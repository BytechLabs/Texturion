import XCTest
@testable import Loonext

/// #161 telephony mapping coverage, ported from the Android twins
/// (`CallStateMachineTest.kt`, `ClientStateTest.kt`, `SoftphoneCoreTest.kt`)
/// where the semantics match:
///
/// - `CallStateMachineTests` — the pure reducer every surface renders from.
/// - `ClientStateMappingTests` — client_state VERBATIM on the wire (the iOS
///   SDK, unlike Android's, does NOT re-encode — see ClientState.swift).
/// - `TelephonyMappingTests` — the CallKit-action <-> SDK-op table against
///   `SoftphoneCore` with a fake SDK + fake backend. Each CallKit action's
///   core-side half is what `CallsManager.wireCallKit` routes into:
///   CXAnswerCallAction -> noteAnswerIntent + SDK answer; CXEndCallAction ->
///   hangup/dismiss; CXSetHeldCallAction -> toggleHold; CXSetMutedCallAction
///   -> setMuted; CXPlayDTMFCallAction -> dtmf per digit; the group swap is
///   toggleHold on a held call (hold-active-then-unhold-target).

// MARK: - Fakes (the Android twins' FakeSdk/FakeHandle shapes, on MainActor)

@MainActor
private final class FakeHandle: SdkCallHandle {
    let id: String
    let callControlId: String?
    let telnyxSessionId: String?
    var onPhase: ((CallPhase?) -> Void)?

    var answered = false
    var ended = false
    var holds = 0
    var unholds = 0
    var lastMuted: Bool?
    var dtmfDigits = ""

    init(id: String, callControlId: String? = nil, telnyxSessionId: String? = nil) {
        self.id = id
        self.callControlId = callControlId
        self.telnyxSessionId = telnyxSessionId
    }

    func answer() { answered = true }

    func end() {
        ended = true
        // The SDK reports DONE after a hangup — mirror it.
        onPhase?(.ended)
    }

    func hold() { holds += 1 }

    func unhold() { unholds += 1 }

    func setMuted(_ muted: Bool) { lastMuted = muted }

    func dtmf(_ digit: String) { dtmfDigits += digit }

    /// Drive an SDK phase report into whatever the core installed.
    func report(_ phase: CallPhase?) { onPhase?(phase) }
}

@MainActor
private final class FakeSdk: SoftphoneSdk {
    var onEvent: ((SdkEvent) -> Void)?

    struct Placed {
        let callerIdName: String
        let callerIdNumber: String
        let destinationNumber: String
        let clientState: String
    }

    var connects = 0
    var disconnects = 0
    var readyOnConnect = true
    var lastPushDeviceToken: String?
    var nextOutboundSessionId: String?
    var placed: [Placed] = []
    var outboundHandles: [FakeHandle] = []

    func connect(token: String, callerIdName: String, pushDeviceToken: String?) throws {
        connects += 1
        lastPushDeviceToken = pushDeviceToken
        if readyOnConnect { onEvent?(.ready) }
    }

    func disconnect() { disconnects += 1 }

    func newCall(
        callerIdName: String,
        callerIdNumber: String,
        destinationNumber: String,
        clientState: String
    ) throws -> any SdkCallHandle {
        placed.append(Placed(
            callerIdName: callerIdName,
            callerIdNumber: callerIdNumber,
            destinationNumber: destinationNumber,
            clientState: clientState
        ))
        let handle = FakeHandle(
            id: "out-\(placed.count)",
            telnyxSessionId: nextOutboundSessionId
        )
        outboundHandles.append(handle)
        return handle
    }

    func setAudioRoute(_ route: AudioRoute) {}

    func ring(
        _ handle: FakeHandle,
        name: String? = "Dana",
        number: String? = "+15557778888"
    ) {
        onEvent?(.incoming(call: handle, callerName: name, callerNumber: number))
    }

    func emit(_ event: SdkEvent) { onEvent?(event) }
}

