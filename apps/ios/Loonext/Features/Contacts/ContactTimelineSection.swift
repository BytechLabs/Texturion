import SwiftUI

/// The broadcasts that change a customer's history.
///
/// `task.changed` is the real wire name — the DB trigger in
/// `20260702060000_appv2_tasks_attachments_geocode.sql` emits it, and every
/// other client listens for it. An earlier draft here said `task.updated`,
/// which nothing broadcasts, so job rows never revalidated.
private let timelineRefreshEvents: Set<String> = [
    "call.updated",
    "message.created",
    "conversation.updated",
    "task.changed",
]

/// #324 — "what have we done for this customer?", answered by scrolling once.
///
/// D7 threads by recency, so a long relationship is MANY conversations. The
/// prior-conversations list (G6) and the per-contact call history (#205) both
/// already existed and are both still right; what was missing is that they were
/// separate blocks with jobs nowhere, so the question asked before every visit
/// meant opening threads one at a time.
///
/// This sits ABOVE the Calls section rather than replacing it: this is the
/// overview, and Calls stays as the detail view where a voicemail plays in
/// place. Mirror of the Android `ContactTimelineSection`.
///
/// The kinds are told apart by icon and by what the line says, never by being
/// put back into separate lists — merging them is the entire point.
struct ContactTimelineSection: View {
    let graph: AppGraph
    /// Passed in rather than constructed: ContactMutations needs both the api
    /// and the multipart client, and the detail view already holds one.
    let mutations: ContactMutations
    let companyId: String
    let contactId: String
    let onOpenConversation: ((_ conversationId: String) -> Void)?

    @State private var state: LoadState<TimelineLog> = .loading
    @State private var loadingMore = false
    @State private var refreshKey = 0
    /// #517: the roster, so an answered call can say who took it. Best-effort
    /// and out of band — the history must still render if this fails, because
    /// the name is a decoration on a line that already reads correctly.
    @State private var answererNames: [String: String] = [:]

    @Environment(\.appLocale) private var appLocale

