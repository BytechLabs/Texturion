import SwiftUI

/// /for-you — the default landing: Triage (owner/admin), Waiting on you,
/// My tasks, Unread, and Recent calls (D43: the mobile entry point into the
/// Calls surface). Realtime events refetch the queue; every row deep-links
/// into `ThreadView` in place (task rows open their conversation — task
/// detail itself is the Tasks tab's surface, #160).
///
/// `onOpenCalls` is the shell's navigation to the full Calls surface — the
/// "View all" affordance hides until the shell wires it.
@MainActor
struct ForYouTab: View {
    let graph: AppGraph
    let companyId: String
    let me: Me
    var onOpenCalls: (() -> Void)? = nil

    @State private var openConversationId: String?
    @State private var state: LoadState<ForYou> = .loading
    @State private var recentCalls: LoadState<[Call]> = .loading
    @State private var refreshKey = 0

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
            } else {
                switch state {
                case .loading:
                    CenteredLoading()
                case .failed(let message):
                    CenteredError(message: message) { refreshKey += 1 }
                case .ready(let forYou):
                    ForYouList(
                        forYou: forYou,
                        recentCalls: recentCalls,
                        onOpenConversation: { openConversationId = $0 },
                        onOpenCalls: onOpenCalls
                    )
                }
            }
        }
        .task(id: "\(companyId)#\(refreshKey)") { await reload() }
        .task(id: "\(companyId)#\(refreshKey)") { await reloadRecentCalls() }
        .task(id: companyId) {
            // Any conversation/task/call movement can change the queue —
            // refetch quietly.
            for await event in await graph.realtime.events() {
                if event.event.hasPrefix("message.") ||
                    event.event.hasPrefix("conversation.") ||
                    event.event.hasPrefix("task.") ||
                    event.event.hasPrefix("call.") {
                    refreshKey += 1
                }
            }
        }
        .task(id: companyId) {
            for await _ in await graph.realtime.reconnected() {
                refreshKey += 1
            }
        }
    }

    private func reload() async {
        if refreshKey == 0 { state = .loading }
        do {
            state = .ready(try await graph.forYouApi.forYou(companyId: companyId))
        } catch {
            state = .failed(error.userMessage)
        }
    }

    /// Recent calls (#161/D43): the 3 newest sessions from the calls list
    /// endpoint (never invented /v1/home fields), refetched on the same
    /// realtime ticks as the queue ('call.' is already in the filter above).
    private func reloadRecentCalls() async {
        do {
            recentCalls = .ready(
                try await CallsService(api: graph.api)
                    .calls(companyId: companyId, limit: 3).data
            )
        } catch {
            if case .ready = recentCalls {
                // Keep stale rows over an error flash on a refetch hiccup.
            } else {
                recentCalls = .failed(error.userMessage)
            }
        }
    }
}

private struct ForYouList: View {
    let forYou: ForYou
    let recentCalls: LoadState<[Call]>
    let onOpenConversation: @MainActor (String) -> Void
    let onOpenCalls: (() -> Void)?

    private var total: Int {
        forYou.waiting_on_you.count + forYou.my_tasks.count + forYou.unread.count +
            (forYou.triage.map { $0.conversations.count + $0.tasks.count } ?? 0)
    }

