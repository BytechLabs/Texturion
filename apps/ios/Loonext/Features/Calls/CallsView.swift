import SwiftUI
import AVFoundation
import UIKit

private enum CallsFilter: String, CaseIterable, Identifiable {
    // The raw values stay ENGLISH and stay identity: they are the `.task(id:)`
    // key and the `Identifiable` id, so translating them would make switching
    // language look like switching filter.
    case all = "All"
    case missed = "Missed"
    case voicemail = "Voicemail"

    var id: String { rawValue }

    /// What the pill says, which is a different question from what it is.
    var labelKey: String {
        switch self {
        case .all: "contactsTasks.filterAll"
        case .missed: "contactsTasks.filterMissed"
        case .voicemail: "contactsTasks.filterVoicemail"
        }
    }

    var outcome: String? {
        switch self {
        case .all: nil
        case .missed: CallOutcome.missed
        case .voicemail: CallOutcome.voicemail
        }
    }
}

/// The calls surface (#161): softphone status line, All|Missed|Voicemail log
/// (cursor-paged), outcome rows, voicemail playback, realtime call.updated
/// refresh, and the dialer. Registering the softphone here (and in
/// `CallsOverlay`) is what makes this member ring-eligible.
/// Paper & Olive reskin per spec 25 (docs/MOBILE-DESIGN.md).
@MainActor
struct CallsView: View {
    let graph: AppGraph
    let companyId: String
    let me: Me
    var openConversation: (String) -> Void = { _ in }

    private let manager: CallsManager
    private let service: CallsService
    /// #691: delete and restore for calls and voicemails.
    private let deletion: RecordDeletionRepository

    @State private var filter: CallsFilter = .all
    /// #725: a setting's "See them" narrows the log to one reason; the chip clears it.
    @State private var reason: String?
    @State private var state: LoadState<[Call]> = .loading
    @State private var nextCursor: String?
    @State private var loadingMore = false
    @State private var refreshKey = 0
    /// #210: the rows the Ongoing card pins, and the roster that names who is
    /// holding each line. Both are derived reads — the log below stays the
    /// single source of the call history.
    @State private var ongoing: [Call] = []
    @State private var members: [Member] = []
    /// The dialer and its "Add contact" create sheet share ONE presentation
    /// (#186 item 5): the dialer swaps to `.addContact` IN PLACE, so the two
    /// never toggle in the same runloop (dismiss-then-present on the same
    /// anchor is dropped on iOS 15/16 and flaky on 17.x — "Add contact" would
    /// do nothing / need a second tap).
    @State private var activeSheet: CallsSheet?
    /// #691: the toast after a delete, carrying its Undo.
    @State private var notice: ThreadNotice?
    @State private var noticeSeq: Int64 = 0
    @State private var noticeDismissTask: Task<Void, Never>?

    @Environment(\.appLocale) private var appLocale
    @Environment(\.openURL) private var openURL

    private func t(_ key: String) -> String { AppStrings.translate(appLocale, key) }

    init(
        graph: AppGraph,
        companyId: String,
        me: Me,
        openConversation: @escaping (String) -> Void = { _ in }
    ) {
        self.graph = graph
        self.companyId = companyId
        self.me = me
        self.openConversation = openConversation
        self.manager = CallsManager.get(graph: graph)
        self.service = CallsService(api: graph.api)
        self.deletion = RecordDeletionRepository(api: graph.api)
    }

    var body: some View {
        callsColumn
        .overlay(alignment: .bottom) { noticeToast }
        .task(id: companyId) {
            manager.start(companyId: companyId, callerIdName: me.display_name)
        }
        .task(id: "\(companyId)|\(filter.rawValue)|\(reason ?? "")|\(refreshKey)") { await reload() }
        .onReceive(AppRouter.shared.$callsReason) { requested in
            guard let requested else { return }
            reason = isCallReasonFilter(requested) ? requested : nil
            filter = .all
            AppRouter.shared.callsReason = nil
        }
        .task(id: companyId) {
            // Realtime: the calls table's DB trigger broadcasts call.updated
            // (ID-only) on every session change — refetch the first page.
            for await event in await graph.realtime.events()
                where event.event == "call.updated" {
                refreshKey += 1
            }
        }
        .task(id: companyId) {
            for await _ in await graph.realtime.reconnected() {
                refreshKey += 1
            }
        }
        // #210: the roster only matters once a live call needs a name on it,
        // so the transfer picker's GET /v1/members read fires on the first
        // ongoing row (and again per company) — never on the quiet path.
        .task(id: "\(companyId)|\(ongoing.isEmpty)") {
            guard !ongoing.isEmpty else { return }
            guard let page = try? await service.members(companyId: companyId) else { return }
            members = page.data
        }
        // #459: the phone's own book, read once while this surface is alive.
        // Silent when access has never been granted — the dialer is not where
        // that permission is asked for. The Contacts tab asks, with the section
        // it buys already on screen; this just uses the answer.
        .task {
            deviceCandidates = await DeviceContactsAccess.load()
        }
        // #215 Part A: a call.updated missed while backgrounded self-heals on
        // foreground — the same first-page refetch the re-JOIN runs.
        .resyncOnForeground { refreshKey += 1 }
        // ONE presentation for the dialer and its "Add contact" create sheet:
        // swapping the item swaps content in place, so B never presents while A
        // is still dismissing (the dropped-second-sheet race).
        .sheet(item: $activeSheet) { sheet in
            switch sheet {
            case .dialer:
                DialerSheet(
                    manager: manager,
                    numbers: (me.company?.numbers ?? []).filter {
                        $0.status == NumberStatus.active && $0.number_e164 != nil
                    },
                    lookupMatches: { typed in await lookupMatches(typed) },
                    onAddContact: { e164 in activeSheet = .addContact(prefill: e164) },
                    // #459: the dialer's other three exits. A raw number for the
                    // text, because the point of dialing a stranger is that we
                    // have never met them.
                    onMessage: { number in AppRouter.shared.composeTo = number },
                    onOpenContact: { contactId in
                        AppRouter.shared.openContactId = contactId
                    },
                    onOpenContacts: { AppRouter.shared.openContacts = true }
                )
            case .addContact(let prefill):
                CreateContactSheet(
                    mutations: ContactMutations(
                        api: graph.api,
                        multipart: MultipartClient(api: graph.api, sessionStore: graph.sessionStore)
                    ),
                    companyId: companyId,
                    prefillPhone: prefill
                ) { _ in
                    activeSheet = nil
                }
            }
        }
    }

