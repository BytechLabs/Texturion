import Combine
import Observation
import SwiftUI

/// Inbox: pinned section + segmented Open|Mine|All|Closed + filter chips
/// (assignee/tag/unread/spam) + debounced global search (≥2 chars) + cursor
/// infinite scroll + realtime re-sort + row swipe actions + pull-to-refresh.
///
/// Structure: `NavigationSplitView` — sidebar is the conversation list,
/// detail is the open `ThreadView` (or a calm empty state). On iPhone the
/// split collapses to a stack (the list's selection binding drives the push);
/// on iPad the two columns sit side by side. Compose keeps its own
/// presentation (a full-screen cover). The Android InboxTab's twin.
///
/// AppRouter: consumes `openConversationId` commands (deep links, pushes, the
/// contact panel's prior-conversation rows) and reports the on-screen thread
/// via `viewedConversationId` so notification routing can suppress the toast
/// for the thread the user is already reading.
@MainActor
struct InboxTab: View {
    let graph: AppGraph
    let companyId: String
    let me: Me
    var initialConversationId: String? = nil

    @State private var openConversationId: String?
    @State private var composeOpen = false
    @State private var composeContactId: String?
    @State private var appliedInitialId = false

    var body: some View {
        NavigationSplitView {
            InboxList(
                graph: graph,
                companyId: companyId,
                me: me,
                selection: $openConversationId,
                onOpen: { openConversationId = $0 },
                onTextContact: { contactId in
                    composeContactId = contactId
                    composeOpen = true
                },
                onCompose: { composeOpen = true }
            )
            .toolbar(.hidden, for: .navigationBar)
        } detail: {
            if let openId = openConversationId {
                ThreadView(
                    graph: graph,
                    companyId: companyId,
                    me: me,
                    conversationId: openId,
                    onBack: { openConversationId = nil }
                )
            } else {
                // iPad's resting detail column; never visible on iPhone.
                Text("Select a conversation to read it here.")
                    .font(.golos(13))
                    .foregroundStyle(BrandColor.muted600)
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                    .background(BrandColor.canvas)
            }
        }
        .navigationSplitViewStyle(.balanced)
        .fullScreenCover(isPresented: $composeOpen) {
            NewConversationView(
                graph: graph,
                companyId: companyId,
                me: me,
                prefillContactId: composeContactId,
                onCreated: { conversationId in
                    composeOpen = false
                    composeContactId = nil
                    openConversationId = conversationId
                },
                onBack: {
                    composeOpen = false
                    composeContactId = nil
                }
            )
        }
        .onAppear {
            if !appliedInitialId, let initialConversationId {
                appliedInitialId = true
                openConversationId = initialConversationId
            }
            reportViewed(openConversationId)
        }
        .onDisappear {
            // Tab switched away — nothing is "on screen" anymore.
            reportViewed(nil)
        }
        // Command channel: another surface asked for this thread. Consume,
        // open, clear (deferred — never republish inside the publish).
        .onReceive(AppRouter.shared.$openConversationId) { commanded in
            guard let commanded else { return }
            composeOpen = false
            composeContactId = nil
            openConversationId = commanded
            Task { @MainActor in
                AppRouter.shared.openConversationId = nil
            }
        }
        .onChange(of: openConversationId) { _, next in
            reportViewed(next)
        }
    }

    private func reportViewed(_ id: String?) {
        Task { @MainActor in
            AppRouter.shared.viewedConversationId = id
        }
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
    private let searchApi: SearchApi
    private let repo: MessagingRepository
    private let companyId: String
    private let meUserId: String

    private(set) var tab: InboxStatusTab = .open
    private(set) var assignee: Member?
    private(set) var tag: Tag?
    private(set) var unreadOnly = false
    private(set) var spamOnly = false

    private(set) var state: LoadState<Void> = .loading
    private(set) var rows: [ConversationListItem] = []
    private(set) var pinnedRows: [ConversationListItem] = []
    private(set) var cursor: String?
    private(set) var loadingMore = false

    private(set) var members: [Member] = []
    private(set) var allTags: [Tag] = []

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
        self.searchApi = graph.searchApi
        self.repo = MessagingRepository(api: graph.api)
        self.companyId = companyId
        self.meUserId = meUserId
    }

