import Foundation
import Observation
import CallKit
import AVFAudio
import Network
import UIKit

/// The iOS softphone (#161): `SoftphoneCore` (registration, multi-call
/// state, live-call ops — pure and unit-tested) wrapped with the platform
/// plumbing that can't run in a unit test:
///
/// - Telnyx SDK binding (`TelnyxSdkClient`)
/// - CallKit (`CallKitBridge`) — lock-screen ring UI, system audio session,
///   cellular interop, AirPods answer/hangup; CallKit-first UX: answer/end
///   go through CXTransactions and fall back to direct SDK ops only when the
///   system refuses
/// - PushKit VoIP (`VoipPushAdapter`) — the token rides every SDK login
///   (TxConfig.pushDeviceToken) so Telnyx's iOS push credential rings the
///   device; on a VoIP push the CallKit report happens SYNCHRONOUSLY
///   (mandatory) before the SDK wakes
/// - recovery watchdog triggers: network regained + app foregrounded (the
///   debounce, the never-during-a-live-call rule, and the fresh-mint-on-
///   auth-failure behavior all live in the core)
/// - audio-session fallback when CallKit refuses a call
///
/// Created lazily via `get(graph:)` — one instance per process, alive for
/// the process lifetime (the phone must ring on whatever company was last
/// started). Construct it AT APP LAUNCH (one line in the app init) so a
/// cold-start VoIP push finds the PushKit delegate already installed.
@MainActor
@Observable
final class CallsManager {
    private static var instance: CallsManager?

    /// Lazy process-wide singleton.
    static func get(graph: AppGraph) -> CallsManager {
        if let instance { return instance }
        let manager = CallsManager(
            backend: CallsService(api: graph.api),
            prefs: graph.prefs
        )
        instance = manager
        return manager
    }

    /// The instance if the app already built one — never create from a
    /// system callback.
    static func peek() -> CallsManager? { instance }

    @ObservationIgnored private let backend: CallsService
    @ObservationIgnored private let prefs: AppPrefs
    @ObservationIgnored private let sdkClient: TelnyxSdkClient
    @ObservationIgnored private let core: SoftphoneCore
    @ObservationIgnored private let callKit: CallKitBridge
    @ObservationIgnored private let voipPush: VoipPushAdapter

    /// Calls currently reported to CallKit (lowercased UUID strings).
    @ObservationIgnored private var reportedToCallKit: Set<String> = []

    /// Ends CallKit already knows about (its own CXEndCallAction) — never
    /// re-reported.
    @ObservationIgnored private var locallyEnded: Set<String> = []

    /// Outgoing calls whose "connected" moment was already reported.
    @ObservationIgnored private var connectedReported: Set<String> = []

    /// Last phase seen per call — distinguishes an unanswered ring's silent
    /// vanish (answeredElsewhere) from a live call's remote end.
    @ObservationIgnored private var lastPhases: [String: CallPhase] = [:]

    /// The current PushKit VoIP token (hex), if iOS granted one.
    @ObservationIgnored private var voipToken: String?

    /// True while we hold a manually-activated audio session because CallKit
    /// refused the call (the Android audio-focus-fallback twin).
    @ObservationIgnored private var audioFallbackActive = false

    @ObservationIgnored private let pathMonitor = NWPathMonitor()

    /// The one softphone state every surface renders from.
    var state: SoftphoneSnapshot { core.state }

    private init(backend: CallsService, prefs: AppPrefs) {
        self.backend = backend
        self.prefs = prefs
        let sdkClient = TelnyxSdkClient()
        self.sdkClient = sdkClient
        self.core = SoftphoneCore(api: backend, sdk: sdkClient)
        self.callKit = CallKitBridge()
        self.voipPush = VoipPushAdapter()

        wireCore()
        wireCallKit()
        wirePushKit()
        watchNetwork()
        watchForeground()
    }

    // MARK: - Lifecycle

    /// Register (or keep) the softphone for a company. Idempotent and silent
    /// on failure — texting is never blocked by calling; the status pill and
    /// the watchdog retry.
    func start(companyId: String, callerIdName: String = "") {
        voipPush.start()
        core.start(companyId: companyId, callerIdName: callerIdName)
    }

