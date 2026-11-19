/**
 * Retry old queued sends with no recorded carrier ID. The same message key
 * also covers a lost response or an ID write that failed after acceptance.
 * Telnyx can refuse a replay if the payload changed, for example when an MMS
 * attachment URL has been signed again.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { ERROR_CODE_STATUS } from "@loonext/shared";

import { getDb } from "../db";
import type { Env } from "../env";
import { ApiError } from "../http/errors";
import { signedMediaUrls } from "./media";
import {
  claimMessageRetry,
  dispatchOutbound,
  persistSendInterruption,
  runPreSendGates,
  STUCK_SEND_SECONDS,
} from "./send";
import type { MessageRow } from "./types";
import { captureException, errorLogText, reportHandledFailure } from "../observability/capture";

/**
 * One automatic attempt, then the row falls to the fail-out sweeper.
 *
 * Enough for the failure this addresses — a Worker that died mid-dispatch, a
 * transient partition. Anything that survives one clean re-dispatch is not
 * transient, and a second attempt would only delay telling the human.
 */
export const AUTO_RETRY_LIMIT = 1;

/**
 * Bounded per run. The stuck predicate should match a handful of rows at
 * worst; a batch this size hitting it means something systemic is happening,
 * and re-dispatching hundreds of texts inside one cron tick is the last thing
 * that situation needs.
 */
const RETRY_BATCH = 25;

interface ClaimedRow {
  id: string;
  company_id: string;
  conversation_id: string;
}

interface SendView {
  /** #291: the number the thread is with, not the contact's primary. */
  contact_phone_e164: string | null;
  phone_numbers: { number_e164: string | null; status: string };
}

/**
 * Re-dispatch one claimed row, or leave it failed.
 *
 * Every gate a human retry runs, this runs — `runPreSendGates` is the only
 * thing that can mint the clearance `dispatchOutbound` demands, so a path that
 * skipped the opt-out or registration check would not compile. That is the
 * point: this is the SAME retry the button performs, minus the human.
 */
async function retryOne(
  env: Env,
  db: SupabaseClient,
  row: ClaimedRow,
): Promise<boolean> {
  const { data: viewData, error: viewError } = await db
    .from("conversations")
    // #291: the thread's number. A retry that went to a different
    // line than the original attempt would be a second message to
    // somebody who never got the first.
    .select("contact_phone_e164,phone_numbers(number_e164,status)")
    .eq("company_id", row.company_id)
    .eq("id", row.conversation_id)
    .maybeSingle();
  if (viewError || !viewData) return false;
  const view = viewData as unknown as SendView;

  const from = view.phone_numbers?.number_e164;
  // A number still provisioning, or released since the send was queued. There
  // is nothing to re-dispatch from; the fail-out sweeper will tell the human.
  if (!from || view.phone_numbers.status !== "active") return false;
  const to = view.contact_phone_e164;
  if (!to) return false;

  // The gates re-run because the world may have changed since the message was
  // queued: the customer may have texted STOP in the intervening minutes, and
  // sending anyway would break the one rule that cannot be got wrong.
  const clearance = await runPreSendGates(env, row.company_id, to);

  const { data: attachments } = await db
    .from("message_attachments")
    .select("storage_path")
    .eq("company_id", row.company_id)
    .eq("message_id", row.id)
    .order("storage_path", { ascending: true });
  const mediaUrls = await signedMediaUrls(
    db,
    ((attachments ?? []) as { storage_path: string }[]).map((a) => a.storage_path),
  );

  // The same arbiter the retry route uses: eligibility, the SQL rate and cap
  // gates, and the queued→failed→queued flip all under row locks. A row that
  // is over cap or rate-limited gets a typed error here and never reaches
  // Telnyx, exactly as a human retry would.
  const requeued = await claimMessageRetry(db, {
    companyId: row.company_id,
    messageId: row.id,
    stuckAfterSeconds: STUCK_SEND_SECONDS,
  });

  await dispatchOutbound(env, db, requeued, {
    from,
    to,
    text: (requeued).body ?? "",
    refreshPublicLinks: true,
    mediaUrls,
    clearance,
  });
  return true;
}

/**
 * Re-dispatch queued sends with no recorded carrier ID past the retry window.
 *
 * Returns how many went out. Runs BEFORE `failStuckOutboundSends` in the same
 * sweep, so a row this declines still gets failed out in the same tick rather
 * than waiting for the next one.
 */
export async function retryInterruptedSends(
  env: Env,
  _now: Date = new Date(),
  db: SupabaseClient = getDb(env),
): Promise<number> {
  const { data, error } = await db.rpc("claim_stuck_sends_for_retry", {
    p_stuck_after_seconds: STUCK_SEND_SECONDS,
    p_max_attempts: AUTO_RETRY_LIMIT,
    p_limit: RETRY_BATCH,
  });
  if (error) throw new Error(`stuck-send retry claim failed: ${error.message}`);

  const rows = (data ?? []) as ClaimedRow[];
  let sent = 0;
  for (const row of rows) {
    try {
      if (await retryOne(env, db, row)) sent += 1;
    } catch (error_) {
      // One workspace's gate refusal — an expired subscription, a customer who
      // texted STOP, a number over its cap — must not stop the rest of the
      // fleet being retried. The row keeps its bumped counter, so it is the
      // fail-out sweeper's next, which is the correct destination for a send
      // that cannot go.
      if (error_ instanceof ApiError && ERROR_CODE_STATUS[error_.code] < 500) {
        console.warn(`auto-retry declined for message ${row.id}:`, errorLogText(error_));
      } else {
        void reportHandledFailure(env, "message-auto-retry", error_, {
          ids: { messageId: row.id },
        });
      }
      await persistSendInterruption(
        db,
        { id: row.id, company_id: row.company_id } as MessageRow,
        "The send was interrupted before reaching the carrier and could not be resent automatically.",
      );
    }
  }

  if (sent > 0) {
    // Worth saying out loud: every one of these is a customer message that was
    // silently unsent and is now on its way. Count only, never bodies (§10).
    console.log(`auto-retried ${sent} interrupted outbound send(s)`);
    void captureException(
      env,
      `stuck-send sweeper auto-retried ${sent} interrupted send(s)`,
      { source: "cron", level: "warning" },
    );
  }
  return sent;
}
