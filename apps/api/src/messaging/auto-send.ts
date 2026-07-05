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
import { isCarrierKeyword } from "./keywords";
import { dispatchOutbound } from "./send";
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
        | "not_found";
    };

interface ClaimResult {
  skipped?:
    | "recipient_opted_out"
    | "throttled"
    | "subscription_inactive"
    | "not_found";
  message?: MessageRow;
}

/**
 * Run an auto-message through the guard. `from`/`to` are the sending number and
 * destination; `body` is ALREADY merge-field-applied and footer-free (a
 * reply-exempt send carries no §5 identification footer). `triggerBody` is the
 * inbound text that triggered this auto-send — a STOP/HELP/START keyword short-
 * circuits before any DB write.
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
  },
): Promise<AutoSendOutcome> {
  // (b) Never fire on a STOP/HELP/START keyword (Telnyx handles those, D3).
  if (isCarrierKeyword(args.triggerBody)) {
    return { sent: false, reason: "carrier_keyword" };
  }

  const segments = Math.max(1, estimateSegments(args.body).segments);

  // (a) opt-out + (c) throttle + the insert-before-Telnyx queued row, atomic.
  const { data, error } = await db.rpc("claim_auto_reply", {
    p_company_id: args.companyId,
    p_conversation_id: args.conversationId,
    p_body: args.body,
    p_segments_estimate: segments,
    p_throttle_seconds: args.throttleSeconds ?? AUTO_REPLY_THROTTLE_SECONDS,
  });
  if (error) throw new Error(`claim_auto_reply failed: ${error.message}`);

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
        .update({ last_auto_reply_at: null })
        .eq("id", args.conversationId)
        .eq("company_id", args.companyId);
      if (releaseError) {
        console.error(
          `auto-reply throttle release failed for conversation ${args.conversationId}: ${releaseError.message}`,
        );
      }
    }
    throw cause;
  }
  return { sent: true, message: sent };
}
