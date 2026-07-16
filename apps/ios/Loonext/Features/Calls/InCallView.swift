import SwiftUI
import AVKit

/// The live-call surface: identity + duration, hold/mute/route/DTMF, blind
/// transfer with honest busy flags, add-note (opens the conversation), and
/// call-waiting (answer the 2nd holds the 1st; the core auto-declines a 3rd).
/// Presented full-screen by `CallsOverlay` above the shell.
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

    private var snapshot: SoftphoneSnapshot { manager.state }

    private var featured: CallSnapshot? {
        snapshot.activeCall
            ?? snapshot.liveCalls.first { $0.phase != .ringing }
            ?? snapshot.liveCalls.first
            ?? snapshot.calls.last
    }

    var body: some View {
        VStack(spacing: 0) {
            Spacer().frame(height: 48)

            if let featured {
                InitialsAvatar(name: featured.peerName, size: 72)
                Spacer().frame(height: 16)
                Text(featured.peerName)
                    .font(.title.weight(.semibold))
                    .multilineTextAlignment(.center)
                if !featured.peerNumber.isEmpty,
                   formatPhone(featured.peerNumber) != featured.peerName {
                    Text(formatPhone(featured.peerNumber))
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                }
                Spacer().frame(height: 4)
                CallPhaseLine(call: featured)
            }

            Spacer().frame(height: 12)
            if let error = snapshot.error {
                Text(error)
                    .font(.footnote)
                    .foregroundStyle(.secondary)
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
                .padding(.horizontal, 24)
            }

            Spacer()

            if let featured, featured.phase != .ringing {
                controls(for: featured)
            }

            Spacer().frame(height: 24)
            HStack {
                Button("Hide", action: onClose)
                    .font(.body)
                Spacer()
                Button {
                    if let featured { manager.hangup(featured.id) }
                } label: {
                    Image(systemName: "phone.down.fill")
                        .font(.title2)
                        .foregroundStyle(.white)
                        .frame(width: 30, height: 30)
                        .padding(17)
                        .background(BrandColor.destructive, in: Circle())
                }
                .disabled(featured == nil)
                .accessibilityLabel("Hang up")
                Spacer()
                // Balance the trailing edge so the hangup button centers.
                Color.clear.frame(width: 60, height: 1)
            }
            .padding(.horizontal, 32)
            Spacer().frame(height: 24)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Color(uiColor: .systemBackground))
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

    @ViewBuilder
    private func controls(for featured: CallSnapshot) -> some View {
        VStack(spacing: 12) {
            HStack(spacing: 12) {
                ControlToggle(
                    on: featured.muted,
                    systemImage: featured.muted ? "mic.slash.fill" : "mic.fill",
                    label: featured.muted ? "Unmute" : "Mute"
                ) {
                    manager.setMuted(featured.id, muted: !featured.muted)
                }
                ControlToggle(
                    on: false,
                    systemImage: "circle.grid.3x3.fill",
                    label: "Keypad",
                    enabled: featured.phase == .active
                ) {
                    dtmfOpen = true
                }
                ControlToggle(
                    on: speakerOn,
                    systemImage: "speaker.wave.2.fill",
                    label: "Speaker"
                ) {
                    speakerOn.toggle()
                    manager.setAudioRoute(speakerOn ? .speaker : .earpiece)
                }
                // Bluetooth/AirPods routing is system-owned on iOS.
                AudioRoutePicker()
                    .frame(width: 52, height: 52)
                    .background(.quaternary.opacity(0.5), in: Circle())
            }
            HStack(spacing: 12) {
                ControlToggle(
                    on: featured.phase == .held,
                    systemImage: featured.phase == .held ? "play.fill" : "pause.fill",
                    label: featured.phase == .held ? "Resume" : "Hold"
                ) {
                    manager.toggleHold(featured.id)
                }
                ControlToggle(
                    on: false,
                    systemImage: "phone.arrow.right",
                    label: "Transfer",
                    // Transfer needs the CUSTOMER session — resolved via
                    // by-leg for inbound answers; disabled until it lands.
                    enabled: featured.sessionId != nil && featured.phase == .active
                ) {
                    transferOpen = true
                }
                ControlToggle(
                    on: false,
                    systemImage: "text.bubble",
                    label: "Add a note in the conversation",
                    enabled: conversationId != nil
                ) {
                    if let conversationId { openConversation(conversationId) }
                }
            }
        }
    }
}

