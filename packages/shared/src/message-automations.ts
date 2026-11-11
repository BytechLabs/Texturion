/**
 * #725: which automation sent a text, stored on `messages.automation`.
 *
 * `messages.automated` (#388) says a machine wrote the text rather than the
 * person in `sent_by_user_id`; this says which one, so a thread can read
 * "Sent automatically · Away reply" instead of looking like the owner typed it.
 * `messages_automation_check` allows exactly these, and a text carrying one is
 * always `automated`.
 *
 * - `away_reply`: the after-hours or away message.
 * - `help_reply`: the answer to a French AIDE request (English HELP is the
 *   carrier's own reply).
 * - `off_ramp`: the "this number has moved" reply.
 * - `emergency_ack`: the acknowledgment of an urgent text.
 * - `missed_call_text`: the text-back after a missed call.
 * - `job_rating`: the ask for a rating after a job is done.
 * - `reminder`: a task's reminder to the customer.
 */
export const MESSAGE_AUTOMATIONS = [
  "away_reply",
  "help_reply",
  "off_ramp",
  "emergency_ack",
  "missed_call_text",
  "job_rating",
  "reminder",
] as const;

export type MessageAutomation = (typeof MESSAGE_AUTOMATIONS)[number];

export function isMessageAutomation(value: unknown): value is MessageAutomation {
  return (MESSAGE_AUTOMATIONS as readonly unknown[]).includes(value);
}