    var body: some View {
        ContactSection(
            title: AppStrings.translate(appLocale, "contactsTasks.historySection")
        ) {
            content
        }
        .task(id: "\(contactId)|\(refreshKey)") { await reload() }
        .task(id: companyId) {
            if let page = try? await mutations.members(companyId: companyId) {
                // Named `answererNames` so the property cannot shadow the
                // free `memberNames(_:)` this line calls.
                answererNames = memberNames(page.data, locale: appLocale)
            }
        }
        // The history changes when a text lands, a call ends, or a job moves,
        // so it revalidates on the broadcasts those surfaces already send
        // rather than inventing a fourth event.
        .task(id: contactId) {
            for await event in await graph.realtime.events()
            where timelineRefreshEvents.contains(event.event) {
                refreshKey += 1
            }
        }
        .task(id: contactId) {
            for await _ in await graph.realtime.reconnected() {
                refreshKey += 1
            }
        }
        .resyncOnForeground { refreshKey += 1 }
    }

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
        case .failed(let message):
            VStack(alignment: .leading, spacing: 4) {
                Text(message)
                    .font(.golos(12))
                    .foregroundStyle(BrandColor.muted500)
                Button(AppStrings.translate(appLocale, "common.retry")) { refreshKey += 1 }
                    .font(.golos(12, weight: .semibold))
                    .foregroundStyle(BrandColor.olive)
                    .buttonStyle(.plain)
            }
            .padding(.horizontal, 6)
        case .ready(let log):
            let entries = log.entries
            if entries.isEmpty {
                Text(AppStrings.translate(appLocale, "contactsTasks.timelineEmpty"))
                    .font(.golos(12.5))
                    .foregroundStyle(BrandColor.muted500)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.horizontal, 6)
            } else {
                readyList(groupTimelineByDay(entries), nextCursor: log.nextCursor)
            }
        }
    }

    private func readyList(
        _ groups: [TimelineDayGroup],
        nextCursor: String?
    ) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            ForEach(groups) { group in
                SectionHeader(label: group.label, count: group.entries.count)
                    .padding(.top, group.id == groups.first?.id ? 4 : 10)
                PaperCard {
                    // Keyed on the dedupe key, not `id`: the three source
                    // tables have independent id spaces, so identity by id
                    // alone could collide across kinds.
                    ForEach(group.entries, id: \.dedupeKey) { entry in
                        TimelineRow(
                            entry: entry,
                            memberNames: answererNames,
                            onOpen: openAction(for: entry)
                        )
                        if entry.dedupeKey != group.entries.last?.dedupeKey {
                            RowDivider().padding(.leading, 42)
                        }
                    }
                }
            }
            if let cursor = nextCursor {
                HStack {
                    Spacer()
                    if loadingMore {
                        ProgressView().controlSize(.small)
                    } else {
                        Button(
                            AppStrings.translate(appLocale, "contactsTasks.showEarlier")
                        ) { loadMore(from: cursor) }
                            .font(.golos(12, weight: .semibold))
                            .foregroundStyle(BrandColor.olive)
                            .buttonStyle(.plain)
                    }
                    Spacer()
                }
                .padding(.top, 8)
            }
        }
    }

    /// Extracted with an explicit type — the same swiftc type-checker guard the
    /// calls section documents. A call that never threaded has nowhere to go,
    /// and a dead tap target is worse than a plain row.
    private func openAction(for entry: TimelineEntry) -> (@MainActor () -> Void)? {
        guard let id = entry.conversation_id, let onOpenConversation else { return nil }
        return { onOpenConversation(id) }
    }

    private func reload() async {
        do {
            let page = try await mutations.timeline(
                companyId: companyId,
                contactId: contactId
            )
            let cached: TimelineLog? = if case .ready(let existing) = state { existing } else { nil }
            // The merge carries the cursor: when it keeps a deeper tail it also
            // keeps the DEEPER cursor, because the fresh page's next_cursor
            // points at the end of page one and adopting it would make "Show
            // earlier" re-request rows already on screen.
            state = .ready(mergeTimelineFirstPage(cached: cached, page: page))
        } catch {
            // A failed background revalidate must NOT throw away a history the
            // reader is looking at — the sibling Calls section guards this the
            // same way. Only a first load with nothing on screen shows an error.
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
                let page = try await mutations.timeline(
                    companyId: companyId,
                    contactId: contactId,
                    cursor: cursor
                )
                guard case .ready(let current) = state else { return }
                state = .ready(appendTimelinePage(current: current, page: page))
            } catch {
                // Keep what is loaded; the button stays, so the retry is one tap.
            }
        }
    }
}

private struct TimelineRow: View {
    let entry: TimelineEntry
    let memberNames: [String: String]
    let onOpen: (@MainActor () -> Void)?

    var body: some View {
        let row = HStack(spacing: 10) {
            Image(systemName: iconName)
                .font(.scaled(15))
                .foregroundStyle(BrandColor.muted500)
                .frame(width: 22)
            VStack(alignment: .leading, spacing: 2) {
                Text(timelineTitle(entry, memberNames: memberNames))
                    .font(.golos(14))
                    .lineLimit(1)
                Text(timelineDetail(entry))
                    .font(.golos(12))
                    .foregroundStyle(BrandColor.muted500)
                    .lineLimit(1)
            }
            Spacer(minLength: 8)
            Text(timeLabel)
                .font(.golos(11))
                .foregroundStyle(BrandColor.muted500)
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 10)
        .contentShape(Rectangle())

        if let onOpen {
            Button(action: onOpen) { row }.buttonStyle(.plain)
        } else {
            row
        }
    }

    private var iconName: String {
        switch entry.kind {
        case "call": return "phone"
        case "task": return entry.done == true ? "checkmark.circle" : "circle"
        default: return "bubble.left"
        }
    }

    private var timeLabel: String {
        // parseWireTimestamp and timelineShortDate: the app's own helpers. The
        // `.formatted(.dateTime...)` API is used nowhere else here, and Swift
        // only compiles in CI, so an unproven API is a 25-minute round trip.
        guard let date = parseWireTimestamp(entry.occurred_at) else { return "" }
        return timelineShortDate(date, calendar: .current, format: "h:mm a")
    }
}