@MainActor
private final class FakeBackend: CallsBackend {
    // The exact base64 the server would mint: btoa('oc_customer|<to>|<nonce>').
    let serverClientState = ClientState.serverMint(
        "oc_customer|+15552223333|nonce-1"
    )

    var tokenMints = 0
    var byLegHits = 0
    var resolvedByLegCcids: [String] = []
    var ringMeCalls: [String] = []
    var ringMeError: ApiError?

    func mintToken(companyId: String) async throws -> WebRtcToken {
        tokenMints += 1
        return WebRtcToken(token: "telnyx-jwt", sip_username: "sip-u1", expires_in_hours: 24)
    }

    func authorizeBrowserCall(
        companyId: String,
        conversationId: String?,
        contactId: String?,
        to: String?,
        phoneNumberId: String?
    ) async throws -> BrowserCallAuth {
        BrowserCallAuth(
            from: "+15550001111",
            to: to ?? "+15552223333",
            client_state: serverClientState
        )
    }

    func resolveByLeg(companyId: String, legCcid: String) async throws -> LegResolution {
        byLegHits += 1
        resolvedByLegCcids.append(legCcid)
        return LegResolution(call_session_id: "sess-real")
    }

    func liveFacts(companyId: String, sessionId: String) async throws -> LiveCallFacts {
        LiveCallFacts(conversation_id: nil, caller_e164: nil)
    }

    func transferTargets(companyId: String, sessionId: String) async throws -> TransferTargets {
        TransferTargets(targets: [])
    }

    func blindTransfer(
        companyId: String,
        sessionId: String,
        targetUserId: String
    ) async throws -> TransferAck {
        TransferAck(status: "ringing")
    }

    func ringMe(companyId: String, sessionId: String) async throws -> RingAck {
        ringMeCalls.append(sessionId)
        if let ringMeError { throw ringMeError }
        return RingAck(ok: true)
    }
}

// MARK: - CallStateMachine (pure reducer — Android CallStateMachineTest port)

final class CallStateMachineTests: XCTestCase {
    private func ringing(_ id: String) -> CallSnapshot {
        CallSnapshot(
            id: id,
            direction: .inbound,
            peerName: "Dana",
            peerNumber: "+15551230000",
            phase: .ringing
        )
    }

    private func outbound(_ id: String) -> CallSnapshot {
        CallSnapshot(
            id: id,
            direction: .outbound,
            peerName: "Ari",
            peerNumber: "+15559998888",
            phase: .connecting
        )
    }

    private func at(_ seconds: TimeInterval) -> Date {
        Date(timeIntervalSince1970: seconds)
    }

    func testAnUnansweredInboundRingEndsSilentlyNoEndedChip() {
        var state = CallStateMachine.incoming(SoftphoneSnapshot(), ringing("a"))
        XCTAssertEqual(.ringing, state.calls.first?.phase)

        state = CallStateMachine.sdkPhase(state, id: "a", phase: .ended, now: at(1))
        XCTAssertTrue(state.calls.isEmpty)
    }

    func testEarlySdkStatesNeverMorphARingingCallsAnswerChip() {
        var state = CallStateMachine.incoming(SoftphoneSnapshot(), ringing("a"))
        state = CallStateMachine.sdkPhase(state, id: "a", phase: .connecting, now: at(0))
        XCTAssertEqual(.ringing, state.calls.first?.phase)
    }

    func testACallGoingActiveDemotesThePreviousActiveCallToHeld() {
        var state = CallStateMachine.placing(SoftphoneSnapshot(), outbound("out"))
        state = CallStateMachine.sdkPhase(state, id: "out", phase: .active, now: at(5))
        XCTAssertEqual("out", state.activeId)
        XCTAssertEqual(at(5), state.calls.first?.activeSince)

        state = CallStateMachine.incoming(state, ringing("in"))
        state = CallStateMachine.sdkPhase(state, id: "in", phase: .active, now: at(9))

        XCTAssertEqual("in", state.activeId)
        XCTAssertEqual(.held, state.calls.first { $0.id == "out" }?.phase)
        XCTAssertEqual(.active, state.calls.first { $0.id == "in" }?.phase)
    }