    /// #459: the phone's own address book, read ONCE while this surface is
    /// alive and never re-read per keystroke. Empty without permission, which
    /// is the honest degraded state: the dialer still correlates our own
    /// contacts, it just cannot name somebody only the phone knows.
    @State private var deviceCandidates: [DeviceContactListRow] = []

    /// The single calls-surface presentation (#186 item 5): the dialer and the
    /// create sheet it swaps to — never two simultaneous `.sheet` toggles.
    private enum CallsSheet: Identifiable {
        case dialer
        case addContact(prefill: String)

        var id: String {
            switch self {
            case .dialer: "dialer"
            case .addContact(let prefill): "add:\(prefill)"
            }
        }
    }

    /// #459: who the typed digits could be, best first.
    ///
    /// `t9: true` is what makes the keypad a name search — the server matches
    /// contact names by their keypad letters (2 is ABC, so 2-6-2 finds "Bob").
    /// The ranking then runs locally through the same matcher the browser and
    /// Android use, so all three agree on who is at the top of the list.
    ///
    /// The phone's own address book supplements ours when access has been
    /// granted (the Android twin's #183 behaviour, which iOS lacked until
    /// #459). App candidates go FIRST so they win ties: the crew's shared book
    /// is the source of truth and a personal phone entry fills the gaps.
    private func lookupMatches(_ typed: String) async -> [DialerMatch] {
        let app = (try? await graph.contactsApi.contacts(
            companyId: companyId, q: typed, limit: 10, t9: true
        ))?.data.map {
            DialerCandidate(
                name: $0.name, number: $0.phone_e164, source: .app, contactId: $0.id
            )
        } ?? []
        let device = deviceCandidates.map {
            DialerCandidate(name: $0.name, number: $0.number, source: .device)
        }
        return rankDialerCandidates(typed: typed, candidates: app + device)
    }

    private var header: some View {
        CallsHeaderBar(
            status: manager.state.status,
            onRetry: manager.retryNow
        )
    }

    private var filterPills: some View {
        CallsFilterTabs(selected: filter) { next in
            filter = next
        }
    }

    private var emptyCopy: String {
        switch filter {
        case .missed: t("contactsTasks.noMissedCalls")
        case .voicemail: t("contactsTasks.noVoicemailsYet")
        case .all: t("contactsTasks.noCallsYetLog")
        }
    }

    @ViewBuilder
    private var content: some View {
        switch state {
        case .loading:
            ListSkeleton(rows: 7, avatar: true, lines: 2)
        case .failed(let message):
            LoadError(message: message) { refreshKey += 1 }
        case .ready(let calls):
            // #210: in-flight rows live in the pinned card above, not the log;
            // each drops back in here the moment its outcome is stamped.
            callLog(resolvedCalls(calls))
        }
    }

