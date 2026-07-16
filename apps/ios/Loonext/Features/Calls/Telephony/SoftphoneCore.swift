import Foundation
import Observation

/// Discrete moments the platform layer (CallKit + PushKit) reacts to.
enum CoreEvent: Sendable, Equatable {
    case incomingRinging(CallSnapshot)
    case outgoingPlaced(CallSnapshot)
}

/// The softphone's brain — registration lifecycle, the multi-call state, and
/// every live-call op — with the Telnyx SDK behind `SoftphoneSdk` and the
/// server behind `CallsBackend`, so the whole flow is unit-testable (fake SDK
/// + fake backend). `CallsManager` wraps this with the iOS plumbing (CallKit,
/// PushKit, audio session, watchdog triggers). A Swift port of the Android
/// `telephony/SoftphoneCore.kt`.
///
/// Invariants (BINDING, from the calls domain contract):
/// - The login token is minted ON CONNECT ONLY — never per call (rate-limited).
///   Recovery reconnects mint fresh, which is also the auth-failure fix.
/// - client_state from POST /v1/calls/browser reaches the wire VERBATIM
///   (`ClientState.forIOSSdk` — on iOS the SDK sends it unmodified).
/// - An answered INBOUND call's SDK leg is the RING leg — the customer
///   call_session_id resolves via GET /v1/calls/live/by-leg/{ccid} before any
///   live-call op can run.
/// - Max 2 concurrent calls; answering the second holds the first; a third
///   inbound declines immediately so the answer race resolves elsewhere.
/// - Recovery never rebuilds the client while any call is live (#138).
@MainActor
@Observable
final class SoftphoneCore {
    static let maxConcurrentCalls = CallStateMachine.maxConcurrentCalls

    @ObservationIgnored private let api: any CallsBackend
    @ObservationIgnored private let sdk: any SoftphoneSdk
    @ObservationIgnored private let now: () -> Date
    @ObservationIgnored private let recoverDebounce: Duration
    @ObservationIgnored private let readyTimeout: Duration

    private(set) var state = SoftphoneSnapshot() {
        didSet { onState?(state) }
    }

    /// Every state change, for the platform sync (CallKit reporting).
    @ObservationIgnored var onState: ((SoftphoneSnapshot) -> Void)?

    /// Discrete ring/place moments (CallKit report triggers).
    @ObservationIgnored var onEvent: ((CoreEvent) -> Void)?

    @ObservationIgnored private var handles: [String: any SdkCallHandle] = [:]

    /// Ground truth of what the SDK last reported per call — hold commands
    /// must consult THIS, not the reduced UI state (which demotes to HELD
    /// structurally before the SDK has actually held anything).
    @ObservationIgnored private var sdkPhases: [String: CallPhase] = [:]

    /// Calls with a hold/unhold command in flight — a second command before
    /// the SDK reports back would fight the first.
    @ObservationIgnored private var pendingHold: Set<String> = []

    /// Handles whose by-leg resolution is running or done (resolve once).
    @ObservationIgnored private var resolvingLegs: Set<String> = []

    @ObservationIgnored private var connectTask: Task<Void, Error>?
    @ObservationIgnored private var recoverTask: Task<Void, Never>?

    @ObservationIgnored private(set) var companyId: String?
    @ObservationIgnored private var callerIdName = ""

    /// The PushKit VoIP token — attached to the NEXT registration so Telnyx's
    /// iOS push credential can ring this device while the socket is down.
    @ObservationIgnored private var pushDeviceToken: String?

    init(
        api: any CallsBackend,
        sdk: any SoftphoneSdk,
        recoverDebounce: Duration = .seconds(4),
        readyTimeout: Duration = .seconds(15),
        now: @escaping () -> Date = { Date() }
    ) {
        self.api = api
        self.sdk = sdk
        self.recoverDebounce = recoverDebounce
        self.readyTimeout = readyTimeout
        self.now = now
        sdk.onEvent = { [weak self] event in
            self?.onSdkEvent(event)
        }
    }

    /// Begin (or keep) registration for a company. Fire-and-forget and silent
    /// on failure — texting is unaffected; the Call button and the watchdog
    /// retry. Registering is also what makes this member ring-eligible.
    func start(companyId: String, callerIdName: String = "") {
        let switching = self.companyId != nil && self.companyId != companyId
        self.companyId = companyId
        if !callerIdName.isBlank { self.callerIdName = callerIdName }
        if switching {
            // A different company means a different credential — rebuild.
            sdk.disconnect()
            state = CallStateMachine.disconnected(state)
        }
        Task { try? await self.ensureConnected() }
    }