    func testActiveSinceAnchorsOnFirstActivationAndSurvivesHoldResume() {
        var state = CallStateMachine.placing(SoftphoneSnapshot(), outbound("out"))
        state = CallStateMachine.sdkPhase(state, id: "out", phase: .active, now: at(1))
        state = CallStateMachine.sdkPhase(state, id: "out", phase: .held, now: at(2))
        XCTAssertNil(state.activeId)
        state = CallStateMachine.sdkPhase(state, id: "out", phase: .active, now: at(3))
        XCTAssertEqual(at(1), state.calls.first?.activeSince)
    }

    func testAnEstablishedCallsEndKeepsADismissibleEndedChip() {
        var state = CallStateMachine.placing(SoftphoneSnapshot(), outbound("out"))
        state = CallStateMachine.sdkPhase(state, id: "out", phase: .active, now: at(0))
        state = CallStateMachine.sdkPhase(state, id: "out", phase: .ended, now: at(1))

        XCTAssertEqual(.ended, state.calls.first?.phase)
        XCTAssertNil(state.activeId)
        XCTAssertTrue(state.liveCalls.isEmpty)

        state = CallStateMachine.dismissed(state, id: "out")
        XCTAssertTrue(state.calls.isEmpty)
    }

    func testPlacingANewCallSweepsOldEndedChips() {
        var state = CallStateMachine.placing(SoftphoneSnapshot(), outbound("one"))
        state = CallStateMachine.sdkPhase(state, id: "one", phase: .active, now: at(0))
        state = CallStateMachine.sdkPhase(state, id: "one", phase: .ended, now: at(1))
        state = CallStateMachine.placing(state, outbound("two"))
        XCTAssertEqual(["two"], state.calls.map(\.id))
    }

    func testDuplicateIncomingEventsAreIgnored() {
        var state = CallStateMachine.incoming(SoftphoneSnapshot(), ringing("a"))
        state = CallStateMachine.incoming(state, ringing("a"))
        XCTAssertEqual(1, state.calls.count)
    }

    func testSessionKnownPatchesOnlyTheTargetCall() {
        var state = CallStateMachine.incoming(SoftphoneSnapshot(), ringing("a"))
        state = CallStateMachine.incoming(state, ringing("b"))
        state = CallStateMachine.sessionKnown(state, id: "a", sessionId: "sess-1")
        XCTAssertEqual("sess-1", state.calls.first { $0.id == "a" }?.sessionId)
        XCTAssertNil(state.calls.first { $0.id == "b" }?.sessionId)
    }

    func testDisconnectDropsRegistrationButKeepsTheCalls() {
        var state = CallStateMachine.ready(SoftphoneSnapshot())
        state = CallStateMachine.placing(state, outbound("out"))
        state = CallStateMachine.disconnected(state)
        XCTAssertEqual(.disconnected, state.status)
        XCTAssertEqual(1, state.calls.count)
    }
}

// MARK: - ClientState (the iOS boundary is VERBATIM — no Android-style decode)

final class ClientStateMappingTests: XCTestCase {
    func testServerClientStateReachesTheIOSSdkVerbatim() {
        let raw = "oc_customer|+15551234567|6a1c2f9e-9b7d-4f1e-8f7a-2c3d4e5f6a7b"
        let server = ClientState.serverMint(raw)

        // iOS is identity end-to-end: the SDK sends its input unmodified.
        let sdkInput = ClientState.forIOSSdk(server)
        XCTAssertEqual(server, sdkInput)
        XCTAssertEqual(server, ClientState.wireValue(sdkInput))

        // The wire value decodes back to the exact minted tag (nonce intact).
        XCTAssertEqual(raw, ClientState.decodedTag(ClientState.wireValue(sdkInput)))
        let parts = raw.split(separator: "|")
        XCTAssertEqual(3, parts.count)
        XCTAssertEqual("oc_customer", parts[0])
    }

