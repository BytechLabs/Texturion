/**
 * Missed-call classification + the missed-call text-back (MCTB).
 *
 * D43 (#135): the browser is the phone — an unanswered inbound call (nobody
 * answered a browser ring, the caller reached voicemail, the line was busy,
 * or the workspace was gated) is a MISS, and the text-back fires once per
 * call. computeMissedFromEvent stays a PURE cause-table classifier over
 * (eventType, hangup cause, AMD verdict, leg): deciding from the leg tag —
 * the state captured at call time — means a mid-call settings change can
 * never flip how an in-flight call is computed. The legacy forward-leg
 * vocabulary remains for calls in flight across the D43 deploy; nothing
 * dials a cell anymore.
 */
import {
  effectiveMctbMessage,
  estimateSegments,
  isUsCaDestination,
} from "@loonext/shared";
import type { SupabaseClient } from "@supabase/supabase-js";

import type { Env } from "../env";
import { ApiError } from "../http/errors";
import { notifyMissedCall } from "../notifications/missed-call";
import { guardedMissedCallText } from "./auto-send-missed";
import { applySendMergeFields } from "./merge";
import { dispatchOutbound, runPreSendGates } from "./send";

/** Hangup causes that mean the forward leg was NOT answered by a human. */
const MISSED_HANGUP_CAUSES = new Set([
  "timeout",
  "time_out",
  "no_answer",
  "noanswer",
  "busy",
  "user_busy",
  "rejected",
  "call_rejected",
  "originator_cancel",
  "unallocated_number",
]);

/** AMD results that mean a human did NOT pick up (voicemail / IVR / machine). */
const MISSED_AMD_RESULTS = new Set(["machine", "not_human", "fax"]);
/** AMD result that means a person DID pick up — do not text. */
const HUMAN_AMD_RESULT = "human";

export type MissedComputeOutcome =
  | { missed: true }
  | { missed: false; reason: "human_answered" | "not_terminal" | "inbound_leg" };

/**
 * PURE missed-call computation over one Call-Control event. The `leg` comes
 * from the event's echoed client_state tag — the routing decision CAPTURED AT
 * CALL TIME (voice-webhook.ts stamps 'mctb_forward|<caller>' on the dialed
 * leg and 'mctb_inbound_fwd' on the inbound leg it forwarded; an untagged leg
 * means we issued no commands, i.e. the no-forward path). Deciding from the
 * tag instead of re-reading the company means a mid-call forward_to_cell
 * settings change can never flip how an in-flight call is computed.
 */
export function computeMissedFromEvent(args: {
  eventType: string;
  hangupCause?: string | null;
  amdResult?: string | null;
  leg: "forward" | "inbound_forwarded" | "inbound_untagged";
}): MissedComputeOutcome {
  const { eventType, hangupCause, amdResult, leg } = args;

  // AMD verdict on the forward leg: 'human' answered (not missed); 'machine' /
  // 'not_human' means voicemail took it (missed). This can arrive before the
  // leg hangs up, so it is a terminal signal in its own right.
  if (eventType === "call.machine.detection.ended" && leg === "forward") {
    const result = (amdResult ?? "").toLowerCase();
    if (result === HUMAN_AMD_RESULT) {
      return { missed: false, reason: "human_answered" };
    }
    if (MISSED_AMD_RESULTS.has(result)) {
      return { missed: true };
    }
    // 'not_sure' / unknown AMD: wait for the leg's hangup to decide.
    return { missed: false, reason: "not_terminal" };
  }

  if (eventType === "call.hangup") {
    if (leg === "forward") {
      // The forward leg's hangup carries the verdict.
      const cause = (hangupCause ?? "").toLowerCase();
      if (MISSED_HANGUP_CAUSES.has(cause)) {
        return { missed: true };
      }
      // 'normal_clearing' after a human answered and hung up is NOT missed —
      // but a human-answered call is caught by the AMD 'human' branch above and
      // short-circuited before it ever reaches here in the enabled path. A bare
      // normal hangup with no AMD human verdict (e.g. AMD disabled) is treated
      // as answered to avoid texting someone a human just spoke to.
      return { missed: false, reason: "human_answered" };
    }
    if (leg === "inbound_forwarded") {
      // The inbound leg of a FORWARDED call hangs up too, but only the forward
      // leg decides — never double-compute from this side.
      return { missed: false, reason: "inbound_leg" };
    }
    // Untagged inbound leg = the no-forward path (we never answered): the
    // hangup IS a missed call — nobody could have answered it live.
    return { missed: true };
  }

  // Any other event (call.initiated, call.answered, …) is not terminal.
  return { missed: false, reason: "not_terminal" };
}

/** Company MCTB settings the send path needs. */
interface MctbSettings {
  name: string;
  mctb_enabled: boolean;
  mctb_message: string | null;
  subscription_status: string;
}

/**
 * What the text-back path did, for the webhook's #132 crew-alert decision:
 * `alerted` true means THIS function already fired notifyMissedCall (the
 * text-dispatched path — its claim keeps that exactly-once across ledger
 * replays, and it alone knows whether the send landed, so it alone can pick
 * the sent/failed copy); false means the caller owns the alert with 'none'
 * copy (MCTB off/unauthored, opted-out, throttled, non-textable caller,
 * webhook redelivery — no text was attempted in any of them).
 */
