package com.loonext.android.core.net

import com.loonext.android.core.auth.Session
import com.loonext.android.core.auth.SessionSource
import com.loonext.android.core.auth.SupabaseAuth
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.Serializable
import mockwebserver3.MockResponse
import mockwebserver3.MockWebServer
import okhttp3.OkHttpClient
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Before
import org.junit.Test

@Serializable
private data class Pong(val ok: Boolean)

private class FakeSessions(initial: Session?) : SessionSource {
    val flow = MutableStateFlow(initial)
    override val session = flow
    var cleared = false

    override suspend fun current(): Session? = flow.value

    override suspend fun save(session: Session) {
        flow.value = session
    }

    override suspend fun clear() {
        cleared = true
        flow.value = null
    }
}

private fun liveSession(token: String = "token-1") = Session(
    accessToken = token,
    refreshToken = "refresh-1",
    // Far future — not expired.
    expiresAt = System.currentTimeMillis() / 1000 + 3600,
    userId = "user-1",
    email = "a@b.c",
)

class ApiClientTest {
    private lateinit var api: MockWebServer
    private lateinit var gotrue: MockWebServer
    private lateinit var sessions: FakeSessions

    @Before
    fun setUp() {
        api = MockWebServer().also { it.start() }
        gotrue = MockWebServer().also { it.start() }
        sessions = FakeSessions(liveSession())
    }

    @After
    fun tearDown() {
        api.close()
        gotrue.close()
    }

    private fun client() = ApiClient(
        http = OkHttpClient(),
        baseUrl = api.url("/").toString().trimEnd('/'),
        sessionStore = sessions,
        supabaseAuth = SupabaseAuth(
            client = OkHttpClient(),
            supabaseUrl = gotrue.url("/").toString().trimEnd('/'),
            publishableKey = "pk",
        ),
    )

    @Test
    fun `sends bearer, company id, and idempotency headers`() = runTest {
        api.enqueue(MockResponse(body = """{"ok":true}"""))
        val result: Pong = client().post(
            "/v1/messages/send",
            mapOf("body" to "hi"),
            companyId = "company-1",
            idempotencyKey = "key-1",
        )
        assertTrue(result.ok)
        val recorded = api.takeRequest()
        assertEquals("Bearer token-1", recorded.headers["Authorization"])
        assertEquals("company-1", recorded.headers["X-Company-Id"])
        assertEquals("key-1", recorded.headers["Idempotency-Key"])
    }

    @Test
    fun `decodes the SPEC error envelope and surfaces the code`() = runTest {
        api.enqueue(
            MockResponse(
                code = 409,
                body = """{"error":{"code":"quiet_hours_confirmation_required","message":"It's late there."}}""",
            ),
        )
        try {
            client().get<Pong>("/v1/conversations", companyId = "c")
            fail("expected ApiException")
        } catch (e: ApiException) {
            assertEquals(ApiErrorCode.QUIET_HOURS_CONFIRMATION_REQUIRED, e.code)
            assertEquals("It's late there.", e.message)
            assertEquals(409, e.httpStatus)
        }
    }

    @Test
    fun `a 401 refreshes once and retries with the new token`() = runTest {
        api.enqueue(MockResponse(code = 401, body = """{"error":{"code":"unauthorized","message":"nope"}}"""))
        api.enqueue(MockResponse(body = """{"ok":true}"""))
        gotrue.enqueue(
            MockResponse(
                body = """{"access_token":"token-2","refresh_token":"refresh-2",
                    "expires_in":3600,"user":{"id":"user-1","email":"a@b.c"}}""",
            ),
        )

        val result: Pong = client().get("/v1/me")
        assertTrue(result.ok)

        assertEquals("Bearer token-1", api.takeRequest().headers["Authorization"])
        assertEquals("Bearer token-2", api.takeRequest().headers["Authorization"])
        assertEquals("token-2", sessions.flow.value?.accessToken)
    }

