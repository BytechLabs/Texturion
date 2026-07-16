import Observation
import SwiftUI

/// Inbox: pinned section + segmented Open|Mine|All|Closed + filter chips
/// (assignee/tag/unread/spam) + debounced global search (≥2 chars) + cursor
/// infinite scroll + realtime re-sort. Tapping a row opens `ThreadView` in
/// place (state-based detail — the Android InboxTab's twin).
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
        Group {
            if let openId = openConversationId {
                ThreadView(
                    graph: graph,
                    companyId: companyId,
                    me: me,
                    conversationId: openId,
                    onBack: { openConversationId = nil }
                )
            } else if composeOpen {
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
            } else {
                InboxList(
                    graph: graph,
                    companyId: companyId,
                    me: me,
                    onOpen: { openConversationId = $0 },
                    onTextContact: { contactId in
                        composeContactId = contactId
                        composeOpen = true
                    },
                    onCompose: { composeOpen = true }
                )
            }
        }
        .onAppear {
            if !appliedInitialId, let initialConversationId {
                appliedInitialId = true
                openConversationId = initialConversationId
            }
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

    // Search (≥2 chars flips the pane to grouped global results).
    var query = ""
    private(set) var searchState: LoadState<SearchResult>?
    private(set) var searchLoadingMore = false
    var searching: Bool { query.trimmingCharacters(in: .whitespaces).count >= 2 }

    @ObservationIgnored private var loadSeq = 0
    @ObservationIgnored private var searchSeq = 0
    @ObservationIgnored private var realtimeTask: Task<Void, Never>?
    @ObservationIgnored private var supportLoaded = false

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
    let onOpen: @MainActor (String) -> Void
    let onTextContact: @MainActor (String) -> Void
    let onCompose: @MainActor () -> Void

    @State private var controller: InboxController?
    @State private var assigneeSheetOpen = false
    @State private var tagSheetOpen = false

    var body: some View {
        Group {
            if let controller {
                listBody(controller)
            } else {
                CenteredLoading()
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
            HStack(spacing: 8) {
                searchField(controller)
                Button {
                    onCompose()
                } label: {
                    Image(systemName: "square.and.pencil")
                        .font(.body.weight(.medium))
                        .foregroundStyle(BrandColor.petrol)
                        .frame(width: 36, height: 36)
                }
                .accessibilityLabel("New message")
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 8)

            if controller.searching {
                SearchResultsPane(
                    controller: controller,
                    onOpen: { id in
                        controller.markLocallyRead(id)
                        onOpen(id)
                    },
                    onTextContact: onTextContact
                )
            } else {
                Picker("Filter", selection: Binding(
                    get: { controller.tab },
                    set: { controller.selectTab($0) }
                )) {
                    ForEach(InboxStatusTab.allCases) { item in
                        Text(item.rawValue).tag(item)
                    }
                }
                .pickerStyle(.segmented)
                .padding(.horizontal, 16)
                .padding(.vertical, 4)

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
                    ConversationListPane(controller: controller) { id in
                        controller.markLocallyRead(id)
                        onOpen(id)
                    }
                }
            }
        }
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
    }

    private func searchField(_ controller: InboxController) -> some View {
        @Bindable var controller = controller
        return HStack(spacing: 8) {
            Image(systemName: "magnifyingglass")
                .foregroundStyle(.secondary)
            TextField("Search conversations, contacts, tasks…", text: $controller.query)
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
                        .foregroundStyle(.secondary)
                }
                .buttonStyle(.borderless)
                .accessibilityLabel("Clear search")
            }
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 9)
        .background(.quaternary.opacity(0.5), in: RoundedRectangle(cornerRadius: 12))
    }
}

