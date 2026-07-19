package com.loonext.android.telephony

import com.loonext.android.core.model.WebRtcToken
import com.loonext.android.core.net.ApiErrorCode
import com.loonext.android.core.net.ApiException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Before
import org.junit.Test
import java.util.concurrent.atomic.AtomicInteger

/**
 * SoftphoneCore against a suspend-fake [CallsApi] and a fake SDK.
 *
 * DETERMINISM (this class was flaky on CI — two different tests, two runs):
 * the old harness used a real ApiClient + MockWebServer, so every api call
 * resumed the core's coroutines on OkHttp threads — OUTSIDE the
 * kotlinx-coroutines-test scheduler. With an Unconfined core scope that let
 * OkHttp threads run core state transitions concurrently with the test
 * thread (and let runTest fast-forward virtual time past delay-based
 * retries/watchdogs while real IO was in flight). Now:
 *  - [FakeCallsApi] answers inline in the caller's coroutine — ZERO foreign
 *    threads (ApiClient's HTTP behavior stays covered by
 *    core/net/ApiClientTest);
 *  - the core's scope runs on a StandardTestDispatcher sharing runTest's
 *    scheduler, so every `scope.launch` inside the core is queued and runs
 *    only when the test pumps it (`runCurrent()`) or suspends into it;
 *  - after every fire-and-forget action the test pumps, then asserts —
 *    one thread, one ordered queue, no interleaving left to chance.
 *
 * Covered invariants: client_state passthrough, by-leg resolution on inbound
 * answer, mint-on-connect (never per call), the call-waiting invariants, and
 * the calls-v3 §10 client protocol — ring-me eligibility (push while a leg is
 * live never rings; the §6 `no_local_leg` attestation; the recent_leg retry),
 * presentation dismissal on a ringing-exit (`call.updated` / `call_end` push,
 * SILENCE only — never a client hangup), and §10.1.4 one-presentation-per-
 * device (duplicate/over-ceiling INVITEs held silent, promoted when a slot
 * frees).
 */
@OptIn(ExperimentalCoroutinesApi::class)
class SoftphoneCoreTest {
    // The exact base64 the server would mint: btoa('oc_customer|<to>|<nonce>').
    private val serverClientState: String = java.util.Base64.getEncoder().encodeToString(
        "oc_customer|+15552223333|nonce-1".toByteArray(Charsets.UTF_8),
    )

    private val tokenMints = AtomicInteger(0)
    private val byLegHits = AtomicInteger(0)

    /** What the always-200 `/state` read (§8.1) answers per session. */
    private var sessionStateBehavior: (String) -> LiveSessionState = { session ->
        LiveSessionState(call_session_id = session, state = CallWakePolicy.STATE_RINGING)
    }

    /** The ring-me ack to return (§8.3), plus a record of every request's
     *  `no_local_leg` value — the §6 attestation, always `true` from v3. */
    private var ringMeBehavior: () -> RingAck =
        { RingAck(ok = true, rang = true, state = CallWakePolicy.STATE_RINGING) }
    private val ringMeNoLocalLeg = mutableListOf<Boolean>()

    /** Every session the per-session fast-path decline POSTed (#171 R1). */
    private val declinedSessions = mutableListOf<String>()

    /** How many times the universal member-scoped decline-mine POSTed (#171 R1). */
    private val declineMineCalls = AtomicInteger(0)

    @Before
    fun setUp() {
        tokenMints.set(0)
        byLegHits.set(0)
        sessionStateBehavior = { session ->
            LiveSessionState(call_session_id = session, state = CallWakePolicy.STATE_RINGING)
        }
        ringMeBehavior = { RingAck(ok = true, rang = true, state = CallWakePolicy.STATE_RINGING) }
        ringMeNoLocalLeg.clear()
        declinedSessions.clear()
        declineMineCalls.set(0)
    }

