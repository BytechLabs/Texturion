import Foundation

/// #548 — which dimensions the inbox is currently arranged by.
///
/// The hand-port of `packages/shared/src/inbox-filters.ts`, asserted against it by
/// `InboxFiltersTests`.
///
/// ## Why this is shared rather than a local predicate
///
/// It WAS a local predicate — `hasFilterChips` — and it counted the removable
/// chips and not the status segment. Android had the identical omission with worse
/// consequences: `resetFilters()` opened with `if (!hasFilterChips) return` while
/// its filter sheet drew a **Status** section forty points below its own **Reset**,
/// so selecting "Closed" and pressing Reset gave a haptic and did nothing. Web's
/// version was correct and wired to nothing that mattered.
///
/// Three copies, two wrong, and the founder found it in a few minutes of use.
///
/// ## Two questions, one list
///
/// `isInboxFiltered` is what a Reset and an indicator ask. `hasSecondaryInboxFilters`
/// is what the empty-state copy asks, because a tab with a truthful sentence of its
/// own ("No closed conversations") should use it rather than saying "nothing matches
/// these filters" at somebody who selected one tab and nothing else.
///
/// One name serving both is how the bug survived review.

/// The dimensions an inbox list can be narrowed by, in a stable render order.
enum InboxFilterDimension: String, CaseIterable {
    case segment
    case assignee
    case line
    case tag
    case unread
    case spam
    case snoozed
    case awaiting
}

struct InboxFilterState: Equatable {
    /// The status segment in this client's own words, or nil on the home view.
    var segment: String?
    /// Relative self-assignment from a saved view, owned by the assignee filter.
    var assignedToMe: Bool
    /// A named teammate. Ignored while `assignedToMe` is set.
    var assigneeUserId: String?
    var tagId: String?
    var unreadOnly: Bool
    var spamOnly: Bool
    var snoozedOnly: Bool
    var awaitingOnly: Bool
    var unassignedOnly = false
    var lineId: String? = nil
}

/// Every dimension in force.
///
/// Returning the LIST rather than a boolean is what makes the two questions below
/// answers to the same fact instead of two opinions.
func activeInboxFilters(_ state: InboxFilterState) -> [InboxFilterDimension] {
    var active: [InboxFilterDimension] = []
    if state.segment != nil { active.append(.segment) }
    if state.assignedToMe || state.assigneeUserId != nil || state.unassignedOnly {
        active.append(.assignee)
    }
    if state.lineId != nil { active.append(.line) }
    if state.tagId != nil { active.append(.tag) }
    if state.unreadOnly { active.append(.unread) }
    if state.spamOnly { active.append(.spam) }
    if state.snoozedOnly { active.append(.snoozed) }
    if state.awaitingOnly { active.append(.awaiting) }
    return active
}

/// Is the list arranged by anything at all?
///
/// What a Clear control and an indicator ask. THE STATUS SEGMENT COUNTS — that it
/// did not is the whole of #548.
func isInboxFiltered(_ state: InboxFilterState) -> Bool {
    !activeInboxFilters(state).isEmpty
}

/// Anything beyond the segment — the empty-state copy's question, and only that.
func hasSecondaryInboxFilters(_ state: InboxFilterState) -> Bool {
    activeInboxFilters(state).contains { $0 != .segment }
}
