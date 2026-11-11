import SwiftUI

/// The broadcasts that change a record's activity: a text lands, a call moves,
/// a job changes. `task.changed` is the wire name the tasks trigger emits.
private let activityRefreshEvents: Set<String> = [
    "call.updated",
    "message.created",
    "conversation.updated",
    "task.changed",
]

/// #714: reads the one activity timeline, a page at a time, filtered by the server.
struct ActivityService: Sendable {
    let api: ApiClient

    func page(
        companyId: String,
        recordType: ActivityRecordType,
        recordId: String,
        category: ActivityCategory?,
        cursor: String?
    ) async throws -> Page<ActivityItem> {
        try await api.get(
            recordType.path(recordId),
            query: ["category": category?.rawValue, "cursor": cursor],
            companyId: companyId
        )
    }

    func members(companyId: String) async throws -> Page<Member> {
        try await api.get("/v1/members", query: ["limit": "100"], companyId: companyId)
    }
}

/// What the timeline holds once a page has loaded.
private struct ActivityLoaded {
    var items: [ActivityItem]
    var nextCursor: String?
}

/// #714: the ONE timeline every record uses (a customer, a job, a thread, a
/// call). The server writes the rows, so this only reads them: a filter row
/// (All, Messages, Calls, Changes, applied by the server so paging stays
/// right), day groups, per row the sentence, who did it and when, and "Show
/// earlier". A port of `apps/web/src/components/activity/activity-timeline.tsx`.
///
/// The caller supplies the heading, so a sheet and a screen can each frame it.
/// It is a plain stack rather than a lazy list, so it sits inside whichever
/// scroll view the surface already has.
///
/// Applying: Chunking (one list, four filters) and Zen of Clarity (an icon and
/// one sentence per row; the actor and the time underneath).
@MainActor
struct ActivityTimelineView: View {
    let graph: AppGraph
    let companyId: String
    let recordType: ActivityRecordType
    let recordId: String
    var onOpenConversation: (@MainActor (_ conversationId: String, _ messageId: String?) -> Void)? = nil
    var onOpenTask: (@MainActor (_ taskId: String) -> Void)? = nil
    var onOpenContact: (@MainActor (_ contactId: String) -> Void)? = nil
    /// Bumped by a surface that changed the record and wants the timeline to catch up.
    var reloadKey: Int = 0

    @State private var category: ActivityCategory? = nil
    @State private var state: LoadState<ActivityLoaded> = .loading
    @State private var loadingMore = false
    @State private var refreshKey = 0
    @State private var names: [String: String] = [:]

    @Environment(\.appLocale) private var appLocale

    private var service: ActivityService { ActivityService(api: graph.api) }

    private func t(_ key: String) -> String { AppStrings.translate(appLocale, key) }

