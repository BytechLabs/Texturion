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
        number: String? = "+15557778888",
        sessionHeader: String? = nil
    ) {
        onEvent?(.incoming(
            call: handle,
            callerName: name,
            callerNumber: number,
            sessionHeader: sessionHeader
        ))
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

    /// #213: the server session (S) the next authorize returns. The op leg then
    /// carries `X-Loonext-Session = S` so the core correlates it. Nil simulates a
    /// pre-#211 server that returned no id (placeCall must fail honestly).
    var nextSessionId: String? = "11111111-1111-4111-8111-111111111111"

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
            client_state: serverClientState,
            call_session_id: nextSessionId
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

    // MARK: #213 placement reconcile (server-dialed outbound — web state.test.ts port)

    /// The synthetic "Calling…" chip is keyed on S until the op INVITE rekeys it.
    private func placement(_ s: String) -> CallSnapshot {
        CallSnapshot(
            id: s,
            direction: .outbound,
            peerName: "Dana Roofer",
            peerNumber: "+16135551000",
            phase: .connecting,
            sessionId: s
        )
    }

    func testPlacementConnectedRekeysTheCallingChipKeepingItOutboundAndActive() {
        let s = "11111111-1111-4111-8111-111111111111"
        var state = CallStateMachine.ready(SoftphoneSnapshot())
        state = CallStateMachine.placing(state, placement(s))
        state = CallStateMachine.placementConnected(
            state, placementId: s, id: "sdk-op-1", sessionId: s, peerNumber: "+16135551000"
        )
        state = CallStateMachine.sdkPhase(state, id: "sdk-op-1", phase: .active, now: at(2))

        XCTAssertEqual(1, state.calls.count)
        let call = state.calls[0]
        XCTAssertEqual("sdk-op-1", call.id) // rekeyed onto the SDK leg
        XCTAssertEqual(s, call.sessionId)
        XCTAssertEqual(.outbound, call.direction)
        XCTAssertEqual(.active, call.phase)
        XCTAssertEqual("sdk-op-1", state.activeId)
    }

    func testPlacementConnectedOnACancelledChipIsANoOp() {
        let s = "11111111-1111-4111-8111-111111111111"
        var state = CallStateMachine.ready(SoftphoneSnapshot())
        state = CallStateMachine.placing(state, placement(s))
        state = CallStateMachine.dismissed(state, id: s) // user cancelled during Calling…
        state = CallStateMachine.placementConnected(
            state, placementId: s, id: "sdk-op-1", sessionId: s, peerNumber: "+16135551000"
        )
        XCTAssertTrue(state.calls.isEmpty)
        XCTAssertNil(state.activeId)
    }

    func testPlacementFailedDropsTheCallingChipAndSurfacesAnError() {
        let s = "11111111-1111-4111-8111-111111111111"
        var state = CallStateMachine.ready(SoftphoneSnapshot())
        state = CallStateMachine.placing(state, placement(s))
        state = CallStateMachine.placementFailed(
            state, placementId: s, message: "Couldn't reach the line."
        )
        XCTAssertTrue(state.calls.isEmpty)
        XCTAssertNil(state.activeId)
        XCTAssertEqual("Couldn't reach the line.", state.error)
    }

    func testPlacementConnectedPrefersTheHeaderCustomerNumber() {
        // The op leg's X-Loonext-Caller wins for the displayed peer; a blank one
        // keeps the placing number (both are the same customer by construction).
        let s = "11111111-1111-4111-8111-111111111111"
        var state = CallStateMachine.ready(SoftphoneSnapshot())
        state = CallStateMachine.placing(state, placement(s))
        state = CallStateMachine.placementConnected(
            state, placementId: s, id: "sdk-op-1", sessionId: s, peerNumber: "+16139990000"
        )
        XCTAssertEqual("+16139990000", state.calls.first?.peerNumber)

        var kept = CallStateMachine.ready(SoftphoneSnapshot())
        kept = CallStateMachine.placing(kept, placement(s))
        kept = CallStateMachine.placementConnected(
            kept, placementId: s, id: "sdk-op-2", sessionId: s, peerNumber: ""
        )
        XCTAssertEqual("+16135551000", kept.calls.first?.peerNumber)
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

    // Server-minted session ids (S) — real UUIDs, the shape POST /calls/browser
    // returns and stamps on the op leg's X-Loonext-Session header.
    private let sessionA = "11111111-1111-4111-8111-111111111111"
    private let sessionB = "22222222-2222-4222-8222-222222222222"
    private let sessionC = "33333333-3333-4333-8333-333333333333"

    /// #213 outbound flow: place a call and connect its SERVER-dialed placer (op)
    /// leg. authorize (returns S) → pending placement + "Calling…" chip → the op
    /// INVITE arrives as an inbound SDK call carrying X-Loonext-Session=S → the
    /// core auto-answers it and reconciles it into the chip. Returns the op leg
    /// handle to drive (the chip's id is now the op leg's SDK id).
    @discardableResult
    private func placeAndConnect(
        _ core: SoftphoneCore,
        _ sdk: FakeSdk,
        _ backend: FakeBackend,
        to: String = "+15552223333",
        displayName: String = "A",
        session: String = "11111111-1111-4111-8111-111111111111",
        opId: String = "op-1",
        callControlId: String = "ccid-op-1"
    ) async throws -> FakeHandle {
        backend.nextSessionId = session
        try await core.placeCall(displayName: displayName, to: to)
        let op = FakeHandle(
            id: opId,
            callControlId: callControlId,
            telnyxSessionId: "telnyx-\(opId)"
        )
        sdk.ring(op, name: displayName, number: to, sessionHeader: session)
        return op
    }

    // MARK: outbound (#213 server-dialed)

    func testPlacingDoesNotDialTheCustomerTheServerDoes() async throws {
        let (core, sdk, backend) = makeCore()
        try await startReady(core)

        backend.nextSessionId = sessionA
        try await core.placeCall(displayName: "Ari", to: "+15552223333")

        // #213: the SERVER dials the customer — the client issues NO newCall.
        XCTAssertTrue(sdk.placed.isEmpty, "the client never dials the customer")
        // A "Calling…" chip keyed on S: outbound, connecting, session already S.
        let chip = try XCTUnwrap(core.state.calls.first)
        XCTAssertEqual(sessionA, chip.id)
        XCTAssertEqual(.outbound, chip.direction)
        XCTAssertEqual(.connecting, chip.phase)
        XCTAssertEqual(sessionA, chip.sessionId)
        XCTAssertEqual("+15552223333", chip.peerNumber)
        XCTAssertEqual(sessionA, core.state.activeId)
    }

    func testPlaceCallFailsHonestlyWhenTheServerReturnsNoSession() async throws {
        let (core, _, backend) = makeCore()
        try await startReady(core)
        backend.nextSessionId = nil // a pre-#211 / kill-switch server

        do {
            try await core.placeCall(displayName: "Ari", to: "+15552223333")
            XCTFail("expected conflict")
        } catch let error as ApiError {
            XCTAssertEqual(ApiErrorCode.conflict, error.code)
        }
        XCTAssertTrue(core.state.calls.isEmpty, "no silent dead chip")
    }

    func testTheOpInviteIsAutoAnsweredAndReconciledAsOutbound() async throws {
        let (core, sdk, backend) = makeCore()
        try await startReady(core)

        let op = try await placeAndConnect(
            core, sdk, backend, to: "+15552223333", displayName: "Ari",
            session: sessionA, opId: "op-1"
        )

        // Auto-answered (the mic was pre-granted before authorize) — never a ring.
        XCTAssertTrue(op.answered, "the op leg is auto-answered")
        // Reconciled: the chip rekeyed onto the SDK leg, still OUTBOUND, session S.
        let chip = try XCTUnwrap(core.state.calls.first)
        XCTAssertEqual("op-1", chip.id)
        XCTAssertEqual(.outbound, chip.direction)
        XCTAssertEqual(sessionA, chip.sessionId)
        XCTAssertEqual("+15552223333", chip.peerNumber)

        // Goes active with NO by-leg resolve — the customer session is already S.
        op.report(.active)
        XCTAssertEqual(.active, core.state.calls.first?.phase)
        XCTAssertEqual("op-1", core.state.activeId)
        XCTAssertEqual(0, backend.byLegHits, "the outbound op leg never resolves by-leg")
    }

    func testTheOpLegPeerPrefersTheXLoonextCallerHeader() async throws {
        let (core, sdk, backend) = makeCore()
        try await startReady(core)
        backend.nextSessionId = sessionA
        // Placed against a contact (no `to`) — the placing peer number is auth.to;
        // the op leg then carries the customer on X-Loonext-Caller (its number).
        try await core.placeCall(displayName: "Ari", contactId: "contact-1")
        let op = FakeHandle(id: "op-1", callControlId: "ccid-op-1")
        // The op INVITE's callerNumber == X-Loonext-Caller (the customer).
        sdk.ring(op, name: "Ari", number: "+15559998888", sessionHeader: sessionA)
        XCTAssertEqual("+15559998888", core.state.calls.first?.peerNumber)
        XCTAssertEqual(.outbound, core.state.calls.first?.direction)
    }

    func testTheTokenIsMintedOnConnectOnlyNeverPerCall() async throws {
        let (core, sdk, backend) = makeCore()
        try await startReady(core)
        XCTAssertEqual(1, backend.tokenMints)

        let op1 = try await placeAndConnect(core, sdk, backend, session: sessionA, opId: "op-1")
        op1.report(.active)
        op1.report(.ended)
        let op2 = try await placeAndConnect(core, sdk, backend, session: sessionB, opId: "op-2")
        _ = op2

        XCTAssertEqual(1, backend.tokenMints, "two calls, still one mint")
        XCTAssertEqual(1, sdk.connects)
    }

    func testTheOutboundSessionIsKnownAtPlacementNoByLegCall() async throws {
        let (core, sdk, backend) = makeCore()
        try await startReady(core)

        let op = try await placeAndConnect(core, sdk, backend, session: sessionA, opId: "op-1")
        // Session S is known from AUTHORIZE — before the leg even goes active.
        XCTAssertEqual(sessionA, core.state.calls.first?.sessionId)

        op.report(.active)
        let call = try XCTUnwrap(core.state.calls.first)
        XCTAssertEqual(.active, call.phase)
        XCTAssertEqual(sessionA, call.sessionId)
        XCTAssertEqual(0, backend.byLegHits, "outbound never resolves by-leg")
    }

    func testAThirdConcurrentPlaceCallIsRefusedBeforeThirdLineAbuse() async throws {
        let (core, sdk, backend) = makeCore()
        try await startReady(core)

        let op1 = try await placeAndConnect(core, sdk, backend, session: sessionA, opId: "op-1")
        op1.report(.active)
        // A second placement (still "Calling…") — that is two live lines.
        backend.nextSessionId = sessionB
        try await core.placeCall(displayName: "B", to: "+15552224444")

        do {
            backend.nextSessionId = sessionC
            try await core.placeCall(displayName: "C", to: "+15552225555")
            XCTFail("expected conflict")
        } catch let error as ApiError {
            XCTAssertEqual(ApiErrorCode.conflict, error.code)
        }
    }

    // MARK: #213 placement lifecycle (correlate / cancel-declines / timeout)

    func testCancellingDuringCallingDeclinesTheLateOpInvite() async throws {
        let (core, sdk, backend) = makeCore()
        try await startReady(core)

        backend.nextSessionId = sessionA
        try await core.placeCall(displayName: "Ari", to: "+15552223333")
        // Cancel while still "Calling…" (no op INVITE yet).
        core.hangup(sessionA)
        XCTAssertTrue(core.state.calls.isEmpty, "the Calling… chip clears on cancel")

        // The op INVITE arrives LATE for the cancelled placement -> DECLINED so
        // the DO drops the server-dialed customer; never a ring, never answered.
        let op = FakeHandle(id: "op-late", callControlId: "ccid-late")
        sdk.ring(op, name: "Ari", number: "+15552223333", sessionHeader: sessionA)
        XCTAssertTrue(op.ended, "the late op leg is hung up (the DO drops the customer)")
        XCTAssertFalse(op.answered, "a cancelled placement's op leg is never answered")
        XCTAssertTrue(core.state.calls.isEmpty, "no ring UI for a cancelled placement")
    }

    func testConnectingAnOutboundWhileOnACallHoldsTheFirst() async throws {
        let (core, sdk, backend) = makeCore()
        try await startReady(core)

        // On a first (inbound) call.
        let first = FakeHandle(id: "in-1", callControlId: "ccid-1")
        sdk.ring(first, name: "First")
        core.answer("in-1")
        first.report(.active)
        XCTAssertEqual("in-1", core.state.activeId)

        // Place a second (outbound) call and connect its server-dialed op leg.
        let op = try await placeAndConnect(
            core, sdk, backend, to: "+15552224444", displayName: "Bob",
            session: sessionB, opId: "op-2"
        )
        // #148 + one-audio-path: the op leg connecting SDK-holds the first call
        // (iOS has no single-sink swap, so an un-held first leg would keep audio).
        XCTAssertEqual(1, first.holds, "the active first call was SDK-held on connect")

        op.report(.active)
        first.report(.held)
        XCTAssertEqual("op-2", core.state.activeId)
        XCTAssertEqual(.held, core.state.calls.first { $0.id == "in-1" }?.phase)
        XCTAssertEqual(.active, core.state.calls.first { $0.id == "op-2" }?.phase)
    }

    func testAnInboundRingWithASessionHeaderIsPresentedNormally() async throws {
        let (core, sdk, _) = makeCore()
        try await startReady(core)

        // A genuine inbound ring ALSO carries X-Loonext-Session, but there is no
        // pending placement for it -> the normal ring path (never auto-answered).
        let ring = FakeHandle(id: "in-1", callControlId: "ccid-in-1")
        sdk.ring(ring, name: "Dana", number: "+15551230000", sessionHeader: "inbound-session-xyz")

        XCTAssertEqual(.ringing, core.state.calls.first?.phase)
        XCTAssertEqual(.inbound, core.state.calls.first?.direction)
        XCTAssertFalse(ring.answered, "an inbound ring is never auto-answered")
    }

    func testAPlacementTimesOutWhenTheOpInviteNeverArrives() async throws {
        let backend = FakeBackend()
        let sdk = FakeSdk()
        let core = SoftphoneCore(
            api: backend,
            sdk: sdk,
            recoverDebounce: .milliseconds(5),
            readyTimeout: .seconds(5),
            placementTimeout: .milliseconds(30)
        )
        core.start(companyId: "company-1", callerIdName: "Sam")
        try await core.awaitReady()

        backend.nextSessionId = sessionA
        try await core.placeCall(displayName: "Ari", to: "+15552223333")
        XCTAssertEqual(.connecting, core.state.calls.first?.phase)

        // The op INVITE never arrives -> the chip drops + an honest error.
        try await waitFor("placement timeout") {
            core.state.calls.isEmpty && core.state.error != nil
        }
        XCTAssertEqual("Couldn't reach the line. Please try again.", core.state.error)
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
        let (core, sdk, backend) = makeCore()
        try await startReady(core)
        let handle = try await placeAndConnect(core, sdk, backend, session: sessionA, opId: "op-1")
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
        let (core, sdk, backend) = makeCore()
        try await startReady(core)
        let handle = try await placeAndConnect(core, sdk, backend, session: sessionA, opId: "op-1")
        handle.report(.active)

        core.setMuted(handle.id, muted: true)
        XCTAssertEqual(true, handle.lastMuted)
        XCTAssertEqual(true, core.state.calls.first?.muted)

        core.setMuted(handle.id, muted: false)
        XCTAssertEqual(false, handle.lastMuted)
        XCTAssertEqual(false, core.state.calls.first?.muted)
    }

    func testDtmfMapsEachDigitToTheHandle() async throws {
        let (core, sdk, backend) = makeCore()
        try await startReady(core)
        let handle = try await placeAndConnect(core, sdk, backend, session: sessionA, opId: "op-1")
        handle.report(.active)

        // CallsManager's CXPlayDTMFCallAction handler feeds digits one at a
        // time — the core forwards each verbatim.
        for digit in "59#" {
            core.dtmf(handle.id, digit: String(digit))
        }
        XCTAssertEqual("59#", handle.dtmfDigits)
    }

    func testHangupMapsToHandleEndAndDismissClearsAnEndedChip() async throws {
        let (core, sdk, backend) = makeCore()
        try await startReady(core)
        let handle = try await placeAndConnect(core, sdk, backend, session: sessionA, opId: "op-1")
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
        let handle = try await placeAndConnect(core, sdk, backend, session: sessionA, opId: "op-1")
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

    // MARK: #195 zombie hygiene (F1 reap on client death, F5 answer failure)

    func testClientDeathReapsRingingZombiesSoRecoveryProceeds() async throws {
        // #195 F1: a socket drop while a leg is RINGING must drop that ring
        // (its phase callback can never fire again after the rebuild) so the
        // recovery gate isn't wedged behind an immortal zombie.
        let (core, sdk, _) = makeCore()
        try await startReady(core)

        sdk.ring(FakeHandle(id: "in-1"), name: "Dana")
        XCTAssertEqual(.ringing, core.state.calls.first?.phase)

        sdk.emit(.disconnected)
        // The ring is reaped immediately (state hygiene, never a hangup).
        XCTAssertTrue(core.state.calls.isEmpty, "the ringing zombie was reaped")

        // With no engaged leg wedging it, recovery rebuilds the socket.
        try await waitFor("recovery after client death") {
            core.state.status == .ready
        }
        XCTAssertEqual(2, sdk.connects)
    }

    func testAFailedAnswerRebuildsTheZombieSocketExactlyOnce() async throws {
        // #195 F5: an ANSWERED ring that never goes active is the zombie-socket
        // signature — drop the stuck presentation and rebuild the socket once.
        let (core, sdk, backend) = makeCore()
        try await startReady(core)

        let ringLeg = FakeHandle(id: "in-1", callControlId: "ccid-1")
        sdk.ring(ringLeg)
        core.answer("in-1")
        XCTAssertTrue(ringLeg.answered)
        // No active report ever lands — the leg is stuck ringing.
        XCTAssertEqual(.ringing, core.state.calls.first?.phase)

        core.forceRecoverAfterAnswerFailure(stuckId: "in-1")
        XCTAssertTrue(core.state.calls.isEmpty, "the stuck answered ring was dropped")

        try await waitFor("socket rebuild after answer failure") {
            core.state.status == .ready && backend.tokenMints == 2
        }
        XCTAssertEqual(2, sdk.connects)
    }

    func testAnswerFailureNeverRebuildsWhileAnotherCallIsEngaged() async throws {
        // #195 F5 gate: a genuinely engaged second call vetoes the rebuild.
        let (core, sdk, backend) = makeCore()
        try await startReady(core)

        let live = FakeHandle(id: "in-1", callControlId: "ccid-1")
        sdk.ring(live, name: "First")
        core.answer("in-1")
        live.report(.active)

        let stuck = FakeHandle(id: "in-2", callControlId: "ccid-2")
        sdk.ring(stuck, name: "Second")
        core.answer("in-2") // stays ringing — never binds

        core.forceRecoverAfterAnswerFailure(stuckId: "in-2")

        // The stuck ring is dropped, but the live call vetoes the rebuild.
        XCTAssertNil(core.state.calls.first { $0.id == "in-2" })
        XCTAssertEqual(.active, core.state.calls.first { $0.id == "in-1" }?.phase)
        try await Task.sleep(for: .milliseconds(50))
        XCTAssertEqual(1, sdk.connects, "an engaged leg vetoed the socket rebuild")
        XCTAssertEqual(1, backend.tokenMints)
    }
}

// MARK: - #195 engaged-leg gate (pure predicate — Android CallWakePolicy port)

final class EngagedGateTests: XCTestCase {
    private func call(_ phase: CallPhase, id: String = "c") -> CallSnapshot {
        CallSnapshot(
            id: id,
            direction: .inbound,
            peerName: "Dana",
            peerNumber: "+15551230000",
            phase: phase
        )
    }

    func testOnlyLiveOrRingablePhasesAreEngaged() {
        XCTAssertTrue(call(.active).isEngaged)
        XCTAssertTrue(call(.held).isEngaged)
        XCTAssertTrue(call(.connecting).isEngaged)
        XCTAssertTrue(call(.ringing).isEngaged)
        XCTAssertFalse(call(.ended).isEngaged)
    }

    func testAnyEngagedIgnoresEndedDebris() {
        var state = SoftphoneSnapshot()
        state.calls = [call(.ended, id: "a")]
        XCTAssertFalse(state.anyEngaged, "an ended chip is not an engaged call")

        state.calls = [call(.ended, id: "a"), call(.ringing, id: "b")]
        XCTAssertTrue(state.anyEngaged)

        XCTAssertFalse(SoftphoneSnapshot().anyEngaged, "no calls -> nothing engaged")
    }
}

// MARK: - #195 ring TTL (pure sweep math)

final class RingTtlTests: XCTestCase {
    private func at(_ seconds: TimeInterval) -> Date {
        Date(timeIntervalSince1970: seconds)
    }

    func testARingExpiresOnlyPastTheTtlWindow() {
        let seen = at(1_000)
        XCTAssertFalse(CallWakePolicy.ringExpired(firstSeen: seen, now: at(1_000)))
        XCTAssertFalse(CallWakePolicy.ringExpired(firstSeen: seen, now: at(1_054)))
        XCTAssertTrue(CallWakePolicy.ringExpired(firstSeen: seen, now: at(1_055)))
        XCTAssertTrue(CallWakePolicy.ringExpired(firstSeen: seen, now: at(1_100)))
    }

    func testAClockThatMovedBackwardsNeverExpiresARing() {
        let seen = at(1_000)
        XCTAssertFalse(CallWakePolicy.ringExpired(firstSeen: seen, now: at(900)))
    }
}

// MARK: - #212 caller-id header preference (pure)

final class CallerHeaderTests: XCTestCase {
    func testTheTrustedCallerHeaderWinsOverTheRewrittenInviteFrom() {
        // The INVITE `from` is the business number; the header is the caller.
        let resolved = CallerHeaders.resolve(
            headers: ["X-Loonext-Caller": "+15551234567"],
            inviteNumber: "+15559990000", // Telnyx-rewritten business number
            inviteName: "Loonext Business"
        )
        XCTAssertEqual("+15551234567", resolved.number)
        // No caller-name header: the INVITE name is the business CNAM, dropped.
        XCTAssertNil(resolved.name)
    }

    func testTheCallerNameHeaderIsPreferredWhenPresent() {
        let resolved = CallerHeaders.resolve(
            headers: [
                "X-Loonext-Caller": "+15551234567",
                "X-Loonext-Caller-Name": "Jane Doe",
            ],
            inviteNumber: "+15559990000",
            inviteName: "Loonext Business"
        )
        XCTAssertEqual("+15551234567", resolved.number)
        XCTAssertEqual("Jane Doe", resolved.name)
    }

    func testHeaderLookupIsCaseInsensitive() {
        XCTAssertEqual(
            "+15551234567",
            CallerHeaders.caller(from: ["x-loonext-caller": "+15551234567"])
        )
        XCTAssertEqual(
            "Jane",
            CallerHeaders.callerName(from: ["X-LOONEXT-CALLER-NAME": "Jane"])
        )
    }

    func testNoHeaderFallsBackToTheInviteValues() {
        // Older server / anonymous caller sends no header -> the INVITE stands.
        let resolved = CallerHeaders.resolve(
            headers: nil,
            inviteNumber: "+15557778888",
            inviteName: "DANA F"
        )
        XCTAssertEqual("+15557778888", resolved.number)
        XCTAssertEqual("DANA F", resolved.name)
    }

    func testABlankHeaderValueIsTreatedAsAbsent() {
        let resolved = CallerHeaders.resolve(
            headers: ["X-Loonext-Caller": "   "],
            inviteNumber: "+15557778888",
            inviteName: "DANA F"
        )
        XCTAssertEqual("+15557778888", resolved.number)
        XCTAssertEqual("DANA F", resolved.name)
        XCTAssertNil(CallerHeaders.caller(from: nil))
    }

    // #213: the X-Loonext-Session correlation header (case-insensitive, blank-safe).
    func testSessionHeaderIsReadCaseInsensitivelyAndBlankSafe() {
        let s = "11111111-1111-4111-8111-111111111111"
        XCTAssertEqual(s, CallerHeaders.session(from: ["X-Loonext-Session": s]))
        XCTAssertEqual(s, CallerHeaders.session(from: ["x-loonext-session": s]))
        XCTAssertNil(CallerHeaders.session(from: ["X-Loonext-Session": "   "]))
        XCTAssertNil(CallerHeaders.session(from: nil))
        XCTAssertNil(CallerHeaders.session(from: ["X-Loonext-Caller": "+15551234567"]))
    }
}
