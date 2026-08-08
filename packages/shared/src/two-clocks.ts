/**
 * #539 — a time on this screen must say whose clock it is on.
 *
 * ## The bug this closes, and why it is worse than it looks
 *
 * A queued message showed "Tue 8:00 AM", formatted in the CUSTOMER's zone
 * because that is the time the sender chose. Nothing said so. A dispatcher in
 * Toronto reading a send queued for a customer in Vancouver saw "8:00 AM" and
 * read their own clock — and it goes out at 11am theirs. The string is correct
 * and the reader is wrong, which is the worst kind of label: there is nothing on
 * the screen to argue with.
 *
 * Every scheduling surface had the same shape. The picker labels its presets
 * "their clock"; the list of what is queued did not, and neither did the
 * reminders, the snoozes, or anything else that shows a future instant.
 *
 * ## The rule
 *
 * One instant, two wall clocks. Say both — but ONLY when they differ, because a
 * crew whose customers are all in town would otherwise read "8:00 AM their time ·
 * 8:00 AM yours" on every row forever, and a label that is noise on the common
 * day is a label people stop reading before the day it matters.
 *
 * ## Why "differ" is decided on the rendered clock, not the zone name
 *
 * `America/Toronto` and `America/New_York` are two names for one clock. Deciding
 * by name would put "their time · yours" on every row of a workspace that texts
 * across a state line into the same hour — noise, and the same noise the
 * paragraph above refuses. Deciding on the rendered wall clock is also correct
 * across DST on its own, without a single line of offset arithmetic: on the two
 * days a year an offset would be wrong, the formatted strings are simply right.
 *
 * ## The split with the clients
 *
 * This module owns the RULE and the WORDS. Formatting an instant into a wall
 * clock stays with each platform's own formatter — `Intl` here, `java.time` on
 * Android, `DateFormatter` on iOS — because a date rendered by hand in three
 * languages is three chances to disagree about a locale.
 */

/** What the destination's clock is called, in the product's voice. */
export const CLOCK_THERE = "their time";

/** ...and the reader's own. Not "my time": the screen is talking TO them. */
export const CLOCK_HERE = "yours";

/**
 * Are these two rendered wall clocks the same moment on the same clock face?
 *
 * Takes the FORMATTED strings rather than the zones, so the comparison is
 * whatever the caller is about to put on the screen. If the two strings a reader
 * would see are identical, there is nothing to disambiguate and the label would
 * be noise.
 *
 * Both are trimmed before comparing, because a formatter that pads differently
 * for one zone than another would otherwise force the label on for a difference
 * nobody can see.
 */
export function sameClock(there: string, here: string): boolean {
  return there.trim() === here.trim();
}

/**
 * The line to show for one instant.
 *
 * `here` may be null when the caller already knows the reader's clock is not
 * worth naming — a settings screen that is explicitly about the workspace's own
 * zone, for instance. Passing the same string twice is the same as passing null,
 * which is what makes this safe to call unconditionally from a render path.
 *
 * The separator is a middot rather than a bracket or a slash: it reads as one
 * line of two facts, which is what it is, and it survives a narrow column
 * without looking like a truncation.
 */
export function bothClocks(there: string, here?: string | null): string {
  const t = there.trim();
  if (!here || sameClock(t, here)) return t;
  return `${t} ${CLOCK_THERE} · ${here.trim()} ${CLOCK_HERE}`;
}

/**
 * The same two facts for a screen reader, spelled out.
 *
 * A middot is announced as "middle dot" or skipped entirely depending on the
 * reader, and "8:00 AM their time middle dot 11:00 AM yours" is not a sentence.
 * Used as the accessible name wherever {@link bothClocks} is the visible text.
 */
export function bothClocksSpoken(there: string, here?: string | null): string {
  const t = there.trim();
  if (!here || sameClock(t, here)) return t;
  return `${t} ${CLOCK_THERE}, which is ${here.trim()} ${CLOCK_HERE}`;
}

/**
 * Which clock a typed time is being read in — the switch #539 asks for
 * ("why cant i choose? let me switch?").
 *
 * Two values, not a zone picker. The question a sender actually has is "did I
 * mean 8am here or 8am there", and offering them 400 IANA zones to answer it
 * would be a worse version of the same confusion. The destination's zone is
 * already resolved and the reader's is their device — those are the only two
 * clocks anybody is thinking in.
 */
export type ClockChoice = "theirs" | "yours";

/** What the switch says for each side. */
export const CLOCK_CHOICE_LABELS: Record<ClockChoice, string> = {
  theirs: "Their time",
  yours: "Your time",
};

/**
 * The default side for a typed time, and why it is the reader's own.
 *
 * A native date-and-time field reads and writes the DEVICE's zone — there is no
 * way to hand one a different zone and have it round-trip. Defaulting to
 * "theirs" would mean the value the field shows is not the value it holds, which
 * is a worse bug than the one this switch exists to fix.
 *
 * So the field starts honest, and the switch is what lets somebody say they
 * meant the other one.
 */