    private var callsColumn: some View {
        VStack(spacing: 0) {
            header

            // #210: who is holding which line RIGHT NOW — pinned above the
            // filter rail whenever the company has in-flight rows, absent
            // entirely when it has none (it never takes space at rest).
            if !ongoing.isEmpty {
                OngoingCallsCard(
                    calls: ongoing,
                    members: members,
                    numbers: me.company?.numbers ?? [],
                    openConversation: openConversation
                )
                .padding(.horizontal, 18)
                .padding(.top, 12)
            }

            filterPills
                .padding(.horizontal, 18)
                .padding(.vertical, 10)

            if let reason {
                ReasonChip(label: callReasonLabel(reason, appLocale)) {
                    Haptics.tap()
                    self.reason = nil
                }
                .padding(.horizontal, 18)
                .padding(.bottom, 4)
            }

            content
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(BrandColor.canvas)
        // #732: Dial is the tab's one main action, the shared button.
        .mainAction(
            systemImage: "circle.grid.3x3",
            label: t("contactsTasks.dialANumber")
        ) {
            activeSheet = .dialer
        }
    }

    // MARK: - Deleting (#691)

    /// Deleting is its own capability; a member without it never sees the item.
    private var canDeleteRecords: Bool {
        let role = me.memberships
            .first(where: { $0.company_id == companyId })?.role
        return RecordDeletion.canDelete(role: role)
    }

    /// #712: the call's one action list. The row's long-press menu draws it, so
    /// a member without `records.delete` never sees either delete, and a call with
    /// no voicemail has no voicemail to delete on its own.
    private func recordActions(for call: Call) -> [RecordAction] {
        callActions(
            CallActionsInput(
                hasConversation: call.conversation_id != nil,
                hasContact: call.contact_id != nil,
                callerE164: call.caller_e164,
                hasVoicemail: call.outcome == CallOutcome.voicemail
                    && (call.voicemail_seconds ?? 0) > 0,
                canDelete: canDeleteRecords
            )
        )
    }

    private func performAction(_ actionId: String, for call: Call) {
        switch actionId {
        case CallActionId.callBack:
            callBack(call)
        case CallActionId.text:
            messageCall(call)
        case CallActionId.copyNumber:
            Haptics.tap()
            UIPasteboard.general.string = call.caller_e164
            showNotice(t("recordMenu.numberCopied"))
        case CallActionId.deleteVoicemail:
            Haptics.tap()
            deleteRecord(call, kind: .voicemail)
        case CallActionId.deleteCall:
            Haptics.tap()
            deleteRecord(call, kind: .call)
        default:
            break
        }
    }

    /// Mic first, then authorize: a denial never reserves the line.
    private func callBack(_ call: Call) {
        Haptics.confirm()
        let place: @MainActor () -> Void = {
            Task {
                do {
                    try await manager.placeCall(
                        displayName: callerDisplayName(call),
                        conversationId: call.conversation_id,
                        contactId: call.contact_id,
                        to: call.conversation_id == nil && call.contact_id == nil
                            ? call.caller_e164
                            : nil
                    )
                } catch {
                    showNotice(error.userMessage)
                }
            }
        }
        if manager.hasMicPermission {
            place()
            return
        }
        Task {
            if await manager.requestMicPermission() {
                place()
            } else {
                showNotice(t("contactsTasks.micNeededToPlace"))
            }
        }
    }

    /// Both go to the Trash, so the toast carries an Undo that restores it. No
    /// confirmation: it is reversible and the Trash holds it for 30 days.
    private func deleteRecord(_ call: Call, kind: TrashKind) {
        Task {
            do {
                if kind == .voicemail {
                    try await deletion.deleteVoicemail(companyId: companyId, callId: call.id)
                } else {
                    try await deletion.deleteCall(companyId: companyId, callId: call.id)
                    if case .ready(let calls) = state {
                        state = .ready(calls.filter { $0.id != call.id })
                    }
                }
                refreshKey += 1
                let key = kind == .voicemail ? "thread.voicemailDeleted" : "thread.callDeleted"
                showNotice(
                    t(key),
                    actionLabel: t("thread.undo"),
                    trashLabel: t("trash.viewTrash")
                ) {
                    restoreRecord(call, kind: kind)
                }
            } catch {
                showNotice(error.userMessage)
            }
        }
    }

    private func restoreRecord(_ call: Call, kind: TrashKind) {
        Task {
            do {
                try await deletion.restore(companyId: companyId, kind: kind, id: call.id)
                refreshKey += 1
                showNotice(t(RecordDeletion.restoredKey(kind)))
            } catch {
                let status = (error as? ApiError)?.httpStatus ?? 0
                if let key = RecordDeletion.restoreFailureKey(httpStatus: status) {
                    showNotice(t(key))
                } else {
                    showNotice(error.userMessage)
                }
            }
        }
    }

    private func showNotice(
        _ text: String,
        actionLabel: String? = nil,
        trashLabel: String? = nil,
        action: (@MainActor () -> Void)? = nil
    ) {
        noticeSeq += 1
        notice = ThreadNotice(
            id: noticeSeq,
            text: text,
            actionLabel: actionLabel,
            action: action,
            trashLabel: trashLabel
        )
        noticeDismissTask?.cancel()
        let shownSeq = noticeSeq
        noticeDismissTask = Task {
            // An undoable notice stays up longer (docs/UNDO-AUDIT.md).
            try? await Task.sleep(for: .seconds(actionLabel == nil ? 3 : 10))
            if !Task.isCancelled, noticeSeq == shownSeq { notice = nil }
        }
    }

    @ViewBuilder
    private var noticeToast: some View {
        if let shown = notice {
            HStack(spacing: 12) {
                Text(shown.text)
                    .font(.golos(12.5))
                    .foregroundStyle(BrandColor.ink)
                    .lineLimit(2)
                if let label = shown.actionLabel {
                    Button(label) {
                        shown.action?()
                        notice = nil
                    }
                    .font(.golos(12.5, weight: .semibold))
                    .foregroundStyle(BrandColor.olive)
                }
                // #710: a delete notice also leads to the Trash.
                if let trashLabel = shown.trashLabel {
                    Button(trashLabel) {
                        openURL(RecordDeletion.trashURL)
                        notice = nil
                    }
                    .font(.golos(12.5, weight: .semibold))
                    .foregroundStyle(BrandColor.olive)
                }
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 10)
            .background(.regularMaterial, in: Capsule())
            .padding(.bottom, 12)
            .onTapGesture { notice = nil }
        }
    }

    /// D64: "Make a task" on an answered call that landed in a conversation.
    private func makeTaskButton(for call: Call) -> AnyView? {
        guard call.outcome == CallOutcome.answered,
              let conversationId = call.conversation_id
        else { return nil }
        return AnyView(
            CallTaskButton(
                graph: graph,
                companyId: companyId,
                conversationId: conversationId,
                callerName: callerDisplayName(call),
                callId: call.id
            )
        )
    }

    /// The resolved log itself, split out so the `content` switch stays one
    /// expression per case (this file has already lost the type checker once).
    @ViewBuilder
    private func callLog(_ calls: [Call]) -> some View {
        if calls.isEmpty {
            if ongoing.isEmpty {
                EmptyState(title: emptyCopy, fill: true)
            } else {
                // With a live call pinned above, "No calls yet" would
                // contradict the screen — stay quiet and let the card talk.
                Spacer()
            }
        } else {
            ScrollView {
                VStack(spacing: 14) {
                    PaperCard {
                        ForEach(calls, id: \.id) { call in
                            CallRow(
                                call: call,
                                service: service,
                                companyId: companyId,
                                rowActions: callRowActions(call),
                                makeTask: makeTaskButton(for: call),
                                actions: recordActions(for: call),
                                onAction: { actionId in performAction(actionId, for: call) },
                                onRowAction: rowActionHandler(for: call)
                            )
                            if call.id != calls.last?.id {
                                RowDivider().padding(.leading, 64)
                            }
                        }
                    }
                    if nextCursor != nil {
                        HStack {
                            Spacer()
                            if loadingMore {
                                ProgressView()
                            } else {
                                Button(t("contactsTasks.loadMore")) { loadMore() }
                                    .font(.golos(12, weight: .semibold))
                                    .foregroundStyle(BrandColor.olive)
                            }
                            Spacer()
                        }
                        .padding(.vertical, 4)
                    }
                }
                .padding(.horizontal, 18)
                .padding(.bottom, 24)
            }
        }
    }

    /// #734: the row goes nowhere; its actions do. Extracted with an explicit
    /// type — a closure built inline inside the ForEach made swiftc's type
    /// checker give up ("failed to produce diagnostic", CI run 5).
    private func rowActionHandler(for call: Call) -> @MainActor (CallRowAction) -> Void {
        return { action in performRowAction(action, for: call) }
    }

    private func performRowAction(_ action: CallRowAction, for call: Call) {
        switch action {
        case .message:
            messageCall(call)
        case .callBack:
            callBack(call)
        case .contact:
            if let id = call.contact_id { AppRouter.shared.openContactId = id }
        case .addContact:
            if let number = call.caller_e164 { activeSheet = .addContact(prefill: number) }
        case .details:
            AppRouter.shared.openCallSessionId = call.call_session_id
        case .task:
            break
        }
    }

    /// Message opens the conversation, or starts a new text to the number.
    private func messageCall(_ call: Call) {
        Haptics.tap()
        if let id = call.conversation_id {
            openConversation(id)
        } else if let number = call.caller_e164, !number.isBlank {
            AppRouter.shared.composeTo = number
        }
    }

    private func reload() async {
        do {
            let page = try await service.calls(
                companyId: companyId,
                outcome: filter.outcome,
                reason: reason
            )
            nextCursor = page.next_cursor
            state = .ready(page.data)
            // On the default pill the page just fetched IS the ongoing source,
            // so the pinned card costs no second request.
            if filter == .all && reason == nil { ongoing = ongoingCalls(page.data) }
        } catch {
            if case .ready = state {
                // Keep the stale list on a quiet refetch failure.
            } else {
                state = .failed(error.userMessage)
            }
        }
        // #210: an `outcome=` page can never carry an in-flight row (those have
        // no outcome yet), so a narrow pill reads the unfiltered log as well —
        // otherwise the live call would vanish the moment Missed is tapped. A
        // failure here just leaves the last known card up, never an error.
        if filter != .all || reason != nil,
           let page = try? await service.calls(companyId: companyId) {
            ongoing = ongoingCalls(page.data)
        }
    }

    private func loadMore() {
        guard let cursor = nextCursor, !loadingMore else { return }
        loadingMore = true
        Task {
            defer { loadingMore = false }
            do {
                let page = try await service.calls(
                    companyId: companyId,
                    outcome: filter.outcome,
                    cursor: cursor,
                    reason: reason
                )
                nextCursor = page.next_cursor
                if case .ready(let existing) = state {
                    let seen = Set(existing.map(\.id))
                    state = .ready(existing + page.data.filter { !seen.contains($0.id) })
                }
            } catch {
                // Keep what's loaded; the button stays.
            }
        }
    }
}

/// The Calls header: the title with the softphone status, and the line saying calls
/// ring while the app is open. A view of its own so the accessibility audit draws the
/// same header the screen does.
private struct CallsHeaderBar: View {
    let status: SoftphoneStatus
    let onRetry: @MainActor () -> Void