    /// A new record, filter, refresh or reload from the surface starts a fresh load.
    private var loadKey: String {
        let filter: String = category?.rawValue ?? "all"
        return "\(recordType.path(recordId))|\(filter)|\(refreshKey)|\(reloadKey)"
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            filters
            content
        }
        .task(id: loadKey) { await reload() }
        .task(id: companyId) {
            if let page = try? await service.members(companyId: companyId) {
                names = memberNames(page.data, locale: appLocale)
            }
        }
        .task(id: recordId) {
            for await event in await graph.realtime.events()
            where activityRefreshEvents.contains(event.event) {
                refreshKey += 1
            }
        }
        .task(id: recordId) {
            for await _ in await graph.realtime.reconnected() {
                refreshKey += 1
            }
        }
        .resyncOnForeground { refreshKey += 1 }
    }

    // MARK: - Filters

    private var filters: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                ForEach(activityFilterOptions) { option in
                    ChoiceChip(
                        label: t(option.labelKey),
                        chosen: category == option.category,
                        minHeight: 44
                    ) { choose(option.category) }
                }
            }
            .padding(.horizontal, 6)
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(t("activity.filterAria"))
    }

    private func choose(_ next: ActivityCategory?) {
        guard next != category else { return }
        Haptics.tap()
        state = .loading
        category = next
    }

    // MARK: - Body states

    @ViewBuilder
    private var content: some View {
        switch state {
        case .loading:
            HStack {
                Spacer()
                ProgressView().controlSize(.small)
                Spacer()
            }
            .padding(.vertical, 12)
            .accessibilityLabel(t("activity.loading"))
        case .failed:
            failedView
        case .ready(let loaded):
            if loaded.items.isEmpty {
                emptyView
            } else {
                list(loaded)
            }
        }
    }

    private var failedView: some View {
        LoadError(
            message: t("activity.loadFailed") + " " + t("activity.loadFailedDetail"),
            variant: .inline
        ) {
            state = .loading
            refreshKey += 1
        }
        .padding(.horizontal, 6)
    }

    private var emptyView: some View {
        EmptyState(
            title: t(category == nil ? "activity.empty" : "activity.emptyFiltered"),
            description: category == nil ? t("activity.emptyDetail") : nil,
            size: .panel
        )
    }

    // MARK: - The list

    private func list(_ loaded: ActivityLoaded) -> some View {
        let groups = groupActivityByDay(loaded.items, locale: appLocale)
        return VStack(alignment: .leading, spacing: 0) {
            ForEach(groups) { group in
                SectionHeader(label: group.label)
                    .padding(.top, group.id == groups.first?.id ? 0 : 6)
                PaperCard {
                    ForEach(group.items) { item in
                        row(item)
                        if item.id != group.items.last?.id {
                            RowDivider().padding(.leading, 42)
                        }
                    }
                }
            }
            if let cursor = loaded.nextCursor {
                showEarlier(cursor)
            }
        }
    }

    private func showEarlier(_ cursor: String) -> some View {
        HStack {
            Spacer()
            if loadingMore {
                ProgressView().controlSize(.small)
            } else {
                Button(t("activity.showEarlier")) { loadMore(from: cursor) }
                    .font(.golos(12, weight: .semibold))
                    .foregroundStyle(BrandColor.olive)
                    .frame(minHeight: 44)
                    .buttonStyle(.plain)
            }
            Spacer()
        }
        .padding(.top, 4)
    }

    private func row(_ item: ActivityItem) -> some View {
        let line = activityLine(
            item,
            recordType: recordType,
            recordId: recordId,
            nameOf: { id in id.flatMap { names[$0] } },
            locale: appLocale
        )
        let who = activityActor(item, nameOf: { id in id.flatMap { names[$0] } }, locale: appLocale)
        let when = TimestampFormat.label(item.occurred_at, style: .long, locale: appLocale)
        let spoken = TimestampFormat.spoken(item.occurred_at, locale: appLocale)
        let content = ActivityRowContent(
            icon: line.icon, text: line.text, who: who, when: when, spoken: spoken
        )
        return rowButton(content, line.open)
    }

    /// A row with nothing to open stays a plain row: a dead tap target is worse.
    @ViewBuilder
    private func rowButton(_ content: ActivityRowContent, _ open: ActivityOpen?) -> some View {
        if let action = openAction(open) {
            Button(action: action) { content }.buttonStyle(.plain)
        } else {
            content
        }
    }

    /// Extracted with an explicit type, so the compiler is not left to infer a
    /// closure out of a `switch` inside a view builder.
    private func openAction(_ open: ActivityOpen?) -> (@MainActor () -> Void)? {
        switch open {
        case .some(.thread(let conversationId, let messageId)):
            guard let go = onOpenConversation else { return nil }
            return { go(conversationId, messageId) }
        case .some(.task(let taskId)):
            guard let go = onOpenTask else { return nil }
            return { go(taskId) }
        case .some(.contact(let contactId)):
            guard let go = onOpenContact else { return nil }
            return { go(contactId) }
        case .none:
            return nil
        }
    }

    // MARK: - Loading

    private func reload() async {
        do {
            let page = try await service.page(
                companyId: companyId,
                recordType: recordType,
                recordId: recordId,
                category: category,
                cursor: nil
            )
            state = .ready(ActivityLoaded(items: page.data, nextCursor: page.next_cursor))
        } catch {
            // A failed background revalidate must NOT throw away a history the
            // reader is looking at. Only a first load with nothing on screen
            // shows an error.
            if case .ready = state { return }
            state = .failed(error.userMessage)
        }
    }

    private func loadMore(from cursor: String) {
        guard !loadingMore else { return }
        loadingMore = true
        Task { @MainActor in
            defer { loadingMore = false }
            do {
                let page = try await service.page(
                    companyId: companyId,
                    recordType: recordType,
                    recordId: recordId,
                    category: category,
                    cursor: cursor
                )
                guard case .ready(let current) = state else { return }
                let seen = Set(current.items.map(\.id))
                let added = page.data.filter { !seen.contains($0.id) }
                state = .ready(
                    ActivityLoaded(items: current.items + added, nextCursor: page.next_cursor)
                )
            } catch {
                // Keep what is loaded; the button stays, so the retry is one tap.
            }
        }
    }
}

/// One row: the icon, the sentence, then who did it and when.
private struct ActivityRowContent: View {
    let icon: ActivityIcon
    let text: String
    let who: String
    let when: String
    let spoken: String

    var body: some View {
        HStack(spacing: 10) {
            Image(systemName: symbol)
                .font(.scaled(15))
                .foregroundStyle(BrandColor.muted500)
                .frame(width: 22)
            VStack(alignment: .leading, spacing: 2) {
                Text(text)
                    .font(.golos(14))
                    .foregroundStyle(BrandColor.ink)
                    .multilineTextAlignment(.leading)
                Text("\(who) · \(when)")
                    .font(.golos(12))
                    .foregroundStyle(BrandColor.muted500)
                    .multilineTextAlignment(.leading)
            }
            Spacer(minLength: 8)
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 10)
        .contentShape(Rectangle())
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("\(text). \(who), \(spoken)")
    }

    private var symbol: String {
        switch icon {
        case .text: return "bubble.left"
        case .call: return "phone"
        case .voicemail: return "recordingtape"
        case .edit: return "pencil"
        case .tag: return "tag"
        case .person: return "person"
        case .link: return "link"
        case .stop: return "nosign"
        case .check: return "checkmark.circle"
        case .merge: return "arrow.triangle.merge"
        case .trash: return "trash"
        case .mention: return "at"
        case .clock: return "clock"
        }
    }
}