export interface MissedCallTextOutcome {
  alerted: boolean;
}

const NO_TEXT: MissedCallTextOutcome = { alerted: false };

/**
 * Fire the missed-call text-back for a COMPUTED-MISSED call. Best-effort: any
 * failure is thrown to the caller (the webhook dispatch), which records it on
 * the ledger for the sweeper — the RPC's per-call idempotency makes the replay
 * safe. `callerE164` is the inbound caller; `calledE164` is our number that was
 * dialed; `callId` is the stable per-call key (call_session_id).
 */
export async function sendMissedCallText(
  env: Env,
  db: SupabaseClient,
  args: {
    companyId: string;
    phoneNumberId: string;
    fromNumberE164: string;
    callerE164: string;
    callId: string;
  },
): Promise<MissedCallTextOutcome> {
  // Company MCTB settings — one small read; mctb_enabled short-circuits so a
  // company without the feature pays nothing beyond this select.
  const { data: companyRows, error: companyError } = await db
    .from("companies")
    .select("name,mctb_enabled,mctb_message,subscription_status")
    .eq("id", args.companyId)
    .limit(1);
  if (companyError) {
    throw new Error(`mctb settings lookup failed: ${companyError.message}`);
  }
  const settings = (companyRows ?? [])[0] as MctbSettings | undefined;
  if (!settings || !settings.mctb_enabled) return NO_TEXT;

  // #192: the toggle alone decides WHETHER a text goes out. The owner's text
  // overrides only when non-blank; otherwise the product default ships — an
  // enabled text-back never silently sends nothing.
  const template = effectiveMctbMessage(settings.mctb_message).message;

  // An anonymous/CLIR caller ('anonymous'), a malformed token, or a non-US/CA
  // number can never be texted — skip SILENTLY. Throwing here would burn all
  // 5 ledger retries + a Sentry page on a condition known final on the first
  // pass (mirrors the forward path's caller-less client_state skip).
  if (!isUsCaDestination(args.callerE164)) return NO_TEXT;

  // §7 send gates (subscription active, US/CA destination registration-clear).
  // A gate failure (lapsed subscription, pending 10DLC registration — states
  // that last days) is first-pass-final for the retry window, so skip SILENTLY
  // like the non-textable caller above. Throwing would burn all 5 ledger
  // retries + a Sentry page on EVERY missed call until the gate clears. A
  // non-gate error (DB/network) still propagates so the sweeper can retry it.
  try {
    await runPreSendGates(env, args.companyId, args.callerE164);
  } catch (cause) {
    if (cause instanceof ApiError) return NO_TEXT;
    throw cause;
  }

  // Merge fields into the booking-forward message — owner-authored or the
  // product default (contact name is unknown for a brand-new caller).
  const body = applySendMergeFields(template, {
    contactName: null,
    businessName: settings.name,
  });

  const segments = Math.max(1, estimateSegments(body).segments);

  const outcome = await guardedMissedCallText(env, db, {
    companyId: args.companyId,
    phoneNumberId: args.phoneNumberId,
    from: args.fromNumberE164,
    callerE164: args.callerE164,
    callId: args.callId,
    body,
    segmentsEstimate: segments,
  });

  // Opted-out / throttled / duplicate → no text. The webhook decides whether
  // an alert is still owed (#132: yes for a fresh miss, no for a redelivery —
  // its timeline-event claim tells those apart; this function cannot).
  if (!outcome.sent) return NO_TEXT;

  // Dispatch the SMS via the exact §8 Telnyx path. The row is the fresh claim's
  // 'queued' insert — or, on a sweeper REPLAY, the prior claim's still-
  // undispatched row handed back by the RPC's replay-heal (a crash or a
  // rate-limit throw landed between claim and dispatch). A rate-limiter denial
  // here THROWS after persisting the row failed+retryable: the ledger replays
  // in ~5 minutes and the replay-heal re-dispatches once the burst passes, so
  // the crew alert below fires exactly once, truthfully, when the text's fate
  // is known. A Telnyx API failure does NOT throw — it returns the failed row
  // and the crew is alerted immediately with failure-aware copy.
  const dispatched = await dispatchOutbound(env, db, outcome.message, {
    from: args.fromNumberE164,
    to: args.callerE164,
    text: body,
    mediaUrls: [],
  });
  const textSent =
    dispatched.telnyx_message_id !== null && dispatched.status !== "failed";

  // Crew-wide alert (§8 notification pipeline, reused): the team learns a call
  // was missed — and whether the auto-text actually went out (a failed text
  // makes the alert MORE urgent, never suppressed). Best-effort inside its own
  // try so a push/email failure never wedges the durable text (already sent).
  try {
    await notifyMissedCall(
      env,
      {
        companyId: args.companyId,
        conversationId: outcome.conversationId,
        callerE164: args.callerE164,
        textStatus: textSent ? "sent" : "failed",
      },
      db,
    );
  } catch (cause) {
    console.error(
      `missed-call alert for conversation ${outcome.conversationId} failed:`,
      cause instanceof Error ? cause.message : String(cause),
    );
  }
  // `alerted` even when notifyMissedCall threw: the attempt was made and
  // best-effort alerts are never retried — the webhook must not double-fire.
  return { alerted: true };
}