    @Environment(\.appLocale) private var appLocale

    var body: some View {
        HStack(alignment: .center, spacing: 10) {
            VStack(alignment: .leading, spacing: 3) {
                HStack(alignment: .firstTextBaseline, spacing: 9) {
                    ScreenTitle(text: AppStrings.translate(appLocale, "contactsTasks.callsTitle"))
                    SoftphoneStatusPill(status: status, onRetry: onRetry)
                }
                // Honest until the founder uploads a Telnyx VoIP push
                // credential — without it, nothing rings a closed app.
                Text(AppStrings.translate(appLocale, "contactsTasks.callsRingWhileOpen"))
                    .font(.golos(11))
                    .foregroundStyle(BrandColor.muted500)
            }
            Spacer()
        }
        .padding(.horizontal, 18)
        .padding(.top, 16)
        .padding(.bottom, 4)
    }
}

/// The All / Missed / Voicemail tabs, drawn by the shared segmented control.
private struct CallsFilterTabs: View {
    let selected: CallsFilter
    let onSelect: @MainActor (CallsFilter) -> Void

    @Environment(\.appLocale) private var appLocale

    private var options: [SegmentedOption<CallsFilter>] {
        CallsFilter.allCases.map { item in
            SegmentedOption(item, title: AppStrings.translate(appLocale, item.labelKey))
        }
    }

    var body: some View {
        HStack(spacing: 0) {
            SegmentedControl(
                options: options,
                selected: selected,
                size: .compact,
                fill: false,
                onSelect: onSelect
            )
            Spacer(minLength: 0)
        }
    }
}

/// Ready / Connecting / Offline — one calm status line (lime dot + olive text
/// when the line is ready, spec 25), tap retries when down.
private struct SoftphoneStatusPill: View {
    let status: SoftphoneStatus
    let onRetry: @MainActor () -> Void

    @Environment(\.appLocale) private var appLocale

    private var label: String {
        switch status {
        case .ready: AppStrings.translate(appLocale, "contactsTasks.readyToRing")
        case .connecting: AppStrings.translate(appLocale, "contactsTasks.connecting")
        case .disconnected: AppStrings.translate(appLocale, "contactsTasks.offlineRetry")
        }
    }

    private var dotColor: Color {
        switch status {
        case .ready: BrandColor.lime
        case .connecting: BrandColor.muted400
        case .disconnected: BrandColor.overdueAmber
        }
    }