export const CLOCK_CHOICE_DEFAULT: ClockChoice = "yours";

/** A wall clock, as a person reads it off a picker. */
export interface WallClock {
  year: number;
  /** 1–12, the way a person says it. */
  month: number;
  day: number;
  hour: number;
  minute: number;
}

/**
 * The instant at which a given zone's clock reads this wall time.
 *
 * This is what the #539 switch needs. A native date-and-time field can only read
 * and write the DEVICE's zone, so "8am their time" is not something the field can
 * express — the value has to be converted, and the conversion is the whole reason
 * this function is here rather than being an offset subtraction at the call site.
 *
 * ## Why it iterates instead of adding an offset
 *
 * You cannot know a zone's offset until you know the instant, and you cannot know
 * the instant until you know the offset. So: assume the wall time is UTC, ask the
 * zone what it renders as, correct by the difference, and ask again. Two rounds
 * settle every real zone including the ones offset by 30 or 45 minutes, because
 * the second round is already within an hour of the answer.
 *
 * ## The two days a year
 *
 * SPRING FORWARD skips an hour, so 2:30am simply does not exist. The correction
 * lands just past the gap, which is the only sane answer — a send asked for at a
 * time that never happens goes at the first moment that did.
 *
 * FALL BACK has 1:30am twice. This returns the FIRST, the earlier of the two, so a
 * message asked for at 1:30 goes at the first 1:30 rather than an hour later than
 * the sender expected.
 *
 * Returns null for a zone the runtime rejects, so a caller can fall back to the
 * reader's own clock rather than sending at a guessed instant.
 */
export function instantForWallClock(
  wall: WallClock,
  timeZone: string,
): Date | null {
  const target = Date.UTC(
    wall.year,
    wall.month - 1,
    wall.day,
    wall.hour,
    wall.minute,
  );
  let guess = target;
  let previous = target;
  for (let round = 0; round < 2; round += 1) {
    const rendered = wallClockInZone(new Date(guess), timeZone);
    if (rendered === null) return null;
    const renderedUtc = Date.UTC(
      rendered.year,
      rendered.month - 1,
      rendered.day,
      rendered.hour,
      rendered.minute,
    );
    const drift = renderedUtc - target;
    if (drift === 0) return new Date(guess);
    previous = guess;
    guess -= drift;
  }
  // NEITHER ROUND SETTLED, so the wall time does not exist — the clocks jumped
  // over it. Two candidates straddle the gap, and taking the LATER one is the
  // only sane answer: a send asked for at 2:30 on the morning that has no 2:30
  // goes at the first moment that did happen, never at 1:30, which is earlier
  // than the sender asked for. Correcting blindly lands on the earlier one,
  // which is the bug this line exists to prevent.
  return new Date(Math.max(guess, previous));
}

/**
 * What a zone's clock reads at an instant, as numbers.
 *
 * `Intl` rather than arithmetic, so the runtime's own tzdata answers and DST is
 * never something this file computes. Null for a zone it rejects.
 */
export function wallClockInZone(
  at: Date,
  timeZone: string,
): WallClock | null {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).formatToParts(at);
    const get = (type: string): number =>
      Number(parts.find((p) => p.type === type)?.value ?? Number.NaN);
    const wall = {
      year: get("year"),
      month: get("month"),
      day: get("day"),
      // Midnight comes back as hour 24 in some ICU versions, which would put the
      // day one out for every send timed at exactly 00:00.
      hour: get("hour") % 24,
      minute: get("minute"),
    };
    return Object.values(wall).some(Number.isNaN) ? null : wall;
  } catch {
    return null;
  }
}

/**
 * #539 — why the CUSTOMER'S clock is the one that decides, and how to fix it.
 *
 * The issue asks "why are we deriving time from customers area codes even? what if
 * i bought my phone number in quebec but now live in alberta?" — and the honest
 * answer was nowhere on any screen.
 *
 * The answer is that the rule about when a business may text somebody keys on
 * where the RECIPIENT is, not where the sender is, so their clock is the one that
 * governs whether a send is allowed. The area code is how we guess it when nobody
 * has told us, and it is a guess that goes wrong exactly the way the issue
 * describes: a mobile keeps its code when its owner moves.
 *
 * So the line says both halves — why theirs is the clock that counts, and that a
 * wrong guess is correctable — and it is shown ONLY on the guessed rung. A member
 * who already set the zone on the contact does not need to be told they can, and
 * saying it on a non-geographic number where we admit we are showing the shop's own
 * clock would be offering to correct something we never inferred.
 */
export const CLOCK_AREA_CODE_NOTE =
  "The rules about when you may text go by their clock, not yours. If this number moved, set their timezone on the contact.";

/** Where a member goes to correct it, so three clients name the same screen. */
export const CLOCK_AREA_CODE_FIX = "set their timezone on the contact";
