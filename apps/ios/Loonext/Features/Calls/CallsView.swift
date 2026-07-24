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
                    lookupContact: { typed in await lookupContact(typed) },
                    onAddContact: { e164 in activeSheet = .addContact(prefill: e164) }
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

    /// Correlate typed digits with a saved contact (name shows live in the
    /// dialer). The server `q` matches name + phone; double-check the digits
    /// actually appear in the hit's number (the Android `lookupContact` twin).
    private func lookupContact(_ typed: String) async -> String? {
        guard let page = try? await graph.contactsApi.contacts(
            companyId: companyId, q: typed, limit: 5
        ) else { return nil }
        return dialerContactName(matching: typed, in: page.data)
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
            if calls.isEmpty {
                Text(emptyCopy)
                    .font(.golos(13))
                    .foregroundStyle(BrandColor.muted500)
                    .multilineTextAlignment(.center)
                    .padding(.horizontal, 32)
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
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
        } catch {
            if case .ready = state {
                // Keep the stale list on a quiet refetch failure.
            } else {
                state = .failed(error.userMessage)
            }
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
                    seconds: call.voicemail_seconds ?? 0
                )
                .padding(.leading, 64)
                .padding(.trailing, 15)
                .padding(.bottom, 12)
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

    @State private var player: AVPlayer?
    @State private var preparing = false
    @State private var playing = false
    @State private var positionMs = 0
    @State private var durationMs: Int
    @State private var scrubbing = false
    @State private var errorText: String?

    init(service: CallsService, companyId: String, sessionId: String, seconds: Int) {
        self.service = service
        self.companyId = companyId
        self.sessionId = sessionId
        self.seconds = seconds
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
    startedAt: String = "2026-07-16T09:05:00Z"
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
        answered_by_user_id: nil,
        answered_by_name: nil,
        started_at: startedAt
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

#Preview("Status pill states") {
    VStack(spacing: 12) {
        SoftphoneStatusPill(status: .ready, onRetry: {})
        SoftphoneStatusPill(status: .connecting, onRetry: {})
        SoftphoneStatusPill(status: .disconnected, onRetry: {})
    }
    .padding()
    .background(BrandColor.canvas)
}