    private var textColor: Color {
        switch status {
        case .ready: BrandColor.olive
        case .connecting: BrandColor.muted500
        case .disconnected: BrandColor.overdueAmber
        }
    }

    var body: some View {
        Button {
            if status == .disconnected { onRetry() }
        } label: {
            HStack(spacing: 5) {
                Circle()
                    .fill(dotColor)
                    .frame(width: 6, height: 6)
                Text(label)
                    .font(.golos(11, weight: .semibold))
                    .foregroundStyle(textColor)
            }
        }
        .buttonStyle(.plain)
    }
}

/// #210: the Ongoing card — the founder's "who is on my line?" answer. Rows
/// stack when several calls run at once (each business line can hold one);
/// the section is absent entirely when nothing is in flight.
private struct OngoingCallsCard: View {
    let calls: [Call]
    let members: [Member]
    let numbers: [PhoneNumberSummary]
    let openConversation: (String) -> Void

    @Environment(\.appLocale) private var appLocale

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            SectionHeader(
                label: AppStrings.translate(appLocale, "contactsTasks.ongoing"),
                count: calls.count > 1 ? calls.count : nil
            )
            PaperCard {
                ForEach(calls, id: \.id) { call in
                    OngoingCallRow(
                        call: call,
                        members: members,
                        numbers: numbers,
                        openConversation: openConversation
                    )
                    if call.id != calls.last?.id {
                        RowDivider().padding(.leading, 64)
                    }
                }
            }
        }
    }
}

/// One live line: caller identity, the member holding it (or "Ringing…"
/// before anyone does), the business number when the company owns more than
/// one, and — for answered calls — the live talk timer. Tapping opens the
/// caller's conversation when one exists.
private struct OngoingCallRow: View {
    let call: Call
    let members: [Member]
    let numbers: [PhoneNumberSummary]
    let openConversation: (String) -> Void

    @Environment(\.appLocale) private var appLocale

    private var name: String { callerDisplayName(call) }

    private var phase: OngoingPhase { ongoingPhase(call) }

    var body: some View {
        HStack(alignment: .center, spacing: 11) {
            InitialsAvatar(name: name, size: 38)
            VStack(alignment: .leading, spacing: 2) {
                Text(name)
                    .font(.golos(13.5, weight: .semibold))
                    .foregroundStyle(BrandColor.ink)
                    .lineLimit(1)
                HStack(spacing: 6) {
                    // The card's one tinted element — the same coral the app
                    // reserves for live/attention accents, never an error red.
                    Text(ongoingStatusLabel(
                        phase,
                        memberName: memberDisplayName(call.answered_by_user_id, in: members),
                        appLocale
                    ))
                    .font(.golos(11.5, weight: .semibold))
                    .foregroundStyle(BrandColor.coral)
                    .lineLimit(1)
                    if let label = ongoingNumberLabel(call.phone_number_id, in: numbers) {
                        DsChip(
                            text: label,
                            container: BrandColor.inset,
                            content: BrandColor.muted600
                        )
                    }
                }
            }
            Spacer(minLength: 8)
            if ongoingShowsTimer(phase) {
                OngoingTicker(anchorIso: ongoingAnchorIso(call))
            } else {
                AttentionDot()
            }
        }
        .padding(.horizontal, 15)
        .padding(.top, 11)
        .padding(.bottom, 10)
        .contentShape(Rectangle())
        .onTapGesture {
            if let id = call.conversation_id { openConversation(id) }
        }
    }
}

/// The one thing that moves every second — a TimelineView so the tick redraws
/// exactly this label, never the card or the log behind it (#210). An anchor
/// that won't parse renders nothing rather than a frozen 0:00.
private struct OngoingTicker: View {
    let anchorIso: String

    var body: some View {
        if let anchor = parseWireTimestamp(anchorIso) {
            TimelineView(.periodic(from: .now, by: 1)) { context in
                Text(formatTimer(
                    elapsedMs: Int(context.date.timeIntervalSince(anchor) * 1000)
                ))
                .font(.golos(12, weight: .semibold))
                .foregroundStyle(BrandColor.coral)
                .monospacedDigit()
            }
        }
    }
}

private struct CallRow: View {
    let call: Call
    let service: CallsService
    let companyId: String
    /// #734: the compact actions under the row. Defaulted, so the previews that
    /// omit it keep compiling.
    var rowActions: [CallRowAction] = []
    /// D64: "Make a task", offered on an answered call that has a conversation.
    /// After the required `let`s and defaulted, so the call sites and previews
    /// that omit it keep compiling.
    var makeTask: AnyView?
    /// #712: this call's action list, and what to do with the id that was chosen. Empty
    /// means no menu at all.
    var actions: [RecordAction] = []
    var onAction: (@MainActor (String) -> Void)?
    var onRowAction: (@MainActor (CallRowAction) -> Void)?

    /// #228: AFTER the required `let`s, so the memberwise init every call site
    /// above uses keeps the same argument order.
    @Environment(\.appLocale) private var appLocale

    private var name: String { callerDisplayName(call) }

    private var directionIcon: String {
        call.direction == "outbound" ? "phone.arrow.up.right" : "phone.arrow.down.left"
    }

    private var metaColor: Color {
        isActionableMiss(call) ? BrandColor.overdueAmber : BrandColor.muted500
    }

    private var showsVoicemail: Bool {
        call.outcome == CallOutcome.voicemail && (call.voicemail_seconds ?? 0) > 0
    }

    /// The transcript, or nil when there is nothing worth showing under the
    /// player. A blank string is the same as none.
    private var transcript: String? {
        guard let text = call.voicemail_transcript, !text.isBlank else { return nil }
        return text
    }