    func testLongStatesSurviveTheRoundTripNoLineWrapping() {
        // > 57 raw bytes — a wrapping base64 encoder would corrupt this.
        let raw = "oc_customer|+15551234567|" + String(repeating: "n", count: 80)
        let server = ClientState.serverMint(raw)
        XCTAssertFalse(server.contains("\n"))
        XCTAssertEqual(server, ClientState.wireValue(ClientState.forIOSSdk(server)))
        XCTAssertEqual(raw, ClientState.decodedTag(server))
    }

    func testANonBase64ValueDecodesToNilLikeAForgedState() {
        // The webhook rejects it either way — identical to a forged state.
        XCTAssertEqual("not base64!!", ClientState.forIOSSdk("not base64!!"))
        XCTAssertNil(ClientState.decodedTag("not base64!!"))
    }
}

// MARK: - SoftphoneCore (CallKit-op <-> SDK-op table, Android SoftphoneCoreTest port)

@MainActor
final class TelephonyMappingTests: XCTestCase {
    private func makeCore() -> (SoftphoneCore, FakeSdk, FakeBackend) {
        let backend = FakeBackend()
        let sdk = FakeSdk()
        let core = SoftphoneCore(
            api: backend,
            sdk: sdk,
            recoverDebounce: .milliseconds(5),
            readyTimeout: .seconds(5)
        )
        return (core, sdk, backend)
    }

    private func startReady(
        _ core: SoftphoneCore,
        callerIdName: String = "Sam"
    ) async throws {
        core.start(companyId: "company-1", callerIdName: callerIdName)
        try await core.awaitReady()
    }

    /// Poll a MainActor condition with a wall-clock deadline (the fakes run
    /// on the main actor; there is no virtual clock to race).
    private func waitFor(
        _ label: String,
        timeout: Duration = .seconds(3),
        _ condition: @MainActor () -> Bool
    ) async throws {
        let clock = ContinuousClock()
        let deadline = clock.now.advanced(by: timeout)
        while !condition() {
            if clock.now >= deadline {
                XCTFail("timed out waiting for: \(label)")
                return
            }
            try await Task.sleep(for: .milliseconds(10))
        }
    }

    // MARK: outbound

    func testClientStateFromTheServerGoesIntoNewCallVerbatim() async throws {
        let (core, sdk, backend) = makeCore()
        try await startReady(core)

        try await core.placeCall(displayName: "Ari", to: "+15552223333")

        XCTAssertEqual(1, sdk.placed.count)
        let placed = try XCTUnwrap(sdk.placed.first)
        XCTAssertEqual(backend.serverClientState, placed.clientState)
        XCTAssertEqual("+15552223333", placed.destinationNumber)
        XCTAssertEqual("+15550001111", placed.callerIdNumber)
        let call = try XCTUnwrap(core.state.calls.first)
        XCTAssertEqual(.connecting, call.phase)
        XCTAssertEqual(.outbound, call.direction)
    }

    func testTheTokenIsMintedOnConnectOnlyNeverPerCall() async throws {
        let (core, sdk, backend) = makeCore()
        try await startReady(core)
        XCTAssertEqual(1, backend.tokenMints)

        try await core.placeCall(displayName: "A", to: "+15552223333")
        sdk.outboundHandles[0].report(.active)
        sdk.outboundHandles[0].report(.ended)
        try await core.placeCall(displayName: "B", to: "+15552223333")

        XCTAssertEqual(1, backend.tokenMints, "two calls, still one mint")
        XCTAssertEqual(1, sdk.connects)
    }

