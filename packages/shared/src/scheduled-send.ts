/**
 * #233 — send later: the vocabulary all four surfaces share.
 *
 * The API decides WHEN a scheduled message goes; this module decides what
 * everybody CALLS the result. That split matters here more than usual, because
 * the interesting states of this feature are the ones where a message does not
 * send, and `docs/DECISIONS.md` (against #325) makes disclosing them binding:
 *
 *   - held, not dropped, resuming when the block clears;
 *   - anything held or cancelled is disclosed to the owner when it happens —
 *     "silent disappearance is the one unacceptable option";
 *   - time-sensitive work expires rather than arriving late.
 *
 * A rule about disclosure is only as good as the sentence that does the
 * disclosing, and three clients writing their own version of "we did not send
 * this" is how one of them ends up saying nothing at all. So the reasons live
 * here as data, and `scheduled-send-parity.test.ts` rosters them across web,
 * Android and iOS.
 *
 * THE PORTS ARE BY HAND. Kotlin and Swift cannot import this, so the same
 * strings exist three more times. That is the arrangement the rest of the repo
 * already uses; the roster test is what keeps it from rotting.
 */

export const SCHEDULED_MESSAGE_STATUSES = [
  "pending",
  "held",
  "sent",
  "canceled",
  "expired",
  "failed",
] as const;

export type ScheduledMessageStatus =
  (typeof SCHEDULED_MESSAGE_STATUSES)[number];

/** Still going, as far as anybody knows. */
export function isScheduledMessageLive(status: ScheduledMessageStatus): boolean {
  return status === "pending" || status === "held";
}

/**
 * Why a scheduled message did not go, in the words the owner reads.
 *
 * Each is a REASON, not an error: it says what happened and, where there is
 * one, what the person can do. "recipient_opted_out" deliberately does not
 * offer a remedy, because there is not one — an opt-out can only be lifted by
 * the customer, which is carrier truth rather than our policy.
 */
export const SCHEDULED_HOLD_REASONS = {
  /**
   * The workspace's own subscription lapsed between scheduling and firing.
   * Held rather than failed: this is the case the "resumes on reinstatement"
   * half of the rule exists for.
   */
  subscription_inactive:
    "Your subscription has lapsed, so this has not been sent. It will go out when billing is sorted.",

  /**
   * #277: the workspace's plan is PAUSED — the seasonal hold. Held, not failed,
   * and it clears by itself the moment somebody resumes.
   *
   * A separate reason from `subscription_inactive` because they are separate
   * events with separate remedies: nothing lapsed here, nobody needs to sort a
   * card out, and the number is not on any clock. Note that the sentence above
   * used to say "paused" for a lapse — that word now belongs to this, and two
   * reasons both claiming it is precisely the confusion this roster exists to
   * prevent.
   */
  workspace_paused:
    "Your plan is paused, so this has not been sent. It will go out when you resume.",

  /** US carrier registration still pending. Also temporary, also resumes. */
  registration_pending:
    "This is waiting on carrier approval for US texting. It will send once that clears.",

  /** The outbound kill switch, or a provider incident. */
  service_unavailable:
    "Texting is paused while we deal with an issue. This is still queued and nothing was lost.",

  /**
   * #245/D137: a provider round trip has not proved the mirrored appointment
   * current recently enough to trust the time embedded in its reminder.
   * Recoverable: the calendar pull loop advances `last_verified_at`, and the
   * held reminder is eligible again on the next scheduled-send sweep.
   */
  calendar_unverified:
    "Calendar sync is disconnected or has not checked in recently, so this reminder is waiting. It will send after sync is verified again.",

  /**
   * The customer answered after this was scheduled.
   *
   * #233 asks for this explicitly, and it is the one hold that is about
   * MANNERS rather than capability: "still thinking about that quote?"
   * arriving after they already said yes reads as a robot talking over them.
   */
  customer_replied:
    "They replied after you scheduled this, so we held it rather than talk over them. Send it anyway, or cancel it.",

  /**
   * A STOP arrived in between. Terminal, and the copy says so — binding: an
   * opt-out can only be lifted by the customer.
   */
  recipient_opted_out:
    "They replied STOP after you scheduled this, so it was not sent. Only they can undo that.",

  /** The number stopped being one we can text. Terminal. */
  invalid_destination:
    "We cannot text this number any more, so this was not sent.",

  /** Rule 3: the horizon passed. */
  expired:
    "The send window passed before this could go, so it was not sent. A late message is usually worse than none.",

  /** The workspace closed with this still queued. */
  workspace_closed:
    "The workspace was closed before this was due to send.",

  /**
   * #237: the job this reminder was about is no longer on the books — done,
   * deleted, or reminders switched off for it.
   *
   * ONE reason for three causes, on purpose. From the reader's side the
   * actionable fact is identical: the job is not happening as booked, so we did
   * not text their customer about it. Three near-identical sentences is exactly
   * the drift this roster exists to prevent, and each would have to be ported
   * to Kotlin and Swift to say the same thing a third time.
   *
   * This should almost never be seen. Regenerating a job's reminders already
   * removes them when it changes; this is the fire-time net for the case where
   * that did not run, and a net that stays quiet is a net doing its job.
   */
  job_no_longer_scheduled:
    "That job is no longer booked, so this reminder was not sent.",
} as const;