/// One round in-call control.
private struct ControlToggle: View {
    let on: Bool
    let systemImage: String
    let label: String
    var enabled = true
    let action: @MainActor () -> Void

    var body: some View {
        Button(action: action) {
            Image(systemName: systemImage)
                .font(.body)
                .foregroundStyle(
                    on ? BrandColor.onPetrolContainer : Color.primary
                )
                .frame(width: 52, height: 52)
                .background(
                    on
                        ? AnyShapeStyle(BrandColor.petrolContainer)
                        : AnyShapeStyle(.quaternary.opacity(0.5)),
                    in: Circle()
                )
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
                    .font(.headline)
                    .foregroundStyle(BrandColor.petrol)
                    .monospacedDigit()
                }
            }
        }
    }

    private func phaseText(_ text: String) -> some View {
        Text(text)
            .font(.headline)
            .foregroundStyle(.secondary)
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
        HStack(spacing: 8) {
            VStack(alignment: .leading, spacing: 2) {
                Text(call.peerName)
                    .font(.subheadline.weight(.semibold))
                Text(statusLine)
                    .font(.caption2)
                    .foregroundStyle(.secondary)
            }
            Spacer()
            if call.phase == .ringing {
                Button("Decline") { manager.hangup(call.id) }
                    .font(.footnote)
                    .foregroundStyle(BrandColor.destructive)
                Button {
                    answerWithMicPreflight()
                } label: {
                    Label("Answer", systemImage: "phone.fill")
                        .font(.footnote)
                }
                .buttonStyle(.borderedProminent)
                .tint(BrandColor.petrol)
            } else if call.phase == .held {
                Button("Swap") { manager.toggleHold(call.id) }
                    .font(.footnote)
                    .buttonStyle(.bordered)
                    .tint(BrandColor.petrol)
            }
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 10)
        .background(.quaternary.opacity(0.5), in: RoundedRectangle(cornerRadius: 16))
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
        VStack(spacing: 8) {
            Text(sent.isEmpty ? "Keypad" : sent)
                .font(.title2.weight(.semibold))
                .foregroundStyle(sent.isEmpty ? Color.secondary : Color.primary)
                .padding(.vertical, 12)
                .monospacedDigit()
            ForEach(rows, id: \.self) { row in
                HStack(spacing: 0) {
                    ForEach(row, id: \.self) { key in
                        Button {
                            sent += key
                            onDigit(key)
                        } label: {
                            Text(key)
                                .font(.title2)
                                .frame(maxWidth: .infinity)
                                .frame(height: 52)
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
    }
}

/// Blind-transfer picker: eligible teammates with honest busy flags. Names
/// come from GET /v1/members (targets are id-only). Decline/timeout recovery
/// is server-side — the customer snaps back to us, never stranded.
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
        VStack(alignment: .leading, spacing: 8) {
            Text("Transfer to")
                .font(.headline)
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
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                        .multilineTextAlignment(.center)
                    Button("Try again") { reloadKey += 1 }
                        .buttonStyle(.bordered)
                }
                .frame(maxWidth: .infinity)
                .padding(.vertical, 12)
            case .ready(let rows):
                if rows.isEmpty {
                    Text("No teammates can take this call right now.")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                        .padding(.vertical, 24)
                } else {
                    List(rows) { row in
                        HStack(spacing: 12) {
                            InitialsAvatar(name: row.name, size: 36)
                            VStack(alignment: .leading, spacing: 2) {
                                Text(row.name)
                                    .font(.body)
                                if row.busy {
                                    Text("On a call")
                                        .font(.caption2)
                                        .foregroundStyle(.secondary)
                                }
                            }
                            Spacer()
                            Button("Transfer") { transfer(to: row.id) }
                                .buttonStyle(.bordered)
                                .tint(BrandColor.petrol)
                                .disabled(row.busy || transferring)
                        }
                        .listRowInsets(EdgeInsets(
                            top: 10, leading: 0, bottom: 10, trailing: 0
                        ))
                    }
                    .listStyle(.plain)
                }
            }

            if let errorText {
                Text(errorText)
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }
            Spacer(minLength: 16)
        }
        .padding(.horizontal, 24)
        .presentationDetents([.medium, .large])
        .task(id: "\(sessionId)|\(reloadKey)") { await reload() }
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