    var body: some View {
        List {
            Section {
                VStack(alignment: .leading, spacing: 4) {
                    Text("For you")
                        .font(.title2.weight(.semibold))
                    Text(
                        total == 0
                            ? "You're all caught up."
                            : "\(total) \(total == 1 ? "thing needs" : "things need") you"
                    )
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                }
                .listRowSeparator(.hidden)
                .padding(.vertical, 4)
            }

            if let triage = forYou.triage,
               !triage.conversations.isEmpty || !triage.tasks.isEmpty {
                Section {
                    ForEach(triage.conversations, id: \.conversation_id) { row in
                        PersonRow(
                            name: row.contact?.name ?? formatPhone(row.contact?.phone_e164),
                            meta: relativeTime(row.last_message_at),
                            unread: row.unread
                        ) { onOpenConversation(row.conversation_id) }
                    }
                    ForEach(triage.tasks, id: \.task_id) { row in
                        TaskLineRow(
                            title: row.title,
                            overdue: row.overdue,
                            dueAt: row.due_at
                        ) { onOpenConversation(row.conversation_id) }
                    }
                } header: {
                    SectionHeader("Needs an owner")
                }
            }

            if !forYou.waiting_on_you.isEmpty {
                Section {
                    ForEach(forYou.waiting_on_you, id: \.conversation_id) { row in
                        PersonRow(
                            name: row.contact?.name ?? formatPhone(row.contact?.phone_e164),
                            meta: relativeTime(row.last_message_at),
                            unread: row.unread
                        ) { onOpenConversation(row.conversation_id) }
                    }
                } header: {
                    SectionHeader("Waiting on you")
                }
            }

            if !forYou.my_tasks.isEmpty {
                Section {
                    ForEach(forYou.my_tasks, id: \.task_id) { row in
                        TaskLineRow(
                            title: row.title,
                            overdue: row.overdue,
                            dueAt: row.due_at
                        ) { onOpenConversation(row.conversation_id) }
                    }
                } header: {
                    SectionHeader("Your tasks")
                }
            }

            if !forYou.unread.isEmpty {
                Section {
                    ForEach(forYou.unread, id: \.conversation_id) { row in
                        PersonRow(
                            name: row.contact?.name ?? formatPhone(row.contact?.phone_e164),
                            meta: relativeTime(row.last_message_at),
                            unread: true
                        ) { onOpenConversation(row.conversation_id) }
                    }
                } header: {
                    SectionHeader("Unread")
                }
            }

            // Recent calls (#161/D43) — the mobile doorway into the Calls
            // surface. Hidden entirely while loading or empty; an honest
            // error line when the log couldn't load (Android twin parity).
            switch recentCalls {
            case .loading:
                EmptyView()
            case .failed:
                Section {
                    Text("Couldn't load recent calls.")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .listRowSeparator(.hidden)
                } header: {
                    RecentCallsHeader(onOpenCalls: onOpenCalls)
                }
            case .ready(let calls):
                if !calls.isEmpty {
                    Section {
                        ForEach(calls, id: \.id) { call in
                            RecentCallRow(
                                call: call,
                                onTap: call.conversation_id.map { id in
                                    { onOpenConversation(id) }
                                }
                            )
                        }
                    } header: {
                        RecentCallsHeader(onOpenCalls: onOpenCalls)
                    }
                }
            }
        }
        .listStyle(.plain)
    }
}

/// "Recent calls" + the shell-wired "View all" doorway (hidden until wired).
private struct RecentCallsHeader: View {
    let onOpenCalls: (() -> Void)?

    var body: some View {
        HStack {
            Text("Recent calls")
                .font(.footnote.weight(.semibold))
                .foregroundStyle(.secondary)
                .textCase(nil)
            Spacer()
            if let onOpenCalls {
                Button("View all", action: onOpenCalls)
                    .font(.footnote)
                    .textCase(nil)
            }
        }
    }
}

/// One recent call: direction/outcome glyph, contact-or-number, relative
/// time. Amber only for the actionable inbound miss (calm system); tappable
/// into the conversation only when one exists.
private struct RecentCallRow: View {
    let call: Call
    let onTap: (@MainActor () -> Void)?

    private var name: String { callerDisplayName(call) }

    private var directionIcon: String {
        if call.direction == "outbound" { return "phone.arrow.up.right" }
        if call.outcome == CallOutcome.missed { return "phone.arrow.down.left" }
        return "phone.arrow.down.left.fill"
    }

    var body: some View {
        HStack(spacing: 12) {
            InitialsAvatar(name: name)
            VStack(alignment: .leading, spacing: 2) {
                Text(name)
                    .font(.body)
                    .foregroundStyle(.primary)
                HStack(spacing: 6) {
                    Image(systemName: directionIcon)
                        .font(.caption2)
                        .foregroundStyle(
                            isActionableMiss(call)
                                ? BrandColor.overdueAmber
                                : Color.secondary
                        )
                    Text(callOutcomeLabel(call))
                        .font(.caption)
                        .foregroundStyle(
                            isActionableMiss(call)
                                ? BrandColor.overdueAmber
                                : Color.secondary
                        )
                }
            }
            Spacer()
            Text(relativeTime(call.started_at))
                .font(.caption)
                .foregroundStyle(.secondary)
        }
        .padding(.vertical, 2)
        .contentShape(Rectangle())
        .onTapGesture { onTap?() }
    }
}