@MainActor
private struct FilterChipRow: View {
    let controller: InboxController
    let onPickAssignee: @MainActor () -> Void
    let onPickTag: @MainActor () -> Void

    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                if controller.tab != .mine {
                    FilterChip(
                        label: controller.assignee.map {
                            "Assignee: \($0.display_name.isBlank ? "Teammate" : $0.display_name)"
                        } ?? "Assignee",
                        selected: controller.assignee != nil,
                        onTap: onPickAssignee,
                        onClear: controller.assignee != nil
                            ? { controller.setAssigneeFilter(nil) }
                            : nil
                    )
                }
                FilterChip(
                    label: controller.tag.map { "Tag: \($0.name)" } ?? "Tag",
                    selected: controller.tag != nil,
                    onTap: onPickTag,
                    onClear: controller.tag != nil ? { controller.setTagFilter(nil) } : nil
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
            .padding(.horizontal, 16)
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
        HStack(spacing: 4) {
            Button(action: onTap) {
                Text(label)
                    .font(.subheadline)
                    .foregroundStyle(
                        selected
                            ? AnyShapeStyle(BrandColor.onPetrolContainer)
                            : AnyShapeStyle(Color.primary)
                    )
            }
            .buttonStyle(.plain)
            if let onClear {
                Button(action: onClear) {
                    Image(systemName: "xmark")
                        .font(.system(size: 10, weight: .semibold))
                        .foregroundStyle(
                            selected
                                ? AnyShapeStyle(BrandColor.onPetrolContainer)
                                : AnyShapeStyle(Color.secondary)
                        )
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Clear filter")
            }
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 7)
        .background(
            selected
                ? AnyShapeStyle(BrandColor.petrolContainer)
                : AnyShapeStyle(Color(.secondarySystemFill)),
            in: Capsule()
        )
    }
}

@MainActor
private struct ConversationListPane: View {
    let controller: InboxController
    let onOpen: @MainActor (String) -> Void

    var body: some View {
        let empty = controller.rows.isEmpty && controller.pinnedRows.isEmpty
        if empty {
            Text(emptyLabel)
                .font(.body)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
                .padding(.horizontal, 32)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        } else {
            List {
                if !controller.pinnedRows.isEmpty {
                    Section {
                        ForEach(controller.pinnedRows, id: \.id) { row in
                            ConversationRow(row: row) { onOpen(row.id) }
                        }
                    } header: {
                        Label("Pinned", systemImage: "pin.fill")
                            .font(.footnote.weight(.semibold))
                            .foregroundStyle(.secondary)
                            .textCase(nil)
                    }
                }
                Section {
                    ForEach(Array(controller.rows.enumerated()), id: \.element.id) { index, row in
                        ConversationRow(row: row) { onOpen(row.id) }
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
                    }
                } header: {
                    if !controller.pinnedRows.isEmpty, !controller.rows.isEmpty {
                        Text("Conversations")
                            .font(.footnote.weight(.semibold))
                            .foregroundStyle(.secondary)
                            .textCase(nil)
                    }
                }
            }
            .listStyle(.plain)
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
            HStack(alignment: .center, spacing: 12) {
                InitialsAvatar(name: name)
                VStack(alignment: .leading, spacing: 2) {
                    HStack(spacing: 6) {
                        Text(name)
                            .font(row.unread ? .body.weight(.semibold) : .body)
                            .foregroundStyle(.primary)
                            .lineLimit(1)
                        if row.is_spam {
                            Text("Spam")
                                .font(.caption2)
                                .foregroundStyle(.secondary)
                                .padding(.horizontal, 6)
                                .padding(.vertical, 1)
                                .background(Color(.secondarySystemFill), in: Capsule())
                        }
                    }
                    if !snippet.isEmpty {
                        Text(snippet)
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                            .lineLimit(2)
                    }
                    if !row.tags.isEmpty {
                        HStack(spacing: 4) {
                            ForEach(row.tags.prefix(3), id: \.id) { tag in
                                TagChip(tag: tag)
                            }
                            if row.tags.count > 3 {
                                Text("+\(row.tags.count - 3)")
                                    .font(.caption2)
                                    .foregroundStyle(.secondary)
                            }
                        }
                        .padding(.top, 1)
                    }
                }
                Spacer()
                VStack(alignment: .trailing, spacing: 6) {
                    Text(relativeTime(row.last_message_at))
                        .font(.caption)
                        .foregroundStyle(.secondary)
                    if row.unread {
                        Circle()
                            .fill(BrandColor.petrol)
                            .frame(width: 8, height: 8)
                    }
                }
            }
            .padding(.vertical, 4)
        }
        .buttonStyle(.plain)
    }
}

private struct TagChip: View {
    let tag: Tag