    /**
     * Direct suspend-function fake of the [CallsApi] seam. Every call completes
     * synchronously in the caller's coroutine — the test scheduler owns every
     * hop (ApiClient's HTTP behavior stays covered by core/net/ApiClientTest).
     */
    private inner class FakeCallsApi : CallsApi {
        override suspend fun mintToken(companyId: String): WebRtcToken {
            tokenMints.incrementAndGet()
            return WebRtcToken(token = "telnyx-jwt", sip_username = "sip-u1", expires_in_hours = 24)
        }

        override suspend fun authorizeBrowserCall(
            companyId: String,
            conversationId: String?,
            contactId: String?,
            to: String?,
            phoneNumberId: String?,
        ): BrowserCallAuth = BrowserCallAuth(
            from = "+15550001111",
            to = "+15552223333",
            client_state = serverClientState,
        )

        override suspend fun resolveByLeg(companyId: String, legCcid: String): LegResolution {
            byLegHits.incrementAndGet()
            return LegResolution(call_session_id = "sess-real")
        }

        override suspend fun liveFacts(companyId: String, sessionId: String): LiveCallFacts =
            throw ApiException(ApiErrorCode.NOT_FOUND, "No route.", 404)

        override suspend fun sessionState(companyId: String, sessionId: String): LiveSessionState =
            sessionStateBehavior(sessionId)

        override suspend fun transferTargets(companyId: String, sessionId: String): TransferTargets =
            throw ApiException(ApiErrorCode.NOT_FOUND, "No route.", 404)

        override suspend fun blindTransfer(
            companyId: String,
            sessionId: String,
            targetUserId: String,
        ): TransferAck = throw ApiException(ApiErrorCode.NOT_FOUND, "No route.", 404)

        override suspend fun ringMe(
            companyId: String,
            sessionId: String,
            noLocalLeg: Boolean,
        ): RingAck {
            ringMeNoLocalLeg += noLocalLeg
            return ringMeBehavior()
        }

        override suspend fun decline(companyId: String, sessionId: String): DeclineAck {
            declinedSessions += sessionId
            return DeclineAck(declined = true, state = "voicemail_greeting")
        }

        override suspend fun declineMine(companyId: String): DeclineMineAck {
            declineMineCalls.incrementAndGet()
            return DeclineMineAck(declined = true, sessions = declinedSessions.toList())
        }
    }

    private class FakeHandle(
        override val id: String,
        override val callControlId: String? = null,
        override val telnyxSessionId: String? = null,
    ) : SdkCallHandle {
        val phaseFlow = MutableStateFlow<CallPhase?>(null)
        override val phases: Flow<CallPhase?> = phaseFlow

        var accepted: String? = null
        var ended = false
        var holdToggles = 0
        var lastMuted: Boolean? = null
        val dtmfDigits = StringBuilder()

        /** #168A: simulate the SDK throwing out of acceptCall. */
        var acceptThrows: Throwable? = null

        override fun accept(destinationNumber: String) {
            acceptThrows?.let { throw it }
            accepted = destinationNumber
        }

        override fun end() {
            ended = true
            phaseFlow.value = CallPhase.ENDED
        }

        override fun toggleHold() {
            holdToggles++
        }

        override fun setMuted(muted: Boolean) {
            lastMuted = muted
        }

        override fun dtmf(digit: String) {
            dtmfDigits.append(digit)
        }
    }

    private class FakeSdk : SdkClient {
        private val _events = MutableSharedFlow<SdkEvent>(extraBufferCapacity = 32)
        override val events: SharedFlow<SdkEvent> = _events

        data class Placed(
            val callerIdName: String,
            val callerIdNumber: String,
            val destinationNumber: String,
            val clientState: String,
        )

        var connects = 0
        var disconnects = 0
        var readyOnConnect = true
        var nextOutboundSessionId: String? = null
        val placed = mutableListOf<Placed>()
        val outboundHandles = mutableListOf<FakeHandle>()

        override fun connect(token: String, callerIdName: String) {
            connects++
            if (readyOnConnect) _events.tryEmit(SdkEvent.Ready)
        }

        override fun disconnect() {
            disconnects++
        }

        override fun newCall(
            callerIdName: String,
            callerIdNumber: String,
            destinationNumber: String,
            clientState: String,
        ): SdkCallHandle {
            placed += Placed(callerIdName, callerIdNumber, destinationNumber, clientState)
            return FakeHandle("out-${placed.size}", telnyxSessionId = nextOutboundSessionId)
                .also { outboundHandles += it }
        }

        override fun setAudioRoute(route: AudioRoute) = Unit

        fun ring(handle: FakeHandle, name: String? = "Dana", number: String? = "+15557778888") {
            _events.tryEmit(SdkEvent.Incoming(handle, name, number))
        }
    }

    private class Harness(
        val core: SoftphoneCore,
        val sdk: FakeSdk,
        val scope: CoroutineScope,
    )

