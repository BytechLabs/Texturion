import type { SupabaseClient } from "@supabase/supabase-js";

import { getDb } from "../db";
import type { Env } from "../env";
import { isRecipientOptedOut } from "../messaging/opt-out";
import { classifyInbound } from "../messaging/spam-flag";
import { captureException } from "../observability/capture";
import { notifyInboundMessage } from "./inbound";

const LOOKBACK_MS = 30 * 60 * 1000;
const BACKSTOP_DELAY_MS = 2 * 60 * 1000;
const BACKSTOP_BATCH = 10;

export interface CrewNotifyVerdict {
  allow_email: boolean;
  allow_push: boolean;
  notify_reason: string;
  emergency: boolean;
  emergency_claimed?: boolean;
  media_count: number;
  reply_user_ids?: string[] | null;
}

interface PendingInboundAlert {
  id: string;
  company_id: string;
  conversation_id: string;
  body: string;
  crew_notify_verdict: CrewNotifyVerdict;
  conversations: { contact_phone_e164: string | null };
}

export async function clearSavedInboundAlert(
  db: SupabaseClient,
  companyId: string,
  messageId: string,
): Promise<void> {
  const { error } = await db.from("messages")
    .update({ crew_notify_state: "none", crew_notify_verdict: null })
    .eq("id", messageId)
    .eq("company_id", companyId)
    .eq("crew_notify_state", "pending");
  if (error) throw new Error(`clear inbound notification: ${error.message}`);
}

export async function deliverSavedInboundAlert(
  env: Env,
  db: SupabaseClient,
  input: {
    messageId: string;
    companyId: string;
    conversationId: string;
    body: string;
    optedOut: boolean;
    verdict: CrewNotifyVerdict;
    requireUnread: boolean;
    recoveredByBackstop?: boolean;
  },
): Promise<void> {
  const { verdict } = input;
  await notifyInboundMessage(env, {
    companyId: input.companyId,
    conversationId: input.conversationId,
    messageId: input.messageId,
    optedOut: input.optedOut || verdict.notify_reason === "opt_out_hint",
    body: input.body,
    mediaCount: verdict.media_count,
    allowEmail: verdict.allow_email,
    allowPush: verdict.allow_push,
    emergency: verdict.emergency,
    emergencyClaimed: verdict.emergency_claimed,
    optOutHint: verdict.notify_reason === "opt_out_hint",
    lead: verdict.notify_reason === "new" || verdict.notify_reason === "reopened",
    replyUsers: verdict.reply_user_ids ?? undefined,
    beforeSend: async () => {
      const { data, error } = await db.rpc("api_mark_inbound_notify_attempted", {
        p_company_id: input.companyId,
        p_message_id: input.messageId,
        p_require_unread: input.requireUnread,
      });
      if (error) throw new Error(`claim inbound notification: ${error.message}`);
      if (data === true && input.recoveredByBackstop) {
        void captureException(env, "Recovered a pending inbound notification", {
          source: "cron",
          level: "warning",
          job: "job:pending-inbound-notifications",
          extra: { message_id: input.messageId },
        });
      }
      return data === true;
    },
  }, db);
}

export async function runPendingInboundNotifications(
  env: Env,
  now = new Date(),
  db = getDb(env),
): Promise<void> {
  const { data, error } = await db.from("messages")
    .select("id,company_id,conversation_id,body,crew_notify_verdict,conversations!inner(contact_phone_e164)")
    .eq("crew_notify_state", "pending")
    .is("deleted_at", null)
    .gte("created_at", new Date(now.getTime() - LOOKBACK_MS).toISOString())
    .lte("created_at", new Date(now.getTime() - BACKSTOP_DELAY_MS).toISOString())
    .order("created_at")
    .limit(BACKSTOP_BATCH);
  if (error) throw new Error(`pending inbound notifications: ${error.message}`);

  const rows = (data ?? []) as unknown as PendingInboundAlert[];
  const results = await Promise.allSettled(rows.map(async (row) => {
    const fromE164 = row.conversations.contact_phone_e164;
    if (!fromE164) {
      await clearSavedInboundAlert(db, row.company_id, row.id);
      return;
    }
    const spam = await classifyInbound(db, {
      companyId: row.company_id,
      conversationId: row.conversation_id,
      fromE164,
      body: row.body,
    });
    if (spam.blocked || (spam.suspected && !row.crew_notify_verdict.emergency)) {
      await clearSavedInboundAlert(db, row.company_id, row.id);
      return;
    }
    await deliverSavedInboundAlert(env, db, {
      messageId: row.id,
      companyId: row.company_id,
      conversationId: row.conversation_id,
      body: row.body,
      optedOut: row.crew_notify_verdict.allow_push && await isRecipientOptedOut(db, row.company_id, fromE164),
      verdict: row.crew_notify_verdict,
      requireUnread: true,
      recoveredByBackstop: true,
    });
  }));
  for (const [index, result] of results.entries()) {
    if (result.status === "rejected") {
      void captureException(env, result.reason, {
        source: "cron",
        level: "warning",
        job: "job:pending-inbound-notifications",
      });
      console.warn(`Pending inbound notification failed for ${rows[index].id}`);
    }
  }
}
