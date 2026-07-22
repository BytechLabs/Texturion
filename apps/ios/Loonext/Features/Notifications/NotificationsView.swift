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
        .background(BrandColor.canvas.ignoresSafeArea())
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
            HStack(alignment: .firstTextBaseline) {
                Text("Notifications")
                    .font(.display(24))
                    .kerning(-0.2)
                    .foregroundStyle(BrandColor.ink)
                Spacer()
                Button {
                    model.markAllRead()
                } label: {
                    Text("Read all")
                        .font(.golos(11.5, weight: .bold))
                        .foregroundStyle(model.hasUnread ? BrandColor.olive : BrandColor.muted300)
                }
                .buttonStyle(.plain)
                .disabled(!model.hasUnread)
            }
            .padding(.horizontal, 18)
            .padding(.top, 16)
            .padding(.bottom, 12)

            if model.items.isEmpty {
                Text("You're all caught up.")
                    .font(.golos(13))
                    .foregroundStyle(BrandColor.muted600)
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else {
                ScrollView {
                    LazyVStack(spacing: 13) {
                        PaperCard {
                            ForEach(Array(model.items.enumerated()), id: \.element.feedKey) { index, row in
                                if index > 0 { RowDivider() }
                                NotificationRow(row: row) {
                                    model.markItemRead(row)
                                    if let conversationId = row.conversation_id {
                                        onOpenConversation(conversationId)
                                    }
                                }
                            }
                        }
                        if model.nextCursor != nil {
                            Button {
                                model.loadOlder()
                            } label: {
                                Text(model.loadingMore ? "Loading older…" : "Show older")
                                    .font(.golos(12, weight: .semibold))
                                    .foregroundStyle(BrandColor.olive)
                            }
                            .buttonStyle(.plain)
                            .disabled(model.loadingMore)
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, 4)
                        }
                        Text("Push and email mirror these — Settings › Notifications")
                            .font(.golos(11))
                            .foregroundStyle(BrandColor.muted700)
                            .padding(.horizontal, 14)
                            .padding(.vertical, 7)
                            .background(BrandColor.insetDeep, in: Capsule())
                            .frame(maxWidth: .infinity)
                    }
                    .padding(.horizontal, 18)
                    .padding(.bottom, 24)
                }
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
            HStack(alignment: .top, spacing: 11) {
                Image(systemName: iconFor(row.type))
                    .font(.system(size: 15))
                    .foregroundStyle(iconTint(row.type))
                    .frame(width: 38, height: 38)
                    .background(iconWell(row.type), in: Circle())
                Text(summaryFor(row))
                    .font(.golos(13, weight: row.unread ? .bold : .semibold))
                    .foregroundStyle(BrandColor.ink)
                    .lineLimit(2)
                    .multilineTextAlignment(.leading)
                    .padding(.top, 3)
                Spacer(minLength: 8)
                Text(relativeTime(row.created_at))
                    .font(.golos(11))
                    .foregroundStyle(BrandColor.muted300)
                    .padding(.top, 5)
                if row.unread {
                    AttentionDot()
                        .padding(.top, 8)
                }
            }
            .padding(.horizontal, 15)
            .padding(.vertical, 13)
            .contentShape(Rectangle())
            .opacity(row.unread ? 1 : 0.7)
        }
        .buttonStyle(.plain)
        .disabled(row.conversation_id == nil)
    }
}

/// Tinted icon-circle wells (spec 06): cream for texts, inset for tasks,
/// warm-brick container for missed calls, avatar tint for assignments.
private func iconWell(_ type: String) -> Color {
    switch type {
    case NotificationType.inboundMessage: BrandColor.cream
    case NotificationType.assigned: BrandColor.avatarTint
    case NotificationType.taskAssigned: BrandColor.inset
    case NotificationType.missedCall: BrandColor.destructiveContainer
    default: BrandColor.inset
    }
}

private func iconTint(_ type: String) -> Color {
    switch type {
    case NotificationType.missedCall: BrandColor.destructive
    case NotificationType.taskAssigned: BrandColor.olive
    default: BrandColor.muted900
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
