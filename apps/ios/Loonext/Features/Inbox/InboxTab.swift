import Combine
import Observation
import SwiftUI

/// Inbox: pinned section + segmented Open|Mine|All|Closed + filter chips
/// (assignee/tag/unread/spam) + debounced global search (≥2 chars) + cursor
/// infinite scroll + realtime re-sort + row swipe actions + pull-to-refresh.
///
/// Structure (#186): a flat list — every open routes UP to the shell's root
/// navigation stack (`AppRouter`), so the opened thread renders ABOVE the tab
/// shell with no pill (the pushed thread used to sit inside the tab, under the
/// pill overlay). Compose keeps its own full-screen cover. The Android
/// InboxTab's twin.
///
/// Search routing (#186): a conversation/message hit opens the thread scrolled
/// to + flashing the matched message; a TASK hit opens the TASK (not its
/// conversation); a contact hit composes.
@MainActor
struct InboxTab: View {
    let graph: AppGraph
    let companyId: String
    let me: Me

    @State private var selection: String?
    @State private var composeOpen = false
    @State private var composeContactId: String?

    var body: some View {
        InboxList(
            graph: graph,
            companyId: companyId,
            me: me,
            selection: $selection,
            onOpen: { conversationId, highlightMessageId in
                // Push the thread onto the shell's root stack. The highlight
                // (search hit) is read by the shell alongside the open command.
                AppRouter.shared.pendingHighlightMessageId = highlightMessageId
                AppRouter.shared.openConversationId = conversationId
            },
            onOpenTask: { AppRouter.shared.openTaskId = $0 },
            onTextContact: { contactId in
                composeContactId = contactId
                composeOpen = true
            },
            onCompose: { composeOpen = true }
        )
        .fullScreenCover(isPresented: $composeOpen) {
            NewConversationView(
                graph: graph,
                companyId: companyId,
                me: me,
                prefillContactId: composeContactId,
                onCreated: { conversationId in
                    composeOpen = false
                    composeContactId = nil
                    AppRouter.shared.openConversationId = conversationId
                },
                onBack: {
                    composeOpen = false
                    composeContactId = nil
                }
            )
        }
    }
}

// MARK: - Read/unread swipe target

/// The leading read/unread swipe's target for a row's current unread state,
/// pinned pure so the controller and the row label read one source and the
/// Android InboxTab.toggleRead semantics stay in lockstep: an unread row marks
/// read (POST /read), a read row marks unread (DELETE /read).
enum InboxReadSwipe {
    /// True when the swipe should mark the row read (it is currently unread);
    /// false when it should mark the row unread.
    static func marksRead(unread: Bool) -> Bool { unread }

    /// The swipe button title for the row's current state.
    static func title(unread: Bool) -> String { unread ? "Read" : "Unread" }

    /// The SF Symbol for the row's current state.
    static func symbol(unread: Bool) -> String {
        unread ? "envelope.open" : "envelope.badge"
    }
}

/// #295: the copy and the undo decision for a swipe status change, kept pure so
/// it is testable and so it cannot drift from the Android twin
/// (`InboxTab.kt`: "Conversation closed" + Undo when closing, a bare
/// "Conversation reopened" when reopening).
///
/// Undo is offered ONLY when closing, and that asymmetry is deliberate: closing
/// removes the row from the pane, so without an Undo the way back is knowing to
/// switch to the Closed filter and hunt for it. Reopening puts a row IN FRONT of
/// you, where the swipe is right there to reverse it.
enum InboxStatusSwipe {
    static func isClosing(to status: String) -> Bool {
        status == ConversationStatus.closed
    }

    static func notice(to status: String) -> String {
        isClosing(to: status) ? "Conversation closed" : "Conversation reopened"
    }

    /// The status to revert to, or nil when no Undo should be offered.
    ///
    /// Returns the row's ACTUAL prior status rather than a hardcoded "open".
    /// #295 asks that an undo restore full prior state, and a conversation that
    /// was `new` or `waiting` when it got swiped away would otherwise come back
    /// as `open` — quietly losing the fact that nobody had replied to it yet,
    /// which is the whole distinction those statuses carry.
    static func undoTarget(to status: String, from previous: String) -> String? {
        guard isClosing(to: status), previous != status else { return nil }
        return previous
    }
}

// MARK: - List state

private enum InboxStatusTab: String, CaseIterable, Identifiable, Sendable {
    case open = "Open"
    case mine = "Mine"
    case all = "All"
    case closed = "Closed"

    var id: String { rawValue }
}

@MainActor
@Observable
private final class InboxController {
    private let inboxApi: InboxApi
    private let savedViewsApi: SavedViewsApi
    private let searchApi: SearchApi
    private let repo: MessagingRepository
    private let companyId: String
    /// Read by the rows so "assigned to me" shows as "You".
    let meUserId: String

    private(set) var tab: InboxStatusTab = .open
    /// #548: the FILTER is an id. The `Member` is only how that id gets a name.
    ///
    /// It used to be the other way round — the state held the `Member` — so a
    /// saved view applied before `/members` had landed ran `members.first { … }`,
    /// got nil, and dropped the filter along with the label. A saved view is one
    /// tap on a cold start, which is exactly when that race is lost.
    private(set) var assigneeUserId: String?
    private(set) var tagId: String?

    /// The filtered teammate, once the roster can name them. Labels only.
    var assignee: Member? {
        guard let id = assigneeUserId else { return nil }
        return members.first { $0.user_id == id }
    }

    /// Likewise the tag. A filter that outlives its label is still a filter.
    var tag: Tag? {
        guard let id = tagId else { return nil }
        return allTags.first { $0.id == id }
    }
    private(set) var unreadOnly = false
    private(set) var spamOnly = false
    /// #293: the Snoozed view. Same shape as `spamOnly` — a population hidden
    /// from the default list, revealed by one chip — because that pattern
    /// already exists here and a second invention of it is how two hidden
    /// populations end up behaving differently.
    private(set) var snoozedOnly = false
    /// #508: threads nobody has replied to yet — the #388 lead clock, not
    /// `status`. This is the live set behind the response-time card's "N leads
    /// nobody answered", and the destination that row links to.
    private(set) var awaitingOnly = false

    private(set) var state: LoadState<Void> = .loading
    private(set) var rows: [ConversationListItem] = []
    private(set) var pinnedRows: [ConversationListItem] = []
    private(set) var cursor: String?
    private(set) var loadingMore = false

    private(set) var members: [Member] = []
    private(set) var allTags: [Tag] = []

    /// #280 — the member's saved views, which one they land on, and the bounded
    /// badges. Loaded alongside the other supporting lists: the inbox must paint
    /// whether or not this request has landed, so nothing here gates the list.
    private(set) var savedViews: [SavedView] = []
    private(set) var defaultViewId: String?
    private(set) var viewCounts: [String: Int] = [:]

    /// #233 — every text the WORKSPACE has queued, not just this member's.
    ///
    /// The issue asks for this "so nobody is surprised", and a crew shares one
    /// inbox: a follow-up the owner wrote on Sunday night is invisible to the
    /// tech who answers the same customer on Monday. Loaded alongside the other
    /// supporting lists, so nothing here gates the conversation list.
    private(set) var scheduled: [ScheduledMessage] = []

    /// One-shot toast for row-mutation failures (id makes repeats re-fire).
    private(set) var notice: ThreadNotice?

    // Search (≥2 chars flips the pane to grouped global results).
    var query = ""
    private(set) var searchState: LoadState<SearchResult>?
    private(set) var searchLoadingMore = false
    var searching: Bool { query.trimmingCharacters(in: .whitespaces).count >= 2 }

    @ObservationIgnored private var loadSeq = 0
    @ObservationIgnored private var searchSeq = 0
    @ObservationIgnored private var realtimeTask: Task<Void, Never>?
    @ObservationIgnored private var supportLoaded = false
    @ObservationIgnored private var noticeSeq: Int64 = 0

    init(graph: AppGraph, companyId: String, meUserId: String) {
        self.inboxApi = graph.inboxApi
        self.savedViewsApi = graph.savedViewsApi
        self.searchApi = graph.searchApi
        self.repo = MessagingRepository(api: graph.api)
        self.companyId = companyId
        self.meUserId = meUserId
    }

    /// #548: the arrangement in the vocabulary all three clients now share
    /// (`packages/shared/src/inbox-filters.ts`, ported in `InboxFilters.swift`).
    ///
    /// `.open` is this list's HOME view, so it maps to a nil segment — the phones
    /// open there and the web inbox opens on a bare URL, which is why the shared
    /// rule takes each client's own answer rather than deciding it.
    var filterState: InboxFilterState {
        InboxFilterState(
            segment: tab == .open ? nil : String(describing: tab),
            assignedToMe: tab == .mine,
            assigneeUserId: self.assigneeUserId,
            tagId: self.tagId,
            unreadOnly: unreadOnly,
            spamOnly: spamOnly,
            snoozedOnly: snoozedOnly,
            awaitingOnly: awaitingOnly
        )
    }

    /// Is the list arranged by ANYTHING — the status segment included?
    ///
    /// THIS USED TO EXCLUDE THE SEGMENT, and that was #548. On this client there
    /// was no reset at all to break, so the omission showed up instead as an
    /// empty-state sentence blaming filters nobody could see.
    var isFiltered: Bool { isInboxFiltered(filterState) }

    /// Anything BEYOND the segment, for the empty-state copy only. Not the same
    /// question as `isFiltered`: the per-tab sentences below are more use than
    /// "nothing matches these filters", and a segment-aware predicate here would
    /// swallow all of them.
    var hasSecondaryFilters: Bool { hasSecondaryInboxFilters(filterState) }

    /// #548: put the list back to the home view in ONE reload.
    ///
    /// There was no way to do this on iOS at all. Clearing by hand meant up to
    /// seven taps across two bands, each firing its own reload — seven spinners
    /// and fourteen requests — and the status segment could not be cleared to
    /// "everything" at all, because Open is a filter too.
    func clearFilters() {
        if !isFiltered { return }
        tab = .open
        assigneeUserId = nil
        tagId = nil
        unreadOnly = false
        spamOnly = false
        snoozedOnly = false
        awaitingOnly = false
        reload(showLoading: true)
    }

    func selectTab(_ next: InboxStatusTab) {
        if tab == next { return }
        tab = next
        reload(showLoading: true)
    }

    func setAssigneeFilter(_ member: Member?) {
        assigneeUserId = member?.user_id
        reload(showLoading: true)
    }

    func setTagFilter(_ next: Tag?) {
        tagId = next?.id
        reload(showLoading: true)
    }

    func toggleUnread() {
        unreadOnly.toggle()
        reload(showLoading: true)
    }