    /// Status-pill tap — force a re-registration now (refused mid-call).
    func retryNow() { core.retryNow() }

    func clearError() { core.clearError() }

    var hasMicPermission: Bool {
        AVAudioApplication.shared.recordPermission == .granted
    }

    func requestMicPermission() async -> Bool {
        await AVAudioApplication.requestRecordPermission()
    }

    // MARK: - Ops

    /// Authorize + place an outbound call (exactly one of conversation /
    /// contact / raw number). Callers MUST preflight the mic permission —
    /// `hasMicPermission` — before invoking (a denial never reserves the
    /// line). Gate refusals surface as ApiError by code.
    func placeCall(
        displayName: String,
        conversationId: String? = nil,
        contactId: String? = nil,
        to: String? = nil,
        phoneNumberId: String? = nil
    ) async throws {
        try await core.placeCall(
            displayName: displayName,
            conversationId: conversationId,
            contactId: contactId,
            to: to,
            phoneNumberId: phoneNumberId
        )
    }

    /// Answer a ringing call — CallKit-first (the transaction reaches
    /// `performAnswer`, which lets the SDK also settle the VoIP-wake answer
    /// race); direct SDK answer when the system refuses.
    func answer(_ id: String) {
        // #195 F5: only arm the failsafe for a genuine answer of a ringing call.
        let ringing = core.state.calls.first { $0.id == id }?.phase == .ringing
        guard reportedToCallKit.contains(id), let uuid = UUID(uuidString: id) else {
            core.answer(id)
            if ringing { scheduleAnswerFailsafe(id) }
            return
        }
        callKit.requestAnswer(uuid: uuid) { [weak self] in
            self?.core.answer(id)
        }
        if ringing { scheduleAnswerFailsafe(id) }
    }

    /// #195 F5 — a failed answer never materializes a live leg: the SDK claims
    /// READY but the answered ring stays stuck at `.ringing` (never goes active)
    /// past the bind deadline. After that window, hand the stuck leg to the core
    /// to drop and — only if nothing else is engaged — rebuild the zombie socket
    /// once, so at most ONE call is lost to it. A call that went active/held, or
    /// vanished (ended / answered elsewhere), is left alone; the core never hangs
    /// up a leg here (state hygiene only).
    private func scheduleAnswerFailsafe(_ id: String) {
        Task { [weak self] in
            try? await Task.sleep(for: CallWakePolicy.answerFailsafe)
            guard let self else { return }
            guard self.core.state.calls.first(where: { $0.id == id })?.phase == .ringing
            else { return }
            self.core.forceRecoverAfterAnswerFailure(stuckId: id)
        }
    }

    /// Decline a ringing call / hang up a live one; dismiss an ended chip.
    func hangup(_ id: String) {
        let call = core.state.calls.first { $0.id == id }
        guard let call, call.phase != .ended else {
            core.hangup(id) // no handle -> just clears the chip
            return
        }
        guard reportedToCallKit.contains(id), let uuid = UUID(uuidString: id) else {
            core.hangup(id)
            return
        }
        callKit.requestEnd(uuid: uuid) { [weak self] in
            self?.core.hangup(id)
        }
    }

    func toggleHold(_ id: String) { core.toggleHold(id) }

    func setMuted(_ id: String, muted: Bool) { core.setMuted(id, muted: muted) }

    func dtmf(_ id: String, digit: String) { core.dtmf(id, digit: digit) }

    func dismiss(_ id: String) { core.dismiss(id) }

    func setAudioRoute(_ route: AudioRoute) { core.setAudioRoute(route) }

    func liveFacts(sessionId: String) async throws -> LiveCallFacts {
        try await core.liveFacts(sessionId: sessionId)
    }

    func transferTargets(sessionId: String) async throws -> TransferTargets {
        try await core.transferTargets(sessionId: sessionId)
    }

    func blindTransfer(sessionId: String, targetUserId: String) async throws -> TransferAck {
        try await core.blindTransfer(sessionId: sessionId, targetUserId: targetUserId)
    }