    private fun TestScope.harness(): Harness {
        // The core's scope shares runTest's scheduler through a
        // StandardTestDispatcher: every launch inside SoftphoneCore is queued
        // on the (single-threaded, virtual-time) test scheduler and runs only
        // under runCurrent()/first{} — never eagerly, never on another thread.
        val scope = CoroutineScope(SupervisorJob() + StandardTestDispatcher(testScheduler))
        val sdk = FakeSdk()
        return Harness(SoftphoneCore(FakeCallsApi(), sdk, scope), sdk, scope)
    }

    /** Total-predicate wait — suspending into first{} drives the scheduler
     *  through start()'s mint→connect→Ready chain; nothing sampled early. */
    private suspend fun SoftphoneCore.awaitReady() {
        state.first { it.status == SoftphoneStatus.READY }
    }

    // ------------------------------------------------------------- outbound

    @Test
    fun `client_state from the server goes into newCall VERBATIM`() = runTest {
        val h = harness()
        h.core.start("company-1", "Sam")
        h.core.awaitReady()

        h.core.placeCall(displayName = "Ari", to = "+15552223333")
        runCurrent() // start the new leg's phase watcher

        assertEquals(1, h.sdk.placed.size)
        val placed = h.sdk.placed.single()
        assertEquals(serverClientState, placed.clientState)
        assertEquals("+15552223333", placed.destinationNumber)
        assertEquals("+15550001111", placed.callerIdNumber)
        val call = h.core.state.value.calls.single()
        assertEquals(CallPhase.CONNECTING, call.phase)
        assertEquals(CallDirection.OUTBOUND, call.direction)
        h.scope.cancel()
    }

    @Test
    fun `the token is minted on connect only - never per call`() = runTest {
        val h = harness()
        h.core.start("company-1")
        h.core.awaitReady()
        assertEquals(1, tokenMints.get())

        h.core.placeCall(displayName = "A", to = "+15552223333")
        runCurrent()
        h.sdk.outboundHandles[0].phaseFlow.value = CallPhase.ACTIVE
        runCurrent()
        h.sdk.outboundHandles[0].phaseFlow.value = CallPhase.ENDED
        runCurrent()
        h.core.placeCall(displayName = "B", to = "+15552223333")

        assertEquals("two calls, still one mint", 1, tokenMints.get())
        assertEquals(1, h.sdk.connects)
        h.scope.cancel()
    }

    @Test
    fun `an outbound leg IS the customer leg - its session lands with no by-leg call`() = runTest {
        val h = harness()
        h.sdk.nextOutboundSessionId = "sess-out"
        h.core.start("company-1")
        h.core.awaitReady()
        h.core.placeCall(displayName = "A", to = "+15552223333")
        runCurrent()

        h.sdk.outboundHandles.single().phaseFlow.value = CallPhase.ACTIVE
        runCurrent()

        val call = h.core.state.value.calls.single()
        assertEquals(CallPhase.ACTIVE, call.phase)
        assertEquals("sess-out", call.sessionId)
        assertEquals("outbound never resolves by-leg", 0, byLegHits.get())
        h.scope.cancel()
    }

    @Test
    fun `a second concurrent placeCall is refused before third-line abuse`() = runTest {
        val h = harness()
        h.core.start("company-1")
        h.core.awaitReady()
        h.core.placeCall(displayName = "A", to = "+15552223333")
        runCurrent()
        h.sdk.outboundHandles[0].phaseFlow.value = CallPhase.ACTIVE
        runCurrent()
        h.core.placeCall(displayName = "B", to = "+15552223333")
        runCurrent()
        try {
            h.core.placeCall(displayName = "C", to = "+15552223333")
            fail("expected conflict")
        } catch (cause: ApiException) {
            assertEquals(ApiErrorCode.CONFLICT, cause.code)
        }
        h.scope.cancel()
    }

    // -------------------------------------------------------------- inbound