    func toggleSpam() {
        spamOnly.toggle()
        reload(showLoading: true)
    }

    func toggleSnoozed() {
        snoozedOnly.toggle()
        reload(showLoading: true)
    }

    func toggleAwaiting() {
        awaitingOnly.toggle()
        reload(showLoading: true)
    }

    /// #508: land on the Unanswered set, from the response-time card.
    ///
    /// The whole arrangement at once, then ONE reload — an arrival is not four
    /// taps. It clears the OTHER chips deliberately: the row above says "5 leads
    /// nobody answered", and landing on that filter intersected with whatever
    /// was still selected would show a smaller number under the same sentence.
    /// The tab goes to All for the same reason — the lead clock is the question,
    /// and Open would quietly drop the ones somebody closed without replying.
    ///
    /// Idempotent: arriving twice is arriving once.
    func landOnAwaiting() {
        let alreadyThere = awaitingOnly && tab == .all && assigneeUserId == nil
            && tagId == nil && !unreadOnly && !spamOnly && !snoozedOnly
        if alreadyThere { return }
        tab = .all
        assigneeUserId = nil
        tagId = nil
        unreadOnly = false
        spamOnly = false
        snoozedOnly = false
        awaitingOnly = true
        reload(showLoading: true)
    }

    // MARK: - #280 saved views

    /// The arrangement currently on screen, in the shape a view stores.
    var currentSelection: ViewSelection {
        let mapped: SavedViewTab
        switch tab {
        case .open: mapped = .open
        case .mine: mapped = .mine
        case .all: mapped = .all
        case .closed: mapped = .closed
        }
        return ViewSelection(
            tab: mapped,
            assigneeUserId: tab == .mine ? nil : assigneeUserId,
            tagId: tagId,
            unreadOnly: unreadOnly,
            spamOnly: spamOnly,
            snoozedOnly: snoozedOnly,
            awaitingOnly: awaitingOnly
        )
    }

    /// Apply a saved view: every control at once, then ONE reload.
    ///
    /// Setting them one at a time would fire a request per filter and leave the
    /// list flickering through arrangements nobody asked for.
    func applyView(_ view: SavedView) {
        let selection = viewToSelection(view.filters)
        switch selection.tab {
        case .open: tab = .open
        case .mine: tab = .mine
        case .all: tab = .all
        case .closed: tab = .closed
        }
        // #548: the ids, not a lookup. `members`/`allTags` may not have landed
        // yet — a view applied on a cold start used to lose its assignee and tag
        // to a `first` returning nil, and nothing said so.
        assigneeUserId = selection.assigneeUserId
        tagId = selection.tagId
        unreadOnly = selection.unreadOnly
        spamOnly = selection.spamOnly
        snoozedOnly = selection.snoozedOnly
        awaitingOnly = selection.awaitingOnly
        reload(showLoading: true)
    }

    func loadSavedViews(landIfUntouched: Bool = false) {
        Task {
            guard let page = try? await self.savedViewsApi.list(companyId: self.companyId) else {
                return
            }
            self.savedViews = page.data
            self.defaultViewId = page.defaults.conversations
            // Land on the chosen view only from an untouched inbox. Somebody who
            // has already filtered has said what they want to see, and a default
            // that overrode that would be a screen that argues.
            if landIfUntouched, !self.isFiltered,
               let id = page.defaults.conversations,
               let view = page.data.first(where: { $0.id == id }) {
                self.applyView(view)
            }
            self.loadViewCounts()
        }
    }

    private func loadViewCounts() {
        let ids = savedViews.prefix(SavedViewLimits.countMaxViews).map { $0.id }
        if ids.isEmpty { return }
        Task {
            if let result = try? await self.savedViewsApi.counts(
                companyId: self.companyId,
                ids: ids
            ) {
                self.viewCounts = result.counts
            }
        }
    }

    func saveCurrentView(
        name: String,
        shared: Bool,
        onDone: @escaping @MainActor (String?) -> Void
    ) {
        let filters = selectionToView(currentSelection)
        let trimmed = name.trimmingCharacters(in: .whitespacesAndNewlines)
        Task {
            do {
                _ = try await self.savedViewsApi.create(
                    companyId: self.companyId,
                    name: trimmed,
                    filters: filters,
                    shared: shared
                )
                self.loadSavedViews()
                onDone(nil)
            } catch {
                onDone(error.userMessage)
            }
        }
    }

    func renameView(id: String, name: String) {
        let trimmed = name.trimmingCharacters(in: .whitespacesAndNewlines)
        Task {
            _ = try? await self.savedViewsApi.rename(
                companyId: self.companyId,
                id: id,
                name: trimmed
            )
            self.loadSavedViews()
        }
    }

    func deleteView(id: String) {
        Task {
            try? await self.savedViewsApi.delete(companyId: self.companyId, id: id)
            self.loadSavedViews()
        }
    }

    func setDefaultView(_ id: String?) {
        Task {
            try? await self.savedViewsApi.setDefault(companyId: self.companyId, viewId: id)
            self.defaultViewId = id
        }
    }

    private func fetchPage(cursor: String?, pinned: String) async throws -> Page<ConversationListItem> {
        try await inboxApi.conversations(
            companyId: companyId,
            status: {
                switch tab {
                case .open: "open"
                case .closed: "closed"
                default: nil
                }
            }(),
            assignedUserId: tab == .mine ? meUserId : assigneeUserId,
            tagId: tagId,
            // Spam is hidden from defaults server-side; the chip reveals it.
            spam: spamOnly ? true : nil,
            unread: unreadOnly ? true : nil,
            pinned: pinned,
            // #293: same for deferrals. Nil leaves the field off entirely,
            // which IS the server's hide-them default — sending "exclude"
            // would say the same thing twice.
            snoozed: snoozedOnly ? "only" : nil,
            // #508: and the same again for the lead clock. Nil is no filter,
            // which is what the ordinary inbox wants.
            awaiting: awaitingOnly ? "only" : nil,
            cursor: cursor,
            limit: pinned == "only" ? 100 : 25
        )
    }

    func start() {
        if case .ready = state { return }
        reload(showLoading: true)
        loadSupportingLists()
    }

    private func loadSupportingLists() {
        if supportLoaded { return }
        supportLoaded = true
        // #280: the landing view is only applied on this first load, so a later
        // refresh never yanks somebody out of what they are looking at.
        loadSavedViews(landIfUntouched: true)
        Task {
            if let page = try? await self.repo.members(companyId: self.companyId) {
                self.members = page.data
            }
        }
        Task {
            if let page = try? await self.repo.tags(companyId: self.companyId) {
                self.allTags = page.data
            }
        }
        refreshScheduled()
    }

    /// #233: what the workspace has queued. Quiet failure — it gates one icon.
    func refreshScheduled() {
        Task {
            if let page = try? await self.repo.scheduledMessages(
                companyId: self.companyId
            ) {
                self.scheduled = page.scheduled_messages
            }
        }
    }

    /// #233: call one off from the workspace list.
    ///
    /// Removed before the round trip, then reconciled. Cancelling something
    /// that has not gone is reversible in the only sense that matters — you can
    /// schedule it again — so it confirms rather than asking.
    func cancelScheduled(_ id: String) {
        let before = scheduled
        scheduled = before.filter { $0.id != id }
        Task {
            do {
                try await repo.cancelScheduledMessage(companyId: companyId, id: id)
                notify(ScheduledSend.copyLine("canceled_confirmation"))
            } catch {
                // It is still queued. Putting it back is the only honest state:
                // a row that vanished while still being due to send is the
                // silent disappearance DECISIONS.md rules out.
                scheduled = before
                notify(error.userMessage)
            }
        }
    }

    func reload(showLoading: Bool) {
        loadSeq += 1
        let seq = loadSeq
        if showLoading { state = .loading }
        Task {
            do {
                let page = try await fetchPage(cursor: nil, pinned: "exclude")
                let pinnedPage = try? await fetchPage(cursor: nil, pinned: "only")
                if seq != loadSeq { return }
                rows = page.data
                cursor = page.next_cursor
                pinnedRows = pinnedPage?.data ?? []
                state = .ready(())
            } catch {
                if seq == loadSeq { state = .failed(error.userMessage) }
            }
        }
    }

    func loadMore() {
        guard let next = cursor, !loadingMore, case .ready = state else { return }
        loadingMore = true
        let seq = loadSeq
        Task {
            do {
                let page = try await fetchPage(cursor: next, pinned: "exclude")
                if seq == loadSeq {
                    rows = appendPage(rows, page.data) { $0.id }
                    cursor = page.next_cursor
                }
            } catch {
                // Quiet: the scroll edge simply retries on the next reach.
            }
            loadingMore = false
        }
    }

    /// Realtime tick: debounce 250ms, then merge a fresh page 1 (re-sort).
    func scheduleRealtimeRefresh() {
        guard case .ready = state else { return }
        realtimeTask?.cancel()
        realtimeTask = Task {
            try? await Task.sleep(for: .milliseconds(250))
            if Task.isCancelled { return }
            let seq = loadSeq
            guard let page = try? await fetchPage(cursor: nil, pinned: "exclude") else { return }
            let pinnedPage = try? await fetchPage(cursor: nil, pinned: "only")
            if seq != loadSeq { return }
            let merged = mergeFirstPage(
                rows,
                page.data,
                idOf: { $0.id },
                sortKey: { $0.last_message_at }
            )
            rows = dropVanishedFromFirstWindow(
                merged: merged,
                freshFirstPageIds: Set(page.data.map(\.id)),
                // A full window means older rows may exist beyond it;
                // a short page IS the complete filtered set.
                oldestFreshSortKey: page.next_cursor != nil
                    ? page.data.last?.last_message_at
                    : nil,
                idOf: { $0.id },
                sortKey: { $0.last_message_at }
            )
            if let pinnedPage { pinnedRows = pinnedPage.data }
        }
    }

    /// Reconnect: trim to page 1 and refetch (SPEC §8).
    func refreshAfterReconnect() {
        reload(showLoading: false)
    }

    /// Pull-to-refresh: the same first-page refetch as the reconnect path,
    /// awaitable so `.refreshable` holds its spinner honestly. A failure with
    /// data on screen keeps the data and toasts instead of blanking the list.
    func refreshFirstPage() async {
        loadSeq += 1
        let seq = loadSeq
        do {
            let page = try await fetchPage(cursor: nil, pinned: "exclude")
            let pinnedPage = try? await fetchPage(cursor: nil, pinned: "only")
            guard seq == loadSeq else { return }
            rows = page.data
            cursor = page.next_cursor
            pinnedRows = pinnedPage?.data ?? []
            state = .ready(())
        } catch {
            guard seq == loadSeq else { return }
            if case .ready = state {
                notify(error.userMessage)
            } else {
                state = .failed(error.userMessage)
            }
        }
    }

