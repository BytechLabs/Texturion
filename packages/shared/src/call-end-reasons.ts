/**
 * #725: why a call ended, decided once by the call machine at the transition
 * that ended it and stored on `calls.ended_reason`. `calls.routing` (#721)
 * says where an inbound call went when it arrived; this says how it finished.
 *
 * `calls_ended_reason_check` in the database allows exactly these. Each value
 * is a plain fact, not a judgement:
 *
 * - `answered`: a member answered and the call ran to its normal end.
 * - `caller_hung_up`: the caller hung up while it rang, or in voicemail
 *   before leaving a message and with no earlier cause to report.
 * - `no_answer_in_time`: the ring window ran out and the call went to
 *   voicemail.
 * - `declined_by_everyone`: every phone that rang was declined, so the call
 *   went to voicemail early.
 * - `nobody_reachable`: no push or leg could reach anyone, so the call went to
 *   voicemail early.
 * - `left_voicemail`: the caller left a message and no cause came before it
 *   (the routing says why no phone rang: after hours, line busy, screened).
 *   A call that went to voicemail for one of the three causes above keeps that
 *   cause instead, so the person reads why it went to voicemail.
 * - `rejected_blocked`: the caller is blocked.
 * - `rejected_over_limit`: the workspace was over its calling limit.
 * - `line_paused`: the line is suspended or unpaid; the caller heard the
 *   "isn't taking calls" notice or it rang out.
 * - `stuck_call_cleaned_up`: the cleanup timer ended a call that never
 *   resolved.
 * - `intent_expired`: a transfer or consult ran out of time and the call was
 *   torn down.
 * - `voicemail_failed`: the voicemail could not be answered.
 * - `carrier_refused`: the carrier refused to place a leg.
 * - `placer_hung_up`: outbound, the member who placed the call hung up.
 * - `customer_hung_up`: outbound, the customer hung up after answering.
 * - `no_answer`: outbound, the customer never answered.
 */
export const CALL_END_REASONS = [
  "answered",
  "caller_hung_up",
  "no_answer_in_time",
  "declined_by_everyone",
  "nobody_reachable",
  "left_voicemail",
  "rejected_blocked",
  "rejected_over_limit",
  "line_paused",
  "stuck_call_cleaned_up",
  "intent_expired",
  "voicemail_failed",
  "carrier_refused",
  "placer_hung_up",
  "customer_hung_up",
  "no_answer",
] as const;

export type CallEndReason = (typeof CALL_END_REASONS)[number];

export function isCallEndReason(value: unknown): value is CallEndReason {
  return (CALL_END_REASONS as readonly unknown[]).includes(value);
}
