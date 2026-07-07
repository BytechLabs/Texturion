/**
 * Missed-call variant of the shared auto-send guard (FEATURE-GAPS voice wave,
 * Step 1). The away-reply guard (auto-send.ts / claim_auto_reply) assumes the
 * conversation already exists (a customer just texted in). A missed CALLER may
 * never have texted, so the missed-call guard's RPC — claim_missed_call_text —
 * ALSO threads the caller into (creates if needed) a conversation, in the same
 * atomic transaction as the opt-out / throttle / per-call-idempotency checks and
 * the insert-before-Telnyx queued row.
 *
 * Everything the away guard promises still holds: (a) opt-out mirror honored,
 * (b) STOP/HELP short-circuit (checked BEFORE the RPC — but a phone CALL has no
 * keyword body, so there is nothing to short-circuit; the caller passes no
 * triggerBody), (c) per-conversation throttle. Plus a per-CALL idempotency guard
 * (the 'missed_call' event's call_id) so a retried Call-Control webhook can never
 * double-text. dispatchOutbound is run by the caller on the returned row, the
 * exact §8 Telnyx path a normal send uses.
 *
 * Compliance basis (D4): a caller who dialed our number INITIATED contact, so the
 * text-back is a REPLY — reply-exempt, no consent, no quiet-hours. The opt-out
 * mirror is honored regardless (enforced inside the RPC).
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import type { Env } from "../env";
import type { MessageRow } from "./types";

/** One missed-call auto-text per conversation per 3 hours (shared throttle). */
export const MISSED_CALL_THROTTLE_SECONDS = 3 * 60 * 60;

export type MissedCallSendOutcome =
  | { sent: true; message: MessageRow; conversationId: string }
  | {
      sent: false;
      reason:
        | "duplicate"
        | "recipient_opted_out"
        | "throttled"
        | "subscription_inactive"
        | "not_found";
    };

interface ClaimResult {
  skipped?:
    | "duplicate"
    | "recipient_opted_out"
    | "throttled"
    | "subscription_inactive"
    | "not_found";
  message?: MessageRow;
  conversation_id?: string;
  created_conversation?: boolean;
  /**
   * True when the RPC's replay-heal handed back a PRIOR claim's row whose text
   * never reached Telnyx (queued, or failed with no telnyx id) — the sweeper's
   * replay re-dispatches it. Treated identically to a fresh claim by callers;
   * 'duplicate' is returned only once Telnyx actually accepted the text.
   */
  replayed?: boolean;
}

/**
 * Run a missed-call text-back through the guard. `body` is ALREADY merge-field-
 * applied and goes out verbatim. On a successful claim the returned `message`
 * is a 'queued' row the caller dispatches via dispatchOutbound.
 */
export async function guardedMissedCallText(
  env: Env,
  db: SupabaseClient,
  args: {
    companyId: string;
    phoneNumberId: string;
    from: string;
    callerE164: string;
    callId: string;
    body: string;
    segmentsEstimate: number;
    throttleSeconds?: number;
  },
): Promise<MissedCallSendOutcome> {
  const { data, error } = await db.rpc("claim_missed_call_text", {
    p_company_id: args.companyId,
    p_phone_number_id: args.phoneNumberId,
    p_caller_e164: args.callerE164,
    p_call_id: args.callId,
    p_body: args.body,
    p_segments_estimate: Math.max(1, args.segmentsEstimate),
    p_throttle_seconds: args.throttleSeconds ?? MISSED_CALL_THROTTLE_SECONDS,
  });
  if (error) throw new Error(`claim_missed_call_text failed: ${error.message}`);

  const result = data as ClaimResult | null;
  if (!result || result.skipped) {
    return { sent: false, reason: result?.skipped ?? "not_found" };
  }
  if (!result.message?.id || !result.conversation_id) {
    throw new Error("claim_missed_call_text returned no message/conversation");
  }

  return {
    sent: true,
    message: result.message,
    conversationId: result.conversation_id,
  };
}