    /// PushKit token arrival/rotation. Attaches to the next registration; if
    /// we're already registered WITHOUT it and the line is idle, rebuild now
    /// so a ring while backgrounded doesn't wait for the next recovery.
    func setPushDeviceToken(_ token: String?) {
        guard token != pushDeviceToken else { return }
        pushDeviceToken = token
        guard token != nil, companyId != nil else { return }
        if state.status == .ready && state.liveCalls.isEmpty {
            retryNow()
        }
        // Mid-connect: the in-flight connect reads the fresh token itself.
    }

    /// Mint a fresh token and register — single-flight, no-op unless down.
    func ensureConnected() async throws {
        guard companyId != nil else { return }
        // Single-flight: wait out any in-flight attempt (ignoring ITS
        // outcome), then re-evaluate — mirrors the Android mutex semantics,
        // where a waiter whose predecessor failed retries the mint itself.
        while let inFlight = connectTask {
            _ = try? await inFlight.value
        }
        guard state.status == .disconnected, let company = companyId else { return }
        let task = Task<Void, Error> { [weak self] in
            // Clear the single-flight slot from INSIDE the attempt so waiters
            // resume with it already empty (no spin between them).
            defer { self?.connectTask = nil }
            guard let self else { return }
            self.state = CallStateMachine.connecting(self.state)
            do {
                let minted = try await self.api.mintToken(companyId: company)
                try self.sdk.connect(
                    token: minted.token,
                    callerIdName: self.callerIdName,
                    pushDeviceToken: self.pushDeviceToken
                )
            } catch {
                self.state = CallStateMachine.disconnected(self.state)
                throw error
            }
        }
        connectTask = task
        try await task.value
    }

    func awaitReady() async throws {
        if state.status == .ready { return }
        let clock = ContinuousClock()
        let deadline = clock.now.advanced(by: readyTimeout)
        while state.status != .ready {
            if clock.now >= deadline {
                throw ApiError(
                    code: ApiErrorCode.network,
                    message: "Couldn't connect your phone. Check your connection and try again.",
                    httpStatus: 0
                )
            }
            try await Task.sleep(for: .milliseconds(50))
        }
    }

    /// Recovery watchdog entry — call on network-regained / app-foreground /
    /// socket-close. Debounced so a burst collapses into one attempt; no-op
    /// while healthy; NEVER rebuilds while a call is live (#138) — the
    /// call-end path re-arms it once the line clears.
    func scheduleRecover() {
        if state.status == .ready { return }
        if recoverTask != nil { return }
        recoverTask = Task { [weak self, recoverDebounce] in
            try? await Task.sleep(for: recoverDebounce)
            guard let self else { return }
            self.recoverTask = nil
            if self.state.status == .ready { return }
            if !self.state.liveCalls.isEmpty { return }
            try? await self.ensureConnected()
        }
    }

    /// Status-pill tap: force a rebuild now (still refuses during a call).
    func retryNow() {
        if !state.liveCalls.isEmpty { return }
        sdk.disconnect()
        state = CallStateMachine.disconnected(state)
        Task { try? await self.ensureConnected() }
    }

    func clearError() {
        state = CallStateMachine.clearError(state)
    }

    /// Surface a client-side failure (mic permission, CallKit refusal).
    func reportUiError(_ message: String) {
        state = CallStateMachine.error(state, message)
    }

    /// Whether the SDK still holds a live leg for this call id.
    func hasHandle(_ id: String) -> Bool {
        handles[id] != nil
    }

    // MARK: - SDK events

    private func onSdkEvent(_ event: SdkEvent) {
        switch event {
        case .ready:
            state = CallStateMachine.ready(state)

        case .disconnected:
            state = CallStateMachine.disconnected(state)
            scheduleRecover()

        case .error:
            // Often an auth/token failure — the SDK's own reconnect can't fix
            // a dead token; a fresh mint + registration can. Deferred
            // automatically while a call is live.
            state = CallStateMachine.error(
                CallStateMachine.disconnected(state),
                "Calling is temporarily unavailable."
            )
            scheduleRecover()

        case .incoming(let call, let callerName, let callerNumber):
            onIncoming(call, callerName: callerName, callerNumber: callerNumber)
        }
    }

    private func onIncoming(
        _ handle: any SdkCallHandle,
        callerName: String?,
        callerNumber: String?
    ) {
        if state.calls.contains(where: { $0.id == handle.id }) { return }
        // Beyond the two-call ceiling: decline immediately so the answer race
        // resolves elsewhere without waiting out the ring timeout.
        if state.liveCalls.count >= Self.maxConcurrentCalls {
            handle.end()
            return
        }
        let number = callerNumber ?? ""
        let trimmedName = (callerName ?? "").trimmingCharacters(in: .whitespaces)
        let name = !trimmedName.isEmpty
            ? trimmedName
            : (number.isEmpty ? "Unknown caller" : number)
        let snapshot = CallSnapshot(
            id: handle.id,
            direction: .inbound,
            peerName: name,
            peerNumber: number,
            phase: .ringing
        )
        handles[handle.id] = handle
        sdkPhases[handle.id] = .ringing
        state = CallStateMachine.incoming(state, snapshot)
        watch(handle)
        onEvent?(.incomingRinging(snapshot))
    }