    func testAnOutboundLegIsTheCustomerLegItsSessionLandsWithNoByLegCall() async throws {
        let (core, sdk, backend) = makeCore()
        sdk.nextOutboundSessionId = "sess-out"
        try await startReady(core)
        try await core.placeCall(displayName: "A", to: "+15552223333")

        sdk.outboundHandles[0].report(.active)

        let call = try XCTUnwrap(core.state.calls.first)
        XCTAssertEqual(.active, call.phase)
        XCTAssertEqual("sess-out", call.sessionId)
        XCTAssertEqual(0, backend.byLegHits, "outbound never resolves by-leg")
    }

    func testAThirdConcurrentPlaceCallIsRefusedBeforeThirdLineAbuse() async throws {
        let (core, sdk, _) = makeCore()
        try await startReady(core)
        try await core.placeCall(displayName: "A", to: "+15552223333")
        sdk.outboundHandles[0].report(.active)
        try await core.placeCall(displayName: "B", to: "+15552223333")
        do {
            try await core.placeCall(displayName: "C", to: "+15552223333")
            XCTFail("expected conflict")
        } catch let error as ApiError {
            XCTAssertEqual(ApiErrorCode.conflict, error.code)
        }
    }

    // MARK: inbound + answer mapping (CXAnswerCallAction's core half)

    func testAnswerMapsToTheHandleAndResolvesTheCustomerSessionViaByLeg() async throws {
        let (core, sdk, backend) = makeCore()
        try await startReady(core)

        let ringLeg = FakeHandle(id: "in-1", callControlId: "ccid-ring-1")
        sdk.ring(ringLeg)
        XCTAssertEqual(.ringing, core.state.calls.first?.phase)
        XCTAssertNil(core.state.calls.first?.sessionId)

        core.answer("in-1")
        XCTAssertTrue(ringLeg.answered)
        ringLeg.report(.active)

        try await waitFor("by-leg session resolution") {
            core.state.calls.first?.sessionId != nil
        }
        XCTAssertEqual("sess-real", core.state.calls.first?.sessionId)
        XCTAssertEqual(1, backend.byLegHits)
        XCTAssertEqual(["ccid-ring-1"], backend.resolvedByLegCcids)
    }

    func testAnswerIsANoOpForACallThatIsNotRinging() async throws {
        let (core, sdk, _) = makeCore()
        try await startReady(core)
        let leg = FakeHandle(id: "in-1")
        sdk.ring(leg)
        core.answer("in-1")
        leg.report(.active)
        leg.answered = false

        core.answer("in-1") // already active — must not re-answer
        XCTAssertFalse(leg.answered)
    }

    func testAnUnansweredRingThatEndsVanishesSilently() async throws {
        let (core, sdk, _) = makeCore()
        try await startReady(core)
        let ringLeg = FakeHandle(id: "in-1")
        sdk.ring(ringLeg)
        // Another member won the race — the SDK ends our ring leg.
        ringLeg.report(.ended)
        XCTAssertTrue(core.state.calls.isEmpty)
    }

    func testAnsweringASecondCallSdkHoldsTheFirst() async throws {
        let (core, sdk, _) = makeCore()
        try await startReady(core)

        let first = FakeHandle(id: "in-1", callControlId: "ccid-1")
        sdk.ring(first, name: "First")
        core.answer("in-1")
        first.report(.active)

        let second = FakeHandle(id: "in-2", callControlId: "ccid-2")
        sdk.ring(second, name: "Second")
        core.answer("in-2")

        XCTAssertEqual(1, first.holds, "the active first call got the SDK hold")
        XCTAssertTrue(second.answered)

        // The SDK confirms: first held, second active — one active audio path.
        first.report(.held)
        second.report(.active)
        XCTAssertEqual("in-2", core.state.activeId)
        XCTAssertEqual(.held, core.state.calls.first { $0.id == "in-1" }?.phase)
    }

    func testNoteAnswerIntentHoldsTheActiveCallWithoutAnsweringItself() async throws {
        // The CallKit answer path: the SDK's answerFromCallkit does the
        // answer; the core runs ONLY the call-waiting bookkeeping.
        let (core, sdk, _) = makeCore()
        try await startReady(core)

        let first = FakeHandle(id: "in-1")
        sdk.ring(first, name: "First")
        core.answer("in-1")
        first.report(.active)

        let second = FakeHandle(id: "in-2")
        sdk.ring(second, name: "Second")
        core.noteAnswerIntent("in-2")

        XCTAssertEqual(1, first.holds)
        XCTAssertFalse(second.answered, "the SDK CallKit path answers, not the core")
    }

