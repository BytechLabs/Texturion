import SwiftUI
import AVKit

/// The live-call surface: identity + duration, hold/mute/route/DTMF, blind
/// transfer with honest busy flags, add-note (opens the conversation), and
/// call-waiting (answer the 2nd holds the 1st; the core auto-declines a 3rd).
/// Presented full-screen by `CallsOverlay` above the shell.
/// Paper & Olive reskin per specs 26/32 (in-call), 04 (ring), 05 (transfer):
/// deep-inset canvas, ringed avatar, paper control circles with 10.5pt
/// labels, warm-brick End-call pill, lime Answer.
@MainActor
struct InCallView: View {
    let manager: CallsManager
    let service: CallsService
    let companyId: String
    let openConversation: (String) -> Void
    let onClose: @MainActor () -> Void

    @State private var dtmfOpen = false
    @State private var transferOpen = false
    @State private var speakerOn = false
    @State private var conversationId: String?

    /// #180: in landscape / square viewports the vertical size class is compact
    /// — collapse the identity block's rhythm so the controls and End-call pill
    /// stay on screen (and the scroll backstop guarantees reachability below).
    @Environment(\.verticalSizeClass) private var vSizeClass

    private var compactHeight: Bool { vSizeClass == .compact }
    private var avatarSize: CGFloat { compactHeight ? 76 : 112 }
    private var avatarRingInner: CGFloat { compactHeight ? 94 : 130 }
    private var avatarRingOuter: CGFloat { compactHeight ? 110 : 150 }
    private var avatarBlockHeight: CGFloat { compactHeight ? 112 : 152 }

    private var snapshot: SoftphoneSnapshot { manager.state }

    private var featured: CallSnapshot? {
        snapshot.activeCall
            ?? snapshot.liveCalls.first { $0.phase != .ringing }
            ?? snapshot.liveCalls.first
            ?? snapshot.calls.last
    }