    /// #367: the rows worth drawing — present fields only, in the shared order.
    /// Empty means the block is not rendered at all, rather than a titled box
    /// with nothing in it.
    private var intakeLines: [VoicemailIntakeLine] {
        // `localisedLines` rather than the `lines` property beside it: a
        // property cannot take the reader's language, and the labels on these
        // rows ("Problem", "Address") are ours rather than the caller's words.
        call.voicemail_intake?.localisedLines(appLocale) ?? []
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(alignment: .center, spacing: 11) {
                InitialsAvatar(name: name, size: 38)
                VStack(alignment: .leading, spacing: 2) {
                    Text(name)
                        .font(.golos(13.5, weight: .semibold))
                        .foregroundStyle(BrandColor.ink)
                        .lineLimit(1)
                    HStack(spacing: 6) {
                        Image(systemName: directionIcon)
                            .font(.scaled(11, weight: .medium))
                            .foregroundStyle(metaColor)
                        // #566: the screening mark comes BEFORE the outcome and
                        // holds its size. It is a judgement about the CALLER, not
                        // about how the call went, so it reads first — it says
                        // whether the rest of the line is worth reading. Its text
                        // is a fixed literal ("Spam likely"), so giving it
                        // priority costs nothing.
                        if let label = screeningLabel(call.screening_result, callerName: call.caller_name) {
                            DsChip(
                                text: label,
                                container: BrandColor.inset,
                                content: BrandColor.muted600
                            )
                            .fixedSize()
                            .layoutPriority(1)
                        }
                        // #566: THE one element allowed to yield. This renders
                        // "Answered by <display_name> · 4m 32s" and display_name
                        // is capped at 80 characters (routes/me.ts), so it reaches
                        // ~100. With no lineLimit it wrapped to two or three lines,
                        // grew the row, and floated the avatar and timestamp to the
                        // middle of it.
                        Text(callOutcomeLabel(call))
                            .font(.golos(
                                11.5,
                                weight: isActionableMiss(call) ? .semibold : .regular
                            ))
                            .foregroundStyle(metaColor)
                            .lineLimit(1)
                            .truncationMode(.tail)
                    }
                }
                Spacer(minLength: 8)
                Text(relativeTime(call.started_at))
                    .exactTime(call.started_at)
                    .font(.golos(11))
                    .foregroundStyle(BrandColor.muted300)
                    .monospacedDigit()
                    // #566: at the largest Dynamic Type sizes this wrapped and
                    // grew the row on its own. `relativeTime` emits "now"/"5m"/
                    // "3h"/"3d" and, past a week, "Jul 16" or "Jul 16 2025" — the
                    // dated forms being the widest at ~11 characters, which is what
                    // `fixedSize` reserves from the name beside it. None of them
                    // reads better broken in two.
                    .lineLimit(1)
                    .fixedSize(horizontal: true, vertical: false)
            }
            .padding(.horizontal, 15)
            .padding(.top, 11)
            .padding(.bottom, 2)
            CallRowActionBar(
                actions: rowActions,
                name: name,
                task: makeTask,
                onAction: onRowAction
            )
            .padding(.leading, 56)
            .padding(.trailing, 8)
            .padding(.bottom, showsVoicemail ? 2 : 6)
            if showsVoicemail {
                VoicemailPlayerRow(
                    service: service,
                    companyId: companyId,
                    sessionId: call.call_session_id,
                    seconds: call.voicemail_seconds ?? 0,
                    transcriptShown: transcript != nil
                )
                .padding(.leading, 64)
                .padding(.trailing, 15)
                .padding(.bottom, transcript == nil && intakeLines.isEmpty ? 12 : 6)
                // #367: the two lines that answer "do I need to call back",
                // ABOVE the transcript they were read out of. A shortcut
                // printed after the thing it shortens is not one.
                if !intakeLines.isEmpty {
                    VoicemailIntakeSummary(lines: intakeLines)
                        .padding(.leading, 64)
                        .padding(.trailing, 15)
                        .padding(.bottom, transcript == nil ? 12 : 4)
                }
                // What it says, for the times playing it is not an option: on
                // a roof, in a truck, next to a running compressor. The player
                // stays above it: the recording is the record, this is the
                // shortcut.
                if let transcript {
                    VoicemailTranscript(text: transcript)
                        .fixedSize(horizontal: false, vertical: true)
                        .padding(.leading, 64)
                        .padding(.trailing, 15)
                        .padding(.bottom, 12)
                }
            }
        }
        // #734: a tap goes nowhere; only the actions do.
        // #712: long-press draws the call's one action list. The time's own long-press
        // yields to it, so the menu leads with the exact time instead.
        .recordContextMenu(
            actions,
            exactTime: TimestampFormat.exact(call.started_at, locale: appLocale)
        ) { actionId, _ in
            onAction?(actionId)
        }
    }
}

/// #734: what a call row offers, each its own 48pt control. Icons only, so the
/// row stays one quiet line on a phone; each carries its name for VoiceOver.
/// The Task action is drawn by `task`, which owns its sheet.
private struct CallRowActionBar: View {
    let actions: [CallRowAction]
    let name: String
    let task: AnyView?
    let onAction: (@MainActor (CallRowAction) -> Void)?

    @Environment(\.appLocale) private var appLocale

    private func symbol(_ action: CallRowAction) -> String {
        switch action {
        case .message: "message"
        case .callBack: "phone"
        case .contact: "person"
        case .addContact: "person.badge.plus"
        case .task: "checklist"
        case .details: "info.circle"
        }
    }

    private func label(_ action: CallRowAction) -> String {
        AppStrings.translate(appLocale, callRowActionLabelKey(action)) + ", " + name
    }

