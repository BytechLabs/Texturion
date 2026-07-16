import Foundation
import CallKit
import AVFAudio
@preconcurrency import TelnyxRTC

/// The real `SoftphoneSdk` over the Telnyx iOS WebRTC SDK (TelnyxRTC 4.x).
/// One TxClient per registration; `connect` tears the old one down and builds
/// fresh — mint-on-connect is the whole recovery story (a dead token can't be
/// fixed by the SDK's own reconnect, a rebuild with a fresh mint can).
///
/// `@preconcurrency import`: the SDK predates strict concurrency; its
/// delegate calls back on its own threads, so every callback hops onto the
/// main actor before touching state.
@MainActor
final class TelnyxSdkClient: NSObject, SoftphoneSdk {
    var onEvent: ((SdkEvent) -> Void)?

    private var client: TxClient?
    private var handles: [UUID: TelnyxCallHandle] = [:]

    func connect(token: String, callerIdName: String, pushDeviceToken: String?) throws {
        disconnect()
        let next = TxClient()
        next.delegate = self
        client = next
        let config = TxConfig(
            token: token,
            // Registering the PushKit VoIP token at login is what lets the
            // Telnyx iOS push credential ring this device while the socket
            // is down. Nil until PushKit hands us one (simulator, or the
            // entitlement missing) — calls then ring only while connected.
            pushDeviceToken: pushDeviceToken,
            reconnectClient: true
        )
        try next.connect(txConfig: config)
    }

    func disconnect() {
        guard let previous = client else { return }
        client = nil
        // A stale client's straggler delegate events must not flip the fresh
        // one's state — cut the delegate before tearing it down.
        previous.delegate = nil
        previous.disconnect()
        handles.removeAll()
    }

    func newCall(
        callerIdName: String,
        callerIdNumber: String,
        destinationNumber: String,
        clientState: String
    ) throws -> any SdkCallHandle {
        guard let active = client else {
            throw ApiError(
                code: ApiErrorCode.network,
                message: "Calling isn't ready yet. Try again in a moment.",
                httpStatus: 0
            )
        }
        let callId = UUID()
        // The iOS SDK sends clientState to the wire AS-IS (see ClientState) —
        // this argument must already be the server's base64 value.
        let call = try active.newCall(
            callerName: callerIdName.isBlank ? "Loonext" : callerIdName,
            callerNumber: callerIdNumber,
            destinationNumber: destinationNumber,
            callId: callId,
            clientState: clientState
        )
        let handle = TelnyxCallHandle(call: call, uuid: callId)
        handles[callId] = handle
        return handle
    }

    func setAudioRoute(_ route: AudioRoute) {
        switch route {
        case .speaker:
            client?.setSpeaker()
        case .earpiece:
            client?.setEarpiece()
        }
    }

    // MARK: - CallKit passthroughs

    /// Answer via the SDK's CallKit path — it also parks the action until the
    /// pushed call's INVITE lands (the VoIP-wake answer race).
    func answerFromCallKit(_ action: CXAnswerCallAction) {
        client?.answerFromCallkit(answerAction: action)
    }

    /// End via the SDK's CallKit path (fulfills the action itself).
    func endFromCallKit(_ action: CXEndCallAction) {
        client?.endCallFromCallkit(endAction: action)
    }

    /// Whether the SDK currently tracks a call for this CallKit UUID.
    func hasCall(uuid: UUID) -> Bool {
        client?.getCall(callId: uuid) != nil
    }

    /// VoIP-push wake: hand the push metadata to the SDK so it connects and
    /// attaches the pushed INVITE. Creates the client when the app was
    /// launched cold by the push.
    func processVoIPNotification(
        token: String,
        pushDeviceToken: String?,
        pushMetaData: [String: Any]
    ) throws {
        let target: TxClient
        if let client {
            target = client
        } else {
            target = TxClient()
            target.delegate = self
            client = target
        }
        let config = TxConfig(
            token: token,
            pushDeviceToken: pushDeviceToken,
            reconnectClient: true
        )
        try target.processVoIPNotification(
            txConfig: config,
            serverConfiguration: TxServerConfiguration(),
            pushMetaData: pushMetaData
        )
    }

