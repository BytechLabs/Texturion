import SwiftUI

private enum InboxFilter: String, CaseIterable, Identifiable {
    case open = "Open"
    case mine = "Mine"
    case all = "All"
    case closed = "Closed"

    var id: String { rawValue }
}

/// Inbox list: segmented Open|Mine|All|Closed + realtime re-sort. The thread
/// view and cursor pagination land with the full messaging pass (#159) — the
/// first 25 rows render live today.
@MainActor
struct InboxTab: View {
    let graph: AppGraph
    let companyId: String
    let me: Me

    @State private var filter: InboxFilter = .open
    @State private var state: LoadState<[ConversationListItem]> = .loading
    @State private var refreshKey = 0

    var body: some View {
        VStack(spacing: 0) {
            Picker("Filter", selection: $filter) {
                ForEach(InboxFilter.allCases) { item in
                    Text(item.rawValue).tag(item)
                }
            }
            .pickerStyle(.segmented)
            .padding(.horizontal, 16)
            .padding(.vertical, 10)

            switch state {
            case .loading:
                CenteredLoading()
            case .failed(let message):
                CenteredError(message: message) { refreshKey += 1 }
            case .ready(let rows):
                if rows.isEmpty {
                    Text("Nothing waiting on you.")
                        .font(.body)
                        .foregroundStyle(.secondary)
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                } else {
                    List {
                        ForEach(rows, id: \.id) { row in
                            ConversationRow(row: row)
                        }
                    }
                    .listStyle(.plain)
                }
            }
        }
        .task(id: "\(companyId)|\(filter.rawValue)|\(refreshKey)") { await reload() }
        .task(id: companyId) {
            for await event in await graph.realtime.events()
                where event.event == "message.created" || event.event == "conversation.updated" {
                refreshKey += 1
            }
        }
    }

    private func reload() async {
        if case .ready = state {} else { state = .loading }
        do {
            let page: Page<ConversationListItem>
            switch filter {
            case .open:
                page = try await graph.inboxApi.conversations(companyId: companyId, status: "open")
            case .mine:
                page = try await graph.inboxApi.conversations(
                    companyId: companyId, assignedUserId: me.user_id
                )
            case .all:
                page = try await graph.inboxApi.conversations(companyId: companyId)
            case .closed:
                page = try await graph.inboxApi.conversations(companyId: companyId, status: "closed")
            }
            // Cursor pagination arrives with the full inbox pass (#159);
            // the first 25 rows render live today.
            state = .ready(page.data)
        } catch {
            state = .failed(error.userMessage)
        }
    }
}

private struct ConversationRow: View {
    let row: ConversationListItem

    private var name: String {
        row.contact.name ?? formatPhone(row.contact.phone_e164)
    }

    private var snippet: String {
        guard let last = row.last_message else { return "" }
        if last.body.isBlank && last.has_attachments { return "Photo" }
        return last.body
    }

    var body: some View {
        HStack(alignment: .center, spacing: 12) {
            InitialsAvatar(name: name)
            VStack(alignment: .leading, spacing: 2) {
                Text(name)
                    .font(row.unread ? .body.weight(.semibold) : .body)
                Text(snippet)
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .lineLimit(2)
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
}
