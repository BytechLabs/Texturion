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
    fun `updateAiSettings patches every toggle`() = runTest {
        server.enqueue(
            MockResponse(
                body = """{"enrich_task_address":true,"enrich_task_due":true,"suggest_replies":true}""",
            ),
        )
        aiRepo.updateAiSettings(
            "c1",
            com.loonext.android.core.model.CompanyAiSettings(
                enrich_task_address = true,
                enrich_task_due = true,
                suggest_replies = true,
                transcribe_voicemail = false,
                voicemail_intake = true,
                call_wrapup = false,
                summarize_threads = false,
            ),
        )
        val recorded = server.takeRequest()
        assertEquals("PATCH", recorded.method)
        assertEquals("/v1/company/ai-settings", recorded.url.encodedPath)
        // Every toggle rides the PATCH: this client sends the whole object, so
        // an omitted field would silently re-enable whatever it left out.
        //
        // #367: voicemail_intake is on the wire for the same reason, and it is
        // the one where the omission would be worst — the server reads an absent
        // field as "leave it alone", so a client that dropped it could never
        // turn the greeting back off.
        //
        // #507: call_wrapup joins them, and it is the same trap — it defaults
        // to ON, so a client that dropped the field could never turn dictation
        // off for a workspace that asked for it off.
        //
        // #247: summarize_threads is the same trap once more, and this test is
        // what caught it. It also defaults to ON and it authorises the broadest
        // disclosure of the five — a whole conversation rather than one message
        // — so a workspace that turned catch-ups off and had the field dropped
        // would keep sending threads it had explicitly said no to.
        assertEquals(
            """{"enrich_task_address":true,"enrich_task_due":true,"suggest_replies":true,""" +
                """"transcribe_voicemail":false,"voicemail_intake":true,"call_wrapup":false,""" +
                """"summarize_threads":false}""",
            recorded.body?.utf8(),
        )
    }

    @Test
    fun `call wrapup defaults on when the server has never said otherwise`() = runTest {
        // #507: the server's DEFAULT_AI_SETTINGS has call_wrapup true, and a row
        // that predates the column decodes with the field absent. An absent
        // field must resolve the same way the server would resolve it —
        // defaulting to false here would silently hide the microphone from
        // every workspace that never touched the setting.
        server.enqueue(
            MockResponse(body = """{"enrich_task_address":true,"enrich_task_due":true}"""),
        )
        assertTrue(aiRepo.getAiSettings("c1").call_wrapup)
    }

    @Test
    fun `suggestReplies posts the typed draft and returns the drafts`() = runTest {
        server.enqueue(
            MockResponse(body = """{"suggestions":["We can come Thursday.","What time works?"]}"""),
        )
        val drafted = aiRepo.suggestReplies("c1", "conv-1", "We can")
        assertEquals(listOf("We can come Thursday.", "What time works?"), drafted.suggestions)

        val recorded = server.takeRequest()
        assertEquals("POST", recorded.method)
        assertEquals(
            "/v1/conversations/conv-1/reply-suggestions",
            recorded.url.encodedPath,
        )
        assertEquals("""{"draft":"We can"}""", recorded.body?.utf8())
    }

    @Test
    fun `suggestReplies omits an empty draft`() = runTest {
        server.enqueue(MockResponse(body = """{"suggestions":[]}"""))
        assertEquals(emptyList<String>(), aiRepo.suggestReplies("c1", "conv-1", "   ").suggestions)
        assertEquals("{}", server.takeRequest().body?.utf8())
    }

    @Test
    fun `suggestReplies never throws — a failure says so instead of shrugging`() = runTest {
        server.enqueue(MockResponse(code = 500, body = "boom"))
        val drafted = aiRepo.suggestReplies("c1", "conv-1", "")
        assertEquals(emptyList<String>(), drafted.suggestions)
        // The reason is what lets the composer say "couldn't reach the
        // assistant" instead of implying there was simply nothing to say.
        assertEquals("model_error", drafted.reason)
    }
}