    /// #295: carries an optional action, exactly like ThreadController's twin.
    /// The inbox had a text-only version, which is why a swipe-close here had no
    /// Undo while the same action on Android did.
    private func notify(
        _ text: String,
        actionLabel: String? = nil,
        action: (@MainActor () -> Void)? = nil
    ) {
        noticeSeq += 1
        notice = ThreadNotice(
            id: noticeSeq,
            text: text,
            actionLabel: actionLabel,
            action: action
        )
    }

    // MARK: Row swipe mutations — the EXACT calls the thread header makes.

    /// Done/Reopen/Close: PATCH /v1/conversations/:id {status} (the thread
    /// status menu's mutation), then a quiet first-page refetch re-sorts and
    /// drops rows that left the active filter.
    /// #295: a full swipe closes the row, so an Undo is not a nicety here — it is
    /// the only way back. Android has offered it since the swipe shipped; iOS
    /// closed the conversation silently and the row left the pane, so recovering
    /// meant knowing to switch to the Closed filter and find it again. The named
    /// scenario in #295 is a mis-swipe on a phone, and this is that surface.
    ///
    /// `undoTo` is the status the row was ON, captured by the caller before the
    /// mutation, so the revert restores the prior state rather than assuming
    /// "open" — reopening something that was already closed would be its own
    /// small lie.
    func setRowStatus(
        _ conversationId: String,
        status: String,
        /// #295: the status the row was ON, so an Undo restores it exactly.
        from previous: String? = nil,
        announce: Bool = false
    ) {
        Task {
            do {
                _ = try await repo.setStatus(
                    companyId: companyId,
                    conversationId: conversationId,
                    status: status
                )
                await refreshFirstPage()
                guard announce else { return }
                if let previous,
                   let undoTo = InboxStatusSwipe.undoTarget(to: status, from: previous) {
                    notify(
                        InboxStatusSwipe.notice(to: status),
                        actionLabel: "Undo"
                    ) { [weak self] in
                        // The revert itself announces nothing: a toast for the
                        // undo of a toast is noise.
                        self?.setRowStatus(conversationId, status: undoTo)
                    }
                } else {
                    notify(InboxStatusSwipe.notice(to: status))
                }
            } catch {
                notify(error.userMessage)
            }
        }
    }

    /// Assign: PATCH /v1/conversations/:id {assigned_user_id} (the thread
    /// assignee picker's mutation; nil = unassign).
    func assignRow(_ conversationId: String, userId: String?) {
        Task {
            do {
                _ = try await repo.setAssignee(
                    companyId: companyId,
                    conversationId: conversationId,
                    userId: userId
                )
                await refreshFirstPage()
            } catch {
                notify(error.userMessage)
            }
        }
    }

    /// Clear the unread dot locally the moment a thread opens.
    func markLocallyRead(_ conversationId: String) {
        rows = rows.map { row in
            var updated = row
            if row.id == conversationId { updated.unread = false }
            return updated
        }
        pinnedRows = pinnedRows.map { row in
            var updated = row
            if row.id == conversationId { updated.unread = false }
            return updated
        }
    }

    /// Set the unread dot locally on both the main and pinned windows — the
    /// read/unread swipe's optimistic flip (and its revert on failure).
    private func setLocalUnread(_ conversationId: String, unread: Bool) {
        rows = rows.map { row in
            var updated = row
            if row.id == conversationId { updated.unread = unread }
            return updated
        }
        pinnedRows = pinnedRows.map { row in
            var updated = row
            if row.id == conversationId { updated.unread = unread }
            return updated
        }
    }

    /// Leading-swipe read/unread toggle, server-backed both ways: an unread row
    /// gets the SAME read receipt the thread posts on open (POST /read); a read
    /// row drops the caller's watermark (DELETE /read) so the dot survives
    /// revalidation and syncs everywhere. The local flip paints first; a failure
    /// reverts it and toasts. The Android InboxTab.toggleRead twin.
    // MARK: - #275 multi-select
    //
    // `bulkSelection` is either the ids the user pointed at or the filter-wide mode
    // the SERVER resolves — see BulkSelection.swift for why those are different
    // things and why the bar never shows a number it was not told. Named
    // `bulkSelection` rather than `selection` because the view already has a
    // `selection` binding, and that one is the navigation selection.

    private(set) var bulkSelection: BulkSelection = .empty
    private(set) var bulkRunning = false

    /// Whether another page exists. The escalation to "all matching this filter" is
    /// only offered when it would reach MORE than what is on screen.
    var hasMorePages: Bool { cursor != nil }

    func toggleBulkSelected(_ conversationId: String) {
        bulkSelection = bulkSelection.toggling(conversationId, loadedIds: rows.map(\.id))
    }

    func selectAllLoaded() {
        bulkSelection = selectLoaded(rows.map(\.id))
    }

    func selectAllMatchingFilter() {
        bulkSelection = .filter
    }

    func clearBulkSelection() {
        bulkSelection = .empty
    }

    /// Run one bulk action over the current selection, then say what actually
    /// happened.
    ///
    /// The message comes from the RESPONSE, never the selection: those two differ
    /// whenever a row was on a denied number, already gone, or past the cap, and
    /// #275 requires that difference be named rather than swallowed. The reversible
    /// actions carry one Undo for the whole operation.
    func runBulk(
        action: String,
        verb: String,
        targetStatus: String? = nil,
        targetSpam: Bool? = nil,
        targetUserId: String? = nil,
        unassign: Bool = false
    ) {
        let ids = bulkSelection.idsOrNil
        // Filter mode sends the tab's own status, so "everything matching" means the
        // set the user is looking at rather than every conversation in the company.
        let filterStatus = ids == nil ? statusFilterForBulk() : nil
        Task {
            bulkRunning = true
            do {
                let result = try await repo.bulkConversations(
                    companyId: companyId,
                    action: action,
                    ids: ids,
                    filterStatus: filterStatus,
                    targetStatus: targetStatus,
                    targetSpam: targetSpam,
                    targetUserId: targetUserId,
                    unassign: unassign
                )
                clearBulkSelection()
                await refreshFirstPage()
                let message = bulkResultMessage(
                    verb: verb,
                    applied: result.applied.count,
                    failed: result.failed.count,
                    matched: result.matched,
                    capped: result.capped
                )
                if let plan = bulkUndoPlan(result) {
                    notify(message, actionLabel: "Undo") { [weak self] in
                        self?.runBulkUndo(plan)
                    }
                } else {
                    notify(message)
                }
            } catch {
                notify(error.userMessage)
            }
            bulkRunning = false
        }
    }

    /// Replay a plan's groups back, then re-read the page. An undo raises no toast:
    /// a toast for the undo of a toast is noise.
    private func runBulkUndo(_ plan: [BulkUndoGroup]) {
        Task {
            do {
                for group in plan {
                    _ = try await repo.bulkConversations(
                        companyId: companyId,
                        action: group.action,
                        ids: group.ids,
                        targetStatus: group.targetStatus,
                        targetSpam: group.targetSpam,
                        targetUserId: group.targetUserId,
                        unassign: group.unassign
                    )
                }
                await refreshFirstPage()
            } catch {
                notify(error.userMessage)
            }
        }
    }

    /// The status the current tab is showing, for filter-mode bulk calls.
    private func statusFilterForBulk() -> String? {
        tab == .closed ? ConversationStatus.closed : nil
    }

    func toggleRead(_ row: ConversationListItem) {
        let wasUnread = row.unread
        setLocalUnread(row.id, unread: !wasUnread)
        Task {
            do {
                if InboxReadSwipe.marksRead(unread: wasUnread) {
                    try await repo.markRead(companyId: companyId, conversationId: row.id)
                } else {
                    try await repo.markUnread(companyId: companyId, conversationId: row.id)
                }
            } catch {
                setLocalUnread(row.id, unread: wasUnread)
                notify(error.userMessage)
            }
        }
    }

    // MARK: Search

    func runSearch() {
        let q = query.trimmingCharacters(in: .whitespaces)
        if q.count < 2 {
            searchState = nil
            return
        }
        searchSeq += 1
        let seq = searchSeq
        if case .ready? = searchState {} else { searchState = .loading }
        Task {
            do {
                let result = try await searchApi.search(companyId: companyId, q: q)
                if seq == searchSeq { searchState = .ready(result) }
            } catch {
                if seq == searchSeq { searchState = .failed(error.userMessage) }
            }
        }
    }

    /// Conversations arm load-more (other arms are first-page-only).
    func searchMore() {
        guard case .ready(let current)? = searchState,
              let nextCursor = current.next_cursor,
              !searchLoadingMore
        else { return }
        searchLoadingMore = true
        let seq = searchSeq
        Task {
            do {
                let more = try await searchApi.search(
                    companyId: companyId,
                    q: query.trimmingCharacters(in: .whitespaces),
                    cursor: nextCursor
                )
                if seq == searchSeq {
                    searchState = .ready(
                        SearchResult(
                            conversations: appendPage(
                                current.conversations,
                                more.conversations
                            ) { $0.matched_message_id },
                            contacts: current.contacts,
                            tasks: current.tasks,
                            attachments: current.attachments,
                            templates: current.templates,
                            // Declared BEFORE next_cursor in SearchResult, and
                            // a memberwise init takes arguments in declaration
                            // order — placing this anywhere else does not
                            // compile.
                            voicemails: current.voicemails,
                            next_cursor: more.next_cursor
                        )
                    )
                }
            } catch {
                // Quiet — "More results" stays tappable.
            }
            searchLoadingMore = false
        }
    }
}

// MARK: - List UI

@MainActor
private struct InboxList: View {
    let graph: AppGraph
    let companyId: String
    let me: Me
    /// List highlight only (the split view is gone in #186); opens route up.
    @Binding var selection: String?
    /// (conversationId, highlightMessageId?) — the highlight rides search hits.
    let onOpen: @MainActor (String, String?) -> Void
    let onOpenTask: @MainActor (String) -> Void
    let onTextContact: @MainActor (String) -> Void
    let onCompose: @MainActor () -> Void

    @State private var controller: InboxController?
    @State private var assigneeSheetOpen = false
    @State private var tagSheetOpen = false
    /// #233: the workspace's queued texts.
    @State private var scheduledSheetOpen = false
    @State private var assignFor: ConversationListItem?
    /// #295: the whole notice, not just its text — the old `String?` discarded
    /// the action, so an Undo could never have been shown here.
    @State private var visibleNotice: ThreadNotice?
    @State private var noticeDismissTask: Task<Void, Never>?
    /// #280 saved views.
    @State private var savedViewSheetOpen = false
    @State private var renamingView: SavedView?
    @State private var deletingSharedView: SavedView?
    /// #508: the last destination token this list has landed on, so a command
    /// republished to a fresh subscriber cannot re-apply a filter the reader has
    /// since changed by hand.
    @State private var appliedDestinationToken: Int?

