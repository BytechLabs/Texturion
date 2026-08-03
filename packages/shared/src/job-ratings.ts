/**
 * #313 — asking how a job went, and reading the answer.
 *
 * INTERNAL SIGNAL ONLY. D47 re-affirms D32: no public-review path, no review
 * link, nothing that routes a happy customer anywhere. The practice that
 * forecloses — asking privately first and sending only the pleased ones onward
 * — is one Google penalises businesses for, and there is no public ask in this
 * product to route into anyway.
 *
 * The ask itself is a `scheduled_messages` row with `origin = 'rating'`, so
 * every gate, the lease and the exactly-once firing come from #233. What lives
 * here is the vocabulary: what the question says, what counts as an answer,
 * and what counts as bad enough to wake somebody.
 */

/**
 * How long after a job is finished before the question goes.
 *
 * NOT immediately. A tech marks the job done standing in the driveway, and a
 * text arriving thirty seconds later reads as automated because it is — the
 * customer has not had time to form an opinion, and the van is still outside.
 * Four hours is the same evening for a morning job and after work for an
 * afternoon one, which is when somebody is actually looking at their phone.
 */
export const RATING_ASK_DELAY_HOURS = 4;

/**
 * How long the question stays worth asking.
 *
 * Rule 3 (docs/DECISIONS.md): time-sensitive work expires rather than arriving
 * late. "How did it go?" three days after a visit is a business that has lost
 * track of its own week, and the answer is worth less than the impression the
 * question leaves.
 */
export const RATING_ASK_HORIZON_HOURS = 24;

/**
 * At or below this, somebody needs to hear about it today.
 *
 * Two, not three. A 3 out of 5 is "fine" — mildly disappointing at worst — and
 * waking the crew for every one of those is how an alert becomes noise and the
 * genuine 1s get skimmed past with the rest.
 */
export const RATING_POOR_AT_OR_BELOW = 2;

/** Is this the answer that needs a human today? */
export function isPoorRating(score: number): boolean {
  return score <= RATING_POOR_AT_OR_BELOW;
}

/**
 * The question, as the customer reads it.
 *
 * One line, one digit to answer. #313: "anything longer will not be answered by
 * a homeowner on a phone." No link, no form, no survey tool — the reply comes
 * back into the thread the crew is already reading.
 *
 * It says what the number means, because "rate us 1 to 5" without a direction
 * gets a 1 from somebody who meant "first class" often enough to poison a small
 * sample.
 */
export const RATING_ASK_BODY =
  "Thanks for having {business_name} out. How did it go? " +
  "Reply with a number from 1 to 5 — 5 is great.";

/**
 * Read a rating out of a reply, or null when it is not one.
 *
 * DELIBERATELY NARROW. A bare digit, optionally with trailing punctuation or a
 * "/5". Anything else — "5 stars mate", "about a 4 I'd say" — threads as an
 * ordinary message and reaches a person, which is the correct default: the
 * looser this gets, the more real messages get silently eaten as scores.
 *
 * "10/10" is the one shape worth naming: it is a compliment, and it is not on
 * this scale. It returns null and lands in the inbox, where somebody can read
 * it and be pleased.
 */
export function parseRatingReply(body: string): number | null {
  const trimmed = body.trim().replace(/[.!,;:]+$/g, "").trim();
  const match = /^([1-5])(\s*\/\s*5)?$/.exec(trimmed);
  return match ? Number(match[1]) : null;
}

/**
 * What the thread records when an answer arrives.
 *
 * An event, not a reply. Texting "thanks for the 5" back is a second message
 * the customer did not ask for and a segment nobody budgeted; the crew needs to
 * know, and the customer already does. Same reasoning as #237's confirmation.
 */
export const JOB_RATED_EVENT = "job_rated";

/** The timeline line, on every client. */
export function jobRatedLine(score: number): string {
  return `They rated the job ${score} out of 5`;
}
