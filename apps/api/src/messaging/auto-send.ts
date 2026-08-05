/**
 * The shared auto-send guard (FEATURE-GAPS Step 0b): the ONE server helper every
 * auto/assisted send routes through. It sends an auto-message into a conversation
 * ONLY IF:
 *   (a) the contact is not on the opt-out mirror,
 *   (b) the triggering inbound is not a STOP/HELP/START keyword,
 *   (c) we have not already auto-replied to this conversation within the
 *       throttle window (default a few hours).
 * (a) and (c) are enforced ATOMICALLY inside the claim_auto_reply RPC (under a
 * conversation row lock, so a burst of inbound yields exactly one reply); (b) is
 * enforced here on the inbound body before the RPC (the RPC has no body).
 *
 * On a successful claim it reuses dispatchOutbound (the exact §8 Telnyx path a
 * normal send uses) and the claim_auto_reply RPC has already logged the
 * 'auto_reply_sent' conversation_event so the crew sees the machine spoke.
 *
 * Compliance basis (D4): every send routed here fires INTO a thread the customer
 * just started (an inbound reply), so it is reply-exempt — no consent
 * attestation, no quiet-hours gate. The opt-out mirror is honored regardless.
 */
import { estimateSegments } from "@loonext/shared";
import type { SupabaseClient } from "@supabase/supabase-js";

import type { Env } from "../env";
import { ApiError } from "../http/errors";
import { isCarrierKeyword, suppressesAutoReply } from "./keywords";
import { dispatchOutbound, type SendClearance } from "./send";
import type { MessageRow } from "./types";

/** Default throttle: one auto-reply per conversation per 3 hours. */
export const AUTO_REPLY_THROTTLE_SECONDS = 3 * 60 * 60;

export type AutoSendOutcome =
  | { sent: true; message: MessageRow }
  | {
      sent: false;
      reason:
        | "carrier_keyword"
        | "recipient_opted_out"
        | "throttled"
        | "subscription_inactive"
        // #277: the workspace's plan is paused. Distinct from an inactive
        // subscription because the claim RPCs now distinguish them, and a
        // caller that collapsed the two would report a seasonal hold as a
        // billing failure in the audit trail.
        | "workspace_paused"
        | "not_found"
        // #414, emergency acknowledgment only.
        | "emergency_disabled"
        | "daily_cap";
    };

interface ClaimResult {
  skipped?:
    | "recipient_opted_out"
    | "throttled"
    | "subscription_inactive"
    | "workspace_paused"
    | "not_found"
    | "emergency_disabled"
    | "daily_cap";
  message?: MessageRow;
}

/**
 * Run an auto-message through the guard. `from`/`to` are the sending number and
 * destination; `body` is ALREADY merge-field-applied and goes out verbatim.
 * `triggerBody` is the inbound text that triggered this auto-send — a
 * STOP/HELP/START keyword short-circuits before any DB write.
 */
export async function guardedAutoSend(
  env: Env,
  db: SupabaseClient,
  args: {
    companyId: string;
    conversationId: string;
    from: string;
    to: string;
    body: string;
    triggerBody: string;
    throttleSeconds?: number;
    /**
     * #331: the caller's proof that the shared pre-send gates ran for `to`.
     * Threaded rather than re-derived here because the gates are per
     * destination and this function does not know how the destination was
     * chosen — the caller does, and the caller is the one that must have
     * asked.
     */
    clearance: SendClearance;
    /**
     * #414: this send IS the answer to an emergency, so the emergency
     * suppression below must not silence it — that rule exists to stop the
     * away reply telling someone to reply URGENT in answer to having replied
     * URGENT, and this is the message it was cleared out of the way FOR.
     * Exactly one caller may set it (emergency-ack.ts). Carrier keywords are
     * still absolute: a contact who sent STOP hears nothing, ever.
     */
    answersEmergency?: boolean;
    /**
     * #228: this send IS the answer to a French request for help, so the
     * suppression below must not silence it. `suppressesAutoReply` refuses AIDE
     * precisely so the away message does not answer it; this is the message it
     * was cleared out of the way FOR. Exactly one caller may set it
     * (help-reply.ts). A STOP still silences everything.
     */
    answersHelp?: boolean;
    /** #414: per-company rolling-24h ceiling, emergency acknowledgment only. */
    dailyCap?: number;
  },
): Promise<AutoSendOutcome> {
  // (b) Never fire on a STOP/HELP/START keyword (Telnyx handles those, D3),
  // and never on an EMERGENCY reply (#414). Without the second, someone who
  // did exactly what the away message asked receives that same instruction
  // back — "reply URGENT and we'll call you" — in answer to having replied
  // URGENT. A robot telling a person with a gas smell to wait until morning is
  // worse than saying nothing.
  const suppressed =
    args.answersEmergency || args.answersHelp
      ? isCarrierKeyword(args.triggerBody)
      : suppressesAutoReply(args.triggerBody);
  if (suppressed) {
    return { sent: false, reason: "carrier_keyword" };
  }

  const segments = Math.max(1, estimateSegments(args.body).segments);

  // (a) opt-out + (c) throttle + the insert-before-Telnyx queued row, atomic.
  // The emergency acknowledgment claims through its own function: it uses a
  // separate throttle stamp, is exempt from the overage cap, and carries a
  // daily ceiling instead. See the migration for each of those decisions.
  const claimRpc = args.answersEmergency
    ? "claim_emergency_ack"
    : "claim_auto_reply";
  const { data, error } = await db.rpc(claimRpc, {
    p_company_id: args.companyId,
    p_conversation_id: args.conversationId,
    p_body: args.body,
    p_segments_estimate: segments,
    p_throttle_seconds: args.throttleSeconds ?? AUTO_REPLY_THROTTLE_SECONDS,
    ...(args.answersEmergency ? { p_daily_cap: args.dailyCap ?? 0 } : {}),
  });
  if (error) throw new Error(`${claimRpc} failed: ${error.message}`);

  const result = data as ClaimResult | null;
  if (!result || result.skipped) {
    return { sent: false, reason: result?.skipped ?? "not_found" };
  }
  if (!result.message?.id) {
    throw new Error("claim_auto_reply returned no message row");
  }

  // Reuse the exact §8 Telnyx send path; the guard row was inserted 'queued'.
  let sent: MessageRow;
  try {
    sent = await dispatchOutbound(env, db, result.message, {
      from: args.from,
      to: args.to,
      text: args.body,
      mediaUrls: [],
      clearance: args.clearance,
    });
  } catch (cause) {
    // The §10 layer-3 per-company rate limiter denied the dispatch AFTER the
    // claim stamped conversations.last_auto_reply_at — without compensation
    // the customer's auto-reply is silently gone for the whole throttle
    // window (any replay hits 'throttled'). Release the stamp so the NEXT
    // inbound in the burst re-attempts naturally; the failed row (persisted
    // by dispatchOutbound) stays in the thread as the audit trail.
    if (cause instanceof ApiError && cause.code === "rate_limited") {
      const { error: releaseError } = await db
        .from("conversations")
        .update(
          args.answersEmergency
            ? { last_emergency_ack_at: null }
            : { last_auto_reply_at: null },
        )
        .eq("id", args.conversationId)
        .eq("company_id", args.companyId);
      if (releaseError) {
        console.error(
          `${claimRpc} throttle release failed for conversation ${args.conversationId}: ${releaseError.message}`,
        );
      }
    }
    throw cause;
  }
  return { sent: true, message: sent };
}