    var body: some View {
        // #180: the live-call surface fills the viewport and distributes its
        // rhythm on tall screens, but scrolls the instant the fixed content
        // (avatar, controls, End-call pill, Hide) can't fit — so no control is
        // ever stranded on a short/square viewport.
        GeometryReader { proxy in
            ScrollView {
                callColumn
                    .frame(maxWidth: .infinity, minHeight: proxy.size.height)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(BrandColor.insetDeep.ignoresSafeArea())
        .task(id: snapshot.liveCalls.isEmpty) {
            if snapshot.liveCalls.isEmpty {
                // A brief beat so "Call ended" registers, then close.
                try? await Task.sleep(for: .milliseconds(400))
                if !Task.isCancelled { onClose() }
            }
        }
        // The notes deep-link: resolve live facts once the session is known.
        .task(id: featured?.sessionId) {
            conversationId = nil
            guard let session = featured?.sessionId else { return }
            conversationId = try? await manager.liveFacts(sessionId: session).conversation_id
        }
        .sheet(isPresented: $dtmfOpen) {
            if let featured {
                DtmfSheet { digit in manager.dtmf(featured.id, digit: digit) }
            }
        }
        .sheet(isPresented: $transferOpen) {
            if let featured, let session = featured.sessionId {
                TransferSheet(
                    manager: manager,
                    service: service,
                    companyId: companyId,
                    sessionId: session
                )
            }
        }
    }

    /// The identity + controls + actions column. Its top rhythm collapses under
    /// a compact vertical size class (landscape / square) so the whole surface
    /// stays on screen; the scroll backstop covers anything shorter still.
    private var callColumn: some View {
        VStack(spacing: 0) {
            Spacer().frame(height: compactHeight ? 14 : 48)

            if let featured {
                ZStack {
                    Circle()
                        .stroke(BrandColor.lime.opacity(0.55), lineWidth: 2)
                        .frame(width: avatarRingInner, height: avatarRingInner)
                    Circle()
                        .stroke(
                            BrandColor.ink.opacity(0.2),
                            style: StrokeStyle(lineWidth: 2, dash: [2, 5])
                        )
                        .frame(width: avatarRingOuter, height: avatarRingOuter)
                    InitialsAvatar(name: featured.peerName, size: avatarSize)
                }
                .frame(height: avatarBlockHeight)
                Spacer().frame(height: compactHeight ? 10 : 20)
                Text(featured.peerName)
                    .font(.display(26))
                    .kerning(-0.26)
                    .foregroundStyle(BrandColor.ink)
                    .multilineTextAlignment(.center)
                if !featured.peerNumber.isEmpty,
                   formatPhone(featured.peerNumber) != featured.peerName {
                    Text(formatPhone(featured.peerNumber))
                        .font(.golos(12.5))
                        .foregroundStyle(BrandColor.muted600)
                        .padding(.top, 4)
                }
                Spacer().frame(height: 8)
                CallPhaseLine(call: featured)
            }

            Spacer().frame(height: 12)
            if let error = snapshot.error {
                Text(error)
                    .font(.golos(11.5))
                    .foregroundStyle(BrandColor.muted500)
                    .multilineTextAlignment(.center)
                    .padding(.horizontal, 24)
            }

            // Other calls: held lines to swap back to, or a ringing 2nd call.
            let others = snapshot.liveCalls.filter { $0.id != featured?.id }
            if !others.isEmpty {
                Spacer().frame(height: 16)
                VStack(spacing: 8) {
                    ForEach(others) { other in
                        OtherCallRow(call: other, manager: manager)
                    }
                }
                .padding(.horizontal, 22)
            }

            Spacer(minLength: compactHeight ? 16 : 0)

            if let featured, featured.phase != .ringing {
                controls(for: featured)
            }

            Spacer().frame(height: compactHeight ? 16 : 22)

            if let featured, featured.phase == .ringing {
                // The in-app ring layout (spec 04): brick Decline, lime Answer.
                ringActions(for: featured)
            } else {
                endCallBar
            }

            Spacer().frame(height: 14)
            HStack {
                Button("Hide", action: onClose)
                    .font(.golos(13, weight: .semibold))
                    .foregroundStyle(BrandColor.muted700)
                Spacer()
                // Bluetooth/AirPods routing is system-owned on iOS.
                AudioRoutePicker()
                    .frame(width: 44, height: 44)
                    .background(BrandColor.paper, in: Circle())
            }
            .padding(.horizontal, 22)
            Spacer().frame(height: 16)
        }
    }

    /// The warm-brick full-width End-call pill (specs 26/32).
    private var endCallBar: some View {
        Button {
            if let featured { manager.hangup(featured.id) }
        } label: {
            HStack(spacing: 10) {
                Text("End call")
                    .font(.golos(15, weight: .semibold))
                Spacer()
                Image(systemName: "phone.down")
                    .font(.system(size: 19, weight: .medium))
                    .frame(width: 44, height: 44)
                    .background(BrandColor.paperFixed.opacity(0.16), in: Circle())
            }
            .foregroundStyle(BrandColor.paperFixed)
            .padding(.leading, 24)
            .padding(.trailing, 8)
            .padding(.vertical, 8)
            .background(BrandColor.destructive, in: Capsule())
        }
        .buttonStyle(.plain)
        .disabled(featured == nil)
        .accessibilityLabel("Hang up")
        .padding(.horizontal, 22)
    }

    /// Decline / Answer circles for a featured ringing call (spec 04) — the
    /// same manager calls the chip uses, with the mic preflight.
    private func ringActions(for call: CallSnapshot) -> some View {
        HStack {
            VStack(spacing: 8) {
                Button {
                    manager.hangup(call.id)
                } label: {
                    Image(systemName: "phone.down")
                        .font(.system(size: 24, weight: .medium))
                        .foregroundStyle(BrandColor.paperFixed)
                        .frame(width: 72, height: 72)
                        .background(BrandColor.destructive, in: Circle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Decline")
                Text("Decline")
                    .font(.golos(11, weight: .semibold))
                    .foregroundStyle(BrandColor.muted700)
            }
            Spacer()
            VStack(spacing: 8) {
                Button {
                    answerWithMicPreflight(call.id)
                } label: {
                    Image(systemName: "phone")
                        .font(.system(size: 24, weight: .medium))
                        .foregroundStyle(BrandColor.onLime)
                        .frame(width: 72, height: 72)
                        .background(BrandColor.lime, in: Circle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Answer")
                Text("Answer")
                    .font(.golos(11, weight: .bold))
                    .foregroundStyle(BrandColor.ink)
            }
        }
        .padding(.horizontal, 48)
    }

    private func answerWithMicPreflight(_ id: String) {
        if manager.hasMicPermission {
            manager.answer(id)
            return
        }
        Task {
            if await manager.requestMicPermission() {
                manager.answer(id)
            }
        }
    }

    @ViewBuilder
    private func controls(for featured: CallSnapshot) -> some View {
        VStack(spacing: 14) {
            HStack(alignment: .top, spacing: 12) {
                ControlToggle(
                    on: featured.muted,
                    systemImage: featured.muted ? "mic.slash" : "mic",
                    label: featured.muted ? "Unmute" : "Mute",
                    title: featured.muted ? "Unmute" : "Mute"
                ) {
                    manager.setMuted(featured.id, muted: !featured.muted)
                }
                .frame(maxWidth: .infinity)
                ControlToggle(
                    on: false,
                    systemImage: "circle.grid.3x3",
                    label: "Keypad",
                    title: "Keypad",
                    enabled: featured.phase == .active
                ) {
                    dtmfOpen = true
                }
                .frame(maxWidth: .infinity)
                ControlToggle(
                    on: featured.phase == .held,
                    systemImage: featured.phase == .held ? "play" : "pause",
                    label: featured.phase == .held ? "Resume" : "Hold",
                    title: featured.phase == .held ? "Resume" : "Hold"
                ) {
                    manager.toggleHold(featured.id)
                }
                .frame(maxWidth: .infinity)
            }
            HStack(alignment: .top, spacing: 12) {
                ControlToggle(
                    on: false,
                    systemImage: "arrow.left.arrow.right",
                    label: "Transfer",
                    title: "Transfer",
                    // Transfer needs the CUSTOMER session — resolved via
                    // by-leg for inbound answers; disabled until it lands.
                    enabled: featured.sessionId != nil && featured.phase == .active
                ) {
                    transferOpen = true
                }
                .frame(maxWidth: .infinity)
                ControlToggle(
                    on: false,
                    systemImage: "text.bubble",
                    label: "Add a note in the conversation",
                    title: "Note",
                    enabled: conversationId != nil
                ) {
                    if let conversationId { openConversation(conversationId) }
                }
                .frame(maxWidth: .infinity)
                ControlToggle(
                    on: speakerOn,
                    systemImage: "speaker.wave.2",
                    label: "Speaker",
                    title: "Speaker"
                ) {
                    speakerOn.toggle()
                    manager.setAudioRoute(speakerOn ? .speaker : .earpiece)
                }
                .frame(maxWidth: .infinity)
            }
        }
        .padding(.horizontal, 24)
    }
}

/// One round in-call control: 60pt paper circle, outline icon, 10.5pt Golos
/// label beneath. Active state inverts to ink (specs 26/32).
private struct ControlToggle: View {
    let on: Bool
    let systemImage: String
    let label: String
    var title: String? = nil
    var enabled = true
    let action: @MainActor () -> Void

    var body: some View {
        Button(action: action) {
            VStack(spacing: 6) {
                Image(systemName: systemImage)
                    .font(.system(size: 20, weight: .regular))
                    .foregroundStyle(on ? BrandColor.paper : BrandColor.ink)
                    .frame(width: 60, height: 60)
                    .background(
                        on ? BrandColor.ink : BrandColor.paper,
                        in: Circle()
                    )
                if let title {
                    Text(title)
                        .font(.golos(10.5, weight: on ? .bold : .semibold))
                        .foregroundStyle(on ? BrandColor.ink : BrandColor.muted700)
                }
            }
        }
        .buttonStyle(.plain)
        .disabled(!enabled)
        .opacity(enabled ? 1 : 0.4)
        .accessibilityLabel(label)
    }
}

/// "Incoming call" / "Calling…" / live timer / "On hold" / "Call ended".
struct CallPhaseLine: View {
    let call: CallSnapshot

    var body: some View {
        switch call.phase {
        case .ringing:
            phaseText("Incoming call")
        case .connecting:
            phaseText("Calling…")
        case .held:
            phaseText("On hold")
        case .ended:
            phaseText("Call ended")
        case .active:
            if let anchor = call.activeSince {
                TimelineView(.periodic(from: .now, by: 1)) { context in
                    Text(formatTimer(
                        elapsedMs: Int(context.date.timeIntervalSince(anchor) * 1000)
                    ))
                    .font(.golos(48, weight: .regular))
                    .foregroundStyle(BrandColor.ink)
                    .monospacedDigit()
                }
            }
        }
    }

    private func phaseText(_ text: String) -> some View {
        Text(text)
            .font(.golos(15, weight: .semibold))
            .foregroundStyle(BrandColor.muted600)
    }
}

/// A held line to swap to, or a ringing second call (answer holds current).
private struct OtherCallRow: View {
    let call: CallSnapshot
    let manager: CallsManager

    private var statusLine: String {
        switch call.phase {
        case .ringing: "Incoming call"
        case .held: "On hold"
        case .connecting: "Calling…"
        default: ""
        }
    }

    var body: some View {
        HStack(spacing: 10) {
            VStack(alignment: .leading, spacing: 2) {
                Text(call.peerName)
                    .font(.golos(13.5, weight: .semibold))
                    .foregroundStyle(BrandColor.ink)
                Text(statusLine)
                    .font(.golos(11))
                    .foregroundStyle(BrandColor.muted500)
            }
            Spacer()
            if call.phase == .ringing {
                Button {
                    manager.hangup(call.id)
                } label: {
                    Text("Decline")
                        .font(.golos(11.5, weight: .semibold))
                        .foregroundStyle(BrandColor.destructive)
                        .padding(.horizontal, 12)
                        .padding(.vertical, 8)
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Decline")
                Button {
                    answerWithMicPreflight()
                } label: {
                    HStack(spacing: 6) {
                        Image(systemName: "phone")
                            .font(.system(size: 12, weight: .semibold))
                        Text("Answer")
                            .font(.golos(11.5, weight: .bold))
                    }
                    .foregroundStyle(BrandColor.onLime)
                    .padding(.horizontal, 15)
                    .padding(.vertical, 8)
                    .background(BrandColor.lime, in: Capsule())
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Answer")
            } else if call.phase == .held {
                Button {
                    manager.toggleHold(call.id)
                } label: {
                    Text("Swap")
                        .font(.golos(11.5, weight: .semibold))
                        .foregroundStyle(BrandColor.muted900)
                        .padding(.horizontal, 15)
                        .padding(.vertical, 8)
                        .background(BrandColor.inset, in: Capsule())
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Swap")
            }
        }
        .padding(.horizontal, 15)
        .padding(.vertical, 12)
        .background(
            BrandColor.paper,
            in: RoundedRectangle(cornerRadius: 18, style: .continuous)
        )
    }

    private func answerWithMicPreflight() {
        if manager.hasMicPermission {
            manager.answer(call.id)
            return
        }
        Task {
            if await manager.requestMicPermission() {
                manager.answer(call.id)
            }
        }
    }
}

/// In-call DTMF keypad for IVR navigation — digits send immediately.
private struct DtmfSheet: View {
    let onDigit: (String) -> Void

    @State private var sent = ""

    private let rows: [[String]] = [
        ["1", "2", "3"],
        ["4", "5", "6"],
        ["7", "8", "9"],
        ["*", "0", "#"],
    ]

    var body: some View {
        VStack(spacing: 10) {
            Text(sent.isEmpty ? "Keypad" : sent)
                .font(.golos(22, weight: .semibold))
                .foregroundStyle(sent.isEmpty ? BrandColor.muted400 : BrandColor.ink)
                .padding(.vertical, 12)
                .monospacedDigit()
            ForEach(rows, id: \.self) { row in
                HStack(spacing: 24) {
                    ForEach(row, id: \.self) { key in
                        Button {
                            sent += key
                            onDigit(key)
                        } label: {
                            Text(key)
                                .font(.golos(22, weight: .semibold))
                                .foregroundStyle(BrandColor.ink)
                                .frame(width: 60, height: 60)
                                .background(BrandColor.paper, in: Circle())
                        }
                        .buttonStyle(.plain)
                    }
                }
            }
            Spacer(minLength: 16)
        }
        .padding(.horizontal, 24)
        .padding(.top, 16)
        .presentationDetents([.medium])
        .presentationBackground(BrandColor.canvas)
    }
}

/// Blind-transfer picker (spec 05): eligible teammates with honest presence
/// dots — lime "Available", muted "On a call". Names come from
/// GET /v1/members (targets are id-only). Decline/timeout recovery is
/// server-side — the customer snaps back to us, never stranded.
private struct TransferSheet: View {
    let manager: CallsManager
    let service: CallsService
    let companyId: String
    let sessionId: String

    @Environment(\.dismiss) private var dismiss

    private struct Row: Identifiable {
        let id: String
        let name: String
        let busy: Bool
    }

    @State private var state: LoadState<[Row]> = .loading
    @State private var transferring = false
    @State private var errorText: String?
    @State private var reloadKey = 0

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            VStack(alignment: .leading, spacing: 4) {
                Text("Transfer this call")
                    .font(.display(21))
                    .foregroundStyle(BrandColor.ink)
                Text("The customer stays on hold while we ring them.")
                    .font(.golos(12))
                    .foregroundStyle(BrandColor.muted500)
            }
            .padding(.top, 20)

            switch state {
            case .loading:
                HStack {
                    Spacer()
                    ProgressView()
                    Spacer()
                }
                .padding(.vertical, 24)
            case .failed(let message):
                VStack(spacing: 12) {
                    Text(message)
                        .font(.golos(12.5))
                        .foregroundStyle(BrandColor.muted500)
                        .multilineTextAlignment(.center)
                    Button("Try again") { reloadKey += 1 }
                        .font(.golos(12, weight: .semibold))
                        .foregroundStyle(BrandColor.olive)
                }
                .frame(maxWidth: .infinity)
                .padding(.vertical, 12)
            case .ready(let rows):
                if rows.isEmpty {
                    Text("No teammates can take this call right now.")
                        .font(.golos(12.5))
                        .foregroundStyle(BrandColor.muted500)
                        .padding(.vertical, 24)
                } else {
                    ScrollView {
                        PaperCard {
                            ForEach(rows) { row in
                                transferRow(row)
                                if row.id != rows.last?.id {
                                    RowDivider().padding(.leading, 66)
                                }
                            }
                        }
                    }
                }
            }

            if let errorText {
                Text(errorText)
                    .font(.golos(11.5))
                    .foregroundStyle(BrandColor.muted500)
            }
            Text("If they decline, the call snaps back to you.")
                .font(.golos(11))
                .foregroundStyle(BrandColor.muted300)
                .frame(maxWidth: .infinity)
                .multilineTextAlignment(.center)
            Spacer(minLength: 16)
        }
        .padding(.horizontal, 20)
        .presentationDetents([.medium, .large])
        .presentationBackground(BrandColor.canvas)
        .task(id: "\(sessionId)|\(reloadKey)") { await reload() }
    }

    @ViewBuilder
    private func transferRow(_ row: Row) -> some View {
        HStack(spacing: 11) {
            InitialsAvatar(name: row.name, size: 40)
            VStack(alignment: .leading, spacing: 3) {
                Text(row.name)
                    .font(.golos(13.5, weight: .semibold))
                    .foregroundStyle(BrandColor.ink)
                HStack(spacing: 5) {
                    Circle()
                        .fill(row.busy ? BrandColor.muted300 : BrandColor.lime)
                        .frame(width: 6, height: 6)
                    Text(row.busy ? "On a call" : "Available")
                        .font(.golos(11, weight: row.busy ? .regular : .semibold))
                        .foregroundStyle(row.busy ? BrandColor.muted500 : BrandColor.olive)
                }
            }
            Spacer()
            Button {
                transfer(to: row.id)
            } label: {
                Text("Transfer")
                    .font(.golos(11.5, weight: .semibold))
                    .foregroundStyle(BrandColor.paper)
                    .padding(.horizontal, 15)
                    .padding(.vertical, 8)
                    .background(BrandColor.ink, in: Capsule())
            }
            .buttonStyle(.plain)
            .disabled(row.busy || transferring)
            .opacity(row.busy || transferring ? 0.45 : 1)
        }
        .padding(.horizontal, 15)
        .padding(.vertical, 13)
    }

    private func reload() async {
        state = .loading
        errorText = nil
        do {
            let targets = try await manager.transferTargets(sessionId: sessionId).targets
            let members = try await service.members(companyId: companyId).data
            let names = Dictionary(
                members.map { ($0.user_id, $0.display_name) },
                uniquingKeysWith: { first, _ in first }
            )
            state = .ready(targets.map { target in
                Row(
                    id: target.user_id,
                    name: {
                        let name = names[target.user_id] ?? ""
                        return name.isBlank ? "Teammate" : name
                    }(),
                    busy: target.busy
                )
            })
        } catch {
            state = .failed(error.userMessage)
        }
    }

    private func transfer(to userId: String) {
        transferring = true
        errorText = nil
        Task {
            defer { transferring = false }
            do {
                _ = try await manager.blindTransfer(
                    sessionId: sessionId,
                    targetUserId: userId
                )
                dismiss()
            } catch {
                errorText = error.userMessage
            }
        }
    }
}

/// System audio-route picker (AirPods / Bluetooth / CarPlay) — routing is
/// OS-owned on iOS; this is the honest native control for it.
private struct AudioRoutePicker: UIViewRepresentable {
    func makeUIView(context: Context) -> AVRoutePickerView {
        let view = AVRoutePickerView()
        view.prioritizesVideoDevices = false
        return view
    }

    func updateUIView(_ uiView: AVRoutePickerView, context: Context) {}
}

// MARK: - Previews (inline mock CallSnapshots — the live surface renders from
// CallsManager state, which has no injection seam by design, so the previews
// exercise the visual components with mock data)

private func previewSnapshot(
    id: String,
    name: String,
    number: String,
    phase: CallPhase,
    direction: CallDirection = .inbound,
    muted: Bool = false,
    activeSince: Date? = nil
) -> CallSnapshot {
    CallSnapshot(
        id: id,
        direction: direction,
        peerName: name,
        peerNumber: number,
        phase: phase,
        muted: muted,
        sessionId: nil,
        activeSince: activeSince
    )
}

#Preview("In-call states") {
    let manager = CallsManager.get(graph: AppGraph())
    VStack(spacing: 24) {
        VStack(spacing: 8) {
            InitialsAvatar(name: "Dana Whitcomb", size: 112)
            Text("Dana Whitcomb")
                .font(.display(26))
                .foregroundStyle(BrandColor.ink)
            Text("(415) 555-0134")
                .font(.golos(12.5))
                .foregroundStyle(BrandColor.muted600)
            CallPhaseLine(call: previewSnapshot(
                id: "a",
                name: "Dana Whitcomb",
                number: "+14155550134",
                phase: .active,
                activeSince: Date().addingTimeInterval(-272)
            ))
        }
        CallPhaseLine(call: previewSnapshot(
            id: "b", name: "Ari", number: "+15559998888", phase: .ringing
        ))
        CallPhaseLine(call: previewSnapshot(
            id: "c", name: "Ari", number: "+15559998888", phase: .held
        ))
        OtherCallRow(
            call: previewSnapshot(
                id: "d", name: "Ari Benson", number: "+15559998888", phase: .ringing
            ),
            manager: manager
        )
        OtherCallRow(
            call: previewSnapshot(
                id: "e", name: "Marta Reyes", number: "+15551230000", phase: .held
            ),
            manager: manager
        )
        HStack(alignment: .top, spacing: 12) {
            ControlToggle(on: true, systemImage: "mic.slash", label: "Unmute", title: "Unmute") {}
            ControlToggle(on: false, systemImage: "circle.grid.3x3", label: "Keypad", title: "Keypad") {}
            ControlToggle(on: false, systemImage: "pause", label: "Hold", title: "Hold") {}
            ControlToggle(
                on: false,
                systemImage: "arrow.left.arrow.right",
                label: "Transfer",
                title: "Transfer",
                enabled: false
            ) {}
        }
    }
    .padding()
    .background(BrandColor.insetDeep)
}

// #180 responsive matrix — the live surface renders from CallsManager state
// (no injection seam by design), so these prove the callColumn + scroll
// backstop compile and lay out at a landscape and a square ratio.

#Preview("In-call · landscape frame") {
    let graph = AppGraph()
    InCallView(
        manager: CallsManager.get(graph: graph),
        service: CallsService(api: graph.api),
        companyId: "co-preview",
        openConversation: { _ in },
        onClose: {}
    )
    .frame(width: 740, height: 360)
}

#Preview("In-call · 1:1 square frame") {
    let graph = AppGraph()
    InCallView(
        manager: CallsManager.get(graph: graph),
        service: CallsService(api: graph.api),
        companyId: "co-preview",
        openConversation: { _ in },
        onClose: {}
    )
    .frame(width: 400, height: 400)
}