    /// Push-to-wake part 2 — the notification tap router calls this with the
    /// call_session_id parsed from a `kind:'call'` push (`/calls?call=<id>`):
    /// ensure the SDK is registered, then POST ring-me. conflict (already
    /// answered/ended) and not_found are swallowed by contract; other
    /// failures propagate to the caller.
    func onIncomingCallPush(sessionId: String) async throws {
        try await core.onIncomingCallPush(sessionId: sessionId)
    }

    // MARK: - Core -> platform

    private func wireCore() {
        core.onEvent = { [weak self] event in
            switch event {
            case .incomingRinging(let call):
                self?.reportIncomingToCallKit(call)
            case .outgoingPlaced(let call):
                self?.reportOutgoingToCallKit(call)
            }
        }
        core.onState = { [weak self] snapshot in
            self?.syncCallKit(snapshot)
        }
    }

    private func reportIncomingToCallKit(_ call: CallSnapshot) {
        // Already on screen from the VoIP push report — don't double-ring.
        guard !reportedToCallKit.contains(call.id) else { return }
        guard let uuid = UUID(uuidString: call.id) else { return }
        reportedToCallKit.insert(call.id)
        lastPhases[call.id] = call.phase
        callKit.reportIncoming(
            uuid: uuid,
            displayName: call.peerName,
            number: call.peerNumber
        ) { [weak self] error in
            guard error != nil else { return }
            // CallKit refused (DND-style block) — the in-app chip still rings
            // it; keep audio alive without the system session.
            self?.reportedToCallKit.remove(call.id)
            self?.syncAudioFallback()
        }
    }

    private func reportOutgoingToCallKit(_ call: CallSnapshot) {
        guard let uuid = UUID(uuidString: call.id) else { return }
        reportedToCallKit.insert(call.id)
        lastPhases[call.id] = call.phase
        callKit.startOutgoing(
            uuid: uuid,
            number: call.peerNumber,
            displayName: call.peerName
        ) { [weak self] in
            // The system refused the start action (another app's unholdable
            // call). The SDK leg exists — keep the call, own the audio.
            self?.reportedToCallKit.remove(call.id)
            self?.syncAudioFallback()
        }
    }

    /// Drive CallKit (and the audio fallback) from the one state snapshot.
    private func syncCallKit(_ snapshot: SoftphoneSnapshot) {
        let byId = Dictionary(uniqueKeysWithValues: snapshot.calls.map { ($0.id, $0) })

        for id in Array(reportedToCallKit) {
            let call = byId[id]
            guard call == nil || call?.phase == .ended else { continue }
            reportedToCallKit.remove(id)
            connectedReported.remove(id)
            let wasRinging = lastPhases[id] == .ringing
            lastPhases.removeValue(forKey: id)
            if locallyEnded.remove(id) == nil, let uuid = UUID(uuidString: id) {
                // A ring that vanished un-answered = a teammate won the race
                // or the caller gave up — never this member's "call ended".
                callKit.reportEnded(
                    uuid: uuid,
                    reason: call == nil && wasRinging ? .answeredElsewhere : .remoteEnded
                )
            }
        }

        for call in snapshot.calls {
            if call.phase == .active,
               call.direction == .outbound,
               reportedToCallKit.contains(call.id),
               !connectedReported.contains(call.id),
               let uuid = UUID(uuidString: call.id) {
                connectedReported.insert(call.id)
                callKit.reportOutgoingConnected(uuid: uuid)
            }
            lastPhases[call.id] = call.phase
        }

        // #213: a "Calling…" placement chip is tracked by S (never reported to
        // CallKit — its SDK-mapped UUID isn't known until the op INVITE lands),
        // then rekeys onto the op leg's SDK id (or drops on cancel/timeout). Its
        // old id leaves both the snapshot and `reportedToCallKit`, so the
        // teardown loop above never prunes its `lastPhases` record — do it here
        // so stale phase entries don't accumulate across placed calls.
        lastPhases = lastPhases.filter {
            reportedToCallKit.contains($0.key) || byId[$0.key] != nil
        }

        syncAudioFallback()
    }