    /// MUST be driven from CXProviderDelegate didActivate/didDeactivate.
    func enableAudioSession(_ session: AVAudioSession) {
        client?.enableAudioSession(audioSession: session)
    }

    func disableAudioSession(_ session: AVAudioSession) {
        client?.disableAudioSession(audioSession: session)
    }

    // MARK: - Delegate plumbing (hops to MainActor)

    private func trackIncoming(_ call: TelnyxRTC.Call) {
        guard let info = call.callInfo else { return }
        let callId = info.callId
        if handles[callId] != nil { return }
        let handle = TelnyxCallHandle(call: call, uuid: callId)
        handles[callId] = handle
        onEvent?(.incoming(
            call: handle,
            callerName: info.callerName,
            callerNumber: info.callerNumber
        ))
    }

    private func routePhase(_ callId: UUID, _ phase: CallPhase?) {
        guard let handle = handles[callId] else { return }
        handle.onPhase?(phase)
        if phase == .ended {
            handles.removeValue(forKey: callId)
        }
    }

    static func phase(from state: CallState) -> CallPhase? {
        switch state {
        case .NEW, .CONNECTING, .RINGING:
            return .connecting
        case .ACTIVE:
            return .active
        case .HELD:
            return .held
        case .DONE:
            return .ended
        case .RECONNECTING, .DROPPED:
            // Mid-call recovery states — the call keeps its current phase; a
            // failed recovery lands in DONE on its own.
            return nil
        }
    }
}

extension TelnyxSdkClient: TxClientDelegate {
    nonisolated func onSocketConnected() {
        // Connected != registered; READY is the ring-eligible moment.
    }

    nonisolated func onSocketDisconnected() {
        Task { @MainActor in self.onEvent?(.disconnected) }
    }

    nonisolated func onClientError(error: Error) {
        let message = error.localizedDescription
        Task { @MainActor in self.onEvent?(.error(message)) }
    }

    nonisolated func onClientReady() {
        Task { @MainActor in self.onEvent?(.ready) }
    }

    nonisolated func onPushDisabled(success: Bool, message: String) {}

    nonisolated func onSessionUpdated(sessionId: String) {}

    nonisolated func onCallStateUpdated(callState: CallState, callId: UUID) {
        let mapped = Self.phase(from: callState)
        Task { @MainActor in self.routePhase(callId, mapped) }
    }

    nonisolated func onIncomingCall(call: TelnyxRTC.Call) {
        Task { @MainActor in self.trackIncoming(call) }
    }

    nonisolated func onRemoteCallEnded(callId: UUID, reason: CallTerminationReason?) {
        Task { @MainActor in self.routePhase(callId, .ended) }
    }

    /// A VoIP-push call's INVITE landed — same ring path as a live invite
    /// (the core dedups by call id).
    nonisolated func onPushCall(call: TelnyxRTC.Call) {
        Task { @MainActor in self.trackIncoming(call) }
    }
}

/// One SDK call behind the testable handle seam.
@MainActor
private final class TelnyxCallHandle: SdkCallHandle {
    let id: String
    let uuid: UUID
    private let call: TelnyxRTC.Call

    var onPhase: ((CallPhase?) -> Void)?

    init(call: TelnyxRTC.Call, uuid: UUID) {
        self.call = call
        self.uuid = uuid
        self.id = uuid.uuidString.lowercased()
    }

    var callControlId: String? { call.telnyxCallControlId }

    var telnyxSessionId: String? { call.telnyxSessionId?.uuidString.lowercased() }

    func answer() {
        call.answer()
    }

    func end() {
        call.hangup()
    }

    func hold() {
        call.hold()
    }

    func unhold() {
        call.unhold()
    }

    func setMuted(_ muted: Bool) {
        if muted {
            call.muteAudio()
        } else {
            call.unmuteAudio()
        }
    }

    func dtmf(_ digit: String) {
        call.dtmf(dtmf: digit)
    }
}