    var body: some View {
        ZStack(alignment: .bottom) {
            Group {
                if let controller {
                    listBody(controller)
                } else {
                    CenteredLoading()
                }
            }
            if let visibleNotice {
                HStack(spacing: 12) {
                    Text(visibleNotice.text)
                        .font(.golos(12.5))
                        .lineLimit(2)
                    if let label = visibleNotice.actionLabel {
                        Button(label) {
                            visibleNotice.action?()
                            self.visibleNotice = nil
                        }
                        .font(.golos(12.5, weight: .semibold))
                        .foregroundStyle(BrandColor.olive)
                    }
                }
                .padding(.horizontal, 16)
                .padding(.vertical, 10)
                .background(.regularMaterial, in: Capsule())
                .padding(.bottom, 12)
                .onTapGesture { self.visibleNotice = nil }
            }
        }
        .background(BrandColor.canvas)
        // The ink 54pt compose FAB (spec 20) — the same compose action the
        // old header pencil fired; hidden while global search is showing.
        .overlay(alignment: .bottomTrailing) {
            if let controller, !controller.searching {
                Button {
                    onCompose()
                } label: {
                    Image(systemName: "pencil")
                        .font(.scaled(20, weight: .medium))
                        .foregroundStyle(BrandColor.paper)
                        .frame(width: 54, height: 54)
                        .background(BrandColor.ink, in: Circle())
                        .shadow(color: BrandColor.inkFixed.opacity(0.28), radius: 14, x: 0, y: 8)
                }
                .buttonStyle(.plain)
                .accessibilityLabel("New message")
                .padding(.trailing, 18)
                .padding(.bottom, 12)
            }
        }
        .onChange(of: controller?.notice?.id) { _, _ in
            guard let notice = controller?.notice else { return }
            visibleNotice = notice
            noticeDismissTask?.cancel()
            noticeDismissTask = Task {
                // #295 point 4: an undoable notice stays up longer than a bare
                // one. Three seconds is fine for "Copied"; it is not fine for the
                // only chance to reverse a mis-swipe, and the person doing the
                // mis-swiping is on a ladder holding a phone.
                //
                // Ten seconds matches Android's SnackbarDuration.Long, which its
                // notice host already picks for exactly this case. It is
                // deliberately LONGER than the web primitive's 5s: web undo
                // follows a deliberate click with a mouse, a phone undo follows a
                // gesture you can make by accident. The platform difference is
                // the point, not a drift. See docs/UNDO-AUDIT.md.
                try? await Task.sleep(for: .seconds(notice.actionLabel == nil ? 3 : 10))
                if !Task.isCancelled { visibleNotice = nil }
            }
        }
        .task(id: companyId) {
            if controller == nil {
                let created = InboxController(
                    graph: graph,
                    companyId: companyId,
                    meUserId: me.user_id
                )
                controller = created
                created.start()
            }
            // #508: the command may have arrived before this list had a
            // controller to apply it to — the response-time card's tap creates
            // this view and publishes in the same beat. Both paths call the
            // same function, and whichever runs second is the one that lands.
            applyDestination(AppRouter.shared.inboxDestination)
        }
        // #508: the inbox owns its own filters, so it consumes the destination
        // half of the command itself; the shell only switched the tab. The
        // published VALUE is what gets read — a @Published emits in `willSet`,
        // so `AppRouter.shared.inboxDestination` still holds the previous one
        // inside this closure.
        .onReceive(AppRouter.shared.$inboxDestination) { applyDestination($0) }
        .task(id: companyId) {
            for await event in await graph.realtime.events()
                where event.event == "message.created" || event.event == "conversation.updated" {
                controller?.scheduleRealtimeRefresh()
            }
        }
        .task(id: companyId) {
            for await _ in await graph.realtime.reconnected() {
                controller?.refreshAfterReconnect()
            }
        }
        // #215 Part A: re-sort/refetch page 1 on foreground so a row that moved
        // (or an unread that landed) while backgrounded is never stale.
        .resyncOnForeground { controller?.refreshAfterReconnect() }
    }

    /// #508: land on a filter another surface asked for, once per token.
    ///
    /// Clearing the command afterwards is what stops a stale one landing on a
    /// list rebuilt later — the dedupe token lives in `@State` and dies with the
    /// view, so an uncleared command would re-apply on the next one. Deferred to
    /// the next tick because a `@Published` is mid-`willSet` when this runs.
    @MainActor
    private func applyDestination(_ destination: InboxDestination?) {
        guard let controller, let destination,
              destination.token != appliedDestinationToken else { return }
        appliedDestinationToken = destination.token
        switch destination.filter {
        case .awaiting: controller.landOnAwaiting()
        }
        Task { @MainActor in AppRouter.shared.inboxDestination = nil }
    }

    @ViewBuilder
    private func listBody(_ controller: InboxController) -> some View {
        @Bindable var controller = controller
        VStack(spacing: 0) {
            HStack(alignment: .firstTextBaseline) {
                ScreenTitle(text: "Inbox")
                Spacer(minLength: 0)
                // #233: self-surfacing rather than buried. The whole ask is "so
                // nobody is surprised", and a control that only appears when
                // something IS queued does that without costing a permanent
                // slot on the days nothing is. *Applying: Zen of Clarity.*
                if !controller.scheduled.isEmpty {
                    Button {
                        scheduledSheetOpen = true
                    } label: {
                        Label(
                            "\(controller.scheduled.count)",
                            systemImage: "clock"
                        )
                        .font(.footnote.weight(.medium))
                        .foregroundStyle(BrandColor.muted500)
                    }
                    .accessibilityLabel(
                        controller.scheduled.count == 1
                            ? "1 text waiting to send"
                            : "\(controller.scheduled.count) texts waiting to send"
                    )
                }
            }
            .padding(.horizontal, 18)
            .padding(.top, 8)
            .padding(.bottom, 10)

            searchField(controller)
                .padding(.horizontal, 18)
                .padding(.bottom, 10)

            if controller.searching {
                SearchResultsPane(
                    controller: controller,
                    selection: $selection,
                    onOpenConversation: { id, highlight in
                        controller.markLocallyRead(id)
                        onOpen(id, highlight)
                    },
                    onOpenTask: onOpenTask,
                    onTextContact: onTextContact
                )
            } else {
                statusPillRow(controller)
                savedViewsRow(controller)

                FilterChipRow(
                    controller: controller,
                    onPickAssignee: { assigneeSheetOpen = true },
                    onPickTag: { tagSheetOpen = true }
                )

                // #476: first-run guidance, above the list and OUTSIDE the
                // state switch below. Inside it the card would vanish for a
                // brand-new workspace, which is its entire audience.
                GettingStartedCard(graph: graph, companyId: companyId, me: me)
                    .padding(.horizontal, 18)

                switch controller.state {
                case .loading:
                    CenteredLoading()
                case .failed(let message):
                    CenteredError(message: message) { controller.reload(showLoading: true) }
                case .ready:
                    ConversationListPane(
                        controller: controller,
                        selection: $selection,
                        onOpen: { id in
                            controller.markLocallyRead(id)
                            onOpen(id, nil)
                        },
                        onAssign: { assignFor = $0 }
                    )
                }
            }
        }
        .background(BrandColor.canvas)
        // Debounced search over the query field.
        .task(id: controller.query) {
            if !controller.query.isEmpty {
                try? await Task.sleep(for: .milliseconds(300))
                if Task.isCancelled { return }
            }
            controller.runSearch()
        }
        // `controller` is already unwrapped in this branch of the body, so
        // these take it directly rather than re-binding an optional.
        .sheet(isPresented: $savedViewSheetOpen) {
            SaveViewSheet(
                controller: controller,
                // Computed HERE rather than in the sheet's init: `body` is
                // MainActor-isolated and a View's init is not, so reading the
                // controller's state from an initialiser is a concurrency
                // error under Swift 6.
                suggestedName: suggestViewName(
                    controller.currentSelection,
                    assigneeName: controller.assignee?.display_name,
                    tagName: controller.tag?.name
                ),
                canShare: canShareSavedViews,
                onClose: { savedViewSheetOpen = false }
            )
        }
        .sheet(item: $renamingView) { view in
            RenameViewSheet(
                controller: controller,
                view: view,
                onClose: { renamingView = nil }
            )
        }
        // Ethical Friction, only where it is earned: a crew view is a screen
        // other people open every morning, and the person deleting it cannot
        // see who that affects.
        .confirmationDialog(
            "Delete this crew view?",
            isPresented: Binding(
                get: { deletingSharedView != nil },
                set: { if !$0 { deletingSharedView = nil } }
            ),
            titleVisibility: .visible
        ) {
            Button("Delete for everyone", role: .destructive) {
                if let view = deletingSharedView { controller.deleteView(id: view.id) }
                deletingSharedView = nil
            }
            Button("Keep it", role: .cancel) { deletingSharedView = nil }
        } message: {
            Text(
                "Anyone who opens the app there will land on the ordinary inbox instead."
            )
        }
        .sheet(isPresented: $assigneeSheetOpen) {
            AssigneeFilterSheet(
                members: controller.members,
                meUserId: me.user_id,
                selected: controller.assignee
            ) { member in
                assigneeSheetOpen = false
                controller.setAssigneeFilter(member)
            }
        }
        .sheet(isPresented: $tagSheetOpen) {
            TagFilterSheet(tags: controller.allTags, selected: controller.tag) { tag in
                tagSheetOpen = false
                controller.setTagFilter(tag)
            }
        }
        // #233: what the workspace has queued to go out.
        .sheet(isPresented: $scheduledSheetOpen) {
            ScheduledSheet(
                rows: controller.scheduled,
                onOpenConversation: { id in
                    controller.markLocallyRead(id)
                    onOpen(id, nil)
                },
                onCancel: { controller.cancelScheduled($0) }
            )
        }
        // The row swipe's Assign — the thread's picker, the thread's mutation.
        .sheet(
            isPresented: Binding(
                get: { assignFor != nil },
                set: { if !$0 { assignFor = nil } }
            )
        ) {
            if let row = assignFor {
                AssigneePickerSheet(
                    members: controller.members,
                    meUserId: me.user_id,
                    selectedUserId: row.assigned_user_id
                ) { userId in
                    assignFor = nil
                    if userId != row.assigned_user_id {
                        controller.assignRow(row.id, userId: userId)
                    }
                }
            }
        }
    }