    private func watch(_ handle: any SdkCallHandle) {
        handle.onPhase = { [weak self, weak handle] phase in
            guard let self, let handle, let phase else { return }
            self.onPhase(handle, phase)
        }
    }

    private func onPhase(_ handle: any SdkCallHandle, _ phase: CallPhase) {
        let id = handle.id
        sdkPhases[id] = phase
        pendingHold.remove(id)
        let before = state
        guard let prev = before.calls.first(where: { $0.id == id }) else { return }
        state = CallStateMachine.sdkPhase(state, id: id, phase: phase, now: now())

        if phase == .active {
            // One active audio path: SDK-hold whichever call was active before
            // this one connected (the reducer already demoted it in state).
            if let previousActive = before.activeId, previousActive != id {
                requestHold(previousActive, hold: true)
            }
            if prev.direction == .inbound && prev.sessionId == nil {
                resolveSession(handle)
            }
            if prev.direction == .outbound && prev.sessionId == nil,
               let session = handle.telnyxSessionId {
                state = CallStateMachine.sessionKnown(state, id: id, sessionId: session)
            }
        }
        if phase == .ended {
            handles.removeValue(forKey: id)
            sdkPhases.removeValue(forKey: id)
            resolvingLegs.remove(id)
            // A recovery may have been deferred while this call held the
            // client (#138) — re-arm once the line is idle.
            if state.status != .ready && state.liveCalls.isEmpty {
                scheduleRecover()
            }
        }
    }

    /// The answered inbound leg is the RING leg — resolve the CUSTOMER
    /// call_session_id so transfer/notes/voicemail address the right call.
    /// Retries briefly (the webhook ledger row can land a beat after answer);
    /// live-call ops stay disabled until it lands.
    private func resolveSession(_ handle: any SdkCallHandle) {
        guard let company = companyId else { return }
        let id = handle.id
        guard resolvingLegs.insert(id).inserted else { return }
        Task { [weak self, weak handle] in
            var backoffMs = 600
            for _ in 0 ..< 6 {
                guard let self, let handle else { return }
                if let ccid = handle.callControlId {
                    do {
                        let resolved = try await self.api.resolveByLeg(
                            companyId: company,
                            legCcid: ccid
                        )
                        self.state = CallStateMachine.sessionKnown(
                            self.state,
                            id: id,
                            sessionId: resolved.call_session_id
                        )
                        return
                    } catch is CancellationError {
                        return
                    } catch {
                        // Not ledgered yet (or a blip) — retry below.
                    }
                }
                do {
                    try await Task.sleep(for: .milliseconds(backoffMs))
                } catch {
                    return
                }
                backoffMs = min(backoffMs * 2, 5_000)
            }
            // Allow a fresh attempt if the caller retries a live-call op.
            self?.resolvingLegs.remove(id)
        }
    }

    // MARK: - Ops

    /// Place an outbound call. Exactly one origin: an existing thread, a
    /// contact (no thread yet), or raw dialed digits. Gate refusals surface as
    /// `ApiError` BY CODE (usage_cap_reached, subscription_inactive, conflict
    /// "line on another call", validation_failed). The current active call is
    /// held only AFTER the new leg exists (#148) — an authorize or connect
    /// failure never strands the live call on hold.
    func placeCall(
        displayName: String,
        conversationId: String? = nil,
        contactId: String? = nil,
        to: String? = nil,
        phoneNumberId: String? = nil
    ) async throws {
        guard let company = companyId else {
            throw ApiError(
                code: ApiErrorCode.network,
                message: "Calling isn't ready yet. Try again in a moment.",
                httpStatus: 0
            )
        }
        guard state.liveCalls.count < Self.maxConcurrentCalls else {
            throw ApiError(
                code: ApiErrorCode.conflict,
                message: "You're already on two calls.",
                httpStatus: 0
            )
        }
        let auth = try await api.authorizeBrowserCall(
            companyId: company,
            conversationId: conversationId,
            contactId: contactId,
            to: to,
            phoneNumberId: phoneNumberId
        )
        try await ensureConnected()
        try await awaitReady()
        // client_state VERBATIM on the wire — the webhook hangs up any leg
        // without the valid single-use nonce inside it.
        let handle = try sdk.newCall(
            callerIdName: callerIdName,
            callerIdNumber: auth.from,
            destinationNumber: auth.to,
            clientState: ClientState.forIOSSdk(auth.client_state)
        )
        if let active = state.activeId {
            requestHold(active, hold: true)
        }
        handles[handle.id] = handle
        sdkPhases[handle.id] = .connecting
        let snapshot = CallSnapshot(
            id: handle.id,
            direction: .outbound,
            peerName: displayName.isBlank ? auth.to : displayName,
            peerNumber: auth.to,
            phase: .connecting
        )
        state = CallStateMachine.placing(state, snapshot)
        watch(handle)
        onEvent?(.outgoingPlaced(snapshot))
    }