private struct SectionHeader: View {
    let title: String

    init(_ title: String) {
        self.title = title
    }

    var body: some View {
        Text(title)
            .font(.footnote.weight(.semibold))
            .foregroundStyle(.secondary)
            .textCase(nil)
    }
}

private struct PersonRow: View {
    let name: String?
    let meta: String
    let unread: Bool
    let onTap: @MainActor () -> Void

    private var displayName: String {
        let trimmed = name ?? ""
        return trimmed.isEmpty ? "Unknown" : trimmed
    }

    var body: some View {
        Button(action: onTap) {
            HStack(spacing: 12) {
                InitialsAvatar(name: name)
                Text(displayName)
                    .font(unread ? .body.weight(.semibold) : .body)
                    .foregroundStyle(.primary)
                Spacer()
                Text(meta)
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            .padding(.vertical, 2)
        }
        .buttonStyle(.plain)
    }
}

private struct TaskLineRow: View {
    let title: String
    let overdue: Bool
    let dueAt: String?
    let onTap: @MainActor () -> Void

    var body: some View {
        Button(action: onTap) {
            VStack(alignment: .leading, spacing: 2) {
                Text(title)
                    .font(.body)
                    .foregroundStyle(.primary)
                Text(subtitle)
                    .font(.caption)
                    // Overdue = amber, never red (calm system).
                    .foregroundStyle(
                        overdue
                            ? AnyShapeStyle(BrandColor.overdueAmber)
                            : AnyShapeStyle(Color.secondary)
                    )
            }
            .padding(.vertical, 2)
        }
        .buttonStyle(.plain)
    }

    private var subtitle: String {
        if overdue { return "Overdue task" }
        if let dueAt { return "Due \(relativeTime(dueAt))" }
        return "Open task"
    }
}

// MARK: - Previews (inline mock data — nothing fetches)

private func previewCall(
    id: String,
    outcome: String?,
    direction: String,
    contactName: String? = nil,
    callerE164: String? = nil,
    forwardSeconds: Int = 0,
    startedAt: String = "2026-07-16T09:05:00Z"
) -> Call {
    Call(
        id: id,
        call_session_id: "sess-\(id)",
        caller_e164: callerE164,
        contact_id: nil,
        contact_name: contactName,
        caller_name: nil,
        phone_number_id: nil,
        conversation_id: "conv-\(id)",
        outcome: outcome,
        direction: direction,
        forward_seconds: forwardSeconds,
        screening_result: nil,
        stir_attestation: nil,
        voicemail_seconds: nil,
        answered_by_user_id: nil,
        started_at: startedAt
    )
}

#Preview("Recent calls section") {
    ForYouList(
        forYou: ForYou(waiting_on_you: [], my_tasks: [], unread: [], triage: nil),
        recentCalls: .ready([
            previewCall(
                id: "c1",
                outcome: CallOutcome.missed,
                direction: "inbound",
                contactName: "Dana Whitcomb"
            ),
            previewCall(
                id: "c2",
                outcome: CallOutcome.answered,
                direction: "inbound",
                callerE164: "+14155550188",
                forwardSeconds: 272
            ),
            previewCall(
                id: "c3",
                outcome: CallOutcome.answered,
                direction: "outbound",
                contactName: "Ari Benson",
                forwardSeconds: 58
            ),
        ]),
        onOpenConversation: { _ in },
        onOpenCalls: {}
    )
}

#Preview("Recent calls · load failure") {
    ForYouList(
        forYou: ForYou(waiting_on_you: [], my_tasks: [], unread: [], triage: nil),
        recentCalls: .failed("Something went wrong."),
        onOpenConversation: { _ in },
        onOpenCalls: {}
    )
}
