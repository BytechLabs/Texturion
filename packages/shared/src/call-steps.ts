/**
 * #725: the steps of one call, written to that call's own timeline by the call
 * machine as each transition happens, so the call page can say what happened
 * and in what order: it came in, whose phones rang, who declined, who picked
 * up, when it went to voicemail and why it ended.
 *
 * `record_activity_kind_check` allows exactly these (beside the other kinds),
 * and the web and phone timelines each have a sentence for every one.
 *
 * - `call_arrived`: an inbound call reached the line. Payload: `routing`.
 * - `call_placed`: a member placed an outbound call (the actor).
 * - `call_rang`: these members' phones were rung. Payload: `user_ids`, and
 *   `asked` when a member asked to be rung on a call already ringing.
 * - `call_declined`: a member declined (the actor).
 * - `call_answered`: a member picked up (inbound, the actor), or the customer
 *   did (outbound).
 * - `call_voicemail`: the call went to voicemail. Payload: `cause`, a
 *   `CallEndReason` or a `CallRouting`, or null when nothing says why.
 * - `call_ended`: the call ended. Payload: `reason` (a `CallEndReason`) and
 *   `seconds` since it started.
 */
export const CALL_STEP_KINDS = [
  "call_arrived",
  "call_placed",
  "call_rang",
  "call_declined",
  "call_answered",
  "call_voicemail",
  "call_ended",
] as const;

export type CallStepKind = (typeof CALL_STEP_KINDS)[number];

export function isCallStepKind(value: unknown): value is CallStepKind {
  return (CALL_STEP_KINDS as readonly unknown[]).includes(value);
}