export type ScheduledHoldReason = keyof typeof SCHEDULED_HOLD_REASONS;

/**
 * #228 — the same ten reasons, as catalogue keys.
 *
 * ## Why both this and the English above
 *
 * Expand and contract, the shape #339 used for payout readiness. The API writes
 * BOTH: `held_reason` keeps the English sentence and `held_reason_key` carries
 * the key. A client that knows the key translates it; one that does not renders
 * the sentence exactly as it always has; and rows written before this existed
 * still say something rather than nothing.
 *
 * The English comes off the wire in a separate change, once no installed build
 * reads it. Deleting it now would blank the reason on every row already in the
 * database, which is the one outcome worse than showing it in English.
 *
 * ## Why this matters more than most untranslated copy
 *
 * This is one of the few places the product volunteers bad news — *your message
 * did not go, and here is what to do about it*. A workspace working in French
 * being told that in English is the wrong sentence to leave for last.
 *
 * The keys are asserted against {@link SCHEDULED_HOLD_REASONS} in both
 * directions by the tests, so a reason cannot gain a sentence without a key or
 * a key without a sentence.
 */
export const SCHEDULED_HOLD_REASON_KEYS = {
  subscription_inactive: "domain.scheduledHoldSubscriptionInactive",
  workspace_paused: "domain.scheduledHoldWorkspacePaused",
  registration_pending: "domain.scheduledHoldRegistrationPending",
  service_unavailable: "domain.scheduledHoldServiceUnavailable",
  calendar_unverified: "domain.scheduledHoldCalendarUnverified",
  customer_replied: "domain.scheduledHoldCustomerReplied",
  recipient_opted_out: "domain.scheduledHoldOptedOut",
  invalid_destination: "domain.scheduledHoldInvalidDestination",
  expired: "domain.scheduledHoldExpired",
  workspace_closed: "domain.scheduledHoldWorkspaceClosed",
  job_no_longer_scheduled: "domain.scheduledHoldJobUnscheduled",
} as const satisfies Record<ScheduledHoldReason, string>;

export type ScheduledHoldReasonKey =
  (typeof SCHEDULED_HOLD_REASON_KEYS)[ScheduledHoldReason];

/**
 * What to render for a held row: the key's words where the client has them,
 * and the stored English otherwise.
 *
 * `translate` returning its own input is how every catalogue in this repo fails
 * — a missing key renders as the key — so a key that resolves to itself counts
 * as absent and falls back. That is the difference between a French reader
 * seeing an English sentence and seeing `scheduled.holdExpired`.
 */
export function scheduledHoldText(
  reasonKey: string | null | undefined,
  storedEnglish: string | null | undefined,
  translate: (key: ScheduledHoldReasonKey) => string,
): string | null {
  if (reasonKey) {
    // THE ONE CAST, and it is where the knowledge is: this value came off the
    // wire, so nothing has proved it is a key we know. The self-resolving check
    // on the next line is what makes the cast safe — an unknown key resolves to
    // itself and falls through to the stored English.
    const words = translate(reasonKey as ScheduledHoldReasonKey);
    if (words && words !== reasonKey) return words;
  }
  return storedEnglish ?? null;
}

/**
 * Does this reason clear on its own?
 *
 * Drives whether the UI offers "we will keep trying" or asks for a decision,
 * and it is the difference between a hold and a failure in the firing job. A
 * reason wrongly marked recoverable is a message that retries forever against
 * a condition that will never change.
 */