    /// Audio-session fallback only matters while CallKit isn't holding the
    /// session for us (a refused report) — the Android audio-focus twin.
    private func syncAudioFallback() {
        let needsFallback = core.state.calls.contains {
            $0.phase == .active && !reportedToCallKit.contains($0.id)
        }
        if needsFallback && !audioFallbackActive {
            let session = AVAudioSession.sharedInstance()
            try? session.setCategory(
                .playAndRecord,
                mode: .voiceChat,
                options: [.allowBluetooth]
            )
            try? session.setActive(true)
            audioFallbackActive = true
        } else if !needsFallback && audioFallbackActive {
            audioFallbackActive = false
            try? AVAudioSession.sharedInstance().setActive(
                false,
                options: [.notifyOthersOnDeactivation]
            )
        }
    }

    // MARK: - CallKit -> core

    private func wireCallKit() {
        callKit.callbacks.performStart = { action in
            // #213: the SERVER dialed the customer and the op leg is already
            // auto-answered by the time we report the outbound to CallKit
            // (at placement reconcile) — this transaction just registers it
            // with the system.
            action.fulfill()
        }
        callKit.callbacks.performAnswer = { [weak self] action in
            guard let self else {
                action.fail()
                return
            }
            let id = action.callUUID.uuidString.lowercased()
            // Call-waiting bookkeeping first; the SDK's CallKit path answers
            // (and parks the action when the pushed INVITE hasn't landed yet).
            self.core.noteAnswerIntent(id)
            self.sdkClient.answerFromCallKit(action)
        }
        callKit.callbacks.performEnd = { [weak self] action in
            guard let self else {
                action.fail()
                return
            }
            let id = action.callUUID.uuidString.lowercased()
            self.locallyEnded.insert(id)
            if self.core.hasHandle(id) || self.sdkClient.hasCall(uuid: action.callUUID) {
                self.sdkClient.endFromCallKit(action)
            } else {
                // Nothing SDK-side (a pushed call whose INVITE never landed,
                // or an already-ended leg) — clear our own chip and settle.
                self.core.dismiss(id)
                action.fulfill()
            }
        }
        callKit.callbacks.performSetHeld = { [weak self] action in
            let id = action.callUUID.uuidString.lowercased()
            if let self, let call = self.core.state.calls.first(where: { $0.id == id }) {
                let eligible = action.isOnHold ? call.phase == .active : call.phase == .held
                if eligible { self.core.toggleHold(id) }
            }
            action.fulfill()
        }
        callKit.callbacks.performSetMuted = { [weak self] action in
            let id = action.callUUID.uuidString.lowercased()
            self?.core.setMuted(id, muted: action.isMuted)
            action.fulfill()
        }
        callKit.callbacks.performDtmf = { [weak self] action in
            let id = action.callUUID.uuidString.lowercased()
            for digit in action.digits {
                self?.core.dtmf(id, digit: String(digit))
            }
            action.fulfill()
        }
        callKit.callbacks.didActivateAudio = { [weak self] session in
            self?.sdkClient.enableAudioSession(session)
        }
        callKit.callbacks.didDeactivateAudio = { [weak self] session in
            self?.sdkClient.disableAudioSession(session)
        }
        callKit.callbacks.didReset = { [weak self] in
            guard let self else { return }
            // The system tore our calls down — end every SDK leg honestly.
            for call in self.core.state.liveCalls {
                self.core.hangup(call.id)
            }
            self.reportedToCallKit.removeAll()
            self.connectedReported.removeAll()
            self.locallyEnded.removeAll()
            self.lastPhases.removeAll()
        }
    }

    // MARK: - PushKit

    private func wirePushKit() {
        voipPush.onToken = { [weak self] token in
            self?.voipToken = token
            self?.core.setPushDeviceToken(token)
        }
        voipPush.onPush = { [weak self] payload, completion in
            self?.handleVoipPush(payload: payload, completion: completion)
        }
        // Install the delegate NOW — a cold-start VoIP push is redelivered
        // the moment the registry exists, and iOS requires the CallKit
        // report to happen inside that delivery.
        voipPush.start()
    }

