/**
 * #247 — when a thread is worth a catch-up, and what the three sections are
 * called.
 *
 * The expensive part of coming back to a busy inbox is not typing, it is
 * READING: reconstructing what was asked, what the crew committed to, and what
 * is still owed. Lou can draft a reply and pull an address out of a sentence,
 * and could not tell anybody what a conversation was ABOUT.
 *
 * This file holds the two things all three clients and the server have to agree
 * on, and nothing else:
 *
 *   1. WHETHER to offer the catch-up at all. A summary of a four-message thread
 *      is slower to read than the thread, so offering one there is the tool
 *      being clever at the user's expense — and it spends an AI unit to do it.
 *      The server enforces this rule authoritatively before anything is
 *      reserved; the clients apply the SAME rule to decide whether the control
 *      is even on screen, so a person is never offered something that answers
 *      "there was nothing to summarise".
 *
 *   2. WHAT THE SECTIONS ARE CALLED. Three fixed headings, written once. #437
 *      found the same claim written sixteen different ways because nothing owned
 *      the words; three clients each inventing a heading for "what we committed
 *      to" is that failure waiting to happen again.
 *
 * DELIBERATELY PURE AND DELIBERATELY DULL. This is hand-ported to Kotlin and
 * Swift, so there is no regex, no date parsing, and no clever syntax here — only
 * integer and duration comparisons, which port without a trap. A `\b` that means
 * backspace in Kotlin is the kind of silent divergence this shape avoids.
 */

/**
 * Long enough that reading it is genuinely expensive.
 *
 * Twelve customer-visible messages is roughly the point where a thread stops
 * fitting on one screen and a person starts scrolling to answer "what did we
 * say about the price". Below it, reading beats summarising and the summary
 * would be the more expensive of the two — in tokens AND in the reader's time.
 */
export const THREAD_SUMMARY_MIN_MESSAGES = 12;

/**
 * A shorter thread still earns a catch-up once enough time has passed, because
 * the cost this feature attacks is not only length — it is having FORGOTTEN.
 * "Call me after the 15th" three weeks ago is six messages nobody remembers.
 */
export const THREAD_SUMMARY_IDLE_DAYS = 7;

/** The same figure in milliseconds, so no caller does the arithmetic itself. */
export const THREAD_SUMMARY_IDLE_MS = THREAD_SUMMARY_IDLE_DAYS * 24 * 60 * 60 * 1000;

/**
 * Even a forgotten thread needs something in it. Two messages from a month ago
 * are read in four seconds, and a summary of them can only be longer than they
 * are.
 */
export const THREAD_SUMMARY_IDLE_MIN_MESSAGES = 4;

/** What the caller knows about a thread, and all this rule is allowed to use. */
export interface ThreadSummaryOffer {
  /**
   * Customer-visible messages with text in them. NOTES ARE NOT COUNTED, for the
   * same reason they never enter the prompt: a summary is about the
   * conversation, and a crew's private note is not part of it.
   */
  messageCount: number;
  /** How long since the newest message, in milliseconds. Never negative. */
  idleMs: number;
}

/**
 * Is this thread worth a catch-up?
 *
 * Two ways a thread becomes expensive to re-read, and either is enough:
 * it is long, or it is old enough to have been forgotten. Everything else
 * answers no, which costs nothing and is the honest answer.
 */
export function shouldOfferThreadSummary(input: ThreadSummaryOffer): boolean {
  if (input.messageCount >= THREAD_SUMMARY_MIN_MESSAGES) return true;
  return (
    input.messageCount >= THREAD_SUMMARY_IDLE_MIN_MESSAGES &&
    input.idleMs >= THREAD_SUMMARY_IDLE_MS
  );
}

/** The three sections, in the order a person reads them. */
export type ThreadSummarySection = "asked" | "we_said" | "open";

/**
 * The fixed heading for each section, written once for all three clients.
 *
 * Ordered: what THEY wanted, what WE said back, what is still owed. That order
 * is the order the question is asked in when somebody opens a thread cold, and
 * "open" is last because it is the part a person acts on.
 */
/** Every catalogue key this module names. */
export type ThreadSummaryKey =
  | "domain.catchUpSectionAsked"
  | "domain.catchUpSectionWeSaid"
  | "domain.catchUpSectionOpen"
  | "domain.catchUpAttribution";

export const THREAD_SUMMARY_SECTIONS: readonly {
  id: ThreadSummarySection;
  /** #228 — a catalogue key. Both phones have said these three for months. */
  label: ThreadSummaryKey;
}[] = [
  { id: "asked", label: "domain.catchUpSectionAsked" },
  { id: "we_said", label: "domain.catchUpSectionWeSaid" },
  // Not "action items". A loop is open because nobody closed it, which is a
  // statement about the conversation; an action item is an instruction, and
  // this surface does not get to give the crew instructions. The French keeps
  // that: "Ce qui reste en suspens", not "Actions à faire".
  { id: "open", label: "domain.catchUpSectionOpen" },
] as const;

/** Every section id, for validating model output and iterating in order. */
export const THREAD_SUMMARY_SECTION_IDS: readonly ThreadSummarySection[] =
  THREAD_SUMMARY_SECTIONS.map((section) => section.id);

/** True for the three section ids and nothing else. */
export function isThreadSummarySection(
  value: string,
): value is ThreadSummarySection {
  return THREAD_SUMMARY_SECTION_IDS.includes(value as ThreadSummarySection);
}

/**
 * The line every client shows beside the catch-up, in one place.
 *
 * A summary is Lou's reading of the thread, not a record of it. #247 is explicit
 * that a wrong summary is worse than none, because a crew ACTS on it — so the
 * surface has to say whose reading it is and that the thread is still the
 * arbiter. Every line taps through to the message it came from, which is what
 * makes that sentence true rather than a disclaimer.
 */
export const THREAD_SUMMARY_ATTRIBUTION: ThreadSummaryKey =
  "domain.catchUpAttribution";