export function scheduledReasonRecovers(reason: ScheduledHoldReason): boolean {
  return (
    reason === "subscription_inactive" ||
    // #277: a pause is the most recoverable state in the product — it is a
    // season, and the whole promise is that everything is exactly where it was
    // left when the crew comes back. Marked terminal, a workspace's scheduled
    // work would be quietly destroyed by the act of pausing.
    reason === "workspace_paused" ||
    reason === "registration_pending" ||
    reason === "service_unavailable" ||
    reason === "calendar_unverified" ||
    reason === "customer_replied"
  );
}

/**
 * The sentences the send-later UI says on every client.
 *
 * {@link SCHEDULED_HOLD_REASONS} covers the states where a message did NOT go.
 * This covers the rest of the surface — the picker, the quiet-hours warning,
 * the confirmation — and it is here for the same reason: three clients writing
 * their own version of "that lands late where they are" is three different
 * products, and the phone is where somebody schedules a text at 9:40pm with the
 * van still running.
 *
 * Only whole sentences live here. Button labels and headings stay per-client,
 * because each platform has its own conventions for those and a shared
 * "Cancel" would be pretending a Kotlin `TextButton` and a Radix
 * `DialogFooter` are the same control.
 */
/*
 * #228 — KEYS, because a client renders these.
 *
 * Distinct from [SCHEDULED_HOLD_REASONS] above, which stays English on purpose:
 * those are composed by the server into a push body and a stored row, so they
 * are a wire change with an expand-and-contract window rather than a catalogue
 * edit. These five are read straight off this table by a screen that knows the
 * reader's language.
 */
export const SCHEDULED_SEND_COPY = {
  /**
   * The tail of the picker AND of the confirmation after it is queued. One
   * sentence rather than two near-identical ones, because a roster whose job is
   * to stop three clients drifting apart should not itself hold two ways of
   * saying "nothing here is final".
   */
  picker_reassurance: "domain.scheduledPickerReassurance",

  /**
   * #225 ask 2, in one sentence: warned, never blocked. It offers BOTH doors
   * rather than arguing for one — the tech who just finished the job at 9:40pm
   * may well be right that this customer wants the quote tonight.
   */
  quiet_hours_choice: "domain.scheduledQuietHoursChoice",

  /** When the hour there is unknown — the rung answered, the clock did not. */
  quiet_hours_unknown: "domain.scheduledQuietHoursUnknown",

  /** After it is called off. Says what will NOT happen, which is the point. */
  canceled_confirmation: "domain.scheduledCancelled",

  /**
   * The empty state of the workspace-level view. #233 asks for it "so nobody is
   * surprised", and the honest empty answer is the reassurance itself.
   */
  nothing_scheduled: "domain.scheduledNothingWaiting",
} as const;

export type ScheduledSendCopyKey = keyof typeof SCHEDULED_SEND_COPY;

/**
 * Whose clock the sender picked against, said out loud.
 *
 * Same three rungs and the same wording as the thread's "their time" line, on
 * purpose — a product that says "from their area code" in one place and
 * "estimated" in another has two vocabularies for one fact. The weakest rung
 * admits what it is: scheduling "Monday 8am" against a non-geographic number
 * with no contact override is the SHOP's 8am, and a UI that hides that implies
 * a precision this product does not have.
 */
/**
 * Every catalogue key this function can name.
 *
 * A union rather than `string`, so a client's own `t()` proves its catalogue
 * answers all three. A `string` return would need a cast at the call site, and
 * the cast silences the one error worth having — a key nothing answers renders
 * as its own name under a scheduled row.
 */
export type ScheduledClockKey =
  | "domain.clockTheirTimeContact"
  | "domain.clockTheirTimeAreaCode"
  | "domain.clockWorkspaceTime";

export function scheduledClockProvenance(
  source: "contact" | "area_code" | "company",
): ScheduledClockKey {
  switch (source) {
    case "contact":
      return "domain.clockTheirTimeContact";
    case "area_code":
      return "domain.clockTheirTimeAreaCode";
    default:
      return "domain.clockWorkspaceTime";
  }
}

/** The longest a scheduled body may be, matching the column check. */
export const SCHEDULED_BODY_MAX = 1600;

/** How far out a send may be scheduled. Mirrors the SQL horizon. */
export const SCHEDULED_HORIZON_DAYS = 90;