    private func searchField(_ controller: InboxController) -> some View {
        @Bindable var controller = controller
        return HStack(spacing: 9) {
            Image(systemName: "magnifyingglass")
                .font(.scaled(15, weight: .medium))
                .foregroundStyle(BrandColor.muted700)
            TextField("Search texts, tasks, contacts…", text: $controller.query)
                .font(.golos(13.5))
                .foregroundStyle(BrandColor.ink)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .onChange(of: controller.query) { _, next in
                    if next.count > 200 {
                        controller.query = String(next.prefix(200))
                    }
                }
            if !controller.query.isEmpty {
                Button {
                    controller.query = ""
                } label: {
                    Image(systemName: "xmark.circle.fill")
                        .foregroundStyle(BrandColor.muted400)
                }
                .buttonStyle(.borderless)
                .accessibilityLabel("Clear search")
            }
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 11)
        .background(BrandColor.paper, in: Capsule())
    }

    /// Spec 20's segmented pills: selected = ink pill with paper text, idle =
    /// paper pill with muted text. Same `selectTab` mutation as the old
    /// segmented Picker.
    private func statusPillRow(_ controller: InboxController) -> some View {
        HStack(spacing: 7) {
            ForEach(InboxStatusTab.allCases) { item in
                statusPill(item, selected: controller.tab == item) {
                    controller.selectTab(item)
                }
            }
            Spacer(minLength: 0)
        }
        .padding(.horizontal, 18)
        .padding(.vertical, 4)
    }

    private func statusPill(
        _ item: InboxStatusTab,
        selected: Bool,
        onTap: @escaping @MainActor () -> Void
    ) -> some View {
        Button(action: onTap) {
            Text(item.rawValue)
                .font(.golos(12.5, weight: selected ? .semibold : .medium))
                .foregroundStyle(selected ? BrandColor.paper : BrandColor.muted700)
                .padding(.horizontal, 16)
                .padding(.vertical, 10)
                .background(selected ? BrandColor.ink : BrandColor.paper, in: Capsule())
        }
        .buttonStyle(.plain)
        // Expose selected state so VoiceOver announces the active status tab.
        .accessibilityAddTraits(selected ? .isSelected : [])
    }
}

@MainActor
private struct FilterChipRow: View {
    let controller: InboxController
    let onPickAssignee: @MainActor () -> Void
    let onPickTag: @MainActor () -> Void

    // Chip labels/clear-actions extracted with explicit types — the inline
    // map/ternary optional-closure expressions made swiftc's type checker
    // give up (CI run 7).
    private var assigneeLabel: String {
        guard let assignee = controller.assignee else { return "Assignee" }
        let name = assignee.display_name.isBlank ? "Teammate" : assignee.display_name
        return "Assignee: \(name)"
    }

    private var assigneeClear: (@MainActor () -> Void)? {
        guard controller.assigneeUserId != nil else { return nil }
        return { controller.setAssigneeFilter(nil) }
    }

    private var tagLabel: String {
        guard let tag = controller.tag else { return "Tag" }
        return "Tag: \(tag.name)"
    }

    private var tagClear: (@MainActor () -> Void)? {
        guard controller.tagId != nil else { return nil }
        return { controller.setTagFilter(nil) }
    }

    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                if controller.tab != .mine {
                    FilterChip(
                        label: assigneeLabel,
                        selected: controller.assigneeUserId != nil,
                        onTap: onPickAssignee,
                        onClear: assigneeClear
                    )
                }
                FilterChip(
                    label: tagLabel,
                    selected: controller.tagId != nil,
                    onTap: onPickTag,
                    onClear: tagClear
                )
                // #508: ahead of the others, because it is the only chip here
                // that names money leaving. Reachable as a control in its own
                // right and not only by arriving from the response-time card —
                // a filter you can reach from exactly one card is one most of
                // the crew never learns exists.
                FilterChip(
                    label: "Unanswered",
                    selected: controller.awaitingOnly,
                    onTap: { controller.toggleAwaiting() },
                    onClear: nil
                )
                FilterChip(
                    label: "Unread",
                    selected: controller.unreadOnly,
                    onTap: { controller.toggleUnread() },
                    onClear: nil
                )
                FilterChip(
                    label: "Spam",
                    selected: controller.spamOnly,
                    onTap: { controller.toggleSpam() },
                    onClear: nil
                )
                // #293: the way back to what you deferred. A snooze that hid a
                // thread with no way to find it would be worse than the
                // clutter it solved.
                FilterChip(
                    label: "Snoozed",
                    selected: controller.snoozedOnly,
                    onTap: { controller.toggleSnoozed() },
                    onClear: nil
                )
                // #548: the way back, which this client did not have at all.
                //
                // The founder's ask was to do his filtering in one place and be
                // able to start again. Clearing by hand meant up to seven taps
                // across two bands, each firing its own reload — and the status
                // segment could not be put back to "everything" at all, because
                // Open is itself a filter.
                //
                // LAST in the row, and only when something IS filtered: a control
                // that is always present but usually does nothing is furniture,
                // and one that appears where a chip used to be would move the row
                // under a thumb. It ends the row rather than leading it because it
                // is the exit, not the first thing to reach for.
                if controller.isFiltered {
                    FilterChip(
                        label: "Clear filters",
                        selected: false,
                        onTap: { controller.clearFilters() },
                        onClear: nil
                    )
                }
            }
            .padding(.horizontal, 18)
            .padding(.vertical, 2)
        }
    }
}

private struct FilterChip: View {
    let label: String
    let selected: Bool
    let onTap: @MainActor () -> Void
    let onClear: (@MainActor () -> Void)?

    // #548: the pill's padding belongs to the BUTTONS, not to the HStack around
    // them. Outside, it made the bare text glyph the only place a tap counted —
    // pressing the visible capsule an eighth of an inch off the letters did
    // nothing, on the row that is the whole filter UI. Explicit types because
    // swiftc's checker gives up on inline ternaries in this file (CI run 7).
    private var labelTrailing: CGFloat { onClear == nil ? 13 : 3 }
    private var chipVertical: CGFloat { 10 }