    var body: some View {
        HStack(spacing: 0) {
            ForEach(actions, id: \.self) { action in
                if action == .task {
                    if let task { task }
                } else {
                    Button {
                        Haptics.tap()
                        onAction?(action)
                    } label: {
                        Image(systemName: symbol(action))
                            .font(.scaled(15, weight: .medium))
                            .foregroundStyle(BrandColor.muted600)
                            .frame(width: 48, height: 48)
                            .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel(label(action))
                }
            }
            Spacer(minLength: 0)
        }
    }
}

/// #725: the removable chip for the reason the log is narrowed to.
private struct ReasonChip: View {
    let label: String
    let onRemove: @MainActor () -> Void

    @Environment(\.appLocale) private var appLocale

    var body: some View {
        HStack {
            HStack(spacing: 0) {
                Text(label)
                    .font(.golos(12, weight: .medium))
                    .foregroundStyle(BrandColor.muted900)
                    .padding(.leading, 12)
                Button {
                    onRemove()
                } label: {
                    Image(systemName: "xmark")
                        .font(.scaled(11, weight: .semibold))
                        .foregroundStyle(BrandColor.muted600)
                        .frame(width: 44, height: 44)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel(
                    AppStrings.translate(appLocale, "inbox.removeFilterAria", ["label": label])
                )
            }
            .background(BrandColor.avatarTint, in: Capsule())
            Spacer()
        }
    }
}

/// Inline voicemail playback: mint the 1h signed URL on demand (never
/// cached), stream via AVPlayer with seek + live progress. Spec 25 pill:
/// inset capsule, ink play circle, muted tabular time.
struct VoicemailPlayerRow: View {
    let service: CallsService
    let companyId: String
    let sessionId: String
    let seconds: Int
    /// The row already shows the words, so the player must not repeat them.
    let transcriptShown: Bool

    @State private var backfilledTranscript: String?
    @State private var player: AVPlayer?
    @State private var preparing = false
    @State private var playing = false
    @State private var positionMs = 0
    @State private var durationMs: Int
    @State private var scrubbing = false
    @State private var errorText: String?

    @Environment(\.appLocale) private var appLocale

