import Foundation
@preconcurrency import CallKit
import AVFAudio

/// Thin CallKit shell (#161): one CXProvider + CXCallController pair, with
/// every user intent routed back through closures `CallsManager` installs.
/// The iOS twin of Android's self-managed telecom bridge
/// (`LoonextConnectionService`) — registering calls with CallKit is what buys
/// system audio-session priority, the lock-screen incoming UI, cellular-call
/// interop, and hardware (AirPods) answer/hangup.
///
/// The provider delegate runs on the MAIN queue (`setDelegate(_:queue: nil)`),
/// so the `@preconcurrency` conformance's main-actor assumption always holds.
@MainActor
final class CallKitBridge: NSObject {
    struct Callbacks {
        var performStart: (CXStartCallAction) -> Void = { $0.fulfill() }
        var performAnswer: (CXAnswerCallAction) -> Void = { $0.fail() }
        var performEnd: (CXEndCallAction) -> Void = { $0.fail() }
        var performSetHeld: (CXSetHeldCallAction) -> Void = { $0.fulfill() }
        var performSetMuted: (CXSetMutedCallAction) -> Void = { $0.fulfill() }
        var performDtmf: (CXPlayDTMFCallAction) -> Void = { $0.fulfill() }
        var didActivateAudio: (AVAudioSession) -> Void = { _ in }
        var didDeactivateAudio: (AVAudioSession) -> Void = { _ in }
        var didReset: () -> Void = {}
    }

    var callbacks = Callbacks()

    private let provider: CXProvider
    private let controller = CXCallController()

    override init() {
        let configuration = CXProviderConfiguration()
        configuration.supportsVideo = false
        // Two independent calls (call waiting), never a conference.
        configuration.maximumCallGroups = 2
        configuration.maximumCallsPerCallGroup = 1
        configuration.supportedHandleTypes = [.phoneNumber, .generic]
        provider = CXProvider(configuration: configuration)
        super.init()
        provider.setDelegate(self, queue: nil) // nil = main queue
    }

    // MARK: - Reports (state -> system)

    /// Report a ringing inbound call. REQUIRED synchronously on every VoIP
    /// push — iOS terminates apps that receive one and don't report a call.
    func reportIncoming(
        uuid: UUID,
        displayName: String,
        number: String,
        completion: (@MainActor (Error?) -> Void)? = nil
    ) {
        let update = CXCallUpdate()
        update.remoteHandle = CXHandle(
            type: number.isEmpty ? .generic : .phoneNumber,
            value: number.isEmpty ? "Unknown caller" : number
        )
        update.localizedCallerName = displayName
        update.hasVideo = false
        update.supportsGrouping = false
        update.supportsUngrouping = false
        update.supportsHolding = true
        update.supportsDTMF = true
        provider.reportNewIncomingCall(with: uuid, update: update) { error in
            guard let completion else { return }
            Task { @MainActor in completion(error) }
        }
    }

    /// Register an outgoing call with the system (CXStartCallAction); the
    /// dial itself already happened (authorize-then-dial, like Android
    /// reports to telecom after the SDK leg exists).
    func startOutgoing(
        uuid: UUID,
        number: String,
        displayName: String,
        onFailure: @escaping @MainActor () -> Void
    ) {
        let handle = CXHandle(type: .phoneNumber, value: number)
        let action = CXStartCallAction(call: uuid, handle: handle)
        action.contactIdentifier = displayName
        controller.request(CXTransaction(action: action)) { error in
            guard error != nil else { return }
            Task { @MainActor in onFailure() }
        }
    }

    func reportOutgoingConnecting(uuid: UUID) {
        provider.reportOutgoingCall(with: uuid, startedConnectingAt: nil)
    }

    func reportOutgoingConnected(uuid: UUID) {
        provider.reportOutgoingCall(with: uuid, connectedAt: nil)
    }

    func reportEnded(uuid: UUID, reason: CXCallEndedReason) {
        provider.reportCall(with: uuid, endedAt: nil, reason: reason)
    }

    // MARK: - Requests (user intent -> system -> callbacks)

    func requestAnswer(uuid: UUID, onFailure: @escaping @MainActor () -> Void) {
        let action = CXAnswerCallAction(call: uuid)
        controller.request(CXTransaction(action: action)) { error in
            guard error != nil else { return }
            Task { @MainActor in onFailure() }
        }
    }

    func requestEnd(uuid: UUID, onFailure: @escaping @MainActor () -> Void) {
        let action = CXEndCallAction(call: uuid)
        controller.request(CXTransaction(action: action)) { error in
            guard error != nil else { return }
            Task { @MainActor in onFailure() }
        }
    }

    func invalidate() {
        provider.invalidate()
    }
}

extension CallKitBridge: @preconcurrency CXProviderDelegate {
    func providerDidReset(_ provider: CXProvider) {
        callbacks.didReset()
    }

    func provider(_ provider: CXProvider, perform action: CXStartCallAction) {
        callbacks.performStart(action)
    }

    func provider(_ provider: CXProvider, perform action: CXAnswerCallAction) {
        callbacks.performAnswer(action)
    }

    func provider(_ provider: CXProvider, perform action: CXEndCallAction) {
        callbacks.performEnd(action)
    }

    func provider(_ provider: CXProvider, perform action: CXSetHeldCallAction) {
        callbacks.performSetHeld(action)
    }

    func provider(_ provider: CXProvider, perform action: CXSetMutedCallAction) {
        callbacks.performSetMuted(action)
    }

    func provider(_ provider: CXProvider, perform action: CXPlayDTMFCallAction) {
        callbacks.performDtmf(action)
    }

    func provider(_ provider: CXProvider, didActivate audioSession: AVAudioSession) {
        callbacks.didActivateAudio(audioSession)
    }

    func provider(_ provider: CXProvider, didDeactivate audioSession: AVAudioSession) {
        callbacks.didDeactivateAudio(audioSession)
    }
}
