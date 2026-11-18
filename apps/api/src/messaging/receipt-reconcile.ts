import { getDb } from "../db";
import type { Env } from "../env";
import { deployEnv } from "../environments/mode";
import { captureException } from "../observability/capture";
import { telnyxRequest } from "../telnyx/client";
import type { TelnyxEvent, TelnyxMessagePayload } from "./types";

const HOUR_MS = 3_600_000;
const LOOKBACK_MS = 10 * 24 * HOUR_MS;
const CHECK_LIMIT = 40;
const CHECK_BATCH = 10;

interface ReceiptCandidate {
  id: string;
  telnyx_message_id: string;
}

type RetrievedMessage = TelnyxMessagePayload & { completed_at?: string | null };

export async function reconcileOutboundReceipts(env: Env, now = new Date()): Promise<void> {
  if (deployEnv(env) !== "production") return;

  const db = getDb(env);
  const checkedAt = now.toISOString();
  const cutoff = new Date(now.getTime() - HOUR_MS).toISOString();
  const unchecked = `receipt_checked_at.is.null,receipt_checked_at.lte.${cutoff}`;
  const { data, error } = await db.from("messages")
    .select("id,telnyx_message_id")
    .eq("direction", "outbound")
    .in("status", ["queued", "sent"])
    .not("telnyx_message_id", "is", null)
    .is("receipt_finalized_at", null)
    .or(unchecked)
    .gte("created_at", new Date(now.getTime() - LOOKBACK_MS).toISOString())
    .lte("created_at", cutoff)
    .order("receipt_checked_at", { ascending: true, nullsFirst: true })
    .order("created_at", { ascending: true })
    .order("id", { ascending: true })
    .limit(CHECK_LIMIT);
  if (error) throw new Error(`outbound receipt candidates: ${error.message}`);

  const candidates = (data ?? []) as ReceiptCandidate[];
  const failures: unknown[] = [];
  for (let start = 0; start < candidates.length; start += CHECK_BATCH) {
    const batch = candidates.slice(start, start + CHECK_BATCH);
    const results = await Promise.allSettled(batch.map(async (row) => {
      const { data: claimed, error: claimError } = await db.from("messages")
        .update({ receipt_checked_at: checkedAt })
        .eq("id", row.id)
        .eq("telnyx_message_id", row.telnyx_message_id)
        .in("status", ["queued", "sent"])
        .is("receipt_finalized_at", null)
        .or(unchecked)
        .select("id");
      if (claimError) throw new Error(`outbound receipt claim: ${claimError.message}`);
      if (!claimed?.length) return;

      const { data: receipt } = await telnyxRequest<{ data?: RetrievedMessage }>(env, {
        method: "GET",
        path: `/v2/messages/${encodeURIComponent(row.telnyx_message_id)}`,
      });
      if (receipt?.id !== row.telnyx_message_id || receipt.direction !== "outbound"
        || !receipt.completed_at || !Number.isFinite(Date.parse(receipt.completed_at))) {
        return;
      }

      const eventId = `reconciled:${row.telnyx_message_id}`;
      const event: TelnyxEvent = {
        data: {
          id: eventId,
          event_type: "message.finalized",
          occurred_at: receipt.completed_at,
          payload: {
            id: receipt.id,
            direction: receipt.direction,
            type: receipt.type,
            to: receipt.to?.map(({ phone_number, status }) => ({ phone_number, status })),
            parts: receipt.parts,
            encoding: receipt.encoding,
            cost: receipt.cost,
            errors: receipt.errors,
          },
        },
      };
      // The webhook sweeper can retry a stalled database write or billing step.
      const { error: ledgerError } = await db.from("webhook_events").upsert({
        provider: "telnyx",
        event_id: eventId,
        event_type: "message.finalized",
        payload: event,
      }, { onConflict: "provider,event_id", ignoreDuplicates: true });
      if (ledgerError) throw new Error(`outbound receipt ledger: ${ledgerError.message}`);
    }));
    for (const result of results) {
      if (result.status === "rejected") {
        failures.push(result.reason);
      }
    }
  }
  if (failures.length > 0) {
    await captureException(env, failures[0], {
      source: "cron",
      job: "job:reconcile-outbound-receipts",
      level: "warning",
      extra: { failed: failures.length, checked: candidates.length },
    });
  }
}
