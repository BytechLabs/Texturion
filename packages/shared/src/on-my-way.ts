/**
 * #520 — "on my way, about 20 minutes", sent while walking to the van.
 *
 * The wording is already a saved reply; what a template cannot carry is the
 * ETA, and what it cannot be is one tap. This module is the sentence and the
 * choices, shared, because three clients writing their own "on my way" is
 * three products.
 *
 * ── THE TWO DECISIONS #520 ASKS FOR, MADE ─────────────────────────────────
 *
 * 1. WHERE THE ETA COMES FROM: presets, not typing and not location.
 *
 *    Typing is flexible and slow, in the one moment this exists to be fast in.
 *    Deriving it from distance would need a location permission for what is
 *    effectively a background purpose — a privacy ask this product has not
 *    made, which would change `docs/DATA-INVENTORY.md` and both store
 *    declarations, in exchange for a number the tech already knows better than
 *    a straight-line distance does. They are the one holding the traffic.
 *
 *    So: four presets, one tap plus one choice, no keyboard and no permission.
 *
 * 2. WHAT IT WRITES TO THE JOB: nothing.
 *
 *    A dispatcher would like "en route" on the board, and it is tempting
 *    because the text is evidence. But it is evidence of what somebody SAID,
 *    not of where the van is — and a status field fed by a text message is a
 *    field that goes stale the moment the tech gets diverted and says so in
 *    words instead of tapping again. #237 kept `confirmed_by` honest about who
 *    said what for the same reason.
 *
 *    The message is in the thread, and the thread is already attached to the
 *    job. That is the record. If the board ever needs "the tech said 20
 *    minutes at 14:32", it should read the thread rather than a field that
 *    claims more than it knows.
 */

/**
 * The choices, in minutes.
 *
 * Four, not eight. This is a control somebody uses one-handed with a toolbox
 * in the other, and the difference between 20 and 25 minutes is not a promise
 * anybody can keep — the word in the sentence is "about" for that reason.
 */
export const ON_MY_WAY_PRESETS = [10, 20, 30, 45] as const;

export type OnMyWayPreset = (typeof ON_MY_WAY_PRESETS)[number];

/**
 * What the customer reads.
 *
 * "About" is doing real work: a tech who says 20 and arrives at 28 has not
 * broken a promise, and one who says 20 and means it exactly is rare enough
 * that the hedge costs nothing. The alternative — an exact time, "arriving at
 * 2:40" — is a claim about traffic nobody can make from a van.
 */
export function onMyWayText(minutes: number): string {
  return `On my way - about ${minutes} minutes.`;
}

/** The label on the choice itself, which is shorter than the sentence. */
export function onMyWayPresetLabel(minutes: number): string {
  return `${minutes} min`;
}

/** What the clients call it, in one place. */
export const ON_MY_WAY_COPY = {
  /** The control. Not "ETA" — a word for dispatchers, not for a crew. */
  action: "On my way",
  /**
   * Shown while choosing, so the tap that sends is not a surprise. Somebody
   * expecting a picker and getting a sent message would have texted a customer
   * by accident.
   */
  prompt: "How long?",
  /**
   * Said once, where the choice is made. The gates can still refuse this — an
   * opt-out is binding no matter how fast the send is meant to be — and a
   * refusal arriving with no explanation reads as the button being broken.
   */
  gated_note: "Sends straight away, and follows the same rules as any text.",
} as const;
