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
 * answer, ring-me conflict swallowing, mint-on-connect (never per call), and
 * the call-waiting invariants.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class SoftphoneCoreTest {
    // The exact base64 the server would mint: btoa('oc_customer|<to>|<nonce>').
    private val serverClientState: String = java.util.Base64.getEncoder().encodeToString(
        "oc_customer|+15552223333|nonce-1".toByteArray(Charsets.UTF_8),
    )

    private val tokenMints = AtomicInteger(0)
    private val byLegHits = AtomicInteger(0)
    private var ringMeStatus = 200

    @Before
    fun setUp() {
        tokenMints.set(0)
        byLegHits.set(0)
        ringMeStatus = 200
    }

    /**
     * Direct suspend-function fake of the [CallsApi] seam. Responses (and the
     * decoded [ApiException]s for error statuses) match what the old
     * MockWebServer harness served, but every call completes synchronously in
     * the caller's coroutine — the test scheduler owns every hop.
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

        override suspend fun transferTargets(companyId: String, sessionId: String): TransferTargets =
            throw ApiException(ApiErrorCode.NOT_FOUND, "No route.", 404)

        override suspend fun blindTransfer(
            companyId: String,
            sessionId: String,
            targetUserId: String,
        ): TransferAck = throw ApiException(ApiErrorCode.NOT_FOUND, "No route.", 404)

        override suspend fun ringMe(companyId: String, sessionId: String): RingAck =
            when (ringMeStatus) {
                200 -> RingAck(ok = true)
                409 -> throw ApiException(
                    ApiErrorCode.CONFLICT,
                    "That call isn't ringing anymore.",
                    409,
                )

                else -> throw ApiException(ApiErrorCode.INTERNAL_ERROR, "Something broke.", 500)
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

        override fun accept(destinationNumber: String) {
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
        h.sdk.ring(first, name = "First")
        runCurrent()
        h.core.answer("in-1")
        first.phaseFlow.value = CallPhase.ACTIVE
        runCurrent()

        val second = FakeHandle("in-2", callControlId = "ccid-2")
        h.sdk.ring(second, name = "Second")
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
    fun `a third concurrent inbound is declined immediately`() = runTest {
        val h = harness()
        h.core.start("company-1")
        h.core.awaitReady()

        val first = FakeHandle("in-1")
        h.sdk.ring(first, name = "First")
        runCurrent()
        h.core.answer("in-1")
        first.phaseFlow.value = CallPhase.ACTIVE
        runCurrent()
        val second = FakeHandle("in-2")
        h.sdk.ring(second, name = "Second")
        runCurrent()

        val third = FakeHandle("in-3")
        h.sdk.ring(third, name = "Third")
        runCurrent()

        assertTrue("third call declined so the race resolves elsewhere", third.ended)
        assertEquals(2, h.core.state.value.calls.size)
        h.scope.cancel()
    }

    @Test
    fun `unhold swaps the active audio - the other call is held first`() = runTest {
        val h = harness()
        h.core.start("company-1")
        h.core.awaitReady()

        val first = FakeHandle("in-1")
        h.sdk.ring(first, name = "First")
        runCurrent()
        h.core.answer("in-1")
        first.phaseFlow.value = CallPhase.ACTIVE
        runCurrent()
        val second = FakeHandle("in-2")
        h.sdk.ring(second, name = "Second")
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

    // -------------------------------------------------------------- ring-me

    @Test
    fun `ring-me swallows conflict - the call was already resolved`() = runTest {
        ringMeStatus = 409
        val h = harness()
        h.core.start("company-1")
        h.core.awaitReady()
        // Must not throw.
        h.core.onIncomingCallPush("sess-stale")
        h.scope.cancel()
    }

    @Test
    fun `ring-me succeeds silently on 200`() = runTest {
        ringMeStatus = 200
        val h = harness()
        h.core.start("company-1")
        h.core.awaitReady()
        h.core.onIncomingCallPush("sess-live")
        h.scope.cancel()
    }

    @Test
    fun `ring-me propagates real failures so the caller can retry`() = runTest {
        ringMeStatus = 500
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
    fun `ring-me reuses a live registration - no re-connect, no re-mint`() = runTest {
        val h = harness()
        h.core.start("company-1")
        h.core.awaitReady()
        assertEquals(1, h.sdk.connects)
        h.core.onIncomingCallPush("sess-live")
        assertEquals(1, h.sdk.connects)
        assertEquals(1, tokenMints.get())
        h.scope.cancel()
    }
}