    var body: some View {
        HStack(spacing: 0) {
            Button(action: onTap) {
                Text(label)
                    .font(.golos(12, weight: selected ? .semibold : .medium))
                    .foregroundStyle(selected ? BrandColor.paper : BrandColor.muted700)
                    .padding(.leading, 13)
                    .padding(.trailing, labelTrailing)
                    .padding(.vertical, chipVertical)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            if let onClear {
                Button(action: onClear) {
                    Image(systemName: "xmark")
                        .font(.scaled(10, weight: .semibold))
                        .foregroundStyle(selected ? BrandColor.paper : BrandColor.muted500)
                        // A 10pt glyph is not a target. This gives the X its own
                        // slice of the pill, wide enough to hit without aiming and
                        // without stealing the taps meant for the label.
                        .padding(.leading, 3)
                        .padding(.trailing, 11)
                        .padding(.vertical, chipVertical)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Clear filter")
            }
        }
        .background(selected ? BrandColor.ink : BrandColor.paper, in: Capsule())
    }
}

@MainActor
private struct ConversationListPane: View {
    let controller: InboxController
    @Binding var selection: String?
    let onOpen: @MainActor (String) -> Void
    let onAssign: @MainActor (ConversationListItem) -> Void

    var body: some View {
        let empty = controller.rows.isEmpty && controller.pinnedRows.isEmpty
        if empty {
            // A List so pull-to-refresh works from the empty state too.
            List {
                Text(emptyLabel)
                    .font(.golos(13))
                    .foregroundStyle(BrandColor.muted600)
                    .multilineTextAlignment(.center)
                    .frame(maxWidth: .infinity)
                    .padding(.horizontal, 32)
                    .padding(.top, 120)
                    .listRowSeparator(.hidden)
                    .listRowBackground(BrandColor.canvas)
            }
            .listStyle(.plain)
            .scrollContentBackground(.hidden)
            .background(BrandColor.canvas)
            .refreshable { await controller.refreshFirstPage() }
        } else {
            VStack(spacing: 0) {
            // #275: only while something is selected, and above the list so
            // selecting a row does not shove the list under the thumb.
            if !controller.bulkSelection.isEmpty {
                BulkSelectionBar(controller: controller)
            }
            List(selection: $selection) {
                if !controller.pinnedRows.isEmpty {
                    Section {
                        ForEach(controller.pinnedRows, id: \.id) { row in
                            rowCell(row, pinned: true)
                        }
                    } header: {
                        SectionHeader(label: "Pinned")
                    }
                }
                Section {
                    ForEach(Array(controller.rows.enumerated()), id: \.element.id) { index, row in
                        rowCell(row)
                            .onAppear {
                                if index >= controller.rows.count - 5 {
                                    controller.loadMore()
                                }
                            }
                    }
                    if controller.loadingMore {
                        HStack {
                            Spacer()
                            ProgressView()
                            Spacer()
                        }
                        .listRowSeparator(.hidden)
                        .listRowBackground(BrandColor.canvas)
                    }
                } header: {
                    if !controller.pinnedRows.isEmpty, !controller.rows.isEmpty {
                        SectionHeader(label: "Conversations")
                    }
                }
            }
            .listStyle(.plain)
            .scrollContentBackground(.hidden)
            .background(BrandColor.canvas)
            // The reconnect path's first-page refetch, on demand.
            .refreshable { await controller.refreshFirstPage() }
            }
        }
    }

    /// The row's assignee as a name the reader recognises: "You" for their own,
    /// the teammate's display name otherwise, nil when nobody has it. Mirrors
    /// Android's assigneeName in InboxTab.kt.
    private func assigneeName(_ row: ConversationListItem) -> String? {
        guard let userId = row.assigned_user_id else { return nil }
        if userId == controller.meUserId { return "You" }
        guard let member = controller.members.first(where: { $0.user_id == userId })
        else { return nil }
        return member.display_name.isBlank ? "Teammate" : member.display_name
    }

    /// One row + its swipe actions. Done/Reopen IS the close/open status flip
    /// (product vocabulary: "Done" == closed — the web removed the redundant
    /// separate control); Assign opens the thread's assignee picker.
    private func rowCell(_ row: ConversationListItem, pinned: Bool = false) -> some View {
        let closed = row.status == ConversationStatus.closed
        // #275: in selection mode a tap toggles rather than opens. That is the
        // convention and also the only workable one — long-pressing every row would
        // be worse than the tedium this replaces.
        let selecting = !controller.bulkSelection.isEmpty
        let picked = controller.bulkSelection.isRowSelected(row.id)
        return ConversationRow(row: row, assigneeName: assigneeName(row)) {
            if selecting {
                controller.toggleBulkSelected(row.id)
            } else {
                onOpen(row.id)
            }
        }
            .tag(row.id)
            // #275: long-press starts selection mode.
            .onLongPressGesture { controller.toggleBulkSelected(row.id) }
            // Selected rows take the olive-tinted well rather than a checkbox
            // column: on a phone a column of controls costs a row's worth of width
            // for something long-press already communicates.
            .listRowBackground(
                picked
                    ? BrandColor.olive.opacity(0.12)
                    : (pinned ? BrandColor.cream : BrandColor.paper)
            )
            .listRowSeparatorTint(BrandColor.inset)
            // Leading read/unread toggle (#185/#186 parity): mark read when
            // unread, mark unread when read. A shortcut only — the row tap and
            // the thread still mark read the ordinary way.
            .swipeActions(edge: .leading, allowsFullSwipe: true) {
                Button {
                    Haptics.tap()
                    controller.toggleRead(row)
                } label: {
                    Label(
                        InboxReadSwipe.title(unread: row.unread),
                        systemImage: InboxReadSwipe.symbol(unread: row.unread)
                    )
                }
                .tint(Color(.systemGray))
            }
            .swipeActions(edge: .trailing, allowsFullSwipe: true) {
                Button {
                    // A full swipe COMMITS — the row leaves the list. On a
                    // swipe the finger is already moving, so the buzz is what
                    // separates "it took" from "it sprang back".
                    Haptics.confirm()
                    controller.setRowStatus(
                        row.id,
                        status: closed ? ConversationStatus.open : ConversationStatus.closed,
                        // #295: the swipe announces, so a mis-swipe has an Undo —
                        // back to the status the row actually had.
                        from: row.status,
                        announce: true
                    )
                } label: {
                    Label(
                        closed ? "Reopen" : "Done",
                        systemImage: closed ? "arrow.uturn.backward" : "checkmark"
                    )
                }
                .tint(BrandColor.olive)
                Button {
                    Haptics.tap()
                    onAssign(row)
                } label: {
                    Label("Assign", systemImage: "person")
                }
                .tint(Color(.systemGray))
            }
    }

    private var emptyLabel: String {
        // #508: an empty Unanswered list is the best news this screen can give,
        // and "nothing matches these filters" reports it as an absence. Said as
        // the result it is.
        if controller.awaitingOnly { return "Everyone has been answered." }
        if controller.hasSecondaryFilters { return "Nothing matches these filters." }
        switch controller.tab {
        case .open: return "Nothing waiting on you."
        case .mine: return "Nothing assigned to you."
        case .closed: return "No closed conversations."
        case .all: return "No conversations yet."
        }
    }
}

private struct ConversationRow: View {
    let row: ConversationListItem
    /// Who owns this conversation, already resolved to a display name ("You"
    /// for the reader). Nil when nobody has it. In a shared inbox this is the
    /// difference between a list you can triage and one where every row looks
    /// like yours; web and Android both show it, so the row does too.
    var assigneeName: String?
    let onTap: @MainActor () -> Void

    private var name: String {
        row.contact.name ?? formatPhone(row.contact.phone_e164)
    }

    private var snippet: String {
        guard let last = row.last_message else { return "" }
        // Name what actually arrived: a voice message is not a "Photo", which
        // is what this row used to call every attachment.
        let body: String
        if last.body.isBlank && last.has_attachments {
            body = attachmentLabel(
                kind: last.attachment_kind.map { MediaKind(rawValue: $0) ?? .file },
                count: last.attachment_count ?? 1
            )
        } else {
            body = last.body
        }
        switch last.direction {
        case "note": return "Note · \(body)"
        // Whose turn it is, at a glance: without this a row you already
        // answered looks exactly like one still waiting.
        case "outbound": return "You: \(body)"
        default: return body
        }
    }

    var body: some View {
        Button(action: onTap) {
            HStack(alignment: .center, spacing: 11) {
                InitialsAvatar(name: name, size: 42)
                VStack(alignment: .leading, spacing: 2) {
                    HStack(spacing: 6) {
                        Text(name)
                            .font(.golos(14, weight: row.unread ? .semibold : .medium))
                            .foregroundStyle(BrandColor.ink)
                            .lineLimit(1)
                        // #293: normally this row only exists in the Snoozed
                        // view — but it also survives a mid-session return, and
                        // a row that came back with no explanation is what
                        // makes people stop trusting the list. The return time
                        // IS its reason for being here.
                        if let until = row.snoozed_until, isSnoozed(until) {
                            Text(
                                row.snooze_note.map {
                                    "\(snoozeReturnLabel(until)) · \($0)"
                                } ?? snoozeReturnLabel(until)
                            )
                                .font(.golos(10, weight: .bold))
                                .foregroundStyle(BrandColor.muted600)
                                .padding(.horizontal, 7)
                                .padding(.vertical, 2)
                                .background(BrandColor.inset, in: Capsule())
                                .lineLimit(1)
                        }
                        if row.is_spam {
                            Text("Spam")
                                .font(.golos(10, weight: .bold))
                                .foregroundStyle(BrandColor.muted600)
                                .padding(.horizontal, 7)
                                .padding(.vertical, 2)
                                .background(BrandColor.inset, in: Capsule())
                        }
                        // #414 ask 2 — "visibly flagged in the inbox". Same
                        // chip shape as Spam so the row keeps one vocabulary,
                        // in the destructive pair so it is the thing the eye
                        // lands on first. Flagged until the crew CLOSES the
                        // thread: closing is the product's existing word for
                        // "handled", so nothing here invents a second notion
                        // of resolved or lets a timer decide an emergency
                        // stopped mattering.
                        if isConversationFlaggedUrgent(
                            emergencyAt: row.emergency_at,
                            closedAt: row.closed_at
                        ) {
                            UrgentBadge()
                        }
                    }
                    if !snippet.isEmpty {
                        // A message carrying media reads differently at a glance
                        // from one that is only text. The clip shows whenever
                        // there is an attachment, including alongside a caption,
                        // where the label alone would not appear at all.
                        HStack(alignment: .top, spacing: 4) {
                            if row.last_message?.has_attachments == true {
                                Image(systemName: "paperclip")
                                    .font(.scaled(9.5))
                                    .foregroundStyle(BrandColor.muted300)
                                    .padding(.top, 2)
                            }
                            Text(snippet)
                                .font(.golos(12))
                                .foregroundStyle(BrandColor.muted600)
                                .lineLimit(2)
                        }
                    }
                    if !row.tags.isEmpty || assigneeName != nil {
                        HStack(spacing: 4) {
                            ForEach(row.tags.prefix(3), id: \.id) { tag in
                                TagChip(tag: tag)
                            }
                            if row.tags.count > 3 {
                                Text("+\(row.tags.count - 3)")
                                    .font(.golos(10.5, weight: .semibold))
                                    .foregroundStyle(BrandColor.muted500)
                            }
                            if let assigneeName {
                                Text(assigneeName)
                                    .font(.golos(10.5, weight: .semibold))
                                    .foregroundStyle(BrandColor.muted500)
                                    .lineLimit(1)
                            }
                        }
                        .padding(.top, 2)
                    }
                }
                Spacer()
                VStack(alignment: .trailing, spacing: 6) {
                    Text(relativeTime(row.last_message_at))
                        .font(.golos(11))
                        .monospacedDigit()
                        .foregroundStyle(BrandColor.muted300)
                    if row.unread {
                        AttentionDot()
                    }
                }
            }
            .padding(.vertical, 5)
        }
        .buttonStyle(.plain)
        // Announce read/unread to VoiceOver — the AttentionDot that conveys it
        // to sighted users isn't otherwise exposed, so read and unread
        // conversations sounded identical. Matches NotificationsView.
        .accessibilityValue(row.unread ? "Unread" : "")
        .accessibilityHint(assigneeName.map { "Assigned to \($0)" } ?? "")
    }
}

private struct TagChip: View {
    let tag: Tag

    var body: some View {
        HStack(spacing: 4) {
            if let tint = tag.color.flatMap(parseHexColor) {
                Circle()
                    .fill(tint)
                    .frame(width: 6, height: 6)
            }
            Text(tag.name)
                .font(.golos(10.5, weight: .semibold))
                .foregroundStyle(BrandColor.muted600)
        }
        .padding(.horizontal, 7)
        .padding(.vertical, 2)
        .background(BrandColor.inset, in: Capsule())
    }
}

/// "#rrggbb" → Color, nil for anything unparseable.
private func parseHexColor(_ hex: String) -> Color? {
    var value = hex
    if value.hasPrefix("#") { value = String(value.dropFirst()) }
    guard value.count == 6, let parsed = UInt32(value, radix: 16) else { return nil }
    return Color(hex: parsed)
}

// MARK: - Filter picker sheets

@MainActor
private struct AssigneeFilterSheet: View {
    let members: [Member]
    let meUserId: String
    let selected: Member?
    let onPick: @MainActor (Member?) -> Void

    var body: some View {
        NavigationStack {
            List {
                pickerRow(label: "Anyone", avatarName: nil, isSelected: selected == nil) {
                    onPick(nil)
                }
                ForEach(members.filter { $0.deactivated_at == nil }, id: \.user_id) { member in
                    pickerRow(
                        label: (member.display_name.isBlank ? "Teammate" : member.display_name)
                            + (member.user_id == meUserId ? " (you)" : ""),
                        avatarName: member.display_name.isBlank ? nil : member.display_name,
                        isSelected: selected?.user_id == member.user_id
                    ) {
                        onPick(member)
                    }
                }
            }
            .listStyle(.plain)
            .navigationTitle("Filter by assignee")
            .navigationBarTitleDisplayMode(.inline)
        }
        .presentationDetents([.medium, .large])
    }

    private func pickerRow(
        label: String,
        avatarName: String?,
        isSelected: Bool,
        onTap: @escaping @MainActor () -> Void
    ) -> some View {
        Button(action: onTap) {
            HStack(spacing: 12) {
                if let avatarName {
                    InitialsAvatar(name: avatarName, size: 30)
                }
                Text(label)
                    .font(.golos(13.5, weight: .semibold))
                    .foregroundStyle(BrandColor.ink)
                Spacer()
                if isSelected {
                    Image(systemName: "checkmark")
                        .foregroundStyle(BrandColor.olive)
                }
            }
        }
    }
}

@MainActor
private struct TagFilterSheet: View {
    let tags: [Tag]
    let selected: Tag?
    let onPick: @MainActor (Tag?) -> Void

    var body: some View {
        NavigationStack {
            List {
                Button {
                    onPick(nil)
                } label: {
                    HStack {
                        Text("Any tag")
                            .font(.golos(13.5, weight: .semibold))
                            .foregroundStyle(BrandColor.ink)
                        Spacer()
                        if selected == nil {
                            Image(systemName: "checkmark")
                                .foregroundStyle(BrandColor.olive)
                        }
                    }
                }
                if tags.isEmpty {
                    Text("No tags yet. Add tags from a conversation on the web.")
                        .font(.golos(12.5))
                        .foregroundStyle(BrandColor.muted500)
                }
                ForEach(tags, id: \.id) { tag in
                    Button {
                        onPick(tag)
                    } label: {
                        HStack {
                            Text(tag.name)
                                .font(.golos(13.5, weight: .semibold))
                                .foregroundStyle(BrandColor.ink)
                            Spacer()
                            if selected?.id == tag.id {
                                Image(systemName: "checkmark")
                                    .foregroundStyle(BrandColor.olive)
                            }
                        }
                    }
                }
            }
            .listStyle(.plain)
            .navigationTitle("Filter by tag")
            .navigationBarTitleDisplayMode(.inline)
        }
        .presentationDetents([.medium, .large])
    }
}

// MARK: - Search results

/// ts_headline wraps matches in <b>…</b>; render plain on mobile.
private func stripHighlight(_ snippet: String) -> String {
    snippet
        .replacingOccurrences(of: "<b>", with: "")
        .replacingOccurrences(of: "</b>", with: "")
}

@MainActor
private struct SearchResultsPane: View {
    let controller: InboxController
    /// List highlight only.
    @Binding var selection: String?
    /// (conversationId, highlightMessageId) — opens the thread scrolled to the
    /// matched message with a flash (#186 item 2).
    let onOpenConversation: @MainActor (String, String?) -> Void
    /// A TASK hit opens the TASK, not its conversation (#186 item 2).
    let onOpenTask: @MainActor (String) -> Void
    let onTextContact: @MainActor (String) -> Void

    /// Dispatch a computed `SearchResultRoute` (the tested routing decision).
    private func dispatch(_ route: SearchResultRoute) {
        switch route {
        case .thread(let id, let highlight): onOpenConversation(id, highlight)
        case .task(let id): onOpenTask(id)
        }
    }

    var body: some View {
        switch controller.searchState {
        case nil, .loading?:
            CenteredLoading()
        case .failed(let message)?:
            CenteredError(message: message) { controller.runSearch() }
        case .ready(let result)?:
            resultsList(result)
        }
    }

    @ViewBuilder
    private func resultsList(_ result: SearchResult) -> some View {
        let empty = result.conversations.isEmpty && result.contacts.isEmpty &&
            result.tasks.isEmpty && result.attachments.isEmpty && result.templates.isEmpty
            && result.voicemails.isEmpty
        if empty {
            Text("Nothing matches \"\(controller.query.trimmingCharacters(in: .whitespaces))\".")
                .font(.golos(13))
                .foregroundStyle(BrandColor.muted600)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        } else {
            List(selection: $selection) {
                if !result.conversations.isEmpty {
                    Section {
                        ForEach(result.conversations, id: \.matched_message_id) { hit in
                            conversationHit(hit)
                                .listRowBackground(BrandColor.paper)
                                .listRowSeparatorTint(BrandColor.inset)
                        }
                        if result.next_cursor != nil {
                            Button(controller.searchLoadingMore ? "Loading…" : "More results") {
                                controller.searchMore()
                            }
                            .font(.golos(12.5, weight: .semibold))
                            .foregroundStyle(BrandColor.olive)
                            .disabled(controller.searchLoadingMore)
                            .listRowBackground(BrandColor.paper)
                            .listRowSeparatorTint(BrandColor.inset)
                        }
                    } header: {
                        SectionHeader(label: "Conversations", count: result.conversations.count)
                    }
                }
                if !result.contacts.isEmpty {
                    Section {
                        ForEach(result.contacts, id: \.id) { contact in
                            contactHit(contact)
                                .listRowBackground(BrandColor.paper)
                                .listRowSeparatorTint(BrandColor.inset)
                        }
                    } header: {
                        SectionHeader(label: "Contacts", count: result.contacts.count)
                    }
                }
                if !result.tasks.isEmpty {
                    Section {
                        ForEach(result.tasks, id: \.id) { task in
                            Button {
                                // The TASK opens its detail — not its thread.
                                dispatch(InboxSearchRouting.route(forTask: task))
                            } label: {
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(task.title)
                                        .font(.golos(13, weight: .semibold))
                                        .foregroundStyle(BrandColor.ink)
                                    Text(task.done ? "Done" : "Open task")
                                        .font(.golos(11))
                                        .foregroundStyle(BrandColor.muted400)
                                }
                            }
                            .buttonStyle(.plain)
                            .listRowBackground(BrandColor.paper)
                            .listRowSeparatorTint(BrandColor.inset)
                        }
                    } header: {
                        SectionHeader(label: "Tasks", count: result.tasks.count)
                    }
                }
                if !result.attachments.isEmpty {
                    Section {
                        ForEach(result.attachments, id: \.id) { hit in
                            attachmentHit(hit)
                                .listRowBackground(BrandColor.paper)
                                .listRowSeparatorTint(BrandColor.inset)
                        }
                    } header: {
                        SectionHeader(label: "Attachments", count: result.attachments.count)
                    }
                }
                // #409: the words somebody SPOKE. Above saved replies because
                // a customer's voice outranks our own copy when both match.
                //
                // NOT TAPPABLE, and that is a deliberate call rather than an
                // omission. #336 gave a call a permalink on WEB; the phones
                // have no call-detail screen to open, and routing a tap to the
                // calls tab would drop the reader in a list to scroll — most
                // of the way back to the problem this arm exists to solve. The
                // snippet already answers the question somebody is actually
                // asking, so the row earns its place unlinked. A row that
                // looks tappable and lands nowhere useful is worse than one
                // that does not.
                if !result.voicemails.isEmpty {
                    Section {
                        ForEach(result.voicemails, id: \.id) { hit in
                            VStack(alignment: .leading, spacing: 2) {
                                Text(
                                    hit.caller_e164.map { formatPhone($0) } ?? "Voicemail"
                                )
                                .font(.golos(13, weight: .semibold))
                                .foregroundStyle(BrandColor.ink)
                                Text(stripHighlight(hit.snippet))
                                    .font(.golos(12))
                                    .foregroundStyle(BrandColor.muted600)
                                    .lineLimit(2)
                            }
                            .listRowBackground(BrandColor.paper)
                            .listRowSeparatorTint(BrandColor.inset)
                        }
                    } header: {
                        SectionHeader(label: "Voicemails", count: result.voicemails.count)
                    }
                }
                if !result.templates.isEmpty {
                    Section {
                        ForEach(result.templates, id: \.id) { hit in
                            VStack(alignment: .leading, spacing: 2) {
                                Text(hit.name)
                                    .font(.golos(13, weight: .semibold))
                                    .foregroundStyle(BrandColor.ink)
                                Text(stripHighlight(hit.snippet))
                                    .font(.golos(12))
                                    .foregroundStyle(BrandColor.muted600)
                                    .lineLimit(2)
                            }
                            .listRowBackground(BrandColor.paper)
                            .listRowSeparatorTint(BrandColor.inset)
                        }
                    } header: {
                        SectionHeader(label: "Saved replies", count: result.templates.count)
                    }
                }
            }
            .listStyle(.plain)
            .scrollContentBackground(.hidden)
            .background(BrandColor.canvas)
        }
    }

    private func conversationHit(_ hit: SearchConversationHit) -> some View {
        let name = hit.contact.name ?? formatPhone(hit.contact.phone_e164)
        return Button {
            // Open the thread scrolled to + flashing the matched message.
            dispatch(InboxSearchRouting.route(forConversation: hit))
        } label: {
            HStack(spacing: 11) {
                InitialsAvatar(name: name, size: 38)
                VStack(alignment: .leading, spacing: 2) {
                    Text(name)
                        .font(.golos(13.5, weight: .semibold))
                        .foregroundStyle(BrandColor.ink)
                    Text(
                        (hit.direction == "note" ? "Note · " : "")
                            + stripHighlight(hit.snippet)
                    )
                    .font(.golos(12))
                    .foregroundStyle(BrandColor.muted600)
                    .lineLimit(2)
                }
                Spacer()
                Text(relativeTime(hit.matched_at))
                    .font(.golos(11))
                    .monospacedDigit()
                    .foregroundStyle(BrandColor.muted300)
            }
        }
        .buttonStyle(.plain)
    }

    private func contactHit(_ contact: ContactSummary) -> some View {
        let name = contact.name ?? formatPhone(contact.phone_e164)
        return Button {
            onTextContact(contact.id)
        } label: {
            HStack(spacing: 11) {
                InitialsAvatar(name: name, size: 38)
                VStack(alignment: .leading, spacing: 2) {
                    Text(name)
                        .font(.golos(13.5, weight: .semibold))
                        .foregroundStyle(BrandColor.ink)
                    Text(formatPhone(contact.phone_e164))
                        .font(.golos(11.5))
                        .monospacedDigit()
                        .foregroundStyle(BrandColor.muted400)
                }
                Spacer()
            }
        }
        .buttonStyle(.plain)
    }

    @ViewBuilder
    private func attachmentHit(_ hit: SearchAttachmentHit) -> some View {
        let content = VStack(alignment: .leading, spacing: 2) {
            Text(hit.file_name)
                .font(.golos(13, weight: .semibold))
                .foregroundStyle(BrandColor.ink)
                .lineLimit(1)
            Text(relativeTime(hit.created_at))
                .font(.golos(11))
                .foregroundStyle(BrandColor.muted400)
        }
        if let conversationId = hit.conversation_id {
            Button {
                dispatch(InboxSearchRouting.route(forAttachment: conversationId))
            } label: {
                content.foregroundStyle(.primary)
            }
            .buttonStyle(.plain)
        } else {
            content
        }
    }
}

// MARK: - Previews

private func previewListItem(
    id: String,
    name: String?,
    status: String,
    unread: Bool,
    snippet: String,
    tags: [Tag] = []
) -> ConversationListItem {
    ConversationListItem(
        id: id,
        company_id: "co",
        contact_id: "p-\(id)",
        phone_number_id: "n1",
        status: status,
        is_spam: false,
        assigned_user_id: nil,
        pinned_at: nil,
        pinned_by_user_id: nil,
        last_message_at: "2026-07-15T12:00:00Z",
        closed_at: nil,
        created_at: "2026-07-14T12:00:00Z",
        updated_at: "2026-07-15T12:00:00Z",
        contact: ContactSummary(id: "p-\(id)", name: name, phone_e164: "+14155550134"),
        tags: tags,
        unread: unread,
        last_message: ConversationSnippet(
            id: "m-\(id)",
            direction: "inbound",
            body: snippet,
            created_at: "2026-07-15T12:00:00Z",
            has_attachments: false
        )
    )
}

#Preview("Inbox rows") {
    List {
        ConversationRow(
            row: previewListItem(
                id: "c1",
                name: "Dana Whitcomb",
                status: "open",
                unread: true,
                snippet: "Can you come by Tuesday morning to look at the fence?",
                tags: [
                    Tag(id: "t1", name: "Estimate", color: "#66801F", created_at: nil, updated_at: nil),
                ]
            ),
            assigneeName: "You",
            onTap: {}
        )
        ConversationRow(
            row: previewListItem(
                id: "c2",
                name: nil,
                status: "closed",
                unread: false,
                snippet: "Thanks, payment sent."
            ),
            onTap: {}
        )
    }
    .listStyle(.plain)
}

