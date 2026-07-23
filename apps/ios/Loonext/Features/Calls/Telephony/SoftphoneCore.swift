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
/// - #213 OUTBOUND: the SERVER dials the customer; the client NEVER dials it.
///   `placeCall` authorizes (getting S), registers a pending placement, and
///   waits for the server-dialed placer (op) INVITE (an inbound SDK call
///   carrying `X-Loonext-Session=S`), auto-answers it, and reconciles it into
///   the "Calling…" chip as an OUTBOUND call whose customer session is S.
/// - An answered INBOUND call's SDK leg is the RING leg — the customer
///   call_session_id resolves via GET /v1/calls/live/by-leg/{ccid} before any
///   live-call op can run. (An OUTBOUND op leg already knows S — no by-leg.)
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

    /// #213 — how long to wait for the server-dialed placer (op) INVITE after
    /// authorize before giving up on a placement. Set just PAST the server's 45s
    /// ring window so a late op INVITE can never arrive after the timeout fires
    /// and be mistaken for a fresh inbound ring (review M2). Mirrors the web
    /// `PLACEMENT_TIMEOUT_MS` (48s); injectable so the timeout path is unit-testable.
    @ObservationIgnored private let placementTimeout: Duration

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

    /// #195 F2 — when each RINGING inbound leg was FIRST seen, keyed by call id.
    /// A side map on purpose: `CallSnapshot` is a published shape and must not
    /// grow a field for a private TTL. Entries die with the leg (ended / reap).
    /// Mirrors the Android `ringFirstSeenMs`.
    @ObservationIgnored private var ringFirstSeen: [String: Date] = [:]

    @ObservationIgnored private var connectTask: Task<Void, Error>?
    @ObservationIgnored private var recoverTask: Task<Void, Never>?

    /// #195 F2 — the single self-terminating ring-TTL sweep task (nil when no
    /// inbound ring is tracked).
    @ObservationIgnored private var ringTtlTask: Task<Void, Never>?

    @ObservationIgnored private(set) var companyId: String?
    @ObservationIgnored private var callerIdName = ""

    /// The PushKit VoIP token — attached to the NEXT registration so Telnyx's
    /// iOS push credential can ring this device while the socket is down.
    @ObservationIgnored private var pushDeviceToken: String?

    /// #213 — an outbound placement awaiting its server-dialed placer (op)
    /// INVITE, keyed by S (`call_session_id` from POST /v1/calls/browser). The
    /// SERVER dials the customer as a real Call-Control leg AND rings THIS
    /// member's own softphone as the placer (op) leg; that INVITE arrives as an
    /// *inbound* SDK call carrying `X-Loonext-Session=S`. `onIncoming` correlates
    /// it here, AUTO-answers it, and reconciles the "Calling…" chip — never a
    /// ring UI. The client NO LONGER dials the customer. A Swift port of the web
    /// `pendingPlacementsRef` (apps/web/src/lib/softphone/provider.tsx).
    private struct PendingPlacement {
        /// The synthetic "Calling…" chip id (= S) until the op INVITE rekeys it.
        let placementId: String
        /// The customer, for the chip + the op-leg peer fallback.
        let peer: (name: String, number: String)
        /// The call that was ACTIVE when this call was placed (nil if idle). It
        /// is SDK-held only when the op leg actually connects (#148 — never held
        /// against a placement that may still time out), so iOS never leaves two
        /// un-held legs fighting for the audio path (there is no single-sink
        /// swap like the web).
        let previousActiveId: String?
        /// Fires `placementFailed` if the op INVITE never lands in the window.
        let timeout: Task<Void, Never>
    }

    @ObservationIgnored private var pendingPlacements: [String: PendingPlacement] = [:]

    /// #213 — placements the user cancelled during "Calling…" (before the op
    /// INVITE landed). When the op INVITE arrives for a cancelled S it is
    /// DECLINED (hung up) so the DO tears down the server-dialed customer.
    @ObservationIgnored private var cancelledPlacements: Set<String> = []


    init(
        api: any CallsBackend,
        sdk: any SoftphoneSdk,
        recoverDebounce: Duration = .seconds(4),
        readyTimeout: Duration = .seconds(15),
        // #213: past the server's 45s ring window so a late op INVITE can't arrive
        // after the timeout and be mistaken for a fresh inbound ring (matches web).
        placementTimeout: Duration = .seconds(48),
        now: @escaping () -> Date = { Date() }
    ) {
        self.api = api
        self.sdk = sdk
        self.recoverDebounce = recoverDebounce
        self.readyTimeout = readyTimeout
        self.placementTimeout = placementTimeout
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
        // #195 F3: only a genuinely engaged leg defers the rebuild — a
        // silenced/stale ring must never wedge a token-driven reconnect.
        if state.status == .ready && !state.anyEngaged {
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
            // #195 F3 honest gate: only a GENUINELY ENGAGED leg defers recovery
            // (#138's "never rebuild while a call is live"). A silenced/stale
            // RINGING zombie is presentation debris, not a call — letting it
            // wedge recovery is how a dead socket stayed dead for good. The
            // reap (F1) and TTL sweep (F2) clear such debris so this passes.
            if self.state.anyEngaged { return }
            try? await self.ensureConnected()
        }
    }

    /// Status-pill tap: force a rebuild now (still refuses during a call).
    func retryNow() {
        // #195 F3: same honest gate as scheduleRecover — an engaged leg refuses
        // the rebuild; a zombie ring must never block the user's own retry.
        if state.anyEngaged { return }
        sdk.disconnect()
        state = CallStateMachine.disconnected(state)
        Task { try? await self.ensureConnected() }
    }

    /// #195 F5 — the socket reset after a FAILED answer: an ANSWERED ring never
    /// materialized as a live leg within the bind deadline (the zombie-socket
    /// signature — the SDK claims READY but its leg never binds). Drop the
    /// stuck ring's presentation (state hygiene, never a BYE — same path as the
    /// F1/F2 reap), then, if nothing else is genuinely engaged, rebuild the
    /// socket outright (mint-on-connect is the designed recovery) so at most
    /// ONE call is ever lost to a zombie socket. No leg is hung up here.
    func forceRecoverAfterAnswerFailure(stuckId: String) {
        if let call = state.calls.first(where: { $0.id == stuckId }),
           call.phase == .ringing {
            dropRingingPresentation(stuckId)
        }
        if state.anyEngaged { return }
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
            // #195 F1: a dead client's RINGING legs are ZOMBIES — their phase
            // callbacks can never fire again after a rebuild, so nothing else
            // will ever clear them and they wedge every gate that counts them.
            // Reap the presentation now (never a BYE — the server owns legs).
            reapOnClientDeath()
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

        case .incoming(let call, let callerName, let callerNumber, let sessionHeader):
            onIncoming(
                call,
                callerName: callerName,
                callerNumber: callerNumber,
                sessionHeader: sessionHeader
            )
        }
    }

    private func onIncoming(
        _ handle: any SdkCallHandle,
        callerName: String?,
        callerNumber: String?,
        sessionHeader: String?
    ) {
        // #213: FIRST — is this THIS member's own server-dialed placer (op) leg
        // for a call they just placed? The server stamps X-Loonext-Session=S on
        // the placer dial; correlate it to the placement registered in placeCall.
        // Checked before the dedup/ceiling gates so an op leg is never declined
        // as an "over-ceiling" inbound ring.
        if let session = sessionHeader, !session.isEmpty {
            if let pending = pendingPlacements[session] {
                connectPlacement(pending, session: session, handle: handle, callerNumber: callerNumber)
                return
            }
            if cancelledPlacements.contains(session) {
                // The member cancelled during "Calling…" — decline the op leg so
                // the DO tears the call down (drops the server-dialed customer).
                cancelledPlacements.remove(session)
                handle.end()
                return
            }
        }
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
        // #195 F2: start this ring's TTL clock and ensure the sweep is running.
        ringFirstSeen[handle.id] = now()
        state = CallStateMachine.incoming(state, snapshot)
        watch(handle)
        ensureRingTtlSweep()
        onEvent?(.incomingRinging(snapshot))
    }

    /// #213 — the server-dialed placer (op) INVITE for a pending placement
    /// arrived. AUTO-answer it (the mic was pre-granted before authorize, so no
    /// re-prompt) and reconcile it into the existing "Calling…" chip: rekey the
    /// synthetic S id onto the real SDK call id, KEEPING it OUTBOUND to the
    /// customer with S as the (already-known) server session. Because the chip
    /// stays `direction == .outbound` with `sessionId == S`, `onPhase` does NOT
    /// run the inbound by-leg resolver — the customer session is already known —
    /// which is exactly the web `placementSdkIds` carve-out, achieved here for
    /// free via the snapshot direction. Never presents the incoming-ring UI.
    private func connectPlacement(
        _ pending: PendingPlacement,
        session: String,
        handle: any SdkCallHandle,
        callerNumber: String?
    ) {
        pending.timeout.cancel()
        pendingPlacements.removeValue(forKey: session)
        let id = handle.id
        handles[id] = handle
        sdkPhases[id] = .connecting
        // The op leg's peer IS the customer. The server rides X-Loonext-Caller
        // (surfaced here as `callerNumber`) on the placer dial, and the
        // placement's stored customer number (= auth.to) is the header-less
        // fallback — both are the SAME server-side customer E.164 by
        // construction, so the "Calling…" chip's peer (set at placing to auth.to)
        // already carries it. `placementConnected` keeps that peer + the outbound
        // direction while rekeying onto the real SDK leg (web-exact).
        let customerNumber: String
        if let caller = callerNumber, !caller.isEmpty {
            customerNumber = caller
        } else {
            customerNumber = pending.peer.number
        }
        state = CallStateMachine.placementConnected(
            state,
            placementId: pending.placementId,
            id: id,
            sessionId: session,
            peerNumber: customerNumber
        )
        watch(handle)
        // The op leg now exists (#148): SDK-hold whatever call was active when
        // this call was placed, so its audio path yields to the connecting
        // outbound leg. The reducer also demotes it structurally when the op leg
        // goes `.active`; this makes the SDK match. `requestHold` is a no-op if
        // that call already ended or is no longer active.
        if let previousActive = pending.previousActiveId, previousActive != id {
            requestHold(previousActive, hold: true)
        }
        // Answer AFTER the watch is installed so the leg's `.active` transition
        // is never missed.
        handle.answer()
        if let placed = state.calls.first(where: { $0.id == id }) {
            // Present it to CallKit as OUTBOUND now (deferred from placeCall,
            // where no SDK-mapped UUID existed yet — see placeCall).
            onEvent?(.outgoingPlaced(placed))
        }
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
            // #195 F2: an answered leg is no longer a ring — stop its TTL clock
            // (a live call must never be swept).
            ringFirstSeen.removeValue(forKey: id)
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
            ringFirstSeen.removeValue(forKey: id) // #195 F2: clock dies with leg
            // A recovery may have been deferred while this call held the
            // client (#138) — re-arm once the line is genuinely idle (#195 F3).
            if state.status != .ready && !state.anyEngaged {
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

    // MARK: - Zombie hygiene (#195)

    /// #195 F1 — the SDK client died (`.disconnected`): every still-RINGING call
    /// belonged to that client and its per-call phase callback can NEVER fire
    /// again after a rebuild, so nothing else will ever clear it. Drop the
    /// ringing presentation now so no immortal zombie wedges the recovery/wake
    /// gates. State hygiene, not teardown: no BYE, no decline — the server owns
    /// the legs. (iOS has no held-INVITE concept, so the Android held-invite
    /// reap has no counterpart here.)
    private func reapOnClientDeath() {
        for call in state.calls where call.phase == .ringing {
            dropRingingPresentation(call.id)
        }
    }

    /// #195 F2 — one self-terminating sweep while any inbound ring is tracked;
    /// exits on its own once nothing is left, so it can never leak. Each pass
    /// drops rings older than `CallWakePolicy.ringTtlSeconds` (the server ring
    /// window plus grace, so the real leg is already dead). Presentation state
    /// only; never a BYE.
    private func ensureRingTtlSweep() {
        guard ringTtlTask == nil else { return }
        ringTtlTask = Task { [weak self] in
            while true {
                try? await Task.sleep(for: CallWakePolicy.ringTtlSweep)
                guard let self, !self.ringFirstSeen.isEmpty else { break }
                self.reapExpiredRings()
                if self.ringFirstSeen.isEmpty { break }
            }
            self?.ringTtlTask = nil
        }
    }

    private func reapExpiredRings() {
        let current = now()
        let expiredIds: [String] = state.calls.compactMap { call -> String? in
            guard call.direction == .inbound, call.phase == .ringing else { return nil }
            guard let firstSeen = ringFirstSeen[call.id] else { return nil }
            return CallWakePolicy.ringExpired(firstSeen: firstSeen, now: current)
                ? call.id
                : nil
        }
        for id in expiredIds {
            dropRingingPresentation(id)
        }
        // Prune stray timestamps for ids no longer ringing so the sweep's own
        // liveness check can reach empty.
        let tracked = Set(state.calls.filter { $0.phase == .ringing }.map(\.id))
        ringFirstSeen = ringFirstSeen.filter { tracked.contains($0.key) }
        // A recovery may have been deferred behind the stale ring — re-arm once
        // the line is genuinely idle (#195 F3).
        if state.status != .ready && !state.anyEngaged {
            scheduleRecover()
        }
    }

    /// Drop ONE still-RINGING call's local presentation (F1/F2/F5): forget its
    /// handle and side-map entries, then remove it from `calls` through the same
    /// silent-removal path a server-reaped ring takes (the ENDED reducer filters
    /// a ringing call out). The state change drives the CallKit teardown
    /// (`syncCallKit` reports ended) exactly like a real ring death. NEVER ends
    /// the leg — the server owns it (no `handle.end`, no BYE).
    private func dropRingingPresentation(_ id: String) {
        handles.removeValue(forKey: id)
        sdkPhases.removeValue(forKey: id)
        resolvingLegs.remove(id)
        pendingHold.remove(id)
        ringFirstSeen.removeValue(forKey: id)
        state = CallStateMachine.sdkPhase(state, id: id, phase: .ended, now: now())
    }

    // MARK: - Ops

    /// Place an outbound call. Exactly one origin: an existing thread, a
    /// contact (no thread yet), or raw dialed digits. Gate refusals surface as
    /// `ApiError` BY CODE (usage_cap_reached, subscription_inactive, conflict
    /// "line on another call", validation_failed).
    ///
    /// #213: the SERVER now dials the customer (a real, controllable
    /// Call-Control leg) and rings THIS member's own softphone as the placer
    /// (op) leg — the client NO LONGER dials the customer (that only ever
    /// produced the placer's own WebRTC leg, so a blind transfer's bridge-steal
    /// grabbed the wrong leg and dropped the customer). Authorize returns S; we
    /// register a PENDING PLACEMENT keyed on S and show a "Calling…" chip, then
    /// wait for the op INVITE (an inbound SDK call carrying X-Loonext-Session=S)
    /// which `onIncoming` auto-answers and reconciles into this chip. No dial.
    ///
    /// CallKit is reported at reconcile-time (connectPlacement), not here: the
    /// op leg's SDK UUID — the one the Telnyx SDK keys its CallKit answer/end on
    /// — is unknown until the INVITE lands, and CallKit calls cannot be
    /// re-keyed, so the brief "Calling…" window is in-app-chip only.
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
        // Make sure the phone is registered so the op INVITE can reach us (the
        // same registration that makes inbound ring work). No newCall.
        try await ensureConnected()
        try await awaitReady()
        guard let sessionId = auth.call_session_id, !sessionId.isEmpty else {
            // A server that returned no S cannot be correlated to an op INVITE —
            // fail honestly rather than leave a silent dead chip. Mirrors web.
            throw ApiError(
                code: ApiErrorCode.conflict,
                message: "Couldn't start the call. Please try again.",
                httpStatus: 409
            )
        }
        let peer = (name: displayName.isBlank ? auth.to : displayName, number: auth.to)
        // The call currently holding the audio (if any) — held only when the op
        // leg connects (connectPlacement), never eagerly against a placement
        // that could still time out (#148).
        let previousActiveId = state.activeId
        // A per-placement timeout: if the op INVITE never arrives (server dial
        // failed after the 200, or the ring window lapsed), drop the chip + warn.
        let timeout = Task { [weak self, placementTimeout] in
            try? await Task.sleep(for: placementTimeout)
            guard let self else { return }
            guard self.pendingPlacements[sessionId] != nil else { return }
            self.pendingPlacements.removeValue(forKey: sessionId)
            self.state = CallStateMachine.placementFailed(
                self.state,
                placementId: sessionId,
                message: "Couldn't reach the line. Please try again."
            )
        }
        pendingPlacements[sessionId] = PendingPlacement(
            placementId: sessionId,
            peer: peer,
            previousActiveId: previousActiveId,
            timeout: timeout
        )
        // The synthetic "Calling…" chip. Its id IS S (a server-minted UUID, so a
        // valid CallKit UUID once reconciled); it carries S as the session so a
        // transfer/consult affordance can light immediately. No leg to hold the
        // current active call against yet — the op leg going `.active` demotes
        // it structurally (onPhase), so nothing is held prematurely (#148).
        let snapshot = CallSnapshot(
            id: sessionId,
            direction: .outbound,
            peerName: peer.name,
            peerNumber: peer.number,
            phase: .connecting,
            sessionId: sessionId
        )
        state = CallStateMachine.placing(state, snapshot)
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
        // #213: cancelling a placement that is still "Calling…" (no op INVITE
        // yet). Its chip id is S and there is no SDK call to hang up; mark S
        // cancelled so the op INVITE, when it arrives, is DECLINED (the DO then
        // drops the server-dialed customer), and clear the pending timer + chip.
        if let pending = pendingPlacements[id] {
            pending.timeout.cancel()
            pendingPlacements.removeValue(forKey: id)
            cancelledPlacements.insert(id)
            state = CallStateMachine.dismissed(state, id: id)
            return
        }
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

/// #212 caller-id — the trusted custom SIP headers the ring server stamps on the
/// INVITE. The Telnyx-rewritten INVITE `from` is a connection-owned number (the
/// business number) for WebRTC legs, NOT the caller, so these headers carry the
/// real caller. A Swift port of the Android `TelecomCallReducer` header
/// discipline; read case-insensitively and forward-compatibly (the name header
/// is absent until the server stamps it, per #211).
///
/// The iOS Telnyx SDK exposes them as `Call.inviteCustomHeaders: [String:String]?`
/// (a name-keyed dictionary), so the resolution runs at the SDK boundary
/// (`TelnyxSdkClient.trackIncoming`) before the `SdkEvent.incoming` fires — the
/// core then presents the already-preferred caller.
enum CallerHeaders {
    static let callerHeader = "X-Loonext-Caller"
    static let callerNameHeader = "X-Loonext-Caller-Name"

    /// #213 correlation — the server session `X-Loonext-Session` (= S) stamped on
    /// every member ring dial AND on the outbound placer (op) dial. The mirror of
    /// Android's `TelecomCallReducer.HEADER_NAME` / `correlateInvite`. The core
    /// matches this against its pending placements: a hit is THIS member's own
    /// server-dialed op leg (auto-answer it), anything else is a genuine inbound
    /// ring resolved the existing way.
    static let sessionHeader = "X-Loonext-Session"

    /// The server session off `X-Loonext-Session`, or nil when absent/blank.
    /// Case-insensitive, forward-compatible — same discipline as `caller`.
    static func session(from headers: [String: String]?) -> String? {
        value(headers, named: sessionHeader)
    }

    /// The real caller's E.164 off `X-Loonext-Caller`, or nil when absent/blank.
    static func caller(from headers: [String: String]?) -> String? {
        value(headers, named: callerHeader)
    }

    /// The caller display name off `X-Loonext-Caller-Name`, or nil.
    static func callerName(from headers: [String: String]?) -> String? {
        value(headers, named: callerNameHeader)
    }

    /// #212 caller-id precedence — prefer the trusted headers over the
    /// Telnyx-rewritten INVITE `from`/CNAM, matching the Android `onIncoming`
    /// resolution. When the caller header is present the INVITE name is the
    /// business number's CNAM and is deliberately dropped; the INVITE values are
    /// used only for a header-less leg (older server, or an anonymous/CLIR
    /// caller the server sends no header for).
    static func resolve(
        headers: [String: String]?,
        inviteNumber: String?,
        inviteName: String?
    ) -> (number: String?, name: String?) {
        let headerCaller = caller(from: headers)
        let headerName = callerName(from: headers)
        let number = headerCaller ?? inviteNumber
        let name = headerName ?? (headerCaller == nil ? inviteName : nil)
        return (number, name)
    }

    /// Case-insensitive header lookup returning the first non-blank value (the
    /// raw value, untrimmed — mirrors Android's `takeIf { isNotBlank() }`).
    private static func value(_ headers: [String: String]?, named: String) -> String? {
        guard let headers else { return nil }
        for (key, raw) in headers where key.caseInsensitiveCompare(named) == .orderedSame {
            if !raw.trimmingCharacters(in: .whitespaces).isEmpty { return raw }
        }
        return nil
    }
}