    var hasFilterChips: Bool {
        assignee != nil || tag != nil || unreadOnly || spamOnly
    }

    func selectTab(_ next: InboxStatusTab) {
        if tab == next { return }
        tab = next
        reload(showLoading: true)
    }

    func setAssigneeFilter(_ member: Member?) {
        assignee = member
        reload(showLoading: true)
    }

    func setTagFilter(_ next: Tag?) {
        tag = next
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
            assignedUserId: tab == .mine ? meUserId : assignee?.user_id,
            tagId: tag?.id,
            // Spam is hidden from defaults server-side; the chip reveals it.
            spam: spamOnly ? true : nil,
            unread: unreadOnly ? true : nil,
            pinned: pinned,
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

    private func notify(_ text: String) {
        noticeSeq += 1
        notice = ThreadNotice(id: noticeSeq, text: text)
    }

    // MARK: Row swipe mutations — the EXACT calls the thread header makes.

    /// Done/Reopen/Close: PATCH /v1/conversations/:id {status} (the thread
    /// status menu's mutation), then a quiet first-page refetch re-sorts and
    /// drops rows that left the active filter.
    func setRowStatus(_ conversationId: String, status: String) {
        Task {
            do {
                _ = try await repo.setStatus(
                    companyId: companyId,
                    conversationId: conversationId,
                    status: status
                )
                await refreshFirstPage()
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
    /// The split view's selection — binding it to the sidebar lists is what
    /// makes programmatic opens push the detail on iPhone (collapsed) too.
    @Binding var selection: String?
    let onOpen: @MainActor (String) -> Void
    let onTextContact: @MainActor (String) -> Void
    let onCompose: @MainActor () -> Void

    @State private var controller: InboxController?
    @State private var assigneeSheetOpen = false
    @State private var tagSheetOpen = false
    @State private var assignFor: ConversationListItem?
    @State private var visibleNotice: String?
    @State private var noticeDismissTask: Task<Void, Never>?

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
                Text(visibleNotice)
                    .font(.golos(12.5))
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
                        .font(.system(size: 20, weight: .medium))
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
            visibleNotice = notice.text
            noticeDismissTask?.cancel()
            noticeDismissTask = Task {
                try? await Task.sleep(for: .seconds(3))
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
        }
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
    }

    @ViewBuilder
    private func listBody(_ controller: InboxController) -> some View {
        @Bindable var controller = controller
        VStack(spacing: 0) {
            ScreenTitle(text: "Inbox")
                .frame(maxWidth: .infinity, alignment: .leading)
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
                    onOpen: { id in
                        controller.markLocallyRead(id)
                        onOpen(id)
                    },
                    onTextContact: onTextContact
                )
            } else {
                statusPillRow(controller)

                FilterChipRow(
                    controller: controller,
                    onPickAssignee: { assigneeSheetOpen = true },
                    onPickTag: { tagSheetOpen = true }
                )

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
                            onOpen(id)
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
                .font(.system(size: 15, weight: .medium))
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
        guard controller.assignee != nil else { return nil }
        return { controller.setAssigneeFilter(nil) }
    }

    private var tagLabel: String {
        guard let tag = controller.tag else { return "Tag" }
        return "Tag: \(tag.name)"
    }

    private var tagClear: (@MainActor () -> Void)? {
        guard controller.tag != nil else { return nil }
        return { controller.setTagFilter(nil) }
    }

    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                if controller.tab != .mine {
                    FilterChip(
                        label: assigneeLabel,
                        selected: controller.assignee != nil,
                        onTap: onPickAssignee,
                        onClear: assigneeClear
                    )
                }
                FilterChip(
                    label: tagLabel,
                    selected: controller.tag != nil,
                    onTap: onPickTag,
                    onClear: tagClear
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

    var body: some View {
        HStack(spacing: 5) {
            Button(action: onTap) {
                Text(label)
                    .font(.golos(12, weight: selected ? .semibold : .medium))
                    .foregroundStyle(selected ? BrandColor.paper : BrandColor.muted700)
            }
            .buttonStyle(.plain)
            if let onClear {
                Button(action: onClear) {
                    Image(systemName: "xmark")
                        .font(.system(size: 10, weight: .semibold))
                        .foregroundStyle(selected ? BrandColor.paper : BrandColor.muted500)
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Clear filter")
            }
        }
        .padding(.horizontal, 13)
        .padding(.vertical, 8)
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

    /// One row + its swipe actions. Done/Reopen IS the close/open status flip
    /// (product vocabulary: "Done" == closed — the web removed the redundant
    /// separate control); Assign opens the thread's assignee picker.
    private func rowCell(_ row: ConversationListItem, pinned: Bool = false) -> some View {
        let closed = row.status == ConversationStatus.closed
        return ConversationRow(row: row) { onOpen(row.id) }
            .tag(row.id)
            // Pinned rows sit on the warm cream well (design-system grammar).
            .listRowBackground(pinned ? BrandColor.cream : BrandColor.paper)
            .listRowSeparatorTint(BrandColor.inset)
            .swipeActions(edge: .trailing, allowsFullSwipe: true) {
                Button {
                    controller.setRowStatus(
                        row.id,
                        status: closed ? ConversationStatus.open : ConversationStatus.closed
                    )
                } label: {
                    Label(
                        closed ? "Reopen" : "Done",
                        systemImage: closed ? "arrow.uturn.backward" : "checkmark"
                    )
                }
                .tint(BrandColor.olive)
                Button {
                    onAssign(row)
                } label: {
                    Label("Assign", systemImage: "person")
                }
                .tint(Color(.systemGray))
            }
    }

    private var emptyLabel: String {
        if controller.hasFilterChips { return "Nothing matches these filters." }
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
    let onTap: @MainActor () -> Void

    private var name: String {
        row.contact.name ?? formatPhone(row.contact.phone_e164)
    }

    private var snippet: String {
        guard let last = row.last_message else { return "" }
        let body = last.body.isBlank && last.has_attachments ? "Photo" : last.body
        return last.direction == "note" ? "Note · \(body)" : body
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
                        if row.is_spam {
                            Text("Spam")
                                .font(.golos(10, weight: .bold))
                                .foregroundStyle(BrandColor.muted600)
                                .padding(.horizontal, 7)
                                .padding(.vertical, 2)
                                .background(BrandColor.inset, in: Capsule())
                        }
                    }
                    if !snippet.isEmpty {
                        Text(snippet)
                            .font(.golos(12))
                            .foregroundStyle(BrandColor.muted600)
                            .lineLimit(2)
                    }
                    if !row.tags.isEmpty {
                        HStack(spacing: 4) {
                            ForEach(row.tags.prefix(3), id: \.id) { tag in
                                TagChip(tag: tag)
                            }
                            if row.tags.count > 3 {
                                Text("+\(row.tags.count - 3)")
                                    .font(.golos(10.5, weight: .semibold))
                                    .foregroundStyle(BrandColor.muted500)
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
    /// Bound so opening a hit pushes the collapsed split view's detail too.
    @Binding var selection: String?
    let onOpen: @MainActor (String) -> Void
    let onTextContact: @MainActor (String) -> Void

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
                                onOpen(task.conversation_id)
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
            onOpen(hit.id)
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
                onOpen(conversationId)
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
                    Tag(id: "t1", name: "Estimate", color: "#0F766E", created_at: nil, updated_at: nil),
                ]
            ),
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
