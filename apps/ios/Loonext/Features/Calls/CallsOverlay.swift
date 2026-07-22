import SwiftUI

/// The app-wide calls layer the integrator overlays ABOVE the tab bar (one
/// line in the shell, e.g. `.overlay(alignment: .bottom) { CallsOverlay(...) }`
/// with bottom padding clearing the bar): the persistent call chip (live
/// duration / incoming answer-decline / held count) and the full-screen
/// `InCallView` it expands into. Mounting this is also what registers the
/// softphone on app open, so the member is ring-eligible even before ever
/// visiting the calls surface.
@MainActor
struct CallsOverlay: View {
    let graph: AppGraph
    let companyId: String
    let me: Me
    let openConversation: (String) -> Void

    private let manager: CallsManager
    private let service: CallsService

    @State private var expanded = false

    init(
        graph: AppGraph,
        companyId: String,
        me: Me,
        openConversation: @escaping (String) -> Void
    ) {
        self.graph = graph
        self.companyId = companyId
        self.me = me
        self.openConversation = openConversation
        self.manager = CallsManager.get(graph: graph)
        self.service = CallsService(api: graph.api)
    }

    var body: some View {
        CallChip(manager: manager) { expanded = true }
            .task(id: companyId) {
                manager.start(companyId: companyId, callerIdName: me.display_name)
            }
            // Auto-surface the full screen the moment a call connects
            // (answering from the CallKit screen must land the user on the
            // in-call controls when they come back to the app).
            .onChange(of: manager.state.activeId) { _, next in
                if next != nil { expanded = true }
            }
            .fullScreenCover(isPresented: $expanded) {
                InCallView(
                    manager: manager,
                    service: service,
                    companyId: companyId,
                    openConversation: { id in
                        expanded = false
                        openConversation(id)
                    },
                    onClose: { expanded = false }
                )
            }
    }
}

/// The persistent chip above the tab bar. Nothing renders while the line is
/// idle. Ringing (no active call) shows Answer/Decline inline; a live call
/// shows identity + ticking duration + hang up; an ended call flashes
/// "Call ended" briefly, then dismisses itself.
@MainActor
struct CallChip: View {
    let manager: CallsManager
    let onExpand: @MainActor () -> Void

    var body: some View {
        let snapshot = manager.state
        let ended = snapshot.calls.filter { $0.phase == .ended }
        let ringing = snapshot.calls.first { $0.phase == .ringing }
        let featured = snapshot.activeCall
            ?? snapshot.liveCalls.first { $0.phase != .ringing }
        let endedChip = (featured == nil && ringing == nil) ? ended.last : nil

        if let call = featured ?? ringing ?? endedChip {
            let isRingingChip = featured == nil && ringing != nil
            let heldCount = snapshot.liveCalls.count { $0.phase == .held }

            HStack(spacing: 10) {
                Circle()
                    .fill(call.phase == .ended ? BrandColor.muted300 : BrandColor.olive)
                    .frame(width: 8, height: 8)
                Text(call.peerName)
                    .font(.golos(13.5, weight: .semibold))
                    .foregroundStyle(BrandColor.ink)
                    .lineLimit(1)
                ChipStatus(call: call, heldCount: heldCount)
                Spacer(minLength: 8)
                chipActions(call: call, isRingingChip: isRingingChip)
            }
            .padding(.leading, 14)
            .padding(.trailing, 6)
            .padding(.vertical, 8)
            .glassEffect(.regular)
            .padding(.horizontal, 12)
            .padding(.vertical, 6)
            .contentShape(Rectangle())
            .onTapGesture {
                if call.phase != .ended { onExpand() }
            }
            .task(id: ended.map(\.id)) {
                guard !ended.isEmpty else { return }
                try? await Task.sleep(for: .milliseconds(2_500))
                if Task.isCancelled { return }
                for endedCall in ended {
                    manager.dismiss(endedCall.id)
                }
            }
        }
    }

    @ViewBuilder
    private func chipActions(call: CallSnapshot, isRingingChip: Bool) -> some View {
        if isRingingChip {
            Button {
                manager.hangup(call.id)
            } label: {
                Image(systemName: "phone.down")
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundStyle(BrandColor.paperFixed)
                    .frame(width: 34, height: 34)
                    .background(BrandColor.destructive, in: Circle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Decline")
            Button {
                answerWithMicPreflight(call.id)
            } label: {
                Image(systemName: "phone")
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundStyle(BrandColor.onLime)
                    .frame(width: 34, height: 34)
                    .background(BrandColor.lime, in: Circle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Answer")
        } else if call.phase == .ended {
            Button {
                manager.dismiss(call.id)
            } label: {
                Image(systemName: "xmark")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(BrandColor.muted600)
                    .frame(width: 34, height: 34)
                    .background(BrandColor.inset, in: Circle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Dismiss")
        } else {
            Button {
                manager.hangup(call.id)
            } label: {
                Image(systemName: "phone.down")
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundStyle(BrandColor.paperFixed)
                    .frame(width: 34, height: 34)
                    .background(BrandColor.destructive, in: Circle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Hang up")
        }
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
}

/// "Incoming call" / "Calling…" / ticking timer (+ held count) / "On hold" /
/// "Call ended".
private struct ChipStatus: View {
    let call: CallSnapshot
    let heldCount: Int

    var body: some View {
        switch call.phase {
        case .ringing:
            statusText("Incoming call")
        case .connecting:
            statusText("Calling…")
        case .held:
            statusText("On hold")
        case .ended:
            statusText("Call ended")
        case .active:
            if let anchor = call.activeSince {
                TimelineView(.periodic(from: .now, by: 1)) { context in
                    let timer = formatTimer(
                        elapsedMs: Int(context.date.timeIntervalSince(anchor) * 1000)
                    )
                    statusText(
                        heldCount > 0 ? "\(timer) · \(heldCount) on hold" : timer
                    )
                }
            }
        }
    }

    private func statusText(_ text: String) -> some View {
        Text(text)
            .font(.golos(11))
            .foregroundStyle(BrandColor.muted500)
            .monospacedDigit()
    }
}