    var body: some View {
        HStack(spacing: 3) {
            if let tint = tag.color.flatMap(parseHexColor) {
                Circle()
                    .fill(tint)
                    .frame(width: 6, height: 6)
            }
            Text(tag.name)
                .font(.caption2)
                .foregroundStyle(.secondary)
        }
        .padding(.horizontal, 6)
        .padding(.vertical, 1)
        .background(Color(.secondarySystemFill), in: Capsule())
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
                    .foregroundStyle(.primary)
                Spacer()
                if isSelected {
                    Image(systemName: "checkmark")
                        .foregroundStyle(BrandColor.petrol)
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
                        Text("Any tag").foregroundStyle(.primary)
                        Spacer()
                        if selected == nil {
                            Image(systemName: "checkmark")
                                .foregroundStyle(BrandColor.petrol)
                        }
                    }
                }
                if tags.isEmpty {
                    Text("No tags yet. Add tags from a conversation on the web.")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                }
                ForEach(tags, id: \.id) { tag in
                    Button {
                        onPick(tag)
                    } label: {
                        HStack {
                            Text(tag.name).foregroundStyle(.primary)
                            Spacer()
                            if selected?.id == tag.id {
                                Image(systemName: "checkmark")
                                    .foregroundStyle(BrandColor.petrol)
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
                .font(.body)
                .foregroundStyle(.secondary)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        } else {
            List {
                if !result.conversations.isEmpty {
                    Section {
                        ForEach(result.conversations, id: \.matched_message_id) { hit in
                            conversationHit(hit)
                        }
                        if result.next_cursor != nil {
                            Button(controller.searchLoadingMore ? "Loading…" : "More results") {
                                controller.searchMore()
                            }
                            .font(.subheadline.weight(.medium))
                            .foregroundStyle(BrandColor.petrol)
                            .disabled(controller.searchLoadingMore)
                        }
                    } header: {
                        sectionLabel("Conversations")
                    }
                }
                if !result.contacts.isEmpty {
                    Section {
                        ForEach(result.contacts, id: \.id) { contact in
                            contactHit(contact)
                        }
                    } header: {
                        sectionLabel("Contacts")
                    }
                }
                if !result.tasks.isEmpty {
                    Section {
                        ForEach(result.tasks, id: \.id) { task in
                            Button {
                                onOpen(task.conversation_id)
                            } label: {
                                VStack(alignment: .leading, spacing: 1) {
                                    Text(task.title)
                                        .font(.body)
                                        .foregroundStyle(.primary)
                                    Text(task.done ? "Done" : "Open task")
                                        .font(.caption)
                                        .foregroundStyle(.secondary)
                                }
                            }
                            .buttonStyle(.plain)
                        }
                    } header: {
                        sectionLabel("Tasks")
                    }
                }
                if !result.attachments.isEmpty {
                    Section {
                        ForEach(result.attachments, id: \.id) { hit in
                            attachmentHit(hit)
                        }
                    } header: {
                        sectionLabel("Attachments")
                    }
                }
                if !result.templates.isEmpty {
                    Section {
                        ForEach(result.templates, id: \.id) { hit in
                            VStack(alignment: .leading, spacing: 1) {
                                Text(hit.name)
                                    .font(.body)
                                Text(stripHighlight(hit.snippet))
                                    .font(.subheadline)
                                    .foregroundStyle(.secondary)
                                    .lineLimit(2)
                            }
                        }
                    } header: {
                        sectionLabel("Saved replies")
                    }
                }
            }
            .listStyle(.plain)
        }
    }

    private func sectionLabel(_ title: String) -> some View {
        Text(title)
            .font(.footnote.weight(.semibold))
            .foregroundStyle(.secondary)
            .textCase(nil)
    }

    private func conversationHit(_ hit: SearchConversationHit) -> some View {
        let name = hit.contact.name ?? formatPhone(hit.contact.phone_e164)
        return Button {
            onOpen(hit.id)
        } label: {
            HStack(spacing: 12) {
                InitialsAvatar(name: name, size: 36)
                VStack(alignment: .leading, spacing: 1) {
                    Text(name)
                        .font(.body)
                        .foregroundStyle(.primary)
                    Text(
                        (hit.direction == "note" ? "Note · " : "")
                            + stripHighlight(hit.snippet)
                    )
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .lineLimit(2)
                }
                Spacer()
                Text(relativeTime(hit.matched_at))
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        }
        .buttonStyle(.plain)
    }

    private func contactHit(_ contact: ContactSummary) -> some View {
        let name = contact.name ?? formatPhone(contact.phone_e164)
        return Button {
            onTextContact(contact.id)
        } label: {
            HStack(spacing: 12) {
                InitialsAvatar(name: name, size: 36)
                VStack(alignment: .leading, spacing: 1) {
                    Text(name)
                        .font(.body)
                        .foregroundStyle(.primary)
                    Text(formatPhone(contact.phone_e164))
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                Spacer()
            }
        }
        .buttonStyle(.plain)
    }

    @ViewBuilder
    private func attachmentHit(_ hit: SearchAttachmentHit) -> some View {
        let content = VStack(alignment: .leading, spacing: 1) {
            Text(hit.file_name)
                .font(.body)
                .lineLimit(1)
            Text(relativeTime(hit.created_at))
                .font(.caption)
                .foregroundStyle(.secondary)
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