    @Test
    fun `a rejected refresh clears the session`() = runTest {
        api.enqueue(MockResponse(code = 401, body = """{"error":{"code":"unauthorized","message":"nope"}}"""))
        gotrue.enqueue(
            MockResponse(code = 400, body = """{"error_code":"refresh_token_not_found","msg":"gone"}"""),
        )
        try {
            client().get<Pong>("/v1/me")
            fail("expected ApiException")
        } catch (e: ApiException) {
            assertEquals(ApiErrorCode.UNAUTHORIZED, e.code)
        }
        assertTrue(sessions.cleared)
        assertNull(sessions.flow.value)
    }

    @Test
    fun `an expired token refreshes proactively before the request`() = runTest {
        sessions.flow.value = liveSession().copy(
            expiresAt = System.currentTimeMillis() / 1000 - 10,
        )
        gotrue.enqueue(
            MockResponse(
                body = """{"access_token":"token-2","refresh_token":"refresh-2",
                    "expires_in":3600,"user":{"id":"user-1","email":"a@b.c"}}""",
            ),
        )
        api.enqueue(MockResponse(body = """{"ok":true}"""))

        val result: Pong = client().get("/v1/me")
        assertTrue(result.ok)
        assertEquals("Bearer token-2", api.takeRequest().headers["Authorization"])
        assertNotNull(sessions.flow.value)
    }

    // --- #268: a bad minute at the auth server is not a dead session ---

    @Test
    fun `a 429 during refresh keeps the session`() = runTest {
        // A whole crew behind one office IP hits GoTrue's refresh rate limit.
        // The refresh token is untouched; signing everyone out would cost each
        // of them a full re-login for a limit that clears in seconds.
        sessions.flow.value = liveSession().copy(
            expiresAt = System.currentTimeMillis() / 1000 - 10,
        )
        gotrue.enqueue(MockResponse(code = 429, body = """{"msg":"rate limited"}"""))

        try {
            client().get<Pong>("/v1/me")
            fail("expected ApiException")
        } catch (e: ApiException) {
            assertEquals(429, e.httpStatus)
        }
        assertFalse(sessions.cleared)
        assertNotNull(sessions.flow.value)
    }

    @Test
    fun `a 503 during refresh keeps the session`() = runTest {
        // Supabase returns 503 for half a minute during a platform deploy.
        sessions.flow.value = liveSession().copy(
            expiresAt = System.currentTimeMillis() / 1000 - 10,
        )
        gotrue.enqueue(MockResponse(code = 503, body = """{"msg":"unavailable"}"""))

        try {
            client().get<Pong>("/v1/me")
            fail("expected ApiException")
        } catch (e: ApiException) {
            assertEquals(503, e.httpStatus)
        }
        assertFalse(sessions.cleared)
        assertNotNull(sessions.flow.value)
    }

    @Test
    fun `only the server refusing the token counts as a dead session`() {
        // The rule both clients share: a 4xx is a rejection, everything else
        // is weather (iOS Core/ApiClient.swift).
        assertTrue(ApiException(ApiErrorCode.NETWORK, "offline", 0).isTransientRefreshFailure())
        assertTrue(ApiException(ApiErrorCode.RATE_LIMITED, "slow down", 429).isTransientRefreshFailure())
        assertTrue(ApiException(ApiErrorCode.INTERNAL_ERROR, "boom", 500).isTransientRefreshFailure())
        assertTrue(ApiException(ApiErrorCode.INTERNAL_ERROR, "gateway", 503).isTransientRefreshFailure())
        assertFalse(ApiException(ApiErrorCode.UNAUTHORIZED, "gone", 400).isTransientRefreshFailure())
        assertFalse(ApiException(ApiErrorCode.UNAUTHORIZED, "gone", 401).isTransientRefreshFailure())
        assertFalse(ApiException(ApiErrorCode.FORBIDDEN, "no", 403).isTransientRefreshFailure())
    }
}