    func testAThirdConcurrentInboundIsDeclinedImmediately() async throws {
        let (core, sdk, _) = makeCore()
        try await startReady(core)

        let first = FakeHandle(id: "in-1")
        sdk.ring(first, name: "First")
        core.answer("in-1")
        first.report(.active)
        let second = FakeHandle(id: "in-2")
        sdk.ring(second, name: "Second")

        let third = FakeHandle(id: "in-3")
        sdk.ring(third, name: "Third")

        XCTAssertTrue(third.ended, "third call declined so the race resolves elsewhere")
        XCTAssertEqual(2, core.state.calls.count)
    }

    // MARK: hold / swap mapping (CXSetHeldCallAction + the group swap)

    func testUnholdSwapsTheActiveAudioTheOtherCallIsHeldFirst() async throws {
        let (core, sdk, _) = makeCore()
        try await startReady(core)

        let first = FakeHandle(id: "in-1")
        sdk.ring(first, name: "First")
        core.answer("in-1")
        first.report(.active)
        let second = FakeHandle(id: "in-2")
        sdk.ring(second, name: "Second")
        core.answer("in-2")
        first.report(.held)
        second.report(.active)

        // Swap back to the first call (the group-swap op).
        core.toggleHold("in-1")
        XCTAssertEqual(1, second.holds, "the active second call got an SDK hold")
        XCTAssertEqual(1, first.unholds, "the held first call got an SDK unhold")
    }

    func testHoldCommandsConsultTheSdkPhaseNotTheReducedState() async throws {
        let (core, sdk, _) = makeCore()
        try await startReady(core)
        try await core.placeCall(displayName: "A", to: "+15552223333")
        let handle = sdk.outboundHandles[0]
        handle.report(.active)

        core.toggleHold(handle.id)
        XCTAssertEqual(1, handle.holds)
        // A second command before the SDK reports back must not fight the
        // first (pendingHold single-flight).
        core.toggleHold(handle.id)
        XCTAssertEqual(1, handle.holds)
        XCTAssertEqual(0, handle.unholds)

        handle.report(.held)
        core.toggleHold(handle.id)
        XCTAssertEqual(1, handle.unholds)
    }

    // MARK: mute / DTMF / end mapping

    func testMuteMapsToTheHandleAndTheState() async throws {
        let (core, sdk, _) = makeCore()
        try await startReady(core)
        try await core.placeCall(displayName: "A", to: "+15552223333")
        let handle = sdk.outboundHandles[0]
        handle.report(.active)

        core.setMuted(handle.id, muted: true)
        XCTAssertEqual(true, handle.lastMuted)
        XCTAssertEqual(true, core.state.calls.first?.muted)

        core.setMuted(handle.id, muted: false)
        XCTAssertEqual(false, handle.lastMuted)
        XCTAssertEqual(false, core.state.calls.first?.muted)
    }

    func testDtmfMapsEachDigitToTheHandle() async throws {
        let (core, sdk, _) = makeCore()
        try await startReady(core)
        try await core.placeCall(displayName: "A", to: "+15552223333")
        let handle = sdk.outboundHandles[0]
        handle.report(.active)

        // CallsManager's CXPlayDTMFCallAction handler feeds digits one at a
        // time — the core forwards each verbatim.
        for digit in "59#" {
            core.dtmf(handle.id, digit: String(digit))
        }
        XCTAssertEqual("59#", handle.dtmfDigits)
    }