/** How many live scheduled messages one workspace may hold. Mirrors SQL. */
export const SCHEDULED_PER_COMPANY_CAP = 200;

/** ...and one thread, so a conversation cannot become a drip campaign. */
export const SCHEDULED_PER_THREAD_CAP = 20;

/** The hour presets land on. Early enough to be first in the inbox. */
export const SCHEDULED_PRESET_HOUR = 8;

export interface SchedulePreset {
  /** Stable id, so three clients agree on what "tomorrow" means. */
  id: "tomorrow" | "monday" | "custom";
  /** The words, already said — see the `say` parameter below. */
  label: string;
  /** Absolute instant, or null for the one that opens a picker. */
  at: Date | null;
}

/** The three catalogue keys the presets name. */
export type SchedulePresetKey =
  | "domain.scheduledPresetTomorrow"
  | "domain.scheduledPresetMonday"
  | "domain.scheduledPresetCustom";

/**
 * The two presets plus the escape hatch.
 *
 * Two, not five. #233 names "Tomorrow 8am, Monday 8am, Pick a time" and that is
 * already the right number: a preset list long enough to need reading is slower
 * than the picker it was meant to avoid, and the two that matter are "first
 * thing" and "start of the week".
 *
 * Computed in the DESTINATION's zone, because "tomorrow 8am" means 8am where
 * the customer is reading it. `timeZone` is the resolved rung — see
 * {@link scheduledClockProvenance} for why the UI must say which one.
 *
 * #228: `say` is the reader's resolver, and it is REQUIRED and second-to-last
 * rather than defaulted. A default here would have every existing call site
 * keep compiling and quietly render `domain.scheduledPresetTomorrow` in the
 * menu — the failure mode this whole conversion exists to avoid. Both phones
 * already resolve inside their own port, so `label` holds words on all three.
 */
export function schedulePresets(
  now: Date,
  timeZone: string,
  say: (key: SchedulePresetKey) => string,
): SchedulePreset[] {
  return [
    {
      id: "tomorrow",
      label: say("domain.scheduledPresetTomorrow"),
      at: nextLocalHour(now, timeZone, 1),
    },
    {
      id: "monday",
      label: say("domain.scheduledPresetMonday"),
      at: nextLocalHour(now, timeZone, daysUntilMonday(now, timeZone)),
    },
    { id: "custom", label: say("domain.scheduledPresetCustom"), at: null },
  ];
}

/**
 * Read a wall-clock field out of an instant, in a given zone.
 *
 * `Intl` rather than arithmetic: a fixed offset is wrong twice a year, and
 * "Monday 8am" landing at 7am or 9am across a DST boundary is precisely the
 * bug this feature would be blamed for.
 */
function localParts(
  instant: Date,
  timeZone: string,
): { year: number; month: number; day: number; hour: number; weekday: number } {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hour12: false,
    weekday: "short",
  });
  const parts = Object.fromEntries(
    fmt.formatToParts(instant).map((p) => [p.type, p.value]),
  );
  const weekdays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    // Intl renders midnight as "24" in some locales' hour12:false output.
    hour: Number(parts.hour) % 24,
    weekday: Math.max(0, weekdays.indexOf(String(parts.weekday))),
  };
}

/**
 * The instant that is `SCHEDULED_PRESET_HOUR` local time, `addDays` from now.
 *
 * Solved by search rather than by constructing a date in the target zone,
 * which JavaScript has no direct way to do. Two passes are enough: guess with
 * the current offset, measure the error in the target zone, correct once.
 */
function nextLocalHour(now: Date, timeZone: string, addDays: number): Date {
  const here = localParts(now, timeZone);
  // Midnight UTC on the target local date, as a starting point.
  const guess = new Date(
    Date.UTC(here.year, here.month - 1, here.day + addDays, SCHEDULED_PRESET_HOUR),
  );
  const landed = localParts(guess, timeZone);
  const hourError = landed.hour - SCHEDULED_PRESET_HOUR;
  return new Date(guess.getTime() - hourError * 3_600_000);
}

/** Days from today to the next Monday. Today, if today IS Monday, means next. */
function daysUntilMonday(now: Date, timeZone: string): number {
  const weekday = localParts(now, timeZone).weekday;
  const delta = (8 - weekday) % 7;
  return delta === 0 ? 7 : delta;
}
