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
    /// #239: the response-time report and its window. Its own load rather than a
    /// section of /v1/for-you — it answers a different question (how are we
    /// doing) from the queue (what needs doing), and it is windowed, so folding
    /// it in would make the queue refetch on every 7/30/90 switch.
    @State private var responseTime: ResponseTimeReport?
    @State private var responseDays = 30
    /// #313: shares the response-time window — "how fast did we answer" and
    /// "did it land" are one question asked over one period, and two window
    /// pickers on one screen is how a crew compares a fortnight to a quarter
    /// without noticing.
    @State private var satisfaction: SatisfactionReport?
    /// #354: the pipeline report. Fixed at 30 days — the pipeline question is
    /// "how did this month's quotes do", not a window somebody tunes.
    @State private var pipeline: PipelineReportResponse?
    /// #301: where this month's customers came from. Same fixed window as the
    /// pipeline above, and nil until it loads — the card says nothing either.
    @State private var leadSources: LeadSourceReport?
    /// #288: whether this crew has earned the referral ask, the link once they
    /// say yes, and the two flags that decide which of the three the card shows.
    /// All nil/false until something happens, so the card renders nothing.
    @State private var referralMoment: ReferralMoment?
    @State private var referralLink: ReferralsView?
    @State private var referralOpened = false
    @State private var referralDismissed = false

    /// #508: how many times the unanswered row has been tapped this session.
    /// It is the destination's token — a repeat tap has to re-apply the filter
    /// after the reader has wandered off it, and an unchanged command says
    /// nothing new to the inbox.
    @State private var unansweredTaps = 0
    /// #540: which panels this member has put away.
    ///
    /// Held here as well as read from `me` because the toggle is OPTIMISTIC — the
    /// switch has to move on the tap, not a round trip later, and `me` is owned by
    /// the shell and will not refresh until the next app load. `nil` means "not
    /// seeded yet", so the membership's value is used until somebody changes
    /// something; that distinction is why this is not simply `[]`.
    @State private var hiddenOverride: [String]?
    @State private var customiseOpen = false
    @State private var customiseFailed = false

    /// The set to render from: whatever this session last chose, else the server's.
    private var hidden: [String] {
        hiddenOverride
            ?? me.memberships.first { $0.company_id == companyId }?.dashboard_hidden
            ?? []
    }

    /// #540: the whole set goes up, matching the route — the body describes the
    /// screen they want rather than a delta against a state two devices may
    /// disagree about. On failure the row goes back to exactly what it was, so a
    /// dropped connection never leaves the phone showing a preference the server
    /// has not got.
    private func toggle(_ panel: DashboardPanels.Panel, _ visible: Bool) {
        let before = hidden
        let next = DashboardPanels.normalise(
            visible
                ? before.filter { $0 != panel.rawValue }
                : before + [panel.rawValue]
        ).map(\.rawValue)
        hiddenOverride = next
        customiseFailed = false
        Task {
            do {
                try await graph.meApi.setDashboardHidden(
                    companyId: companyId,
                    hidden: next
                )
            } catch {
                hiddenOverride = before
                customiseFailed = true
            }
        }
    }

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
                    // #239: nil while it loads — the card says so rather than
                    // showing a zero.
                    responseTime: responseTime,
                    responseDays: responseDays,
                    onResponseWindow: { responseDays = $0 },
                    // #354: nil while it loads, and the card says nothing.
                    satisfaction: satisfaction,
                    referralMoment: referralDismissed ? nil : referralMoment,
                    referralLink: referralLink,
                    referralOpened: referralOpened,
                    onOpenReferral: { Task { await openReferral() } },
                    onDismissReferral: { Task { await dismissReferral() } },
                    pipeline: pipeline,
                    leadSources: leadSources,
                    onOpenConversation: { AppRouter.shared.openConversationId = $0 },
                    onOpenCalls: onOpenCalls,
                    onRefresh: {
                        await reload()
                        await reloadRecentCalls()
                        await reloadPipeline()
                    },
                    company: me.company,
                    onOpenContacts: { AppRouter.shared.openContacts = true },
                    onOpenSettings: { AppRouter.shared.openSettingsSection = $0 },
                    // #508: arm the destination BEFORE the tab switch, so the
                    // inbox reads it whether it is already on screen or gets
                    // composed by the switch. The token makes a second tap
                    // re-apply the filter.
                    onOpenUnanswered: {
                        unansweredTaps += 1
                        AppRouter.shared.inboxDestination = InboxDestination(
                            filter: .awaiting,
                            token: unansweredTaps
                        )
                        AppRouter.shared.openInbox = true
                    },
                    // #540: what this member has put away, and the door to change it.
                    hidden: hidden,
                    onCustomise: { customiseOpen = true }
                )
            }
        }
        .sheet(isPresented: $customiseOpen, onDismiss: { customiseFailed = false }) {
            CustomiseSheet(
                hidden: hidden,
                onToggle: { panel, visible in toggle(panel, visible) },
                failed: customiseFailed
            )
        }
        .task(id: "\(companyId)#\(refreshKey)") { await reload() }
        .task(id: "\(companyId)#\(refreshKey)") { await reloadSpamReview() }
        .task(id: "\(companyId)#\(refreshKey)") { await reloadRecentCalls() }
        .task(id: "\(companyId)#\(refreshKey)") { await reloadPipeline() }
        .task(id: "\(companyId)#\(refreshKey)") { await reloadReferralMoment() }
        .task(id: "\(companyId)#\(refreshKey)#\(responseDays)") {
            await reloadResponseTime()
        }
        // #313: keyed on the same window, so switching 7/30/90 refetches both
        // panels rather than leaving one describing a different period.
        .task(id: "\(companyId)#\(refreshKey)#\(responseDays)") {
            await reloadSatisfaction()
        }
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

    /// #239. A failure leaves whatever was on screen: this panel is a result to
    /// read, not an action to take, so an error flash costs more than the stale
    /// number does. It stays nil until the first success, and the card says it is
    /// working the number out.
    private func reloadResponseTime() async {
        if let fresh = try? await graph.forYouApi.responseTime(
            companyId: companyId,
            days: responseDays
        ) {
            responseTime = fresh
        }
    }

    /// #288: could this member ever collect the reward?
    ///
    /// The whole referrals router is behind `billing.manage`, so asking on a
    /// tech's phone would be a 403 on every trip through the home screen, for a
    /// card they were never going to be shown. And the offer itself would be one
    /// we have no way to keep: the reward is a month off an invoice they cannot
    /// see.
    private var canCollectReferral: Bool {
        MemberRole.has(
            me.memberships.first { $0.company_id == companyId }?.role,
            Capability.billingManage
        )
    }

    /// #288. Same failure posture as the reports above: a failure leaves whatever
    /// was on screen, because an ask nobody has earned yet shows nothing anyway.
    private func reloadReferralMoment() async {
        guard canCollectReferral else { return }
        if let fresh = try? await graph.forYouApi.referralMoment(companyId: companyId) {
            referralMoment = fresh
        }
    }

    /// #288: the link, fetched only when the owner says yes to being asked. Most
    /// trips through this screen never need it.
    private func openReferral() async {
        referralOpened = true
        if let fresh = try? await graph.forYouApi.referrals(companyId: companyId) {
            referralLink = fresh
        }
    }

    /// #288: "Not now."
    ///
    /// OPTIMISTIC — the card goes on the tap, not a round trip later. A refusal
    /// that feels slower than acceptance is a refusal somebody stops making, and
    /// a dismissal the server misses costs one repeated prompt in a quarter.
    private func dismissReferral() async {
        referralDismissed = true
        try? await graph.forYouApi.dismissReferralAsk(companyId: companyId)
    }

    /// #313. Same failure posture as the response time above.
    private func reloadSatisfaction() async {
        if let fresh = try? await graph.forYouApi.satisfaction(
            companyId: companyId,
            days: responseDays
        ) {
            satisfaction = fresh
        }
    }

    /// #354. Same failure posture as the response time above: a failure leaves
    /// whatever was on screen, because this panel is a result to read rather
    /// than an action to take.
    private func reloadPipeline() async {
        if let fresh = try? await graph.forYouApi.pipeline(companyId: companyId) {
            pipeline = fresh
        }
        if let fresh = try? await graph.forYouApi.leadSources(companyId: companyId) {
            leadSources = fresh
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
    /// #239: nil while it loads — the card says so rather than showing a zero.
    let responseTime: ResponseTimeReport?
    let responseDays: Int
    let onResponseWindow: @MainActor (Int) -> Void
    /// #354: nil while it loads — the card renders nothing rather than zeroes.
    let satisfaction: SatisfactionReport?
    /// #288: nil while it loads, when this member could never collect the reward,
    /// or once they have said "Not now" — and the card renders nothing for all
    /// three.
    let referralMoment: ReferralMoment?
    let referralLink: ReferralsView?
    let referralOpened: Bool
    let onOpenReferral: () -> Void
    let onDismissReferral: () -> Void
    let pipeline: PipelineReportResponse?
    /// #301: nil while it loads, and the card renders nothing.
    let leadSources: LeadSourceReport?
    let onOpenConversation: @MainActor (String) -> Void
    let onOpenCalls: (() -> Void)?
    /// Both loaders, awaited together, so the pull-to-refresh spinner settles
    /// when the screen is actually current rather than when the gesture ends.
    let onRefresh: @MainActor () async -> Void
    /// #310: the workspace, for the waiting-room card. Nil until /me lands.
    let company: CompanyView?
    /// #310/#503: the waiting-room card's doors. Required — see WhileYouWait.
    let onOpenContacts: @MainActor () -> Void
    let onOpenSettings: @MainActor (SettingsSection) -> Void
    /// #508: the response-time card's unanswered row. Required — see the card.
    let onOpenUnanswered: @MainActor () -> Void
    /// #540: the panels this member has put away. Empty for almost everybody.
    let hidden: [String]
    /// #540: opens the Customise sheet.
    let onCustomise: @MainActor () -> Void

    @Environment(\.appLocale) private var appLocale

    /// #306: the work, not the page. Counting the rows meant a member 60
    /// conversations behind read "20 things need you", and the queue looked
    /// finished after twenty items.
    private var total: Int { forYouHeadlineWork(forYou) }

    private var waitingTotal: Int { forYou.totals?.waiting_on_you ?? forYou.waiting_on_you.count }
    private var followUpTotal: Int { forYou.totals?.follow_ups ?? forYou.follow_ups.count }
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
        if total == 0 {
            return AppStrings.translate(appLocale, "inbox.forYouAllCaughtUp")
        }
        if total == 1 {
            return AppStrings.translate(appLocale, "inbox.forYouWorkOne")
        }
        return AppStrings.translate(
            appLocale,
            "inbox.forYouWorkMany",
            ["count": String(total)]
        )
    }

    private func callTap(_ call: Call) -> (@MainActor () -> Void)? {
        guard let id = call.conversation_id else { return nil }
        return { onOpenConversation(id) }
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                heading
                // #310: only while the carriers have it. Above the queue
                // because during the wait the queue is empty by definition —
                // texting is what fills it, and that has not started yet.
                WhileYouWait(
                    company: company,
                    onOpenContacts: onOpenContacts,
                    onOpenSettings: onOpenSettings
                )
                // #239 — the claim we sell, measured. Above the queue because the
                // arc is the reason a contractor stays, and it is a result to
                // read rather than a task to do.
                // #540: each measure can be put away from Customise. Gated here
                // rather than inside each card, so a hidden panel contributes no
                // stack spacing and leaves no gap where a card used to be.
                if DashboardPanels.isVisible(hidden, .responseTime) {
                    ResponseTimeCard(
                        report: responseTime,
                        days: responseDays,
                        onWindow: onResponseWindow,
                        onOpenUnanswered: onOpenUnanswered
                    )
                }
                // #354: beside its neighbour, and absent entirely until there
                // is something true to say.
                if DashboardPanels.isVisible(hidden, .pipeline) {
                    PipelineCard(report: pipeline)
                }
                // #301: last of the four, because it answers a slower question
                // than the three above it — next month's spending rather than
                // this week's work.
                if DashboardPanels.isVisible(hidden, .leadSources) {
                    LeadSourcesCard(report: leadSources)
                }
                // #313: directly under the speed number on purpose. How fast
                // you answered and whether it landed are one thought, and
                // separating them onto two screens is how a business optimises
                // the first while the second quietly slides.
                if DashboardPanels.isVisible(hidden, .satisfaction) {
                    SatisfactionCard(
                        report: satisfaction,
                        days: responseDays,
                        onWindow: onResponseWindow,
                        onOpenPoor: onOpenUnanswered
                    )
                }
                // #288: after the numbers, never before them. The ask is earned
                // by the measures above it, and reading those first is what makes
                // it land as earned rather than as an interruption. NOT one of the
                // hideable panels: it already has its own "Not now", and a prompt
                // with two ways to put it away is a prompt where one of them stops
                // being honoured.
                ReferralAskCard(
                    moment: referralMoment,
                    referrals: referralLink,
                    opened: referralOpened,
                    onOpen: onOpenReferral,
                    onDismiss: onDismissReferral
                )
                // #342: above the queue, because "you're all caught up" is not
                // true if somebody has been texting a thread nobody can see.
                spamReviewSection
                // #293: ABOVE the queue. A quote nobody answered is the most
                // valuable thing in the business to be reminded about, and unlike
                // every section below it this one only appears because the member
                // asked for it — so it keeps the top regardless of what the
                // ordering below says is urgent today.
                followUpsSection
                // #540: the four queues in the order the SHARED rule gives, so the
                // phone leads with the same thing the laptop does. Web spends its
                // horizontal room on a strip of four tiles; a phone cannot afford
                // two rows of chrome above the work, so the same decision orders
                // the sections — which is all the strip was ever an index of.
                ForEach(queueOrder, id: \.self) { tile in
                    switch tile {
                    case .unassigned: triageSection
                    case .waiting: waitingSection
                    case .tasks: tasksSection
                    case .unread: unreadSection
                    }
                }
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
        HStack(alignment: .top, spacing: 12) {
            VStack(alignment: .leading, spacing: 5) {
                ScreenTitle(text: AppStrings.translate(appLocale, "inbox.forYouTitle"))
                Text(subtitle)
                    .font(.golos(13))
                    .foregroundStyle(BrandColor.muted600)
            }
            Spacer(minLength: 0)
            // #540: quiet, and to the side. THE DOT MATTERS MORE THAN IT LOOKS
            // LIKE IT DOES — somebody who put two panels away in April has no
            // other way to find out why their screen is shorter than a
            // colleague's, and "the app is missing the pipeline card" is a
            // support conversation nobody can win.
            Button(action: onCustomise) {
                Image(systemName: "slider.horizontal.3")
                    // Scaled, so the glyph grows with the reader's font setting
                    // rather than staying 15pt for somebody who asked for larger.
                    .font(.scaled(15, weight: .medium))
                    .foregroundStyle(BrandColor.muted700)
                    .frame(width: 40, height: 40)
                    .background(BrandColor.paper, in: Circle())
                    .overlay(alignment: .topTrailing) {
                        if !hidden.isEmpty {
                            Circle()
                                .fill(BrandColor.lime)
                                .frame(width: 8, height: 8)
                                .overlay(Circle().stroke(BrandColor.canvas, lineWidth: 2))
                        }
                    }
            }
            .accessibilityLabel(customiseLabel)
        }
        .padding(.bottom, 2)
    }

    /// The control's accessible name, carrying the count the dot only hints at.
    private var customiseLabel: String {
        let count = DashboardPanels.normalise(hidden).count
        if count == 0 {
            return AppStrings.translate(appLocale, "inbox.customiseAria")
        }
        // A whole sentence per number, not a noun swapped inside one: French
        // agrees the participle as well as the noun ("panneau rangé" /
        // "panneaux rangés"), which a spliced word cannot reach.
        let key: String = count == 1
            ? "inbox.customiseAriaPutAwayOne"
            : "inbox.customiseAriaPutAwayMany"
        return AppStrings.translate(appLocale, key, ["count": String(count)])
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
                    label: AppStrings.translate(
                        appLocale, "inbox.forYouSectionSpamReview"
                    ),
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

    /// #540 — the order the four queues are read in, from the shared rule.
    ///
    /// Ages come from the rows we were sent, which is the honest limit: the oldest
    /// row on this page is not necessarily the oldest in the section, so the age can
    /// be younger than the truth and never older. That is the safe direction for a
    /// number deciding what somebody looks at first.
    private var queueOrder: [DashboardTiles.Tile] {
        let now = Date().timeIntervalSince1970
        func age(_ iso: String?) -> TimeInterval? {
            guard let iso, let parsed = parseWireTimestamp(iso) else { return nil }
            return max(0, now - parsed.timeIntervalSince1970)
        }
        return DashboardTiles.order(
            DashboardTiles.Input(
                unassignedAges:
                    (forYou.triage?.conversations.map { age($0.last_message_at) ?? 0 } ?? [])
                    // A triage task carries no timestamp on this payload, so it
                    // counts towards the number without claiming an age.
                    + (forYou.triage?.tasks.map { _ in TimeInterval(0) } ?? []),
                waiting: forYou.waiting_on_you.map {
                    DashboardTiles.Row(
                        ageSeconds: age($0.last_message_at),
                        overdue: $0.has_overdue_task
                    )
                },
                tasks: forYou.my_tasks.map {
                    DashboardTiles.Row(ageSeconds: age($0.due_at), overdue: $0.overdue)
                },
                unreadAges: forYou.unread.map { age($0.last_message_at) ?? 0 }
            )
        ).map(\.tile)
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
                    label: AppStrings.translate(
                        appLocale, "inbox.forYouSectionUnassigned"
                    ),
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
    private var followUpsSection: some View {
        if !forYou.follow_ups.isEmpty {
            VStack(alignment: .leading, spacing: 0) {
                SectionHeader(
                    label: AppStrings.translate(
                        appLocale, "inbox.forYouSectionChaseThese"
                    ),
                    count: followUpTotal
                )
                PaperCard {
                    ForEach(
                        Array(forYou.follow_ups.enumerated()),
                        id: \.element.conversation_id
                    ) { index, row in
                        if index > 0 { RowDivider() }
                        PersonRow(
                            name: row.contact?.name
                                ?? formatPhone(row.contact?.phone_e164),
                            // The REASON, not the last-message time: it is what
                            // the member wrote down, and the only thing that
                            // makes the card actionable three days later.
                            // "Chase the quote" is a job; "Chase this" is a
                            // chore.
                            meta: (row.note?.isBlank == false)
                                ? row.note!
                                : AppStrings.translate(
                                    appLocale,
                                    "inbox.forYouWhyNoReply",
                                    ["when": relativeTime(row.last_message_at)]
                                ),
                            unread: row.unread
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
                SectionHeader(
                    label: AppStrings.translate(appLocale, "inbox.forYouSectionWaiting"),
                    count: waitingTotal
                )
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
                SectionHeader(
                    label: AppStrings.translate(appLocale, "inbox.forYouSectionTasks"),
                    count: tasksTotal
                )
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
                SectionHeader(
                    label: AppStrings.translate(appLocale, "inbox.forYouSectionUnread"),
                    count: unreadTotal
                )
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
    // #540: and hideable, unlike everything above it in the queue. Calls already
    // happened — this is history a member reads, not work they owe anybody, so it
    // is the one section here that can come off.
    @ViewBuilder
    private var recentCallsSection: some View {
        if !DashboardPanels.isVisible(hidden, .recentCalls) {
            EmptyView()
        } else {
            recentCallsBody
        }
    }

    @ViewBuilder
    private var recentCallsBody: some View {
        switch recentCalls {
        case .loading:
            EmptyView()
        case .failed:
            VStack(alignment: .leading, spacing: 0) {
                recentCallsHeader
                PaperCard {
                    Text(AppStrings.translate(appLocale, "inbox.forYouCallsLoadFailed"))
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
            SectionHeader(
                label: AppStrings.translate(appLocale, "inbox.forYouRecentCalls")
            )
            Spacer()
            if let onOpenCalls {
                Button(
                    AppStrings.translate(appLocale, "inbox.forYouViewAllCalls"),
                    action: onOpenCalls
                )
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
                        .font(.scaled(10, weight: .medium))
                        .foregroundStyle(metaColor)
                    // #566: the same unbounded label as the /calls row —
                    // "Answered by <display_name> · 4m 32s", with display_name
                    // capped at 80 characters (routes/me.ts). Android's twin has
                    // had maxLines = 1 since it shipped; this was the last of the
                    // three clients left to wrap.
                    Text(callOutcomeLabel(call))
                        .font(.golos(11.5, weight: isActionableMiss(call) ? .semibold : .regular))
                        .foregroundStyle(metaColor)
                        .lineLimit(1)
                        .truncationMode(.tail)
                }
            }
            Spacer(minLength: 8)
            Text(relativeTime(call.started_at))
                .font(.golos(11))
                .monospacedDigit()
                .foregroundStyle(BrandColor.muted300)
                // #566: `relativeTime` reaches "Jul 16 2025" past a week — a
                // multi-word string that wraps when squeezed. Kept whole so the
                // name beside it is what gives way.
                .lineLimit(1)
                .fixedSize(horizontal: true, vertical: false)
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

    @Environment(\.appLocale) private var appLocale

    private var displayName: String {
        let trimmed = name ?? ""
        return trimmed.isEmpty
            ? AppStrings.translate(appLocale, "inbox.forYouUnknownCaller")
            : trimmed
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
                    .font(.scaled(15, weight: .medium))
                    .foregroundStyle(BrandColor.muted250)
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 11)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        // Same as the inbox + notification rows: the AttentionDot is the only
        // unread signal, and it is invisible to VoiceOver.
        .accessibilityValue(
            unread ? AppStrings.translate(appLocale, "inbox.rowStateUnread") : ""
        )
    }
}

private struct TaskLineRow: View {
    let title: String
    let overdue: Bool
    let dueAt: String?
    let onTap: @MainActor () -> Void

    @Environment(\.appLocale) private var appLocale

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
                    .font(.scaled(15, weight: .medium))
                    .foregroundStyle(BrandColor.muted250)
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 12)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }

    private var subtitle: String {
        if overdue {
            return AppStrings.translate(appLocale, "inbox.forYouWhyOverdueTask")
        }
        // formatDue, NOT relativeTime: relativeTime measures time ELAPSED, so
        // every future due date came out as "Due now".
        if let dueAt {
            return AppStrings.translate(
                appLocale,
                "inbox.forYouWhyDue",
                ["when": formatDue(dueAt)]
            )
        }
        return AppStrings.translate(appLocale, "inbox.forYouWhyOpenTask")
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
        // #239: nil report — the preview shows the "working it out" state.
        responseTime: nil,
        responseDays: 30,
        onResponseWindow: { _ in },
        // #313: nil report — the preview shows the "reading your ratings" state.
        satisfaction: nil,
        referralMoment: nil,
        referralLink: nil,
        referralOpened: false,
        onOpenReferral: {},
        onDismissReferral: {},
        // #354: nil report — the preview shows the card's absent state, which
        // is what a workspace with no quotes actually sees.
        pipeline: nil,
        leadSources: nil,
        onOpenConversation: { _ in },
        onOpenCalls: {},
        onRefresh: {},
        company: nil,
        onOpenContacts: {},
        onOpenSettings: { _ in },
        onOpenUnanswered: {},
        // #540: previews render the whole screen — nothing put away.
        hidden: [],
        onCustomise: {}
    )
}

#Preview("Recent calls · load failure") {
    ForYouList(
        forYou: ForYou(waiting_on_you: [], my_tasks: [], unread: [], triage: nil),
        spamReview: [],
        onAnswerSpamReview: { _, _ in },
        recentCalls: .failed("Something went wrong."),
        // #239: nil report — the preview shows the "working it out" state.
        responseTime: nil,
        responseDays: 30,
        onResponseWindow: { _ in },
        // #313: nil report — the preview shows the "reading your ratings" state.
        satisfaction: nil,
        referralMoment: nil,
        referralLink: nil,
        referralOpened: false,
        onOpenReferral: {},
        onDismissReferral: {},
        // #354: nil report — the preview shows the card's absent state, which
        // is what a workspace with no quotes actually sees.
        pipeline: nil,
        leadSources: nil,
        onOpenConversation: { _ in },
        onOpenCalls: {},
        onRefresh: {},
        company: nil,
        onOpenContacts: {},
        onOpenSettings: { _ in },
        onOpenUnanswered: {},
        // #540: previews render the whole screen — nothing put away.
        hidden: [],
        onCustomise: {}
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
        // #239: nil report — the preview shows the "working it out" state.
        responseTime: nil,
        responseDays: 30,
        onResponseWindow: { _ in },
        // #313: nil report — the preview shows the "reading your ratings" state.
        satisfaction: nil,
        referralMoment: nil,
        referralLink: nil,
        referralOpened: false,
        onOpenReferral: {},
        onDismissReferral: {},
        // #354: nil report — the preview shows the card's absent state, which
        // is what a workspace with no quotes actually sees.
        pipeline: nil,
        leadSources: nil,
        onOpenConversation: { _ in },
        onOpenCalls: {},
        onRefresh: {},
        company: nil,
        onOpenContacts: {},
        onOpenSettings: { _ in },
        onOpenUnanswered: {},
        // #540: previews render the whole screen — nothing put away.
        hidden: [],
        onCustomise: {}
    )
}

/// #342 — one spam mark that does not look like spam, and the two answers.
/// Both end the prompt: one lifts the mark, the other confirms it without
/// making the decision permanent again.
private struct SpamReviewRow: View {
    let item: SpamReviewItem
    let onOpen: @MainActor () -> Void
    let onAnswer: @MainActor (Bool) -> Void

    @Environment(\.appLocale) private var appLocale

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
                Button(AppStrings.translate(appLocale, "inbox.forYouNotSpam")) {
                    onAnswer(true)
                }
                    .font(.golos(12, weight: .semibold))
                    .foregroundStyle(BrandColor.olive)
                    .buttonStyle(.plain)
                Button(AppStrings.translate(appLocale, "inbox.forYouStillSpam")) {
                    onAnswer(false)
                }
                    .font(.golos(12))
                    .foregroundStyle(BrandColor.muted500)
                    .buttonStyle(.plain)
            }
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 11)
    }
}
