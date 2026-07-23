import Foundation

/// The minimal slice of the Telnyx WebRTC SDK the softphone touches, behind a
/// protocol seam so `SoftphoneCore`'s registration/call orchestration is
/// unit-testable without the SDK, a device, or a mic. The real implementation
/// is `TelnyxSdkClient`. Mirrors the Android `telephony/SdkClient.kt` seam.
///
/// Everything here is MainActor-bound: the real client hops its delegate
/// callbacks onto the main actor before touching these callbacks, and the
/// fake in tests runs on the main actor throughout.

/// iOS audio routes the app commands directly. Bluetooth/AirPlay routing is
/// system-owned on iOS (AVRoutePickerView in the in-call UI).
enum AudioRoute: Sendable, Equatable {
    case earpiece
    case speaker
}

/// Discrete SDK moments the core reacts to.
enum SdkEvent {
    /// Registered on the socket — the phone can ring.
    case ready

    /// The socket dropped; the SDK's own reconnect may or may not recover.
    case disconnected

    /// A socket/auth error — often a dead token; recovery re-mints.
    case error(String?)

    /// A new inbound invite (the ring engine, a transfer, OR — #213 — THIS
    /// member's own server-dialed placer (op) leg for an outbound call they
    /// just placed). `sessionHeader` is the `X-Loonext-Session` custom SIP
    /// header (= S) the server stamps on every ring/placer dial, extracted at
    /// the SDK boundary; the core correlates it to a pending placement to
    /// decide whether to auto-answer (op leg) or present a ring (inbound).
    case incoming(
        call: any SdkCallHandle,
        callerName: String?,
        callerNumber: String?,
        sessionHeader: String?
    )
}

@MainActor
protocol SdkCallHandle: AnyObject {
    /// The SDK call's UUID string, lowercased — the state's map key.
    var id: String { get }

    /// Telnyx call_control_id of THIS leg — the by-leg resolution key.
    var callControlId: String? { get }

    /// Telnyx session id of THIS leg (the customer session for outbound).
    var telnyxSessionId: String? { get }

    /// Per-call phase callback mapped from the SDK's CallState. `nil` values
    /// are mid-call recovery states (reconnecting/dropped) the state machine
    /// ignores — the call keeps its current phase.
    var onPhase: ((CallPhase?) -> Void)? { get set }

    func answer()
    func end()

    /// The iOS SDK exposes hold/unhold explicitly (unlike Android's toggle);
    /// `SoftphoneCore` still serializes commands from the SDK's own
    /// last-reported phase.
    func hold()
    func unhold()
    func setMuted(_ muted: Bool)
    func dtmf(_ digit: String)
}

@MainActor
protocol SoftphoneSdk: AnyObject {
    var onEvent: ((SdkEvent) -> Void)? { get set }

    /// Tear down any previous socket and register with a fresh login token
    /// (mint-on-connect is what makes auth-failure recovery a simple rebuild).
    /// `pushDeviceToken` is the PushKit VoIP token — attaching it at login is
    /// what lets Telnyx's iOS push credential ring this device while the
    /// socket is down.
    func connect(token: String, callerIdName: String, pushDeviceToken: String?) throws

    func disconnect()

    /// Place an outbound call. `clientState` MUST carry the exact wire bytes
    /// of POST /v1/calls/browser's client_state — the webhook hangs up any
    /// outgoing PSTN leg whose client_state doesn't carry a valid single-use
    /// nonce. See `ClientState` for the per-SDK boundary rule.
    func newCall(
        callerIdName: String,
        callerIdNumber: String,
        destinationNumber: String,
        clientState: String
    ) throws -> any SdkCallHandle

    func setAudioRoute(_ route: AudioRoute)
}