    @Test
    fun `answering an inbound call resolves the CUSTOMER session via by-leg`() = runTest {
        val h = harness()
        h.core.start("company-1")
        h.core.awaitReady()

        val ringLeg = FakeHandle("in-1", callControlId = "ccid-ring-1")
        h.sdk.ring(ringLeg)
        runCurrent() // deliver the invite through the events collector
        assertEquals(CallPhase.RINGING, h.core.state.value.calls.single().phase)
        assertNull(h.core.state.value.calls.single().sessionId)

        h.core.answer("in-1")
        assertNotNull(ringLeg.accepted)
        ringLeg.phaseFlow.value = CallPhase.ACTIVE
        runCurrent() // phase watcher -> resolveSession -> by-leg -> sessionKnown

        // singleOrNull keeps the predicate TOTAL (a non-single emission is
        // "not yet", never a throw) — the CI flake that motivated this
        // harness was a single() here observing an in-between emission.
        val resolved = h.core.state.first { it.calls.singleOrNull()?.sessionId != null }
        assertEquals("sess-real", resolved.calls.single().sessionId)
        assertEquals(1, byLegHits.get())
        h.scope.cancel()
    }

    @Test
    fun `an unanswered ring that ends vanishes silently`() = runTest {
        val h = harness()
        h.core.start("company-1")
        h.core.awaitReady()
        val ringLeg = FakeHandle("in-1")
        h.sdk.ring(ringLeg)
        runCurrent()
        // Another member won the race — the SDK ends our ring leg.
        ringLeg.phaseFlow.value = CallPhase.ENDED
        runCurrent()
        assertTrue(h.core.state.value.calls.isEmpty())
        h.scope.cancel()
    }

    @Test
    fun `answering a second call SDK-holds the first`() = runTest {
        val h = harness()
        h.core.start("company-1")
        h.core.awaitReady()

        val first = FakeHandle("in-1", callControlId = "ccid-1")
        h.sdk.ring(first, name = "First", number = "+15551110001")
        runCurrent()
        h.core.answer("in-1")
        first.phaseFlow.value = CallPhase.ACTIVE
        runCurrent()

        val second = FakeHandle("in-2", callControlId = "ccid-2")
        h.sdk.ring(second, name = "Second", number = "+15551110002")
        runCurrent()
        h.core.answer("in-2")

        assertEquals("the active first call got the SDK hold toggle", 1, first.holdToggles)
        assertNotNull(second.accepted)

        // The SDK confirms: first held, second active — one active audio path.
        first.phaseFlow.value = CallPhase.HELD
        runCurrent()
        second.phaseFlow.value = CallPhase.ACTIVE
        runCurrent()
        val state = h.core.state.value
        assertEquals("in-2", state.activeId)
        assertEquals(CallPhase.HELD, state.calls.first { it.id == "in-1" }.phase)
        h.scope.cancel()
    }

    @Test
    fun `a third concurrent inbound is held SILENT, never declined`() = runTest {
        // calls-v3 §10.1.4/§10.1.2: the client NEVER hangs up a leg outside
        // user action. A ring beyond the two-call ceiling is HELD silent (no
        // UI, no signaling), never declined — a decline on a forked leg would
        // kill the ring on the member's other devices. The server reaps it.
        val h = harness()
        h.core.start("company-1")
        h.core.awaitReady()

        val first = FakeHandle("in-1")
        h.sdk.ring(first, name = "First", number = "+15551110001")
        runCurrent()
        h.core.answer("in-1")
        first.phaseFlow.value = CallPhase.ACTIVE
        runCurrent()
        val second = FakeHandle("in-2")
        h.sdk.ring(second, name = "Second", number = "+15551110002")
        runCurrent()

        val third = FakeHandle("in-3")
        h.sdk.ring(third, name = "Third", number = "+15551110003")
        runCurrent()

        assertFalse("the over-ceiling ring is held, never ended by the client", third.ended)
        assertEquals("only the two presented calls are in state", 2, h.core.state.value.calls.size)
        assertTrue(h.core.state.value.calls.none { it.id == "in-3" })
        h.scope.cancel()
    }

    @Test
    fun `unhold swaps the active audio - the other call is held first`() = runTest {
        val h = harness()
        h.core.start("company-1")
        h.core.awaitReady()

        val first = FakeHandle("in-1")
        h.sdk.ring(first, name = "First", number = "+15551110001")
        runCurrent()
        h.core.answer("in-1")
        first.phaseFlow.value = CallPhase.ACTIVE
        runCurrent()
        val second = FakeHandle("in-2")
        h.sdk.ring(second, name = "Second", number = "+15551110002")
        runCurrent()
        h.core.answer("in-2")
        first.phaseFlow.value = CallPhase.HELD
        runCurrent()
        second.phaseFlow.value = CallPhase.ACTIVE
        runCurrent()

        // Swap back to the first call.
        h.core.toggleHold("in-1")
        assertEquals("second call got an SDK hold", 1, second.holdToggles)
        assertEquals("first call got an SDK unhold", 2, first.holdToggles)
        h.scope.cancel()
    }

