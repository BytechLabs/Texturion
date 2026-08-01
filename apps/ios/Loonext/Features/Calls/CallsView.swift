import SwiftUI
import AVFoundation

private enum CallsFilter: String, CaseIterable, Identifiable {
    case all = "All"
    case missed = "Missed"
    case voicemail = "Voicemail"

    var id: String { rawValue }

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

    @State private var filter: CallsFilter = .all
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
    }

    var body: some View {
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

            content
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(BrandColor.canvas)
        .task(id: companyId) {
            manager.start(companyId: companyId, callerIdName: me.display_name)
        }
        .task(id: "\(companyId)|\(filter.rawValue)|\(refreshKey)") { await reload() }
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
        HStack(alignment: .center, spacing: 10) {
            VStack(alignment: .leading, spacing: 3) {
                HStack(alignment: .firstTextBaseline, spacing: 9) {
                    ScreenTitle(text: "Calls")
                    SoftphoneStatusPill(
                        status: manager.state.status,
                        onRetry: manager.retryNow
                    )
                }
                // Honest until the founder uploads a Telnyx VoIP push
                // credential — without it, nothing rings a closed app.
                Text("Calls ring here while the app is open.")
                    .font(.golos(11))
                    .foregroundStyle(BrandColor.muted500)
            }
            Spacer()
            Button {
                activeSheet = .dialer
            } label: {
                Image(systemName: "circle.grid.3x3")
                    .font(.system(size: 17, weight: .medium))
                    .foregroundStyle(BrandColor.ink)
                    .frame(width: 44, height: 44)
                    .background(BrandColor.paper, in: Circle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Dial a number")
        }
        .padding(.horizontal, 18)
        .padding(.top, 16)
        .padding(.bottom, 4)
    }

    private var filterPills: some View {
        HStack(spacing: 7) {
            ForEach(CallsFilter.allCases) { item in
                let selected = filter == item
                Button {
                    filter = item
                } label: {
                    Text(item.rawValue)
                        .font(.golos(12, weight: selected ? .semibold : .medium))
                        .foregroundStyle(
                            selected ? BrandColor.muted900 : BrandColor.muted500
                        )
                        .padding(.horizontal, 15)
                        .padding(.vertical, 9)
                        .background(
                            selected ? BrandColor.avatarTint : BrandColor.paper,
                            in: Capsule()
                        )
                }
                .buttonStyle(.plain)
            }
            Spacer()
        }
    }

    private var emptyCopy: String {
        switch filter {
        case .missed: "No missed calls."
        case .voicemail: "No voicemails yet."
        case .all: "No calls yet. When customers call your number, they land here."
        }
    }

    @ViewBuilder
    private var content: some View {
        switch state {
        case .loading:
            CenteredLoading()
        case .failed(let message):
            CenteredError(message: message) { refreshKey += 1 }
        case .ready(let calls):
            // #210: in-flight rows live in the pinned card above, not the log;
            // each drops back in here the moment its outcome is stamped.
            callLog(resolvedCalls(calls))
        }
    }

    /// The resolved log itself, split out so the `content` switch stays one
    /// expression per case (this file has already lost the type checker once).
    @ViewBuilder
    private func callLog(_ calls: [Call]) -> some View {
        if calls.isEmpty {
            if ongoing.isEmpty {
                Text(emptyCopy)
                    .font(.golos(13))
                    .foregroundStyle(BrandColor.muted500)
                    .multilineTextAlignment(.center)
                    .padding(.horizontal, 32)
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
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
                                onOpen: openAction(for: call)
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
                                Button("Load more") { loadMore() }
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

    /// Extracted with explicit types — the inline Optional.map producing a
    /// closure-of-closure inside the ForEach made swiftc's type checker give
    /// up ("failed to produce diagnostic", CI run 5).
    private func openAction(for call: Call) -> (@MainActor () -> Void)? {
        guard let id = call.conversation_id else { return nil }
        return { openConversation(id) }
    }

    private func reload() async {
        do {
            let page = try await service.calls(companyId: companyId, outcome: filter.outcome)
            nextCursor = page.next_cursor
            state = .ready(page.data)
            // On the default pill the page just fetched IS the ongoing source,
            // so the pinned card costs no second request.
            if filter == .all { ongoing = ongoingCalls(page.data) }
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
        if filter != .all,
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
                    cursor: cursor
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

/// Ready / Connecting / Offline — one calm status line (lime dot + olive text
/// when the line is ready, spec 25), tap retries when down.
private struct SoftphoneStatusPill: View {
    let status: SoftphoneStatus
    let onRetry: @MainActor () -> Void

    private var label: String {
        switch status {
        case .ready: "Ready to ring"
        case .connecting: "Connecting…"
        case .disconnected: "Offline · retry"
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

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            SectionHeader(label: "Ongoing", count: calls.count > 1 ? calls.count : nil)
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
                        memberName: memberDisplayName(call.answered_by_user_id, in: members)
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
    let onOpen: (@MainActor () -> Void)?

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
        call.voicemail_intake?.lines ?? []
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
                            .font(.system(size: 11, weight: .medium))
                            .foregroundStyle(metaColor)
                        Text(callOutcomeLabel(call))
                            .font(.golos(
                                11.5,
                                weight: isActionableMiss(call) ? .semibold : .regular
                            ))
                            .foregroundStyle(metaColor)
                        if let label = screeningLabel(call.screening_result) {
                            DsChip(
                                text: label,
                                container: BrandColor.inset,
                                content: BrandColor.muted600
                            )
                        }
                    }
                }
                Spacer(minLength: 8)
                Text(relativeTime(call.started_at))
                    .font(.golos(11))
                    .foregroundStyle(BrandColor.muted300)
                    .monospacedDigit()
            }
            .padding(.horizontal, 15)
            .padding(.top, 11)
            .padding(.bottom, showsVoicemail ? 6 : 11)
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
                    Text(transcript)
                        .font(.golos(12.5))
                        .foregroundStyle(BrandColor.muted600)
                        .fixedSize(horizontal: false, vertical: true)
                        .padding(.leading, 64)
                        .padding(.trailing, 15)
                        .padding(.bottom, 12)
                }
            }
        }
        .contentShape(Rectangle())
        .onTapGesture {
            onOpen?()
        }
    }
}

/// Inline voicemail playback: mint the 1h signed URL on demand (never
/// cached), stream via AVPlayer with seek + live progress. Spec 25 pill:
/// inset capsule, ink play circle, muted tabular time.
private struct VoicemailPlayerRow: View {
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
                                .font(.system(size: 11, weight: .bold))
                                .foregroundStyle(BrandColor.paper)
                        }
                    }
                    .frame(width: 28, height: 28)
                    .background(BrandColor.ink, in: Circle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel(playing ? "Pause voicemail" : "Play voicemail")

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
                Text(backfilledTranscript)
                    .font(.golos(12))
                    .foregroundStyle(BrandColor.muted600)
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
                            errorText = "Couldn't play this voicemail."
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
                    errorText = "Couldn't play this voicemail."
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
    let service = CallsService(api: AppGraph().api)
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
                onOpen: nil
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
                onOpen: nil
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
                onOpen: nil
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
                onOpen: nil
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
                onOpen: nil
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
