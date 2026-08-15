/**
 * #313 — reading the ratings back, honestly.
 *
 * "Report it against the rest: satisfaction alongside response time (#239) is
 * the beginnings of an honest picture of how the business is doing."
 *
 * THE HARD PART IS NOT THE AVERAGE, IT IS REFUSING TO SHOW ONE. A mean of three
 * answers is noise, and #313 is explicit about what noise costs here: "in a
 * small crew, a bad month for one tech is noise, and treating it as data
 * damages trust faster than it improves service." The first time this number
 * disagrees with the owner's gut on evidence that thin, they stop believing the
 * panel — and #239 already learned that lesson about response time.
 *
 * So the floor lives here, in one place, and the server applies it before the
 * number is ever sent to a client. Three clients cannot disagree about a rule
 * they were never given.
 */

/**
 * How many answers before an average means anything.
 *
 * Five, not three. Under five, a single unhappy customer moves the average by
 * more than a point — which is a swing the owner would read as a trend and act
 * on. Five is still a small sample; it is the point at which the number stops
 * being dominated by one person's bad morning.
 *
 * Applied per SCOPE, not per workspace: a member with four answers has no
 * average even in a workspace with two hundred, because the coaching
 * conversation that number would start is about that member.
 */
export const SATISFACTION_MIN_SAMPLE = 5;

/**
 * How much the average must move before it is called a direction.
 *
 * Scores are 1–5, so a tenth of a point is rounding. Two tenths is the smallest
 * move that survives one extra answer landing either way in a modest sample,
 * and calling anything smaller "better" is the panel inventing a trend.
 */
export const SATISFACTION_ARC_MIN_DELTA = 0.2;

/** At or below this, a rating needed a human that day. Mirrors the alert. */
export const SATISFACTION_POOR_AT_OR_BELOW = 2;

/**
 * The average as a person reads it: one decimal, or an em dash.
 *
 * Null renders as "—" rather than "0.0" or "N/A". A zero is a score nobody can
 * give — the scale starts at 1 — so showing one would be the panel lying about
 * a workspace nobody has answered for yet.
 */
export function formatSatisfaction(average: number | null | undefined): string {
  if (average === null || average === undefined || !Number.isFinite(average)) {
    return "—";
  }
  return average.toFixed(1);
}

/**
 * Which way it moved, or null when the honest answer is "not enough to say".
 *
 * Mirrors `responseArcDirection` deliberately: the two cards sit next to each
 * other, and an arc that means one thing on the left and another on the right
 * is worse than no arc at all.
 */
export function satisfactionArcDirection(
  improvedBy: number | null | undefined,
): "better" | "worse" | null {
  if (
    improvedBy === null ||
    improvedBy === undefined ||
    !Number.isFinite(improvedBy) ||
    Math.abs(improvedBy) < SATISFACTION_ARC_MIN_DELTA
  ) {
    return null;
  }
  return improvedBy > 0 ? "better" : "worse";
}

/**
 * What the panel says, in one place.
 *
 * Every "we do not know" state gets a sentence rather than a blank, for the
 * same reason #239's card does: a panel that goes quiet when it is unsure reads
 * as broken, and a panel that guesses reads as untrustworthy the first time it
 * is wrong.
 */
/**
 * What the panel says — catalogue KEYS since #228.
 *
 * Four of these are the keys BOTH PHONES have been saying for months. Their
 * cards were converted and the web's was not, so the same five sentences
 * existed twice: once as French under `inbox.satisfaction*` and once as
 * English here, feeding only the web. Naming the phones' keys collapses that
 * rather than minting a third spelling.
 *
 * There is no `heading` any more. It held "How customers rate the work" and
 * nothing on any client rendered it: the web card titles itself from
 * `inbox.satisfactionTitle` and both phone cards say "SATISFACTION". The
 * conversion is what surfaced it — a sentence with no reader has no language
 * to be in.
 */
export const SATISFACTION_COPY = {
  /** Asked, nobody answered yet. Not a failure — most people do not reply. */
  none_answered: "inbox.satisfactionGapNoneAnswered",
  /** Asked too few times to average. Says the count so it is not a mystery. */
  too_few: "inbox.satisfactionMemberTooFew",
  /** Nothing asked at all in the window. */
  none_asked: "inbox.satisfactionGapNoneAsked",
  /** Per-member is off, which is a choice rather than an omission. */
  per_member_off: "inbox.satisfactionByMemberOff",
} as const;

/** Every key this module names. */
export type SatisfactionKey =
  | (typeof SATISFACTION_COPY)[keyof typeof SATISFACTION_COPY]
  | "inbox.satisfactionPoorOne"
  | "inbox.satisfactionPoorMany";

/** The reader's resolver. */
export type SaySatisfaction = (key: SatisfactionKey) => string;

/**
 * The count of poor ratings, said as a sentence.
 *
 * Framed as something that happened and was handled, not as a score against the
 * business. "2 needed a call back" is a fact an owner can check; "customer
 * satisfaction: 87%" is a number nobody can do anything with.
 *
 * *Applying: Loss Aversion & Meaningful Highlights — the actionable count, not
 * the flattering percentage.*
 */
export function poorRatingLine(count: number, say: SaySatisfaction): string {
  // Two whole sentences, not a count glued to a shared fragment. The fragment
  // was "needed a call back", and French cannot use it: the verb agrees with
  // the number — "1 travail A nécessité un rappel" against "3 travaux ONT
  // nécessité un rappel" — so a shared tail would be wrong in one of the two
  // cases no matter which way it was written.
  return count === 1
    ? say("inbox.satisfactionPoorOne")
    : say("inbox.satisfactionPoorMany").replace("{count}", String(count));
}
