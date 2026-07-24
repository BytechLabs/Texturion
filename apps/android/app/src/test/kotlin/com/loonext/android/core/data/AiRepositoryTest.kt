package com.loonext.android.core.data

import com.loonext.android.core.auth.Session
import com.loonext.android.core.auth.SessionSource
import com.loonext.android.core.auth.SupabaseAuth
import com.loonext.android.core.net.ApiClient
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.test.runTest
import mockwebserver3.MockResponse
import mockwebserver3.MockWebServer
import okhttp3.OkHttpClient
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

/**
 * #214 wire-level checks of the AI enrichment + settings client: the enrich
 * POST is session-cached per (company, message), never throws (any error →
 * empty enrichment, still cached), and the settings read/write hit the right
 * routes with the right bodies.
 */
class AiRepositoryTest {

    private class FakeSessions : SessionSource {
        val flow = MutableStateFlow<Session?>(
            Session(
                accessToken = "token-1",
                refreshToken = "refresh-1",
                expiresAt = System.currentTimeMillis() / 1000 + 3600,
                userId = "user-1",
                email = "a@b.c",
            ),
        )
        override val session = flow
        override suspend fun current(): Session? = flow.value
        override suspend fun save(session: Session) {
            flow.value = session
        }

        override suspend fun clear() {
            flow.value = null
        }
    }

    private lateinit var server: MockWebServer
    private lateinit var aiRepo: AiRepository

    @Before
    fun setUp() {
        server = MockWebServer().also { it.start() }
        val api = ApiClient(
            http = OkHttpClient(),
            baseUrl = server.url("/").toString().trimEnd('/'),
            sessionStore = FakeSessions(),
            supabaseAuth = SupabaseAuth(
                client = OkHttpClient(),
                supabaseUrl = server.url("/gotrue").toString(),
                publishableKey = "pk",
            ),
        )
        aiRepo = AiRepository(api)
    }

    @After
    fun tearDown() {
        server.close()
    }

    @Test
    fun `enrich posts text and ids, then reuses the session cache`() = runTest {
        server.enqueue(
            MockResponse(
                body = """
                    {"address":{"street":"5 Bay St","city":"Toronto"},
                     "address_provenance":"message","due_at":"2026-07-24T14:00:00-04:00"}
                """.trimIndent(),
            ),
        )
        val first = aiRepo.enrichTask("c1", "meet at 5 Bay St tomorrow 2pm", "m1", "cv1")
        assertEquals("5 Bay St", first.address?.street)
        assertEquals("message", first.address_provenance)
        assertEquals("2026-07-24T14:00:00-04:00", first.due_at)

        val recorded = server.takeRequest()
        assertEquals("POST", recorded.method)
        assertEquals("/v1/tasks/enrich", recorded.url.encodedPath)
        assertEquals("c1", recorded.headers["X-Company-Id"])
        assertEquals(
            """{"text":"meet at 5 Bay St tomorrow 2pm","message_id":"m1","conversation_id":"cv1"}""",
            recorded.body?.utf8(),
        )

        // Second call for the SAME (company, message): served from cache — no
        // second network request is made.
        val second = aiRepo.enrichTask("c1", "different text entirely", "m1", "cv1")
        assertEquals(first, second)
        assertEquals(1, server.requestCount)
    }

    @Test
    fun `enrich never throws, degrading a failed call to the empty enrichment`() = runTest {
        server.enqueue(MockResponse(code = 500, body = "boom"))
        val result = aiRepo.enrichTask("c1", "some text", "m2", "cv1")
        assertNull(result.address)
        assertNull(result.address_provenance)
        assertNull(result.due_at)
        assertFalse(result.enrichment_disabled)

        // The empty result is cached too — a second open never re-spends.
        val again = aiRepo.enrichTask("c1", "some text", "m2", "cv1")
        assertEquals(result, again)
        assertEquals(1, server.requestCount)
    }

    @Test
    fun `getAiSettings reads the member route`() = runTest {
        server.enqueue(
            MockResponse(body = """{"enrich_task_address":true,"enrich_task_due":false}"""),
        )
        val settings = aiRepo.getAiSettings("c1")
        assertTrue(settings.enrich_task_address)
        assertFalse(settings.enrich_task_due)
        val recorded = server.takeRequest()
        assertEquals("GET", recorded.method)
        assertEquals("/v1/company/ai-settings", recorded.url.encodedPath)
    }

    @Test
    fun `updateAiSettings patches both toggles`() = runTest {
        server.enqueue(
            MockResponse(body = """{"enrich_task_address":true,"enrich_task_due":true}"""),
        )
        aiRepo.updateAiSettings(
            "c1",
            com.loonext.android.core.model.CompanyAiSettings(
                enrich_task_address = true,
                enrich_task_due = true,
            ),
        )
        val recorded = server.takeRequest()
        assertEquals("PATCH", recorded.method)
        assertEquals("/v1/company/ai-settings", recorded.url.encodedPath)
        assertEquals(
            """{"enrich_task_address":true,"enrich_task_due":true}""",
            recorded.body?.utf8(),
        )
    }
}
