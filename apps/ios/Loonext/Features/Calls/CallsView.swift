import SwiftUI
import AVFoundation

private enum CallsFilter: String, CaseIterable, Identifiable {
    case all = "All"
    case missed = "Missed"

    var id: String { rawValue }

    var outcome: String? {
        switch self {
        case .all: nil
        case .missed: CallOutcome.missed
        }
    }
}

/// The calls surface (#161): softphone status pill, All|Missed log
/// (cursor-paged), outcome rows, voicemail playback, realtime call.updated
/// refresh, and the dialer. Registering the softphone here (and in
/// `CallsOverlay`) is what makes this member ring-eligible.
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
    @State private var dialerOpen = false

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

            Picker("Filter", selection: $filter) {
                ForEach(CallsFilter.allCases) { item in
                    Text(item.rawValue).tag(item)
                }
            }
            .pickerStyle(.segmented)
            .padding(.horizontal, 16)
            .padding(.vertical, 10)

            content
        }
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
        .sheet(isPresented: $dialerOpen) {
            DialerSheet(
                manager: manager,
                numbers: (me.company?.numbers ?? []).filter {
                    $0.status == NumberStatus.active && $0.number_e164 != nil
                }
            )
        }
    }

    private var header: some View {
        HStack(alignment: .center, spacing: 10) {
            VStack(alignment: .leading, spacing: 2) {
                Text("Calls")
                    .font(.title2.weight(.semibold))
                // Honest until the founder uploads a Telnyx VoIP push
                // credential — without it, nothing rings a closed app.
                Text("Calls ring here while the app is open.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            Spacer()
            SoftphoneStatusPill(status: manager.state.status, onRetry: manager.retryNow)
            Button {
                dialerOpen = true
            } label: {
                Image(systemName: "circle.grid.3x3.fill")
                    .font(.body)
            }
            .accessibilityLabel("Dial a number")
        }
        .padding(.horizontal, 20)
        .padding(.top, 16)
        .padding(.bottom, 4)
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
                Text(
                    filter == .missed
                        ? "No missed calls."
                        : "No calls yet. When customers call your number, they land here."
                )
                .font(.body)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
                .padding(.horizontal, 32)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else {
                List {
                    ForEach(calls, id: \.id) { call in
                        CallRow(
                            call: call,
                            service: service,
                            companyId: companyId,
                            onOpen: call.conversation_id.map { id in
                                { openConversation(id) }
                            }
                        )
                    }
                    if nextCursor != nil {
                        HStack {
                            Spacer()
                            if loadingMore {
                                ProgressView()
                            } else {
                                Button("Load more") { loadMore() }
                                    .font(.subheadline)
                            }
                            Spacer()
                        }
                        .padding(.vertical, 4)
                        .listRowSeparator(.hidden)
                    }
                }
                .listStyle(.plain)
            }
        }
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

/// Ready / Connecting / Offline — one calm pill, tap retries when down.
private struct SoftphoneStatusPill: View {
    let status: SoftphoneStatus
    let onRetry: @MainActor () -> Void

    private var label: String {
        switch status {
        case .ready: "Ready"
        case .connecting: "Connecting…"
        case .disconnected: "Offline · retry"
        }
    }

    private var dotColor: Color {
        switch status {
        case .ready: BrandColor.petrol
        case .connecting: Color.secondary
        case .disconnected: BrandColor.overdueAmber
        }
    }

    var body: some View {
        Button {
            if status == .disconnected { onRetry() }
        } label: {
            HStack(spacing: 6) {
                Circle()
                    .fill(dotColor)
                    .frame(width: 7, height: 7)
                Text(label)
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            .padding(.horizontal, 10)
            .padding(.vertical, 6)
            .background(.quaternary.opacity(0.5), in: Capsule())
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
        if call.direction == "outbound" { return "phone.arrow.up.right" }
        if call.outcome == CallOutcome.missed { return "phone.arrow.down.left" }
        return "phone.arrow.down.left.fill"
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(alignment: .center, spacing: 12) {
                InitialsAvatar(name: name)
                VStack(alignment: .leading, spacing: 2) {
                    Text(name)
                        .font(.body)
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
                            // Amber for the actionable inbound miss — the
                            // row's one tinted element; all else stays quiet.
                            .foregroundStyle(
                                isActionableMiss(call)
                                    ? BrandColor.overdueAmber
                                    : Color.secondary
                            )
                        if let label = screeningLabel(call.screening_result) {
                            Text(label)
                                .font(.caption2)
                                .padding(.horizontal, 8)
                                .padding(.vertical, 2)
                                .background(.quaternary.opacity(0.6), in: Capsule())
                                .foregroundStyle(.secondary)
                        }
                    }
                }
                Spacer()
                Text(relativeTime(call.started_at))
                    .font(.caption2)
                    .foregroundStyle(.secondary)
            }
            if call.outcome == CallOutcome.voicemail, (call.voicemail_seconds ?? 0) > 0 {
                VoicemailPlayerRow(
                    service: service,
                    companyId: companyId,
                    sessionId: call.call_session_id,
                    seconds: call.voicemail_seconds ?? 0
                )
                .padding(.leading, 52)
            }
        }
        .padding(.vertical, 4)
        .contentShape(Rectangle())
        .onTapGesture {
            onOpen?()
        }
    }
}

/// Inline voicemail playback: mint the 1h signed URL on demand (never
/// cached), stream via AVPlayer with seek + live progress.
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
            HStack(spacing: 8) {
                Button(action: togglePlayback) {
                    if preparing {
                        ProgressView()
                            .controlSize(.small)
                    } else {
                        Image(systemName: playing ? "pause.fill" : "play.fill")
                            .font(.footnote)
                    }
                }
                .buttonStyle(.bordered)
                .buttonBorderShape(.circle)
                .tint(BrandColor.petrol)
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
                .disabled(player == nil)

                Text("\(formatTimer(elapsedMs: positionMs)) / \(formatVoicemailLength(seconds))")
                    .font(.caption2)
                    .foregroundStyle(.secondary)
                    .monospacedDigit()
            }
            if let errorText {
                Text(errorText)
                    .font(.caption2)
                    .foregroundStyle(.secondary)
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
