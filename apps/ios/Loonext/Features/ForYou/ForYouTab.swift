import SwiftUI

/// /for-you — the default landing: Triage (owner/admin), Waiting on you,
/// My tasks, Unread, and Recent calls (D43: the mobile entry point into the
/// Calls surface). Realtime events refetch the queue; every row deep-links
/// into `ThreadView` in place (task rows open their conversation — task
/// detail itself is the Tasks tab's surface, #160).
///
/// `onOpenCalls` is the shell's navigation to the full Calls surface — the
/// "View all" affordance hides until the shell wires it.
///
/// Visuals: "Paper & Olive" (docs/MOBILE-DESIGN.md, screen 19/29) — canvas
/// background, radius-22 paper cards with hairline dividers, tracked
/// micro-headers with olive counts, Bricolage screen title.
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
                        .background(BrandColor.canvas)
                case .failed(let message):
                    CenteredError(message: message) { refreshKey += 1 }
                        .background(BrandColor.canvas)
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

    // Extracted with explicit types — the interpolated nested ternary and the
    // Optional.map closure-of-closure below made swiftc's type checker give
    // up on the whole body (CI run 7).
    private var subtitle: String {
        if total == 0 { return "You're all caught up." }
        return total == 1 ? "1 thing needs you" : "\(total) things need you"
    }

    private func callTap(_ call: Call) -> (@MainActor () -> Void)? {
        guard let id = call.conversation_id else { return nil }
        return { onOpenConversation(id) }
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                heading
                triageSection
                waitingSection
                tasksSection
                unreadSection
                recentCallsSection
            }
            .padding(.horizontal, 18)
            .padding(.top, 8)
            .padding(.bottom, 28)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .background(BrandColor.canvas)
    }

    private var heading: some View {
        VStack(alignment: .leading, spacing: 5) {
            ScreenTitle(text: "For you")
            Text(subtitle)
                .font(.golos(13))
                .foregroundStyle(BrandColor.muted600)
        }
        .padding(.bottom, 2)
    }

    @ViewBuilder
    private var triageSection: some View {
        if let triage = forYou.triage,
           !triage.conversations.isEmpty || !triage.tasks.isEmpty {
            VStack(alignment: .leading, spacing: 0) {
                SectionHeader(
                    label: "Triage",
                    count: triage.conversations.count + triage.tasks.count
                )
                PaperCard {
                    ForEach(
                        Array(triage.conversations.enumerated()),
                        id: \.element.conversation_id
                    ) { index, row in
                        if index > 0 { RowDivider() }
                        PersonRow(
                            name: row.contact?.name ?? formatPhone(row.contact?.phone_e164),
                            meta: relativeTime(row.last_message_at),
                            unread: row.unread
                        ) { onOpenConversation(row.conversation_id) }
                    }
                    ForEach(
                        Array(triage.tasks.enumerated()),
                        id: \.element.task_id
                    ) { index, row in
                        if index > 0 || !triage.conversations.isEmpty { RowDivider() }
                        TaskLineRow(
                            title: row.title,
                            overdue: row.overdue,
                            dueAt: row.due_at
                        ) { onOpenConversation(row.conversation_id) }
                    }
                }
            }
        }
    }

    @ViewBuilder
    private var waitingSection: some View {
        if !forYou.waiting_on_you.isEmpty {
            VStack(alignment: .leading, spacing: 0) {
                SectionHeader(label: "Waiting on you", count: forYou.waiting_on_you.count)
                PaperCard {
                    ForEach(
                        Array(forYou.waiting_on_you.enumerated()),
                        id: \.element.conversation_id
                    ) { index, row in
                        if index > 0 { RowDivider() }
                        PersonRow(
                            name: row.contact?.name ?? formatPhone(row.contact?.phone_e164),
                            meta: relativeTime(row.last_message_at),
                            unread: row.unread
                        ) { onOpenConversation(row.conversation_id) }
                    }
                }
            }
        }
    }

    @ViewBuilder
    private var tasksSection: some View {
        if !forYou.my_tasks.isEmpty {
            VStack(alignment: .leading, spacing: 0) {
                SectionHeader(label: "My tasks", count: forYou.my_tasks.count)
                PaperCard {
                    ForEach(
                        Array(forYou.my_tasks.enumerated()),
                        id: \.element.task_id
                    ) { index, row in
                        if index > 0 { RowDivider() }
                        TaskLineRow(
                            title: row.title,
                            overdue: row.overdue,
                            dueAt: row.due_at
                        ) { onOpenConversation(row.conversation_id) }
                    }
                }
            }
        }
    }

    @ViewBuilder
    private var unreadSection: some View {
        if !forYou.unread.isEmpty {
            VStack(alignment: .leading, spacing: 0) {
                SectionHeader(label: "Unread", count: forYou.unread.count)
                PaperCard {
                    ForEach(
                        Array(forYou.unread.enumerated()),
                        id: \.element.conversation_id
                    ) { index, row in
                        if index > 0 { RowDivider() }
                        PersonRow(
                            name: row.contact?.name ?? formatPhone(row.contact?.phone_e164),
                            meta: relativeTime(row.last_message_at),
                            unread: true
                        ) { onOpenConversation(row.conversation_id) }
                    }
                }
            }
        }
    }

    // Recent calls (#161/D43) — the mobile doorway into the Calls surface.
    // Hidden entirely while loading or empty; an honest error line when the
    // log couldn't load (Android twin parity).
    @ViewBuilder
    private var recentCallsSection: some View {
        switch recentCalls {
        case .loading:
            EmptyView()
        case .failed:
            VStack(alignment: .leading, spacing: 0) {
                recentCallsHeader
                PaperCard {
                    Text("Couldn't load recent calls.")
                        .font(.golos(12))
                        .foregroundStyle(BrandColor.muted500)
                        .padding(.horizontal, 16)
                        .padding(.vertical, 12)
                }
            }
        case .ready(let calls):
            if !calls.isEmpty {
                VStack(alignment: .leading, spacing: 0) {
                    recentCallsHeader
                    PaperCard {
                        ForEach(Array(calls.enumerated()), id: \.element.id) { index, call in
                            if index > 0 { RowDivider() }
                            RecentCallRow(call: call, onTap: callTap(call))
                        }
                    }
                }
            }
        }
    }

    /// "Recent calls" + the shell-wired "View all" doorway (hidden until wired).
    private var recentCallsHeader: some View {
        HStack(alignment: .firstTextBaseline) {
            SectionHeader(label: "Recent calls")
            Spacer()
            if let onOpenCalls {
                Button("View all", action: onOpenCalls)
                    .font(.golos(12, weight: .bold))
                    .foregroundStyle(BrandColor.olive)
                    .buttonStyle(.plain)
                    .padding(.trailing, 6)
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

    private var metaColor: Color {
        isActionableMiss(call) ? BrandColor.overdueAmber : BrandColor.muted400
    }

    var body: some View {
        HStack(spacing: 11) {
            InitialsAvatar(name: name, size: 34)
            VStack(alignment: .leading, spacing: 1) {
                Text(name)
                    .font(.golos(13, weight: .semibold))
                    .foregroundStyle(BrandColor.ink)
                    .lineLimit(1)
                HStack(spacing: 5) {
                    Image(systemName: directionIcon)
                        .font(.system(size: 10, weight: .medium))
                        .foregroundStyle(metaColor)
                    Text(callOutcomeLabel(call))
                        .font(.golos(11.5, weight: isActionableMiss(call) ? .semibold : .regular))
                        .foregroundStyle(metaColor)
                }
            }
            Spacer(minLength: 8)
            Text(relativeTime(call.started_at))
                .font(.golos(11))
                .monospacedDigit()
                .foregroundStyle(BrandColor.muted300)
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 10)
        .contentShape(Rectangle())
        .onTapGesture { onTap?() }
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
            HStack(spacing: 11) {
                InitialsAvatar(name: name, size: 38)
                VStack(alignment: .leading, spacing: 2) {
                    Text(displayName)
                        .font(.golos(13.5, weight: .semibold))
                        .foregroundStyle(BrandColor.ink)
                        .lineLimit(1)
                    Text(meta)
                        .font(.golos(11.5))
                        .foregroundStyle(BrandColor.muted400)
                }
                Spacer(minLength: 8)
                if unread {
                    AttentionDot()
                }
                Image(systemName: "arrow.right")
                    .font(.system(size: 15, weight: .medium))
                    .foregroundStyle(BrandColor.muted250)
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 11)
            .contentShape(Rectangle())
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
            HStack(spacing: 12) {
                Circle()
                    .strokeBorder(BrandColor.muted250, lineWidth: 1.8)
                    .frame(width: 22, height: 22)
                VStack(alignment: .leading, spacing: 2) {
                    Text(title)
                        .font(.golos(13.5, weight: .semibold))
                        .foregroundStyle(BrandColor.ink)
                        .lineLimit(1)
                    Text(subtitle)
                        .font(.golos(11.5, weight: overdue ? .bold : .regular))
                        // Overdue = amber, never red (calm system).
                        .foregroundStyle(
                            overdue ? BrandColor.overdueAmber : BrandColor.muted400
                        )
                }
                Spacer(minLength: 8)
                Image(systemName: "arrow.right")
                    .font(.system(size: 15, weight: .medium))
                    .foregroundStyle(BrandColor.muted250)
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 12)
            .contentShape(Rectangle())
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