    /// Answer a ringing call; any active call is held first (call waiting).
    func answer(_ id: String) {
        guard let handle = handles[id],
              let call = state.calls.first(where: { $0.id == id }),
              call.phase == .ringing
        else { return }
        if let active = state.activeId, active != id {
            requestHold(active, hold: true)
        }
        handle.answer()
        // The caller may have hung up in the same instant — the ring's end
        // event clears the chip silently.
    }

    /// CallKit performed the SDK-level answer itself (answerFromCallkit) —
    /// run only the call-waiting bookkeeping: hold whatever call is active.
    func noteAnswerIntent(_ id: String) {
        guard let call = state.calls.first(where: { $0.id == id }),
              call.phase == .ringing
        else { return }
        if let active = state.activeId, active != id {
            requestHold(active, hold: true)
        }
    }

    /// Decline a ringing call / hang up a live one — same SDK verb.
    func hangup(_ id: String) {
        guard let handle = handles[id] else {
            // Already torn down — just clear the chip.
            state = CallStateMachine.dismissed(state, id: id)
            return
        }
        handle.end()
    }

    /// Hold/unhold flip — unholding another call swaps the active audio.
    func toggleHold(_ id: String) {
        guard let call = state.calls.first(where: { $0.id == id }) else { return }
        switch call.phase {
        case .held:
            if let active = state.activeId, active != id {
                requestHold(active, hold: true)
            }
            requestHold(id, hold: false)
        case .active:
            requestHold(id, hold: true)
        default:
            break
        }
    }

    func setMuted(_ id: String, muted: Bool) {
        guard let handle = handles[id] else { return }
        handle.setMuted(muted)
        state = CallStateMachine.muted(state, id: id, muted: muted)
    }

    func dtmf(_ id: String, digit: String) {
        guard let handle = handles[id] else { return }
        handle.dtmf(digit)
    }

    func dismiss(_ id: String) {
        state = CallStateMachine.dismissed(state, id: id)
    }

    /// Command hold/unhold strictly from the SDK's own last-reported phase
    /// (never the reduced state, which demotes calls structurally before the
    /// SDK follows) and never while a command is already in flight — a
    /// doubled command would fight the first.
    private func requestHold(_ id: String, hold: Bool) {
        guard let handle = handles[id], let actual = sdkPhases[id] else { return }
        let eligible = hold ? actual == .active : actual == .held
        guard eligible else { return }
        guard pendingHold.insert(id).inserted else { return }
        if hold {
            handle.hold()
        } else {
            handle.unhold()
        }
    }

    // MARK: - Live-call ops

    func liveFacts(sessionId: String) async throws -> LiveCallFacts {
        try await api.liveFacts(companyId: requireCompany(), sessionId: sessionId)
    }

    func transferTargets(sessionId: String) async throws -> TransferTargets {
        try await api.transferTargets(companyId: requireCompany(), sessionId: sessionId)
    }

    func blindTransfer(sessionId: String, targetUserId: String) async throws -> TransferAck {
        try await api.blindTransfer(
            companyId: requireCompany(),
            sessionId: sessionId,
            targetUserId: targetUserId
        )
    }

    /// Push-to-wake part 2: ensure the softphone is registered, then ask the
    /// server to re-ring THIS member for the still-ringing call. A conflict
    /// (already answered/ended — someone beat us) or not_found (the push aged
    /// out) is SILENT by contract; anything else propagates so the caller can
    /// retry.
    func onIncomingCallPush(sessionId: String) async throws {
        let company = try requireCompany()
        try await ensureConnected()
        try await awaitReady()
        do {
            _ = try await api.ringMe(companyId: company, sessionId: sessionId)
        } catch let error as ApiError
            where error.code == ApiErrorCode.conflict || error.code == ApiErrorCode.notFound {
            // Answered/ended elsewhere, or the push aged out — silent.
        }
    }

    func setAudioRoute(_ route: AudioRoute) {
        sdk.setAudioRoute(route)
    }

    private func requireCompany() throws -> String {
        guard let companyId else {
            throw ApiError(
                code: ApiErrorCode.network,
                message: "Calling isn't ready yet. Try again in a moment.",
                httpStatus: 0
            )
        }
        return companyId
    }
}