    func testHangupMapsToHandleEndAndDismissClearsAnEndedChip() async throws {
        let (core, sdk, _) = makeCore()
        try await startReady(core)
        try await core.placeCall(displayName: "A", to: "+15552223333")
        let handle = sdk.outboundHandles[0]
        handle.report(.active)

        core.hangup(handle.id)
        XCTAssertTrue(handle.ended)
        // Established call end keeps a dismissible chip…
        XCTAssertEqual(.ended, core.state.calls.first?.phase)

        // …and hangup on a torn-down id (no SDK handle) just clears it.
        core.hangup(handle.id)
        XCTAssertTrue(core.state.calls.isEmpty)
    }

    // MARK: ring-me (push-to-wake part 2)

    func testRingMeSwallowsConflictTheCallWasAlreadyResolved() async throws {
        let (core, _, backend) = makeCore()
        backend.ringMeError = ApiError(
            code: ApiErrorCode.conflict,
            message: "That call isn't ringing anymore.",
            httpStatus: 409
        )
        try await startReady(core)
        // Must not throw.
        try await core.onIncomingCallPush(sessionId: "sess-stale")
        XCTAssertEqual(["sess-stale"], backend.ringMeCalls)
    }

    func testRingMeSwallowsNotFoundThePushAgedOut() async throws {
        let (core, _, backend) = makeCore()
        backend.ringMeError = ApiError(
            code: ApiErrorCode.notFound,
            message: "No such call.",
            httpStatus: 404
        )
        try await startReady(core)
        try await core.onIncomingCallPush(sessionId: "sess-gone")
    }

    func testRingMePropagatesRealFailuresSoTheCallerCanRetry() async throws {
        let (core, _, backend) = makeCore()
        backend.ringMeError = ApiError(
            code: ApiErrorCode.internalError,
            message: "Something broke.",
            httpStatus: 500
        )
        try await startReady(core)
        do {
            try await core.onIncomingCallPush(sessionId: "sess-live")
            XCTFail("expected internal_error")
        } catch let error as ApiError {
            XCTAssertEqual(ApiErrorCode.internalError, error.code)
        }
    }

    func testRingMeReusesALiveRegistrationNoReconnectNoRemint() async throws {
        let (core, sdk, backend) = makeCore()
        try await startReady(core)
        XCTAssertEqual(1, sdk.connects)
        try await core.onIncomingCallPush(sessionId: "sess-live")
        XCTAssertEqual(1, sdk.connects)
        XCTAssertEqual(1, backend.tokenMints)
    }

    // MARK: recovery (fresh mint on auth failure; never during a live call)

    func testAnSdkErrorRecoversWithAFreshMintWhenTheLineIsIdle() async throws {
        let (core, sdk, backend) = makeCore()
        try await startReady(core)
        XCTAssertEqual(1, backend.tokenMints)

        sdk.emit(.error("auth token expired"))
        XCTAssertEqual(.disconnected, core.state.status)

        try await waitFor("recovery re-mint + reconnect") {
            core.state.status == .ready && backend.tokenMints == 2
        }
        XCTAssertEqual(2, sdk.connects)
    }

    func testTheWatchdogNeverRebuildsWhileACallIsLive() async throws {
        let (core, sdk, backend) = makeCore()
        try await startReady(core)
        try await core.placeCall(displayName: "A", to: "+15552223333")
        let handle = sdk.outboundHandles[0]
        handle.report(.active)

        sdk.emit(.error("socket died"))
        XCTAssertEqual(.disconnected, core.state.status)

        // Give the (5ms-debounced) watchdog ample time to fire if it were
        // going to — the live call must veto the rebuild (#138).
        try await Task.sleep(for: .milliseconds(100))
        XCTAssertEqual(1, backend.tokenMints)
        XCTAssertEqual(1, sdk.connects)
        XCTAssertEqual(.disconnected, core.state.status)

        // The call ends -> the deferred recovery re-arms and rebuilds.
        handle.report(.ended)
        try await waitFor("post-call recovery") {
            core.state.status == .ready && backend.tokenMints == 2
        }
        XCTAssertEqual(2, sdk.connects)
    }
}
