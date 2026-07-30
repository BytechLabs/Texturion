/**
 * #239 — how a response time READS, in one place.
 *
 * This number is the product's whole retention argument, and the customer is
 * meant to repeat it to other contractors: "we answer in four minutes". So it has
 * to say the same thing on the laptop, the phone and the tablet, or the crew
 * comparing two screens learns not to trust either.
 *
 * Hand-ported to Kotlin (`ResponseTimeFormat.kt`) and Swift
 * (`ResponseTimeFormat.swift`) with the SAME table of cases in each unit suite,
 * because hand-ported logic drifts silently and the drift is invisible until a
 * customer notices.
 *
 * Deliberately NOT `formatCallDuration` (apps/web/src/lib/format/call.ts). That
 * is mm:ss for a call you are listening to, where every second counts. This is a
 * human phrase for a span that can be four seconds or four days, and "76:32:11"
 * is not something anybody repeats out loud.
 */

/** Rounded, coarse, and honest: the largest unit that still tells the truth. */
export function formatResponseTime(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds)) {
    // No median is a real state — a window with no answered lead. The caller
    // decides what to say around it; this refuses to invent a zero.
    return "—";
  }
  const total = Math.max(0, Math.round(seconds));

  // Under a minute is the number worth bragging about, so it keeps its
  // precision. "Under a minute" would round away the difference between a
  // fifty-second reply and a five-second one.
  if (total < 60) return `${total} sec`;

  // ROUNDING CARRIES. Every unit here is rounded, and a rounded remainder can
  // reach a whole unit of the next size up: 3,599 seconds rounds to 60 minutes
  // and 86,399 rounds to 24 hours. Without the carry those print as "60 min"
  // and — the one that would have shipped — "23 hr 60 min", which is the sort of
  // thing a customer screenshots.
  let minutes = Math.round(total / 60);
  let hours = 0;
  let days = 0;
  if (minutes >= 60) {
    hours = Math.floor(minutes / 60);
    minutes -= hours * 60;
  }
  if (hours >= 24) {
    days = Math.floor(hours / 24);
    hours -= days * 24;
  }

  if (days > 0) {
    // Past a day the exact hours stop mattering: the story is "nobody answered
    // this for two days", and the crew already knows that is bad. Rounded to
    // whole days so a 25-hour silence does not read as a precise 1 day 1 hr.
    const rounded = hours >= 12 ? days + 1 : days;
    return rounded === 1 ? "1 day" : `${rounded} days`;
  }
  if (hours > 0) {
    // "3 hr" reads better than "3 hr 0 min", and a stray minute on a three-hour
    // reply is noise nobody acts on.
    if (minutes === 0) return hours === 1 ? "1 hr" : `${hours} hr`;
    return `${hours} hr ${minutes} min`;
  }
  return minutes === 1 ? "1 min" : `${minutes} min`;
}

/**
 * Whether the arc is worth showing as an improvement.
 *
 * A change of under a minute is not a story — it is the same performance
 * measured twice, and dressing it up as progress is how a metric earns a
 * reputation for flattery.
 */
export const RESPONSE_ARC_MIN_SECONDS = 60;

/** Which way the arc goes, or null when there is no arc worth drawing. */
export function responseArcDirection(
  improvedBySeconds: number | null | undefined,
): "faster" | "slower" | null {
  if (
    improvedBySeconds === null ||
    improvedBySeconds === undefined ||
    !Number.isFinite(improvedBySeconds) ||
    Math.abs(improvedBySeconds) < RESPONSE_ARC_MIN_SECONDS
  ) {
    return null;
  }
  return improvedBySeconds > 0 ? "faster" : "slower";
}