    init(
        service: CallsService,
        companyId: String,
        sessionId: String,
        seconds: Int,
        transcriptShown: Bool
    ) {
        self.service = service
        self.companyId = companyId
        self.sessionId = sessionId
        self.seconds = seconds
        self.transcriptShown = transcriptShown
        _durationMs = State(initialValue: max(1, seconds * 1000))
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(spacing: 9) {
                Button(action: togglePlayback) {
                    Group {
                        if preparing {
                            ProgressView()
                                .controlSize(.small)
                                .tint(BrandColor.paper)
                        } else {
                            Image(systemName: playing ? "pause.fill" : "play.fill")
                                .font(.scaled(11, weight: .bold))
                                .foregroundStyle(BrandColor.paper)
                        }
                    }
                    .frame(width: 28, height: 28)
                    .background(BrandColor.ink, in: Circle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel(
                    playing
                        ? AppStrings.translate(appLocale, "contactsTasks.pauseVoicemail")
                        : AppStrings.translate(appLocale, "contactsTasks.playVoicemail")
                )

                Slider(
                    value: Binding(
                        get: { Double(min(positionMs, durationMs)) },
                        set: { positionMs = Int($0) }
                    ),
                    in: 0 ... Double(durationMs)
                ) { editing in
                    scrubbing = editing
                    if !editing, let player {
                        player.seek(to: CMTime(
                            value: CMTimeValue(positionMs),
                            timescale: 1000
                        ))
                    }
                }
                .tint(BrandColor.olive)
                .disabled(player == nil)

                Text("\(formatTimer(elapsedMs: positionMs)) / \(formatVoicemailLength(seconds))")
                    .font(.golos(10.5, weight: .semibold))
                    .foregroundStyle(BrandColor.muted600)
                    .monospacedDigit()
            }
            .padding(.vertical, 6)
            .padding(.leading, 6)
            .padding(.trailing, 14)
            .background(BrandColor.inset, in: Capsule())
            if let errorText {
                Text(errorText)
                    .font(.golos(10.5))
                    .foregroundStyle(BrandColor.muted500)
            }
            if let backfilledTranscript {
                VoicemailTranscript(text: backfilledTranscript)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .task(id: playing) {
            // Poll position while playing (the Android twin does the same).
            while playing {
                if !scrubbing, let player {
                    let current = player.currentTime().seconds
                    if current.isFinite { positionMs = Int(current * 1000) }
                    if let item = player.currentItem {
                        let total = item.duration.seconds
                        if total.isFinite && total > 0 { durationMs = Int(total * 1000) }
                        if item.error != nil {
                            errorText = AppStrings.translate(
                                appLocale, "contactsTasks.voicemailPlayFailed"
                            )
                            playing = false
                        }
                    }
                    if positionMs >= durationMs - 150 {
                        // Finished — a replay restarts from the top.
                        positionMs = durationMs
                        playing = false
                        player.pause()
                    }
                }
                try? await Task.sleep(for: .milliseconds(200))
            }
        }
        .onDisappear {
            player?.pause()
            player = nil
            playing = false
        }
    }

    private func togglePlayback() {
        if preparing { return }
        if playing {
            player?.pause()
            playing = false
            return
        }
        if let player {
            if positionMs >= durationMs - 150 {
                player.seek(to: .zero)
                positionMs = 0
            }
            player.play()
            playing = true
            return
        }
        beginPlayback()
    }

    private func beginPlayback() {
        errorText = nil
        preparing = true
        Task {
            defer { preparing = false }
            do {
                // Signed URL minted per playback — NEVER cached (SPEC).
                let playback = try await service.voicemail(
                    companyId: companyId,
                    sessionId: sessionId
                )
                guard let url = URL(string: playback.url) else {
                    errorText = AppStrings.translate(
                        appLocale, "contactsTasks.voicemailPlayFailed"
                    )
                    return
                }
                if !transcriptShown, let words = playback.transcript, !words.isBlank {
                    backfilledTranscript = words
                }
                let next = AVPlayer(url: url)
                player = next
                next.play()
                playing = true
            } catch {
                errorText = error.userMessage
            }
        }
    }
}

// MARK: - Previews (inline mock data — nothing fetches until a row is tapped)

private func previewCall(
    id: String,
    outcome: String?,
    direction: String = "inbound",
    contactName: String? = nil,
    callerName: String? = nil,
    callerE164: String? = nil,
    forwardSeconds: Int = 0,
    screening: String? = nil,
    voicemailSeconds: Int? = nil,
    startedAt: String = "2026-07-16T09:05:00Z",
    state: String? = nil,
    answeredBy: String? = nil,
    answeredAt: String? = nil
) -> Call {
    Call(
        id: id,
        call_session_id: "sess-\(id)",
        caller_e164: callerE164,
        contact_id: nil,
        contact_name: contactName,
        caller_name: callerName,
        phone_number_id: nil,
        conversation_id: "conv-\(id)",
        outcome: outcome,
        direction: direction,
        forward_seconds: forwardSeconds,
        screening_result: screening,
        stir_attestation: nil,
        voicemail_seconds: voicemailSeconds,
        answered_by_user_id: answeredBy,
        answered_by_name: nil,
        started_at: startedAt,
        state: state,
        answered_at: answeredAt
    )
}

#Preview("Call log rows") {
    callLogFixture()
}

/// The call log as a screen reader meets it: a missed, an answered, an outbound,
/// a voicemail and a screened-as-spam row. Shared by the preview and the #238
/// accessibility audit.
@MainActor
@ViewBuilder
func callLogFixture() -> some View {
    let service = CallsService(api: AppGraph().api)
    // Rows in the real list always carry their record menu (#712), which is what
    // takes the time's long-press, so the audit sees the row as people do.
    let menu = callActions(
        CallActionsInput(
            hasConversation: true,
            hasContact: false,
            callerE164: "+14155550188",
            hasVoicemail: false,
            canDelete: false
        )
    )
    VStack(spacing: 0) {
        CallsHeaderBar(status: .ready, onRetry: {})
        CallsFilterTabs(selected: .all, onSelect: { _ in })
            .padding(.horizontal, 18)
            .padding(.vertical, 10)
        callLogFixtureRows(service: service, menu: menu)
    }
    .frame(maxWidth: .infinity, maxHeight: .infinity)
    .background(BrandColor.canvas)
    .mainAction(
        systemImage: "circle.grid.3x3",
        label: AppStrings.translate(UiLocaleStore.shared.resolved, "contactsTasks.dialANumber")
    ) {}
}

@MainActor
private func callLogFixtureRows(service: CallsService, menu: [RecordAction]) -> some View {
    ScrollView {
        PaperCard {
            CallRow(
                call: previewCall(
                    id: "c1",
                    outcome: CallOutcome.missed,
                    contactName: "Dana Whitcomb"
                ),
                service: service,
                companyId: "company-1",
                actions: menu
            )
            RowDivider().padding(.leading, 64)
            CallRow(
                call: previewCall(
                    id: "c2",
                    outcome: CallOutcome.answered,
                    callerName: "ARI B",
                    callerE164: "+14155550188",
                    forwardSeconds: 272
                ),
                service: service,
                companyId: "company-1",
                actions: menu
            )
            RowDivider().padding(.leading, 64)
            CallRow(
                call: previewCall(
                    id: "c3",
                    outcome: CallOutcome.answered,
                    direction: "outbound",
                    contactName: "Marta Reyes",
                    forwardSeconds: 58
                ),
                service: service,
                companyId: "company-1",
                actions: menu
            )
            RowDivider().padding(.leading, 64)
            CallRow(
                call: previewCall(
                    id: "c4",
                    outcome: CallOutcome.voicemail,
                    callerE164: "+14155550134",
                    voicemailSeconds: 42
                ),
                service: service,
                companyId: "company-1",
                actions: menu
            )
            RowDivider().padding(.leading, 64)
            CallRow(
                call: previewCall(
                    id: "c5",
                    outcome: CallOutcome.missed,
                    callerE164: "+18005550100",
                    screening: "spam_likely"
                ),
                service: service,
                companyId: "company-1",
                actions: menu
            )
        }
        .padding(18)
    }
    .background(BrandColor.canvas)
}

#Preview("Ongoing calls") {
    // A live anchor: the ticker is the point of this card, so the preview
    // shows real elapsed talk time instead of years since a fixed date.
    let answeredAt = ISO8601DateFormatter().string(from: Date().addingTimeInterval(-192))
    OngoingCallsCard(
        calls: [
            previewCall(
                id: "live-1",
                outcome: nil,
                contactName: "Marta Reyes",
                state: "answered",
                answeredBy: "u1",
                answeredAt: answeredAt
            ),
            previewCall(
                id: "live-2",
                outcome: nil,
                callerE164: "+14155550188",
                state: "ringing"
            ),
        ],
        members: [
            Member(
                id: "m1",
                user_id: "u1",
                role: "member",
                deactivated_at: nil,
                created_at: "2026-07-01T00:00:00Z",
                display_name: "Dana"
            ),
        ],
        // A one-number company: the business-line chip stays off by design.
        numbers: [],
        openConversation: { _ in }
    )
    .padding(18)
    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
    .background(BrandColor.canvas)
}

#Preview("Status pill states") {
    VStack(spacing: 12) {
        SoftphoneStatusPill(status: .ready, onRetry: {})
        SoftphoneStatusPill(status: .connecting, onRetry: {})
        SoftphoneStatusPill(status: .disconnected, onRetry: {})
    }
    .padding()
    .background(BrandColor.canvas)
}