    /// A Telnyx VoIP push: report to CallKit synchronously (mandatory), then
    /// wake the SDK so the INVITE attaches to the reported call. Mirrors
    /// Android's `onCallWakePush` shape, with CallKit instead of a
    /// notification as the ring surface.
    private func handleVoipPush(
        payload: [AnyHashable: Any],
        completion: @escaping () -> Void
    ) {
        let metadata = Self.pushMetadata(payload)
        let number = (metadata["caller_number"] as? String)
            ?? (metadata["caller_id_number"] as? String)
            ?? ""
        let rawName = (metadata["caller_name"] as? String)
            ?? (metadata["caller_id_name"] as? String)
            ?? ""
        let name = rawName.isBlank
            ? (number.isEmpty ? "Unknown caller" : formatPhone(number))
            : rawName
        // Telnyx stamps the SDK call UUID into the push so the reported
        // CallKit call and the arriving INVITE line up.
        let uuid = (metadata["call_id"] as? String).flatMap(UUID.init(uuidString:)) ?? UUID()
        let id = uuid.uuidString.lowercased()

        // 1. REQUIRED synchronously: the CallKit report.
        reportedToCallKit.insert(id)
        lastPhases[id] = .ringing
        callKit.reportIncoming(uuid: uuid, displayName: name, number: number) { _ in }
        completion()

        // 2. Wake the SDK. Signed out / no workspace = nothing can ring —
        //    end the reported call honestly instead of hanging the screen.
        guard let company = core.companyId ?? prefs.activeCompanyId else {
            endDanglingPushCall(id: id, uuid: uuid, reason: .failed)
            return
        }
        Task { [weak self] in
            guard let self else { return }
            if self.core.state.status != .ready {
                do {
                    // A registration mint (the push IS the connect trigger) —
                    // never a per-call mint.
                    let minted = try await self.backend.mintToken(companyId: company)
                    try self.sdkClient.processVoIPNotification(
                        token: minted.token,
                        pushDeviceToken: self.voipToken,
                        pushMetaData: metadata
                    )
                } catch {
                    self.endDanglingPushCall(id: id, uuid: uuid, reason: .failed)
                    return
                }
            }
            // Watchdog: if the INVITE never lands (answered elsewhere while
            // we connected, network died), clear the ring instead of letting
            // the CallKit screen ring forever.
            try? await Task.sleep(for: .seconds(20))
            if self.core.state.calls.first(where: { $0.id == id }) == nil {
                self.endDanglingPushCall(id: id, uuid: uuid, reason: .answeredElsewhere)
            }
        }
    }

    private func endDanglingPushCall(id: String, uuid: UUID, reason: CXCallEndedReason) {
        guard reportedToCallKit.contains(id) else { return }
        reportedToCallKit.remove(id)
        lastPhases.removeValue(forKey: id)
        callKit.reportEnded(uuid: uuid, reason: reason)
    }

    /// Telnyx delivers `metadata` as a dictionary (or, in some SDK versions,
    /// a JSON string) inside the push payload.
    private static func pushMetadata(_ payload: [AnyHashable: Any]) -> [String: Any] {
        if let dict = payload["metadata"] as? [String: Any] { return dict }
        if let text = payload["metadata"] as? String,
           let data = text.data(using: .utf8),
           let parsed = try? JSONSerialization.jsonObject(with: data) as? [String: Any] {
            return parsed
        }
        return [:]
    }

    // MARK: - Watchdog triggers

    private func watchNetwork() {
        pathMonitor.pathUpdateHandler = { [weak self] path in
            guard path.status == .satisfied else { return }
            Task { @MainActor in self?.core.scheduleRecover() }
        }
        pathMonitor.start(queue: DispatchQueue.global(qos: .utility))
    }

    private func watchForeground() {
        NotificationCenter.default.addObserver(
            forName: UIApplication.willEnterForegroundNotification,
            object: nil,
            queue: .main
        ) { _ in
            Task { @MainActor in
                CallsManager.instance?.core.scheduleRecover()
            }
        }
    }
}
