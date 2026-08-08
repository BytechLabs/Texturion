/**
 * #548 — which dimensions the inbox is currently arranged by.
 *
 * # Why this is shared, and why the bug was inevitable without it
 *
 * This rule existed three times, hand-written, and two of the copies were wrong
 * in the same way: they counted the removable chips and not the status segment.
 * So on the phones, "Reset" inside the filter sheet sat about forty points above
 * a **Status** section it could not see, and pressing it gave a haptic and did
 * nothing. The header's filters-are-on indicator never lit for the most-used
 * filter on the screen either, so an inbox showing only closed conversations
 * looked unfiltered and offered no way back.
 *
 * The founder found it in a few minutes of ordinary use: *"When you select a
 * filter in the filter menu, then you can't reset or choose other filters."*
 *
 * The precedent for sharing it is already written down one file over, in
 * `saved-views.ts`: four things have to agree about a set of filters, and a drift
 * in any of them produces a view that saves fine and then opens something else.
 * Same argument, smaller rule.
 *
 * # Why there are two questions and not one
 *
 * One name could not answer both, and that is how the bug survived review. The
 * screen asks:
 *
 *   "is anything filtered"          — a reset guard, a clear-all's visibility,
 *                                     the header indicator.
 *   "is anything filtered BEYOND    — the empty-state copy, which has a better
 *    the segment"                     per-tab sentence to fall through to
 *                                     ("Nothing assigned to you", "No closed
 *                                     conversations") than a generic one.
 *
 * A single predicate serving both means one of them is wrong. Both are derived
 * from one list here, so they cannot disagree about a case again.
 *
 * # What is deliberately NOT decided here
 *
 * Which view is home. The phones open on "Open"; the web inbox opens on a bare
 * URL with no `status=`. Each client maps its own home to a null `segment` at the
 * one place it builds this state, and says so there. This rule only asks whether
 * the segment moved off home.
 */

/** The dimensions an inbox list can be narrowed by, in a stable render order. */
export const INBOX_FILTER_DIMENSIONS = [
  "segment",
  "assignee",
  "tag",
  "unread",
  "spam",
  "snoozed",
  "awaiting",
] as const;

export type InboxFilterDimension = (typeof INBOX_FILTER_DIMENSIONS)[number];

export interface InboxFilterState {
  /** The status segment in the client's own words, or null on its home view. */
  segment: string | null;
  /** Scoped to whoever is looking ("Mine"), which the SEGMENT owns, not a chip. */
  assignedToMe: boolean;
  /** A named teammate. Ignored while `assignedToMe` — the request ignores it too. */
  assigneeUserId: string | null;
  tagId: string | null;
  unreadOnly: boolean;
  spamOnly: boolean;
  snoozedOnly: boolean;
  awaitingOnly: boolean;
}

/**
 * Every dimension in force.
 *
 * Returning the LIST rather than a boolean is what makes the two questions below
 * answers to the same fact instead of two opinions.
 */
export function activeInboxFilters(
  state: InboxFilterState,
): InboxFilterDimension[] {
  const active: InboxFilterDimension[] = [];
  if (state.segment !== null || state.assignedToMe) active.push("segment");
  // MINE SUBSUMES A NAMED ASSIGNEE, deliberately. Every client's request sends
  // the viewer's own id and drops this field, and every client hides the
  // assignee control while Mine is lit — so counting it here is how an empty
  // "Mine" tab came to blame a filter the person had no way to un-set.
  if (!state.assignedToMe && state.assigneeUserId !== null) {
    active.push("assignee");
  }
  if (state.tagId !== null) active.push("tag");
  if (state.unreadOnly) active.push("unread");
  if (state.spamOnly) active.push("spam");
  if (state.snoozedOnly) active.push("snoozed");
  if (state.awaitingOnly) active.push("awaiting");
  return active;
}

/**
 * Is the list arranged by anything at all?
 *
 * The question a Reset, a "Clear filters" and a header indicator ask. THE STATUS
 * SEGMENT COUNTS — that it did not is the whole of #548.
 */
export function isInboxFiltered(state: InboxFilterState): boolean {
  return activeInboxFilters(state).length > 0;
}

/**
 * Is anything beyond the segment in force?
 *
 * The empty-state copy's question, and only that. A tab with a truthful sentence
 * of its own should use it rather than saying "nothing matches these filters" at
 * somebody who has selected one tab and nothing else.
 */
export function hasSecondaryInboxFilters(state: InboxFilterState): boolean {
  return activeInboxFilters(state).some((dimension) => dimension !== "segment");
}
