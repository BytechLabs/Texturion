/**
 * #293 — when "later" is.
 *
 * The presets are here rather than in each client because a snooze set on a
 * phone has to mean the same instant as the identical tap on a laptop. Three
 * clients each deciding what "tomorrow morning" means is three answers, and
 * the crew finds out by the thread coming back at the wrong time.
 *
 * RESOLVED IN THE DEVICE'S OWN CLOCK, deliberately. #292 says "tomorrow
 * morning" is the USER'S morning; the device already knows what that is, and
 * nothing else does. The client resolves the preset to an absolute instant and
 * sends that — so the server never has to guess a timezone it was not told,
 * and somebody working away from home gets the morning they are actually in.
 *
 * Hand-ported to Kotlin (SnoozeLogic.kt) and Swift (SnoozeLogic.swift). The
 * date arithmetic uses each platform's own calendar — it has to, for DST — so
 * what is genuinely shared is the SPEC: which presets exist, what hour each
 * lands on, the order they are offered in, the wording, and the rule that
 * decides when one is not offered at all.
 */

/** The hours a deferral lands on, in the user's own clock. */
export const SNOOZE_MORNING_HOUR = 8;
export const SNOOZE_AFTERNOON_HOUR = 15;
export const SNOOZE_EVENING_HOUR = 18;

/**
 * A preset resolving nearer than this is not offered.
 *
 * At 14:55, "This afternoon" means five minutes away — technically valid, and
 * useless: the thread blinks out and comes straight back, which reads as the
 * feature being broken rather than as the user picking badly. Ten minutes is
 * the floor at which a deferral is a deferral.
 */
export const SNOOZE_MIN_LEAD_MS = 10 * 60 * 1000;

/** Snoozing further out than this is not offered or accepted (see the API). */
export const SNOOZE_MAX_DAYS = 365;

export type SnoozePresetId =
  | "later_today"
  | "this_evening"
  | "tomorrow"
  | "next_week";

export interface SnoozePreset {
  id: SnoozePresetId;
  /** The button. */
  label: string;
  /** The absolute instant it resolves to, epoch milliseconds. */
  at: number;
}

/** The wording, one place, so three clients cannot drift apart on it. */
export const SNOOZE_PRESET_LABELS: Record<SnoozePresetId, string> = {
  later_today: "This afternoon",
  this_evening: "This evening",
  tomorrow: "Tomorrow morning",
  next_week: "Next week",
};

/** Local midnight `days` after `from`, as a fresh Date. */
function atHour(from: Date, addDays: number, hour: number): Date {
  const d = new Date(
    from.getFullYear(),
    from.getMonth(),
    from.getDate() + addDays,
    hour,
    0,
    0,
    0,
  );
  return d;
}

/** Days from `date` forward to the next Monday (never 0 — always next week). */
export function daysUntilNextMonday(date: Date): number {
  // getDay(): Sunday = 0. From Sunday the next Monday is tomorrow; from Monday
  // it is seven days away, because "next week" on a Monday is not today.
  const day = date.getDay();
  return day === 0 ? 1 : 8 - day;
}

/**
 * The presets to offer right now, in order, already resolved.
 *
 * Anything at or before `now + SNOOZE_MIN_LEAD_MS` is dropped rather than shown
 * greyed out: at 4pm there is no "this afternoon" to offer, and a disabled
 * button is a worse answer than a shorter list.
 */
export function snoozePresets(now: Date | number = new Date()): SnoozePreset[] {
  const at = typeof now === "number" ? new Date(now) : now;
  const floor = at.getTime() + SNOOZE_MIN_LEAD_MS;

  const candidates: { id: SnoozePresetId; when: Date }[] = [
    { id: "later_today", when: atHour(at, 0, SNOOZE_AFTERNOON_HOUR) },
    { id: "this_evening", when: atHour(at, 0, SNOOZE_EVENING_HOUR) },
    { id: "tomorrow", when: atHour(at, 1, SNOOZE_MORNING_HOUR) },
    {
      id: "next_week",
      when: atHour(at, daysUntilNextMonday(at), SNOOZE_MORNING_HOUR),
    },
  ];

  return candidates
    .filter((c) => c.when.getTime() > floor)
    .map((c) => ({
      id: c.id,
      label: SNOOZE_PRESET_LABELS[c.id],
      at: c.when.getTime(),
    }));
}

/**
 * Is a custom instant one the API will accept?
 *
 * Mirrors the route's two gates so a client can say so before the round trip
 * instead of rendering a 422. The clients own the picker; this owns the rule.
 */
export function isSnoozeTargetValid(
  target: Date | number,
  now: Date | number = new Date(),
): boolean {
  const t = typeof target === "number" ? target : target.getTime();
  const n = typeof now === "number" ? now : now.getTime();
  if (Number.isNaN(t)) return false;
  return t > n && t - n <= SNOOZE_MAX_DAYS * 86_400_000;
}

/**
 * "Back this afternoon" / "Back Thu" / "Back 12 Aug" — the label on a deferred
 * row and in the snoozed view.
 *
 * Only the SHAPE is decided here (today / tomorrow / this week / a date);
 * each client formats the time and weekday with its own locale API, because a
 * hand-rolled month table is how a product ends up saying "Aug" to somebody
 * whose phone is in French.
 */
export type SnoozeReturnShape = "today" | "tomorrow" | "weekday" | "date";

export function snoozeReturnShape(
  until: Date | number,
  now: Date | number = new Date(),
): SnoozeReturnShape {
  const u = typeof until === "number" ? new Date(until) : until;
  const n = typeof now === "number" ? new Date(now) : now;

  const startOfToday = new Date(
    n.getFullYear(),
    n.getMonth(),
    n.getDate(),
  ).getTime();
  const dayMs = 86_400_000;
  // Day boundaries, not elapsed hours: 11pm to 1am is "tomorrow", and 1am to
  // 11pm is "today", however few or many hours that is.
  const startOfReturn = new Date(
    u.getFullYear(),
    u.getMonth(),
    u.getDate(),
  ).getTime();
  const days = Math.round((startOfReturn - startOfToday) / dayMs);

  if (days <= 0) return "today";
  if (days === 1) return "tomorrow";
  // Inside a week a weekday name is unambiguous and shorter than a date;
  // past that "Thursday" could be any of several, so it has to be the date.
  if (days < 7) return "weekday";
  return "date";
}
