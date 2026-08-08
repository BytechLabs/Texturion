package com.loonext.android.features.inbox

/**
 * #548 — which dimensions the inbox is currently arranged by.
 *
 * The hand-port of `packages/shared/src/inbox-filters.ts`, asserted against it by
 * `InboxFiltersTest`.
 *
 * ## Why this is shared rather than a local predicate
 *
 * It WAS a local predicate — `hasFilterChips` — and it counted the removable
 * chips and not the status segment. So `resetFilters()` opened with
 * `if (!hasFilterChips) return` while the sheet rendered a **Status** section
 * about forty points below its own **Reset**: select "Closed", press Reset, get a
 * haptic and nothing else. The header's filters-are-on dot never lit for Status
 * either, so an inbox showing only closed threads looked unfiltered and offered
 * no way back.
 *
 * iOS had the same predicate with the same omission. Web's version was correct
 * and wired to nothing that mattered. Three copies, two wrong, and the founder
 * found it in a few minutes of ordinary use.
 *
 * ## Two questions, one list
 *
 * [isInboxFiltered] is what a Reset and an indicator ask. [hasSecondaryInboxFilters]
 * is what the empty-state copy asks, because a tab with a truthful sentence of its
 * own ("No closed conversations") should use it rather than saying "nothing
 * matches these filters" at somebody who selected one tab and nothing else.
 *
 * One name serving both is how the bug survived review.
 */

/** The dimensions an inbox list can be narrowed by, in a stable render order. */
internal enum class InboxFilterDimension {
    SEGMENT,
    ASSIGNEE,
    TAG,
    UNREAD,
    SPAM,
    SNOOZED,
    AWAITING,
}

internal data class InboxFilterState(
    /** The status segment in this client's own words, or null on the home view. */
    val segment: String?,
    /** Scoped to whoever is looking ("Mine"), which the SEGMENT owns, not a chip. */
    val assignedToMe: Boolean,
    /** A named teammate. Ignored while [assignedToMe] — the request ignores it too. */
    val assigneeUserId: String?,
    val tagId: String?,
    val unreadOnly: Boolean,
    val spamOnly: Boolean,
    val snoozedOnly: Boolean,
    val awaitingOnly: Boolean,
)

/**
 * Every dimension in force.
 *
 * Returning the LIST rather than a boolean is what makes the two questions below
 * answers to the same fact instead of two opinions.
 */
internal fun activeInboxFilters(state: InboxFilterState): List<InboxFilterDimension> {
    val active = mutableListOf<InboxFilterDimension>()
    if (state.segment != null || state.assignedToMe) active += InboxFilterDimension.SEGMENT
    // MINE SUBSUMES A NAMED ASSIGNEE, deliberately. The request sends the
    // viewer's own id and drops this field, and the sheet hides the assignee
    // section while Mine is lit — so counting it here is how an empty "Mine" tab
    // came to blame a filter the person had no way to un-set.
    if (!state.assignedToMe && state.assigneeUserId != null) {
        active += InboxFilterDimension.ASSIGNEE
    }
    if (state.tagId != null) active += InboxFilterDimension.TAG
    if (state.unreadOnly) active += InboxFilterDimension.UNREAD
    if (state.spamOnly) active += InboxFilterDimension.SPAM
    if (state.snoozedOnly) active += InboxFilterDimension.SNOOZED
    if (state.awaitingOnly) active += InboxFilterDimension.AWAITING
    return active
}

/**
 * Is the list arranged by anything at all?
 *
 * What Reset and the header dot ask. THE STATUS SEGMENT COUNTS — that it did not
 * is the whole of #548.
 */
internal fun isInboxFiltered(state: InboxFilterState): Boolean =
    activeInboxFilters(state).isNotEmpty()

/** Anything beyond the segment — the empty-state copy's question, and only that. */
internal fun hasSecondaryInboxFilters(state: InboxFilterState): Boolean =
    activeInboxFilters(state).any { it != InboxFilterDimension.SEGMENT }