/// #275 — the selection bar, shown only while something is selected.
///
/// Matches the web and Android bars in reasoning rather than in pixels.
///
/// *The count is never invented.* In filter mode the label reads "All matching this
/// filter" with no number in it, because the client does not know the number — the
/// server counts the set when it runs the action. `BulkSelection.label` owns that
/// rule for all three clients.
///
/// *Progressive disclosure.* Long-press one row, then "Select all N loaded", then —
/// only if more pages exist — "Select all matching this filter". Each step says what
/// it will do.
///
/// *Three actions, then a menu.* Mark read, Close and Spam are the ones #275's own
/// scenarios name (back from a week off; a robotext blast). Assign lives behind the
/// overflow, because a row of six controls on a phone is a menu that forgot to
/// collapse.
///
/// There is no send action and nothing to add one to: bulk management only.
@MainActor
private struct BulkSelectionBar: View {
    let controller: InboxController

    private var loadedIds: [String] { controller.rows.map(\.id) }

    private var showSelectLoaded: Bool {
        guard case let .ids(ids) = controller.bulkSelection else { return false }
        return !loadedIds.isEmpty && !loadedIds.allSatisfy { ids.contains($0) }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 10) {
                Button {
                    controller.clearBulkSelection()
                } label: {
                    Image(systemName: "xmark")
                        .font(.scaled(13, weight: .semibold))
                }
                .buttonStyle(.plain)
                .disabled(controller.bulkRunning)
                .accessibilityLabel("Clear selection")

                Text(controller.bulkSelection.label)
                    .font(.golos(13, weight: .semibold))
                    .foregroundStyle(BrandColor.ink)

                Spacer()

                if controller.bulkRunning { ProgressView() }

                Menu {
                    ForEach(controller.members.filter { $0.deactivated_at == nil }, id: \.user_id) {
                        member in
                        Button("Assign to \(member.display_name.isBlank ? "Teammate" : member.display_name)") {
                            controller.runBulk(
                                action: "assign",
                                verb: "Assigned",
                                targetUserId: member.user_id
                            )
                        }
                    }
                    Button("Unassign") {
                        controller.runBulk(action: "assign", verb: "Unassigned", unassign: true)
                    }
                } label: {
                    Image(systemName: "ellipsis")
                        .font(.scaled(13, weight: .semibold))
                }
                .disabled(controller.bulkRunning)
                .accessibilityLabel("More bulk actions")
            }

