import Foundation

/// #161 softphone state — the pure, SDK-agnostic call model. A Swift port of
/// the Android `telephony/CallStateMachine.kt` (itself a port of the web's
/// unit-tested reducer, apps/web/src/lib/softphone/state.ts). Kept free of
/// TelnyxRTC / CallKit imports so every transition unit-tests without a
/// device, a mic, or the SDK.
///
/// MULTI-CALL (call waiting): the state holds a small list of calls — at most
/// one ACTIVE (audio flowing), the rest held or ringing. One active call per
/// member (the line model's member side); flip freely between a held call and
/// an incoming one. A ringing inbound call that ends un-answered vanishes
/// silently (another member won the race or the caller gave up — not this
/// member's "Call ended" moment).

enum SoftphoneStatus: Sendable, Equatable {
    case disconnected
    case connecting
    case ready
}

enum CallDirection: Sendable, Equatable {
    case inbound
    case outbound
}

/// One call's UI phase. HELD is client-side (SDK hold — far side stays up).
enum CallPhase: Sendable, Equatable {
    case ringing
    case connecting
    case active
    case held
    case ended
}

struct CallSnapshot: Sendable, Equatable, Identifiable {
    /// The SDK call's id (the Telnyx call UUID, lowercased) — the state's
    /// map key AND the CallKit call UUID.
    let id: String
    var direction: CallDirection
    /// Resolved display name (contact > CNAM > number) at ring/place time.
    var peerName: String
    /// E.164 (or raw dialed digits) — empty for anonymous callers.
    var peerNumber: String
    var phase: CallPhase
    var muted: Bool = false
    /// The CUSTOMER call_session_id once known — the server-side handle every
    /// live-call op (transfer, notes link, ring-me) uses. For an answered
    /// INBOUND call the SDK leg is the RING leg, so this arrives only after
    /// GET /v1/calls/live/by-leg/{ccid} resolves; outbound legs carry it
    /// directly (the SDK leg IS the customer leg).
    var sessionId: String? = nil
    /// When this call first went active — the live timer's anchor.
    var activeSince: Date? = nil
}

struct SoftphoneSnapshot: Sendable, Equatable {
    var status: SoftphoneStatus = .disconnected
    /// A registration/call error the UI surfaces (never blocks texting).
    var error: String? = nil
    var calls: [CallSnapshot] = []
    /// The call whose audio is flowing (at most one).
    var activeId: String? = nil

    var activeCall: CallSnapshot? { calls.first { $0.id == activeId } }

    /// Calls still holding a line (anything not torn down).
    var liveCalls: [CallSnapshot] { calls.filter { $0.phase != .ended } }
}

enum CallStateMachine {
    /// At most one active + one waiting/held — a third concurrent declines.
    static let maxConcurrentCalls = 2

    static func ready(_ state: SoftphoneSnapshot) -> SoftphoneSnapshot {
        var next = state
        next.status = .ready
        next.error = nil
        return next
    }

    static func connecting(_ state: SoftphoneSnapshot) -> SoftphoneSnapshot {
        var next = state
        next.status = .connecting
        return next
    }

    /// The socket dropped — the phone can't ring until it re-registers.
    static func disconnected(_ state: SoftphoneSnapshot) -> SoftphoneSnapshot {
        var next = state
        next.status = .disconnected
        return next
    }

    static func error(_ state: SoftphoneSnapshot, _ message: String) -> SoftphoneSnapshot {
        var next = state
        next.error = message
        return next
    }

    static func clearError(_ state: SoftphoneSnapshot) -> SoftphoneSnapshot {
        var next = state
        next.error = nil
        return next
    }

    /// A just-placed outbound call — connecting, immediately the active slot.
    static func placing(_ state: SoftphoneSnapshot, _ call: CallSnapshot) -> SoftphoneSnapshot {
        var placed = call
        placed.phase = .connecting
        placed.direction = .outbound
        var next = state
        next.error = nil
        next.calls = state.calls.filter { $0.phase != .ended } + [placed]
        next.activeId = call.id
        return next
    }

    /// A new inbound invite — rings until answered/declined/won elsewhere.
    static func incoming(_ state: SoftphoneSnapshot, _ call: CallSnapshot) -> SoftphoneSnapshot {
        if state.calls.contains(where: { $0.id == call.id }) { return state }
        var ringing = call
        ringing.phase = .ringing
        ringing.direction = .inbound
        var next = state
        next.calls = state.calls.filter { $0.phase != .ended } + [ringing]
        return next
    }

    /// The customer call_session_id resolved (by-leg for inbound answers).
    static func sessionKnown(
        _ state: SoftphoneSnapshot,
        id: String,
        sessionId: String
    ) -> SoftphoneSnapshot {
        update(state, id: id) { $0.sessionId = sessionId }
    }

    static func muted(_ state: SoftphoneSnapshot, id: String, muted: Bool) -> SoftphoneSnapshot {
        update(state, id: id) { $0.muted = muted }
    }

    /// Dismiss an ended call's chip.
    static func dismissed(_ state: SoftphoneSnapshot, id: String) -> SoftphoneSnapshot {
        var next = state
        next.calls = state.calls.filter { $0.id != id }
        if state.activeId == id { next.activeId = nil }
        return next
    }

    /// Apply an SDK per-call state transition. Mirrors the Android/web reducer
    /// exactly: an un-answered inbound ring ignores early SDK states (the
    /// Answer chip must not morph) and its end is a SILENT removal; a call
    /// going active structurally demotes any other active call to held
    /// (one-active-audio).
    static func sdkPhase(
        _ state: SoftphoneSnapshot,
        id: String,
        phase: CallPhase,
        now: Date
    ) -> SoftphoneSnapshot {
        guard let call = state.calls.first(where: { $0.id == id }) else { return state }
        if call.phase == .ringing {
            switch phase {
            case .active:
                return activate(state, id: id, now: now)
            case .ended:
                var next = state
                next.calls = state.calls.filter { $0.id != id }
                if state.activeId == id { next.activeId = nil }
                return next
            default:
                return state
            }
        }
        switch phase {
        case .active:
            return activate(state, id: id, now: now)
        case .ended:
            var next = update(state, id: id) { $0.phase = .ended }
            if state.activeId == id { next.activeId = nil }
            return next
        case .held:
            var next = update(state, id: id) { $0.phase = .held }
            if state.activeId == id { next.activeId = nil }
            return next
        case .ringing, .connecting:
            return update(state, id: id) { $0.phase = .connecting }
        }
    }

    /// Make `id` the single ACTIVE call — demoting ANY other active call to
    /// held, so two calls can never fight for the one audio path. The caller
    /// (SoftphoneCore) SDK-holds the demoted call to match.
    private static func activate(
        _ state: SoftphoneSnapshot,
        id: String,
        now: Date
    ) -> SoftphoneSnapshot {
        var next = state
        next.calls = state.calls.map { call in
            var updated = call
            if call.id == id {
                updated.phase = .active
                updated.activeSince = call.activeSince ?? now
            } else if call.phase == .active {
                updated.phase = .held
            }
            return updated
        }
        next.activeId = id
        return next
    }

    private static func update(
        _ state: SoftphoneSnapshot,
        id: String,
        _ patch: (inout CallSnapshot) -> Void
    ) -> SoftphoneSnapshot {
        var next = state
        next.calls = state.calls.map { call in
            guard call.id == id else { return call }
            var updated = call
            patch(&updated)
            return updated
        }
        return next
    }
}
