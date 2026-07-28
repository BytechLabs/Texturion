import SwiftUI

/// /for-you — the default landing: Unassigned (every member since #416),
/// Waiting on you,
/// My tasks, Unread, and Recent calls (D43: the mobile entry point into the
/// Calls surface). Realtime events refetch the queue; every row routes its
/// conversation UP to the shell (#186), which pushes `ThreadView` ABOVE the
/// tab shell with no pill (task rows open their conversation — task detail
/// itself is the Tasks tab's surface, #160).
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

    @State private var state: LoadState<ForYou> = .loading
    @State private var recentCalls: LoadState<[Call]> = .loading
    /// #342: spam marks that do not look like spam. Empty on nearly every day,
    /// and deliberately NOT a badge or a push — a signal you find, not one
    /// that finds you.
    @State private var spamReview: [SpamReviewItem] = []
    @State private var refreshKey = 0

    var body: some View {
        Group {
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
                    spamReview: spamReview,
                    onAnswerSpamReview: { conversationId, notSpam in
                        Task {
                            try? await graph.forYouApi.answerSpamReview(
                                companyId: companyId,
                                conversationId: conversationId,
                                notSpam: notSpam
                            )
                            refreshKey += 1
                        }
                    },
                    recentCalls: recentCalls,
                    onOpenConversation: { AppRouter.shared.openConversationId = $0 },
                    onOpenCalls: onOpenCalls,
                    onRefresh: {
                        await reload()
                        await reloadRecentCalls()
                    }
                )
            }
        }
        .task(id: "\(companyId)#\(refreshKey)") { await reload() }
        .task(id: "\(companyId)#\(refreshKey)") { await reloadSpamReview() }
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
        // #215 Part A: rebuild the queue on foreground so movement missed while
        // backgrounded (a new unread, a task change) shows on return.
        .resyncOnForeground { refreshKey += 1 }
    }

    private func reload() async {
        if refreshKey == 0 { state = .loading }
        do {
            state = .ready(try await graph.forYouApi.forYou(companyId: companyId))
        } catch is CancellationError {
            // A re-key (realtime tick, foreground resync) cancelled this pass;
            // the replacement is already running. Never a user-visible failure.
        } catch {
            // A BACKGROUND refetch failure must not replace a loaded queue with
            // a full-screen error — the landing screen would blank out because a
            // single revalidation blipped, even though good data was on screen.
            // Only the true first load has nothing better to show. Mirrors
            // reloadRecentCalls' quiet-refetch handling.
            if case .ready = state { return }
            state = .failed(error.userMessage)
        }
    }

    /// Recent calls (#161/D43): the 3 newest sessions from the calls list
    /// endpoint (never invented /v1/home fields), refetched on the same
    /// realtime ticks as the queue ('call.' is already in the filter above).
    /// #342. A failure leaves the strip as it was rather than surfacing an
    /// error: this is ambient evidence, and an error banner for it would be
    /// louder than the thing it reports.
    private func reloadSpamReview() async {
        if let page = try? await graph.forYouApi.spamReview(companyId: companyId) {
            spamReview = page.data
        }
    }

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
    let spamReview: [SpamReviewItem]
    let onAnswerSpamReview: @MainActor (String, Bool) -> Void
    let recentCalls: LoadState<[Call]>
    let onOpenConversation: @MainActor (String) -> Void
    let onOpenCalls: (() -> Void)?
    /// Both loaders, awaited together, so the pull-to-refresh spinner settles
    /// when the screen is actually current rather than when the gesture ends.
    let onRefresh: @MainActor () async -> Void

    /// #306: the work, not the page. Counting the rows meant a member 60
    /// conversations behind read "20 things need you", and the queue looked
    /// finished after twenty items.
    private var total: Int { forYouHeadlineWork(forYou) }

    private var waitingTotal: Int { forYou.totals?.waiting_on_you ?? forYou.waiting_on_you.count }
    private var tasksTotal: Int { forYou.totals?.my_tasks ?? forYou.my_tasks.count }
    private var unreadTotal: Int { forYou.totals?.unread ?? forYou.unread.count }
    private var triageConvTotal: Int {
        forYou.totals?.triage_conversations ?? forYou.triage?.conversations.count ?? 0
    }
    private var triageTaskTotal: Int {
        forYou.totals?.triage_tasks ?? forYou.triage?.tasks.count ?? 0
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
                // #342: above the queue, because "you're all caught up" is not
                // true if somebody has been texting a thread nobody can see.
                spamReviewSection
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
        // Pull to refresh, matching Android.
        .refreshable { await onRefresh() }
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

    /// #342 — the spam marks that do not look like spam, and the two answers.
    ///
    /// The line says WHICH signal raised it: "4 messages since" reads as a
    /// counter, "you texted them before marking this" reads as the mistake it
    /// probably is.
    @ViewBuilder
    private var spamReviewSection: some View {
        if !spamReview.isEmpty {
            VStack(alignment: .leading, spacing: 0) {
                SectionHeader(
                    label: "Marked spam, still texting",
                    count: spamReview.count
                )
                PaperCard {
                    ForEach(
                        Array(spamReview.enumerated()),
                        id: \.element.conversation_id
                    ) { index, row in
                        if index > 0 { RowDivider() }
                        SpamReviewRow(
                            item: row,
                            onOpen: { onOpenConversation(row.conversation_id) },
                            onAnswer: { notSpam in
                                onAnswerSpamReview(row.conversation_id, notSpam)
                            }
                        )
                    }
                }
            }
        }
    }

    @ViewBuilder
    private var triageSection: some View {
        if let triage = forYou.triage,
           !triage.conversations.isEmpty || !triage.tasks.isEmpty {
            VStack(alignment: .leading, spacing: 0) {
                SectionHeader(
                    // #416/D53: renamed from "Triage" — dispatcher language
                    // for a section only owners could see. It is the whole
                    // crew's queue now, and "unassigned" is the word the rest
                    // of the product already uses.
                    label: "Unassigned",
                    count: triageConvTotal + triageTaskTotal
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
                SectionHeader(label: "Waiting on you", count: waitingTotal)
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
                SectionHeader(label: "My tasks", count: tasksTotal)
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
                SectionHeader(label: "Unread", count: unreadTotal)
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
        // Same as the inbox + notification rows: the AttentionDot is the only
        // unread signal, and it is invisible to VoiceOver.
        .accessibilityValue(unread ? "Unread" : "")
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
        // formatDue, NOT relativeTime: relativeTime measures time ELAPSED, so
        // every future due date came out as "Due now".
        if let dueAt { return "Due \(formatDue(dueAt))" }
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
        answered_by_name: nil,
        started_at: startedAt
    )
}

#Preview("Recent calls section") {
    ForYouList(
        forYou: ForYou(waiting_on_you: [], my_tasks: [], unread: [], triage: nil),
        spamReview: [],
        onAnswerSpamReview: { _, _ in },
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
        onOpenCalls: {},
        onRefresh: {}
    )
}

#Preview("Recent calls · load failure") {
    ForYouList(
        forYou: ForYou(waiting_on_you: [], my_tasks: [], unread: [], triage: nil),
        spamReview: [],
        onAnswerSpamReview: { _, _ in },
        recentCalls: .failed("Something went wrong."),
        onOpenConversation: { _ in },
        onOpenCalls: {},
        onRefresh: {}
    )
}

/// #342 — the strip that says a spam mark may have been a mistake. Previewed
/// on its own because it renders on almost no real day, which is exactly the
/// kind of surface that rots unseen.
#Preview("Marked spam, still texting") {
    ForYouList(
        forYou: ForYou(waiting_on_you: [], my_tasks: [], unread: [], triage: nil),
        spamReview: [
            SpamReviewItem(
                conversation_id: "conv-1",
                contact: ContactSummary(
                    id: "c1",
                    name: "Maria Alvarez",
                    phone_e164: "+14155551000"
                ),
                marked_at: "2026-06-26T12:00:00Z",
                marked_by_user_id: "u1",
                inbound_since: 4,
                last_inbound_at: "2026-07-25T09:00:00Z",
                we_texted_them: true,
                sustained: false,
                high_volume: false
            )
        ],
        onAnswerSpamReview: { _, _ in },
        recentCalls: .ready([]),
        onOpenConversation: { _ in },
        onOpenCalls: {},
        onRefresh: {}
    )
}

/// #342 — one spam mark that does not look like spam, and the two answers.
/// Both end the prompt: one lifts the mark, the other confirms it without
/// making the decision permanent again.
private struct SpamReviewRow: View {
    let item: SpamReviewItem
    let onOpen: @MainActor () -> Void
    let onAnswer: @MainActor (Bool) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Button(action: onOpen) {
                VStack(alignment: .leading, spacing: 2) {
                    Text(item.contact?.name ?? formatPhone(item.contact?.phone_e164))
                        .font(.golos(14.5, weight: .semibold))
                        .foregroundStyle(BrandColor.ink)
                    Text(spamReviewReason(item))
                        .font(.golos(11.5))
                        .foregroundStyle(
                            item.we_texted_them ? BrandColor.coral : BrandColor.muted500
                        )
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            }
            .buttonStyle(.plain)

            HStack(spacing: 10) {
                Button("Not spam") { onAnswer(true) }
                    .font(.golos(12, weight: .semibold))
                    .foregroundStyle(BrandColor.olive)
                    .buttonStyle(.plain)
                Button("Still spam") { onAnswer(false) }
                    .font(.golos(12))
                    .foregroundStyle(BrandColor.muted500)
                    .buttonStyle(.plain)
            }
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 11)
    }
}