            // The escalation ladder: the page first, then the filter. Never one
            // "select all" that quietly means whichever of the two it feels like.
            if showSelectLoaded {
                Button("Select all \(loadedIds.count) loaded") {
                    controller.selectAllLoaded()
                }
                .font(.golos(12.5, weight: .semibold))
                .foregroundStyle(BrandColor.olive)
                .buttonStyle(.plain)
                .disabled(controller.bulkRunning)
            }
            if controller.bulkSelection.canEscalate(
                loadedIds: loadedIds,
                hasMore: controller.hasMorePages
            ) {
                Button("Select all matching this filter") {
                    controller.selectAllMatchingFilter()
                }
                .font(.golos(12.5, weight: .semibold))
                .foregroundStyle(BrandColor.olive)
                .buttonStyle(.plain)
                .disabled(controller.bulkRunning)
            }

            HStack(spacing: 8) {
                BulkActionButton(title: "Mark read", disabled: controller.bulkRunning) {
                    controller.runBulk(action: "mark_read", verb: "Marked read")
                }
                BulkActionButton(title: "Close", disabled: controller.bulkRunning) {
                    controller.runBulk(
                        action: "set_status",
                        verb: "Closed",
                        targetStatus: ConversationStatus.closed
                    )
                }
                BulkActionButton(title: "Spam", disabled: controller.bulkRunning) {
                    controller.runBulk(action: "set_spam", verb: "Marked as spam", targetSpam: true)
                }
            }
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 10)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(BrandColor.cream)
    }
}

/// One pill in the bulk bar. Extracted because three inline button styles in a
/// stack is where swiftc's type checker starts giving up on this file (see
/// FilterChipRow's note).
@MainActor
private struct BulkActionButton: View {
    let title: String
    let disabled: Bool
    let action: @MainActor () -> Void

    var body: some View {
        Button(action: action) {
            Text(title)
                .font(.golos(12.5, weight: .semibold))
                .foregroundStyle(BrandColor.ink)
                .padding(.horizontal, 12)
                .padding(.vertical, 7)
                .background(BrandColor.paper, in: Capsule())
        }
        .buttonStyle(.plain)
        .disabled(disabled)
    }
}

// MARK: - #280 saved views

/// The row of saved views, and the one affordance for keeping the arrangement
/// on screen.
///
/// Applying: the Safety Principle (a horizontal strip of named queries directly
/// under the status pills is where saved views live in every product that has
/// them), Zen of Clarity (per-view actions are a long-press context menu rather
/// than three controls crowded onto a pill), Chunking (its own band, spaced away
/// from the pills above and the list below), and Smart Defaults (the save sheet
/// opens with a name already derived from the filters, because typing one is
/// the whole friction between arranging a useful screen and keeping it).
extension InboxList {
    @ViewBuilder
    fileprivate func savedViewsRow(_ controller: InboxController) -> some View {
        let selection = controller.currentSelection
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 7) {
                ForEach(controller.savedViews) { view in
                    let active = viewMatchesSelection(view.filters, selection)
                    let count = controller.viewCounts[view.id] ?? 0
                    Button {
                        controller.applyView(view)
                    } label: {
                        Text(count > 0 ? "\(view.name)  \(formatViewCount(count))" : view.name)
                            .font(.golos(12.5, weight: .medium))
                            .foregroundStyle(active ? BrandColor.paper : BrandColor.muted700)
                            .padding(.horizontal, 14)
                            .padding(.vertical, 8)
                            .background(active ? BrandColor.ink : BrandColor.paper, in: Capsule())
                    }
                    .buttonStyle(.plain)
                    .contextMenu { savedViewMenu(controller, view: view) }
                }
                Button("Save this view") { savedViewSheetOpen = true }
                    .font(.golos(12.5, weight: .medium))
                    .foregroundStyle(BrandColor.muted700)
                    .buttonStyle(.plain)
            }
            .padding(.horizontal, 18)
            .padding(.vertical, 4)
        }
    }

    /// Per-view actions.
    ///
    /// Ethical Friction applied only where it is earned: deleting your own view
    /// goes immediately, because it is yours and rebuilding it is two taps.
    /// Deleting a shared one removes a screen the rest of the crew opens every
    /// morning, and the person doing it cannot see who that affects.
    @ViewBuilder
    fileprivate func savedViewMenu(
        _ controller: InboxController,
        view: SavedView
    ) -> some View {
        let isDefault = view.id == controller.defaultViewId
        Button(isDefault ? "Stop opening here" : "Open here by default") {
            controller.setDefaultView(isDefault ? nil : view.id)
        }
        if !view.shared || canShareSavedViews {
            Button("Rename") { renamingView = view }
            Button("Delete", role: .destructive) {
                if view.shared {
                    deletingSharedView = view
                } else {
                    controller.deleteView(id: view.id)
                }
            }
        }
    }

    /// Sharing a view is workspace configuration, so it rides the same
    /// capability the server gates it on rather than a fresh role comparison.
    fileprivate var canShareSavedViews: Bool {
        MemberRole.has(
            me.memberships.first { $0.company_id == companyId }?.role,
            Capability.settingsManage
        )
    }
}

/// The save sheet.
///
/// Smart Defaults: the name field is never empty. The person already said what
/// the view is by building it, and "Open · Unread" beats what most would type.
private struct SaveViewSheet: View {
    let controller: InboxController
    let canShare: Bool
    let onClose: @MainActor () -> Void

    @State private var name: String
    @State private var shared = false
    @State private var error: String?
    @State private var saving = false

    init(
        controller: InboxController,
        suggestedName: String,
        canShare: Bool,
        onClose: @escaping @MainActor () -> Void
    ) {
        self.controller = controller
        self.canShare = canShare
        self.onClose = onClose
        _name = State(initialValue: suggestedName)
    }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField("Name", text: $name)
                } header: {
                    Text("Save this view")
                } footer: {
                    Text("The filters you have on now, under a name, one tap away tomorrow.")
                }
                if canShare {
                    Section {
                        Toggle("Share it with the crew", isOn: $shared)
                    } footer: {
                        Text(
                            "Everyone gets the same view, and each person sees only the numbers they already have access to."
                        )
                    }
                }
                if let error {
                    Section { Text(error).foregroundStyle(.red) }
                }
            }
            .navigationTitle("Save this view")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { onClose() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button(saving ? "Saving" : "Save") {
                        saving = true
                        controller.saveCurrentView(name: name, shared: shared) { failure in
                            saving = false
                            if let failure { error = failure } else { onClose() }
                        }
                    }
                    .disabled(saving || name.trimmingCharacters(in: .whitespaces).isEmpty)
                }
            }
        }
    }
}

private struct RenameViewSheet: View {
    let controller: InboxController
    let view: SavedView
    let onClose: @MainActor () -> Void

    @State private var draft: String

    init(
        controller: InboxController,
        view: SavedView,
        onClose: @escaping @MainActor () -> Void
    ) {
        self.controller = controller
        self.view = view
        self.onClose = onClose
        _draft = State(initialValue: view.name)
    }

    var body: some View {
        NavigationStack {
            Form {
                TextField("Name", text: $draft)
            }
            .navigationTitle("Rename view")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { onClose() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save") {
                        controller.renameView(id: view.id, name: draft)
                        onClose()
                    }
                    .disabled(draft.trimmingCharacters(in: .whitespaces).isEmpty)
                }
            }
        }
    }
}
