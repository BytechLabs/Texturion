import SwiftUI

/// The derived notifications feed (D24): per-type icons, unread dots, relative
/// times, cursor pagination. Tap = optimistic watermark advance (that item and
/// everything older flips read; newer stays unread) + deep link into the
/// conversation. 'Mark all read' advances the watermark to now. The unread
/// count stays live via the company realtime channel plus a 60s poll.
///
/// Host-agnostic: carries its own header row (mirrors the Android
/// NotificationsScreen), so it drops into a sheet or a pushed screen as-is.
@MainActor
struct NotificationsView: View {
    let graph: AppGraph
    let companyId: String
    let onOpenConversation: @MainActor (String) -> Void

    @State private var model: NotificationsFeedModel
    @State private var refreshKey = 0

    init(
        graph: AppGraph,
        companyId: String,
        onOpenConversation: @escaping @MainActor (String) -> Void
    ) {
        self.graph = graph
        self.companyId = companyId
        self.onOpenConversation = onOpenConversation
        _model = State(initialValue: NotificationsFeedModel(
            api: NotificationsFeedApi(api: graph.api),
            companyId: companyId
        ))
    }

    var body: some View {
        Group {
            switch model.state {
            case .loading:
                CenteredLoading()

            case .failed(let message):
                CenteredError(message: message) {
                    model.prepareRetry()
                    refreshKey += 1
                }

            case .ready:
                feed
            }
        }
        .overlay(alignment: .bottom) { toastNotice }
        .animation(.default, value: model.toast)
        .task(id: "\(companyId)#\(refreshKey)") { await model.refresh() }
        // The feed is derived from messages/conversations/tasks/calls — any of
        // those moving can add an item or change the badge.
        .task(id: companyId) {
            for await event in await graph.realtime.events()
                where event.event.hasPrefix("message.") ||
                event.event.hasPrefix("conversation.") ||
                event.event.hasPrefix("task.") ||
                event.event.hasPrefix("call.") {
                refreshKey += 1
            }
        }
        .task(id: companyId) {
            for await _ in await graph.realtime.reconnected() {
                refreshKey += 1
            }
        }
        // 60s badge poll — the backstop when realtime is quiet or degraded.
        .task(id: companyId) {
            while !Task.isCancelled {
                try? await Task.sleep(for: .seconds(60))
                if Task.isCancelled { return }
                await model.pollUnread()
            }
        }
    }

    private var feed: some View {
        VStack(spacing: 0) {
            HStack {
                Text("Notifications")
                    .font(.title2.weight(.semibold))
                Spacer()
                Button("Mark all read") {
                    model.markAllRead()
                }
                .font(.subheadline)
                .disabled(!model.hasUnread)
            }
            .padding(.horizontal, 20)
            .padding(.top, 16)
            .padding(.bottom, 4)

            if model.items.isEmpty {
                Text("You're all caught up.")
                    .font(.body)
                    .foregroundStyle(.secondary)
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else {
                List {
                    ForEach(model.items, id: \.feedKey) { row in
                        NotificationRow(row: row) {
                            model.markItemRead(row)
                            if let conversationId = row.conversation_id {
                                onOpenConversation(conversationId)
                            }
                        }
                    }
                    if model.nextCursor != nil {
                        HStack {
                            Spacer()
                            Button(model.loadingMore ? "Loading older…" : "Show older") {
                                model.loadOlder()
                            }
                            .font(.subheadline)
                            .disabled(model.loadingMore)
                            Spacer()
                        }
                        .listRowSeparator(.hidden)
                        .padding(.vertical, 4)
                    }
                }
                .listStyle(.plain)
            }
        }
    }

    @ViewBuilder
    private var toastNotice: some View {
        if let toast = model.toast {
            Text(toast)
                .font(.subheadline)
                .padding(.horizontal, 16)
                .padding(.vertical, 10)
                .glassEffect()
                .padding(.bottom, 16)
                .transition(.opacity)
        }
    }
}

private struct NotificationRow: View {
    let row: NotificationItem
    let onTap: @MainActor () -> Void

    var body: some View {
        // Every derived type today links to its conversation; a future type
        // without one renders disabled instead of dead-tapping.
        Button(action: onTap) {
            HStack(spacing: 14) {
                Image(systemName: iconFor(row.type))
                    .font(.body)
                    .foregroundStyle(.secondary)
                    .frame(width: 24)
                Text(summaryFor(row))
                    .font(row.unread ? .body.weight(.semibold) : .body)
                    .foregroundStyle(.primary)
                    .lineLimit(2)
                    .multilineTextAlignment(.leading)
                Spacer(minLength: 8)
                Text(relativeTime(row.created_at))
                    .font(.caption)
                    .foregroundStyle(.secondary)
                if row.unread {
                    Circle()
                        .fill(BrandColor.petrol)
                        .frame(width: 8, height: 8)
                }
            }
            .padding(.vertical, 6)
        }
        .buttonStyle(.plain)
        .disabled(row.conversation_id == nil)
    }
}

/// One-line summaries, mirroring the web bell popover copy exactly.
private func summaryFor(_ row: NotificationItem) -> String {
    let who: String? = row.contact.map { $0.name ?? formatPhone($0.phone_e164) }
    switch row.type {
    case NotificationType.inboundMessage:
        return who.map { "New message from \($0)" } ?? "New message"
    case NotificationType.assigned:
        return who.map { "\($0) assigned to you" } ?? "Conversation assigned to you"
    case NotificationType.taskAssigned:
        return who.map { "Task assigned · \($0)" } ?? "Task assigned to you"
    case NotificationType.missedCall:
        return who.map { "Missed call from \($0)" } ?? "Missed call"
    default:
        // A type added server-side after this build shipped — show something
        // honest instead of crashing or hiding it.
        return who.map { "Update · \($0)" } ?? "Update"
    }
}

private func iconFor(_ type: String) -> String {
    switch type {
    case NotificationType.inboundMessage: "bubble.left"
    case NotificationType.assigned: "person.crop.circle.badge.checkmark"
    case NotificationType.taskAssigned: "checklist"
    case NotificationType.missedCall: "phone.arrow.down.left"
    default: "bell"
    }
}

#Preview("Feed rows") {
    List {
        NotificationRow(
            row: NotificationItem(
                id: "1",
                type: NotificationType.inboundMessage,
                conversation_id: "c1",
                message_id: "m1",
                task_id: nil,
                contact: ContactSummary(id: "p1", name: "Dana Whitcomb", phone_e164: "+14155550134"),
                created_at: "2026-07-15T12:00:00Z",
                unread: true
            ),
            onTap: {}
        )
        NotificationRow(
            row: NotificationItem(
                id: "2",
                type: NotificationType.missedCall,
                conversation_id: "c2",
                message_id: nil,
                task_id: nil,
                contact: ContactSummary(id: "p2", name: nil, phone_e164: "+14155550188"),
                created_at: "2026-07-15T09:30:00Z",
                unread: false
            ),
            onTap: {}
        )
    }
    .listStyle(.plain)
}
