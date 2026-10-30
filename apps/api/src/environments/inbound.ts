import type { Env } from "../env";
import type { TelnyxEvent } from "../messaging/types";
import { telnyxRequest } from "../telnyx/client";
import { inboundCallerRefusal } from "./policy";

interface InboundCaller {
  from: string | null;
  /** Set only on the event that opens a call, which is the one to reject. */
  rejectCallControlId: string | null;
}

/**
 * Who is calling or texting us, for the events that carry a caller. Outbound
 * legs we dialled ourselves, delivery receipts and account events have no
 * caller to judge and pass untouched.
 */
function inboundCaller(event: TelnyxEvent): InboundCaller | null {
  const type = event.data?.event_type ?? "";
  const payload = (event.data?.payload ?? {}) as Record<string, unknown>;

  if (type === "message.received") {
    const from = payload.from as { phone_number?: unknown } | undefined;
    return {
      from: typeof from?.phone_number === "string" ? from.phone_number : null,
      rejectCallControlId: null,
    };
  }

  if (type.startsWith("call.")) {
    if (payload.direction === "outgoing") return null;
    // Some leg events omit the direction. Without one, only a stated caller
    // can be judged; a withheld one on an explicitly incoming call cannot pass.
    if (payload.direction !== "incoming" && typeof payload.from !== "string") {
      return null;
    }
    const ccid =
      typeof payload.call_control_id === "string" ? payload.call_control_id : null;
    return {
      from: typeof payload.from === "string" ? payload.from : null,
      rejectCallControlId: type === "call.initiated" ? ccid : null,
    };
  }

  return null;
}

/**
 * D142: the inbound gate. True means the event was refused and must go no
 * further: not into the webhook ledger, not to ring, voicemail, transcription
 * or text-back. The caller answers Telnyx 200 so it stops retrying.
 *
 * A refused call is rejected outright rather than left to ring out, so the
 * robot's stranger probe hears a rejection instead of a ring window.
 */
export async function refuseStrangerInbound(
  env: Env,
  event: TelnyxEvent,
): Promise<boolean> {
  const caller = inboundCaller(event);
  if (caller === null) return false;
  const refusal = inboundCallerRefusal(env, caller.from);
  if (refusal === null) return false;

  if (caller.rejectCallControlId !== null) {
    try {
      await telnyxRequest(env, {
        method: "POST",
        path: `/v2/calls/${caller.rejectCallControlId}/actions/reject`,
        body: { cause: "CALL_REJECTED" },
      });
    } catch (cause) {
      // The leg still never reaches a member: refusing the event is what
      // keeps it from ringing, and an unanswered leg times out on its own.
      console.warn(
        `inbound gate: reject failed: ${cause instanceof Error ? cause.message : String(cause)}`,
      );
    }
  }
  console.log(`inbound gate: ${event.data?.event_type} refused; ${refusal}`);
  return true;
}