    // ----------------------------------------------------- ring-me (§10.2)

    @Test
    fun `a wake push while a leg is already presenting never calls ring-me`() = runTest {
        // Scenario 1 (§14): the INVITE path owns presentation — a push (any
        // latency) while a live leg exists is IGNORED, never a ring-me.
        val h = harness()
        h.core.start("company-1")
        h.core.awaitReady()
        val leg = FakeHandle("in-1")
        h.sdk.ring(leg)
        runCurrent()

        h.core.onIncomingCallPush("sess-live", callerHint = "+15557778888")

        assertTrue("no ring-me while a leg presents", ringMeNoLocalLeg.isEmpty())
        assertEquals(CallPhase.RINGING, h.core.state.value.calls.single().phase)
        h.scope.cancel()
    }

    @Test
    fun `a wake push with no live leg reads state then ring-me with no_local_leg true`() = runTest {
        // Scenario 2/3 (§14): no live leg → read /state → still ringing →
        // ring-me with the §6 attestation (no_local_leg:true) on the FIRST call.
        val h = harness()
        h.core.start("company-1")
        h.core.awaitReady()

        h.core.onIncomingCallPush("sess-live")

        assertEquals("exactly one ring-me, asserted", listOf(true), ringMeNoLocalLeg)
        h.scope.cancel()
    }

    @Test
    fun `a wake push whose session already exited ringing does not ring-me`() = runTest {
        // §8.1: /state is the truth — a session that already answered/voicemailed
        // gets no ring-me (the 4xx-inference era is over).
        sessionStateBehavior = { LiveSessionState(call_session_id = it, state = "answered") }
        val h = harness()
        h.core.start("company-1")
        h.core.awaitReady()

        h.core.onIncomingCallPush("sess-done")

        assertTrue(ringMeNoLocalLeg.isEmpty())
        h.scope.cancel()
    }

    @Test
    fun `a not_found from state or ring-me is swallowed by contract`() = runTest {
        sessionStateBehavior = { throw ApiException(ApiErrorCode.NOT_FOUND, "Aged out.", 404) }
        val h = harness()
        h.core.start("company-1")
        h.core.awaitReady()
        // Must not throw — a 404 (push aged out / hidden number) is silent.
        h.core.onIncomingCallPush("sess-gone")
        assertTrue(ringMeNoLocalLeg.isEmpty())
        h.scope.cancel()
    }

    @Test
    fun `ring-me request-property 409 is swallowed`() = runTest {
        ringMeBehavior = { throw ApiException(ApiErrorCode.CONFLICT, "Can't take calls.", 409) }
        val h = harness()
        h.core.start("company-1")
        h.core.awaitReady()
        // The 409 is a REQUEST property (§8.3), not session state — swallowed.
        h.core.onIncomingCallPush("sess-live")
        assertEquals(listOf(true), ringMeNoLocalLeg)
        h.scope.cancel()
    }

    @Test
    fun `ring-me propagates real failures so the caller can retry`() = runTest {
        ringMeBehavior = { throw ApiException(ApiErrorCode.INTERNAL_ERROR, "Broke.", 500) }
        val h = harness()
        h.core.start("company-1")
        h.core.awaitReady()
        try {
            h.core.onIncomingCallPush("sess-live")
            fail("expected internal_error")
        } catch (cause: ApiException) {
            assertEquals(ApiErrorCode.INTERNAL_ERROR, cause.code)
        }
        h.scope.cancel()
    }

    @Test
    fun `a recent_leg ack triggers exactly one retry after the debounce`() = runTest {
        // §10.2: rang:false/recent_leg with no INVITE inside the debounce window
        // licenses ONE retry (it passes the server debounce if the leg died).
        ringMeBehavior = {
            RingAck(ok = true, rang = false, state = "ringing", reason = CallWakePolicy.REASON_RECENT_LEG)
        }
        val h = harness()
        h.core.start("company-1")
        h.core.awaitReady()

        h.core.onIncomingCallPush("sess-live")

        assertEquals("one retry, both asserted", listOf(true, true), ringMeNoLocalLeg)
        h.scope.cancel()
    }

