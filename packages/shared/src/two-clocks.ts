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
