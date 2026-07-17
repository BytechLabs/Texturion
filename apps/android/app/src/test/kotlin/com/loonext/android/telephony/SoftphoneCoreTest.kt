package com.loonext.android.telephony

import com.loonext.android.core.auth.Session
import com.loonext.android.core.auth.SessionSource
import com.loonext.android.core.auth.SupabaseAuth
import com.loonext.android.core.net.ApiClient
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
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.runTest
import mockwebserver3.Dispatcher
import mockwebserver3.MockResponse
import mockwebserver3.MockWebServer
import mockwebserver3.RecordedRequest
import okhttp3.OkHttpClient
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Before
import org.junit.Test
import java.util.concurrent.atomic.AtomicInteger

/**
 * SoftphoneCore against a REAL ApiClient + MockWebServer (the house pattern —
 * core/net/ApiClientTest.kt) and a fake SDK: client_state passthrough, by-leg
 * resolution on inbound answer, ring-me conflict swallowing, mint-on-connect
 * (never per call), and the call-waiting invariants.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class SoftphoneCoreTest {
    private lateinit var server: MockWebServer

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
        server = MockWebServer().also { it.start() }
        server.dispatcher = object : Dispatcher() {
            override fun dispatch(request: RecordedRequest): MockResponse {
                val path = request.url.encodedPath
                return when {
                    path == "/v1/webrtc/token" -> {
                        tokenMints.incrementAndGet()
                        MockResponse(
                            body = """{"token":"telnyx-jwt","sip_username":"sip-u1","expires_in_hours":24}""",
                        )
                    }

                    path == "/v1/calls/browser" -> MockResponse(
                        body = """{"from":"+15550001111","to":"+15552223333",""" +
                            """"client_state":"$serverClientState"}""",
                    )

                    path.startsWith("/v1/calls/live/by-leg/") -> {
                        byLegHits.incrementAndGet()
                        MockResponse(body = """{"call_session_id":"sess-real"}""")
                    }

                    path.endsWith("/ring-me") -> when (ringMeStatus) {
                        200 -> MockResponse(body = """{"ok":true}""")
                        409 -> MockResponse(
                            code = 409,
                            body = """{"error":{"code":"conflict","message":"That call isn't ringing anymore."}}""",
                        )

                        else -> MockResponse(
                            code = 500,
                            body = """{"error":{"code":"internal_error","message":"Something broke."}}""",
                        )
                    }

                    else -> MockResponse(
                        code = 404,
                        body = """{"error":{"code":"not_found","message":"No route."}}""",
                    )
                }
            }
        }
    }

    @After
    fun tearDown() {
        server.close()
    }

    private class FakeSessions : SessionSource {
        private val flow = MutableStateFlow<Session?>(
            Session(
                accessToken = "token-1",
                refreshToken = "refresh-1",
                expiresAt = System.currentTimeMillis() / 1000 + 3600,
                userId = "user-1",
                email = "a@b.c",
            ),
        )
        override val session: Flow<Session?> = flow
        override suspend fun current(): Session? = flow.value
        override suspend fun save(session: Session) {
            flow.value = session
        }

        override suspend fun clear() {
            flow.value = null
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
        val http = OkHttpClient()
        val api = ApiClient(
            http = http,
            baseUrl = server.url("/").toString().trimEnd('/'),
            sessionStore = FakeSessions(),
            supabaseAuth = SupabaseAuth(
                client = http,
                supabaseUrl = "http://localhost:1",
                publishableKey = "pk",
            ),
        )
        // Unconfined so the core's internal collectors start eagerly; shares
        // the test scheduler so delays use virtual time.
        val scope = CoroutineScope(SupervisorJob() + UnconfinedTestDispatcher(testScheduler))
        val sdk = FakeSdk()
        return Harness(SoftphoneCore(CallsApi(api), sdk, scope), sdk, scope)
    }

    /** Bare await — never a virtual-time timeout around REAL MockWebServer
     *  IO (virtual time races ahead of real sockets); runTest's own wall-
     *  clock timeout guards a hang. */
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
        h.sdk.outboundHandles[0].phaseFlow.value = CallPhase.ACTIVE
        h.sdk.outboundHandles[0].phaseFlow.value = CallPhase.ENDED
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

        h.sdk.outboundHandles.single().phaseFlow.value = CallPhase.ACTIVE

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
        h.sdk.outboundHandles[0].phaseFlow.value = CallPhase.ACTIVE
        h.core.placeCall(displayName = "B", to = "+15552223333")
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
        assertEquals(CallPhase.RINGING, h.core.state.value.calls.single().phase)
        assertNull(h.core.state.value.calls.single().sessionId)

        h.core.answer("in-1")
        assertNotNull(ringLeg.accepted)
        ringLeg.phaseFlow.value = CallPhase.ACTIVE

        // singleOrNull: the predicate must be TOTAL — with the by-leg fetch on
        // a real IO thread, runTest can observe interleavings where this
        // snapshot isn't the settled one (CI flake, run 12).
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
        // Another member won the race — the SDK ends our ring leg.
        ringLeg.phaseFlow.value = CallPhase.ENDED
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
        h.core.answer("in-1")
        first.phaseFlow.value = CallPhase.ACTIVE

        val second = FakeHandle("in-2", callControlId = "ccid-2")
        h.sdk.ring(second, name = "Second")
        h.core.answer("in-2")

        assertEquals("the active first call got the SDK hold toggle", 1, first.holdToggles)
        assertNotNull(second.accepted)

        // The SDK confirms: first held, second active — one active audio path.
        first.phaseFlow.value = CallPhase.HELD
        second.phaseFlow.value = CallPhase.ACTIVE
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
        h.core.answer("in-1")
        first.phaseFlow.value = CallPhase.ACTIVE
        val second = FakeHandle("in-2")
        h.sdk.ring(second, name = "Second")

        val third = FakeHandle("in-3")
        h.sdk.ring(third, name = "Third")

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
        h.core.answer("in-1")
        first.phaseFlow.value = CallPhase.ACTIVE
        val second = FakeHandle("in-2")
        h.sdk.ring(second, name = "Second")
        h.core.answer("in-2")
        first.phaseFlow.value = CallPhase.HELD
        second.phaseFlow.value = CallPhase.ACTIVE

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