    @Test
    fun `a non-retryable rang-false reason does not retry`() = runTest {
        ringMeBehavior = { RingAck(ok = true, rang = false, state = "ringing", reason = "live_leg") }
        val h = harness()
        h.core.start("company-1")
        h.core.awaitReady()
        h.core.onIncomingCallPush("sess-live")
        assertEquals("no retry for a non-recent_leg reason", listOf(true), ringMeNoLocalLeg)
        h.scope.cancel()
    }

    @Test
    fun `a wake push reuses a live registration - no re-connect, no re-mint`() = runTest {
        val h = harness()
        h.core.start("company-1")
        h.core.awaitReady()
        assertEquals(1, h.sdk.connects)
        h.core.onIncomingCallPush("sess-live")
        assertEquals(1, h.sdk.connects)
        assertEquals(1, tokenMints.get())
        h.scope.cancel()
    }

    // ----------------------------------------- presentation dismissal (§10.1)

    @Test
    fun `a call_updated ringing-exit SILENCES the presented ring, never ends the leg`() = runTest {
        val h = harness()
        h.core.start("company-1")
        h.core.awaitReady()
        // The wake push named the session + caller (the reconcile correlation).
        h.core.onIncomingCallPush("sess-x", callerHint = "+15557778888")

        val leg = FakeHandle("in-late")
        h.sdk.ring(leg) // caller +15557778888 matches the hint
        runCurrent()
        assertEquals(CallPhase.RINGING, h.core.state.value.calls.single().phase)

        // Realtime says the session answered elsewhere — silence, don't end.
        h.core.onCallSessionUpdate("sess-x", "answered")

        assertFalse("the client NEVER ends the leg — the server sends the BYE", leg.ended)
        val call = h.core.state.value.calls.single()
        assertTrue("presentation is silenced", call.silenced)
        assertEquals(CallPhase.RINGING, call.phase)
        h.scope.cancel()
    }

    @Test
    fun `a call_end push SILENCES the presented ring, never ends the leg`() = runTest {
        val h = harness()
        h.core.start("company-1")
        h.core.awaitReady()
        h.core.onIncomingCallPush("sess-x", callerHint = "+15557778888")

        val leg = FakeHandle("in-late")
        h.sdk.ring(leg)
        runCurrent()

        h.core.onCallEndPush("sess-x")

        assertFalse(leg.ended)
        assertTrue(h.core.state.value.calls.single().silenced)
        h.scope.cancel()
    }

    @Test
    fun `a still-ringing call_updated leaves the presentation alone`() = runTest {
        val h = harness()
        h.core.start("company-1")
        h.core.awaitReady()
        h.core.onIncomingCallPush("sess-x", callerHint = "+15557778888")
        val leg = FakeHandle("in-1")
        h.sdk.ring(leg)
        runCurrent()

        // state=ringing is NOT a ringing-exit — nothing is silenced.
        h.core.onCallSessionUpdate("sess-x", "ringing")

        assertFalse(leg.ended)
        assertFalse(h.core.state.value.calls.single().silenced)
        h.scope.cancel()
    }

    // ----------------------------------------------------- decline (#171 R1)

    @Test
    fun `declineCurrent always POSTs decline-mine and ends the local leg`() = runTest {
        // The FOREGROUND live-socket ring: no wake push, so no session is
        // knowable client-side — the exact case the old per-session decline
        // resolved null and silently dropped. decline-mine needs no session.
        val h = harness()
        h.core.start("company-1")
        h.core.awaitReady()
        val leg = FakeHandle("in-1")
        h.sdk.ring(leg, name = "Dana", number = "+15557778888")
        runCurrent()

        h.core.declineCurrent("in-1")
        runCurrent()

        assertEquals("decline-mine always fires — no session resolution", 1, declineMineCalls.get())
        assertTrue("no per-session decline without a known session", declinedSessions.isEmpty())
        assertTrue("decline is explicit user action — it ends the local leg", leg.ended)
        h.scope.cancel()
    }

    @Test
    fun `declineCurrent with a known session ALSO fires the per-session fast path`() = runTest {
        val h = harness()
        h.core.start("company-1")
        h.core.awaitReady()
        val leg = FakeHandle("in-1")
        h.sdk.ring(leg, name = "Dana", number = "+15557778888")
        runCurrent()

        h.core.declineCurrent("in-1", sessionHint = "sess-known")
        runCurrent()

        assertEquals("the free per-session fast path fired", listOf("sess-known"), declinedSessions.toList())
        assertEquals("the universal decline-mine still fires", 1, declineMineCalls.get())
        assertTrue(leg.ended)
        h.scope.cancel()
    }

