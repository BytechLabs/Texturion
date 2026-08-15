/**
 * #237 — appointment reminders: the vocabulary every surface shares.
 *
 * A no-show is a truck, two techs and half a day gone. The answer is a reminder
 * text before the job and a reply that confirms it, and the two halves of that
 * live here: what the reminders SAY, and which replies count as a yes.
 *
 * The firing, the gates and the exactly-once are not here and not new — a
 * reminder is a `scheduled_messages` row (see the migration header), so it
 * inherits all of that from #233.
 */

/**
 * How many reminder rules one workspace may hold.
 *
 * Two, not five, and the cap is the product decision rather than a technical
 * one: a crew that texts a customer five times before arriving is a crew whose
 * customers stop reading their texts, and that cost lands on the next message
 * that actually matters. Mirrors `appointment_reminder_rules_cap()` in SQL.
 */
export const REMINDER_RULES_CAP = 2;

/** The window an offset may sit in. Mirrors the column's CHECK. */
export const REMINDER_OFFSET_MIN_MINUTES = 15;
export const REMINDER_OFFSET_MAX_MINUTES = 20160; // 14 days

/**
 * What a workspace gets before it has opened the setting.
 *
 * The two the trades actually use: the day before, so the customer can move it
 * while it is still moveable, and a couple of hours out, so somebody is home.
 *
 * Both ask for the reply. A reminder that does not is a notification; one that
 * does is a confirmation, and the difference is the whole no-show argument.
 */
export const DEFAULT_REMINDER_RULES: readonly {
  offset_minutes: number;
  body: string;
}[] = [
  {
    offset_minutes: 1440,
    body:
      "Hi {first_name}, reminder that {business_name} is booked for " +
      "{job_day} at {job_time}. Reply C to confirm, or let us know if you " +
      "need a different time.",
  },
  {
    offset_minutes: 120,
    body:
      "{business_name} here - we're on track for {job_time} today. " +
      "Reply C to confirm.",
  },
];

/** Every catalogue key this module names. */
export type ReminderCopyKey =
  | "domain.reminderOffsetDayBefore"
  | "domain.reminderOffsetDays"
  | "domain.reminderOffsetHour"
  | "domain.reminderOffsetHours"
  | "domain.reminderOffsetMinutes"
  | "thread.sysAppointmentConfirmed";

/** The reader's resolver. */
export type SayReminder = (key: ReminderCopyKey) => string;

/**
 * "The day before", "2 hours before" — the offset, said the way a person would.
 *
 * #228: five keys rather than two, and the singular ones are not an English
 * quirk. "The day before" is a phrase, not a count — French says "La veille",
 * which shares no word with "{count} jours avant". A single key with a number
 * in it would have forced that to be "1 jour avant", which is correct and
 * reads like a machine wrote it.
 *
 * Both phones have said these five since their own pass; this module and the
 * web were the ones still in English.
 */
export function reminderOffsetLabel(minutes: number, say: SayReminder): string {
  if (minutes % 1440 === 0) {
    const days = minutes / 1440;
    return days === 1
      ? say("domain.reminderOffsetDayBefore")
      : say("domain.reminderOffsetDays").replace("{count}", String(days));
  }
  if (minutes % 60 === 0) {
    const hours = minutes / 60;
    return hours === 1
      ? say("domain.reminderOffsetHour")
      : say("domain.reminderOffsetHours").replace("{count}", String(hours));
  }
  return say("domain.reminderOffsetMinutes").replace("{count}", String(minutes));
}

/**
 * Replies that mean "I'll be there".
 *
 * Deliberately short and deliberately forgiving of case and punctuation: this
 * is somebody thumbing a reply at a traffic light, and a confirmation that only
 * works for an exact "C" is a confirmation nobody sends.
 *
 * NOT a general yes-detector. Anything not on this list threads as an ordinary
 * message and reaches a human, which is the correct default — #237 asks for a
 * reschedule request to "route to the inbox as a thing that needs a person",
 * and the way to guarantee that is to keep this list narrow.
 */
export const APPOINTMENT_CONFIRM_KEYWORDS: readonly string[] = [
  "C",
  "CONFIRM",
  "CONFIRMED",
  "YES",
  "Y",
  "YEP",
  "YEAH",
  "OK",
  "OKAY",
];

/**
 * Confirm words that ALSO mean something to the carrier layer.
 *
 * "YES" is in `START_KEYWORDS`: from an opted-out contact it is a request to be
 * texted again, which is carrier truth and outranks anything this feature
 * wants. `opt-out-carrier-truth` is binding — only the customer can lift an
 * opt-out — so a caller must run the opt-out handler FIRST and must not treat a
 * reply as a confirmation when it is doing that job.
 *
 * Named here rather than left implicit so the overlap is a fact somebody can
 * see, and asserted by a test: adding a word to the list above that the carrier
 * layer already owns fails loudly instead of quietly stealing a STOP or a START.
 */
export const CONFIRM_KEYWORDS_ALSO_CARRIER: readonly string[] = ["YES"];

/**
 * Does this reply confirm an appointment?
 *
 * Pure and caller-ordered: it does NOT know whether the contact is opted out,
 * and it must not be asked before the carrier layer has had the message. See
 * {@link CONFIRM_KEYWORDS_ALSO_CARRIER}.
 */
export function isAppointmentConfirmation(body: string): boolean {
  const word = body
    .trim()
    .toUpperCase()
    // Trailing punctuation only. Stripping INNER punctuation would fold
    // "c'mon over" into "CMONOVER" — harmless — but also turn "no, c" into
    // something this could match, and "no" is the opposite answer.
    .replace(/[.!,;:'"]+$/g, "")
    .trim();
  return APPOINTMENT_CONFIRM_KEYWORDS.includes(word);
}

/**
 * What the thread records when a customer confirms.
 *
 * A system line rather than a reply. Texting "thanks for confirming" back is a
 * second message the customer did not ask for, on a thread they have already
 * dealt with — and it costs a segment every time. The crew needs to know; the
 * customer already does.
 */
export const APPOINTMENT_CONFIRMED_EVENT = "appointment_confirmed";

/**
 * The line the timeline shows for that event, on every client — a catalogue
 * KEY since #228, and both phones have rendered it from this key for months.
 */
export const APPOINTMENT_CONFIRMED_LINE: ReminderCopyKey =
  "thread.sysAppointmentConfirmed";