    @Test
    fun `declineCurrent with no local leg still POSTs decline-mine`() = runTest {
        val h = harness()
        h.core.start("company-1")
        h.core.awaitReady()

        // The pre-INVITE push ring: no WebRTC leg exists yet, session known.
        h.core.declineCurrent(callId = null, sessionHint = "sess-pre-invite")
        runCurrent()

        assertEquals(listOf("sess-pre-invite"), declinedSessions.toList())
        assertEquals(1, declineMineCalls.get())
        assertTrue("no local leg to end", h.core.state.value.calls.isEmpty())
        h.scope.cancel()
    }

    @Test
    fun `declineCurrent with a null callId tears down the sole correlated ring`() = runTest {
        val h = harness()
        h.core.start("company-1")
        h.core.awaitReady()
        // A wake push correlates the sole ring by caller; a null callId falls
        // back to it for teardown (the activity's pre-INVITE decline path).
        h.core.onIncomingCallPush("sess-x", callerHint = "+15557778888")
        val leg = FakeHandle("in-late")
        h.sdk.ring(leg, name = "Dana", number = "+15557778888")
        runCurrent()

        h.core.declineCurrent()
        runCurrent()

        assertEquals("decline-mine fires with no callId and no session hint", 1, declineMineCalls.get())
        assertTrue("the sole correlated ring is torn down", leg.ended)
        h.scope.cancel()
    }

    // -------------------------------------------- one-per-device (§10.1.4)

    @Test
    fun `a duplicate INVITE for a caller already presenting is held silent`() = runTest {
        val h = harness()
        h.core.start("company-1")
        h.core.awaitReady()

        val first = FakeHandle("in-1")
        h.sdk.ring(first, name = "Dana", number = "+15557778888")
        runCurrent()
        // The shared credential forks the same session's INVITE to this device
        // again (same caller — the only session proxy an INVITE carries).
        val fork = FakeHandle("in-1-fork")
        h.sdk.ring(fork, name = "Dana", number = "+15557778888")
        runCurrent()

        assertFalse("a forked duplicate is held, never ended", fork.ended)
        assertEquals("only the first INVITE presents", 1, h.core.state.value.calls.size)
        assertEquals("in-1", h.core.state.value.calls.single().id)
        h.scope.cancel()
    }

    @Test
    fun `a held duplicate promotes when the presented sibling dies still ringing`() = runTest {
        // No push hint → the promotion can't verify the session, so it promotes
        // rather than suppress an unverifiable real ring (§10.1.4 doubt rule).
        val h = harness()
        h.core.start("company-1")
        h.core.awaitReady()

        val first = FakeHandle("in-1")
        h.sdk.ring(first, name = "Dana", number = "+15557778888")
        runCurrent()
        val fork = FakeHandle("in-1-fork")
        h.sdk.ring(fork, name = "Dana", number = "+15557778888")
        runCurrent()

        // The presented leg dies un-answered (its socket dropped); the forked
        // leg is still alive and must take over presentation.
        first.phaseFlow.value = CallPhase.ENDED
        runCurrent()

        val presented = h.core.state.value.calls.singleOrNull()
        assertNotNull("the fork promotes to presentation", presented)
        assertEquals("in-1-fork", presented!!.id)
        assertEquals(CallPhase.RINGING, presented.phase)
        assertFalse(fork.ended)
        h.scope.cancel()
    }

    // ------------------------------------------------- answer failure (#168A)

    @Test
    fun `an SDK throw on accept surfaces the error line and keeps the ring`() = runTest {
        val h = harness()
        var reportedTag: String? = null
        h.core.onInternalFailure = { tag, _ -> reportedTag = tag }
        h.core.start("company-1")
        h.core.awaitReady()

        val ringLeg = FakeHandle("in-1")
        ringLeg.acceptThrows = IllegalStateException("Call not found for ID: in-1")
        h.sdk.ring(ringLeg)
        runCurrent()

        h.core.answer("in-1")

        val state = h.core.state.value
        assertEquals("Couldn't answer — try again.", state.error)
        assertEquals("the ring survives the failed answer", CallPhase.RINGING, state.calls.single().phase)
        assertEquals("answer", reportedTag)
        h.scope.cancel()
    }
}
