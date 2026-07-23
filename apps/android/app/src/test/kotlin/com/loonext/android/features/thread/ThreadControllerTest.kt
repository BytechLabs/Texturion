package com.loonext.android.features.thread

import android.content.Context
import android.content.ContextWrapper
import com.loonext.android.core.auth.Session
import com.loonext.android.core.auth.SessionSource
import com.loonext.android.core.auth.SupabaseAuth
import com.loonext.android.core.data.MeRepository
import com.loonext.android.core.data.StoreCache
import com.loonext.android.core.model.ConversationDetail
import com.loonext.android.core.model.ConversationDetailContact
import com.loonext.android.core.model.Message
import com.loonext.android.core.model.MessageDirection
import com.loonext.android.core.model.MessageStatus
import com.loonext.android.core.model.Page
import com.loonext.android.core.net.ApiClient
import com.loonext.android.features.compose.NoteFileUploader
import com.loonext.android.ui.common.LoadState
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import mockwebserver3.Dispatcher
import mockwebserver3.MockResponse
import mockwebserver3.MockWebServer
import mockwebserver3.RecordedRequest
import okhttp3.OkHttpClient
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Before
import org.junit.Test

/**
 * #215 Part A: the resync-on-foreground safety net is wired to
 * [ThreadController.refreshAfterReconnect] on ON_RESUME. That method must
 * (a) recover a page-1 message that exists server-side but for which NO realtime
 * event ever fired (the dropped-frame it heals), and (b) MERGE rather than
 * replace — since foregrounding is frequent, a user who scrolled back must keep
 * their loaded pages across every pause/resume and socket re-JOIN.
 */
class ThreadControllerTest {

    private lateinit var server: MockWebServer
    private lateinit var scope: CoroutineScope

    /** Response encoder — the exact client Json config, so bodies round-trip. */
    private val respJson = Json {
        ignoreUnknownKeys = true
        explicitNulls = false
        encodeDefaults = true
    }

    /** The conversation's page 1 as the server currently sees it (swappable). */
    @Volatile
    private var serverDetail: ConversationDetail =
        detailWith(listOf(msg("m2", T2)), nextCursor = OLDER_CURSOR)

    /** The one older page reachable behind [OLDER_CURSOR]. */
    private val olderPage = Page(data = listOf(msg("m1", T1)), next_cursor = null)

    @Before
    fun setUp() {
        server = MockWebServer()
        server.dispatcher = object : Dispatcher() {
            override fun dispatch(request: RecordedRequest): MockResponse {
                val url = request.url
                val path = url.encodedPath
                return when {
                    // GET /v1/conversations/c1 gates the thread and carries the
                    // embedded first page of messages the controller renders.
                    request.method == "GET" && path == "/v1/conversations/c1" ->
                        MockResponse(code = 200, body = respJson.encodeToString(serverDetail))

                    // The one older page, reached via the cursor.
                    request.method == "GET" &&
                        path == "/v1/conversations/c1/messages" &&
                        url.queryParameter("cursor") == OLDER_CURSOR ->
                        MockResponse(code = 200, body = respJson.encodeToString(olderPage))

                    // Every other secondary read is refetched inside runCatching,
                    // so an empty page (or a decode miss) is tolerated by design.
                    else -> MockResponse(code = 200, body = """{"data":[]}""")
                }
            }
        }
        server.start()
        scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    }

    @After
    fun tearDown() {
        scope.cancel()
        server.close()
    }

    @Test
    fun `refreshAfterReconnect heals a missed message while keeping scrollback`() {
        val controller = controller()
        controller.start()

        // Initial load paints page 1 (m2) with an older page still to fetch.
        awaitUntil { controller.load is LoadState.Ready && ids(controller) == listOf("m2") }

        // The user scrolls back and loads the older page (m1).
        controller.loadOlderMessages()
        awaitUntil { ids(controller) == listOf("m2", "m1") }

        // A new inbound message lands server-side on page 1 — but NO realtime
        // event fires (the dropped-frame scenario), so the open thread is
        // unchanged for now.
        serverDetail = detailWith(listOf(msg("m3", T3), msg("m2", T2)), nextCursor = OLDER_CURSOR)
        assertEquals(listOf("m2", "m1"), ids(controller))

        // The ON_RESUME target runs. It must MERGE: m3 heals in AND the loaded
        // scrollback (m1) survives — replacing with page 1 would have dropped m1.
        controller.refreshAfterReconnect()
        awaitUntil { ids(controller).contains("m3") }
        assertEquals(listOf("m3", "m2", "m1"), ids(controller))
    }

    // --- Harness --------------------------------------------------------------

    private fun controller(): ThreadController {
        val api = ApiClient(
            http = OkHttpClient(),
            baseUrl = server.url("/").toString().trimEnd('/'),
            sessionStore = FakeSessions(liveSession()),
            supabaseAuth = SupabaseAuth(
                client = OkHttpClient(),
                supabaseUrl = server.url("/").toString().trimEnd('/'),
                publishableKey = "pk",
            ),
        )
        // A never-dereferenced Context: the controller only touches appContext
        // in saveNote, which this test never exercises. ContextWrapper(null) is
        // a concrete Context that constructs without the android.test stubs.
        val ctx: Context = ContextWrapper(null)
        return ThreadController(
            repo = MessagingRepository(api),
            meRepo = MeRepository(api),
            uploader = NoteFileUploader(api, "http://localhost"),
            appContext = ctx,
            cache = StoreCache(),
            companyId = "co1",
            conversationId = "c1",
            meUserId = "u1",
            scope = scope,
        )
    }

    private fun ids(c: ThreadController) = c.messages.map { it.id }

    private fun awaitUntil(timeoutMs: Long = 5_000, condition: () -> Boolean) {
        val deadline = System.currentTimeMillis() + timeoutMs
        while (System.currentTimeMillis() < deadline) {
            if (condition()) return
            Thread.sleep(10)
        }
        throw AssertionError("condition not met within ${timeoutMs}ms")
    }

    private companion object {
        private const val OLDER_CURSOR = "older-1"
        private const val T1 = "2026-07-15T10:00:00Z"
        private const val T2 = "2026-07-15T10:05:00Z"
        private const val T3 = "2026-07-15T10:10:00Z"

        private fun msg(id: String, at: String) = Message(
            id = id,
            conversation_id = "c1",
            direction = MessageDirection.INBOUND,
            body = "body $id",
            status = MessageStatus.RECEIVED,
            created_at = at,
        )

        private fun detailWith(messages: List<Message>, nextCursor: String?) = ConversationDetail(
            id = "c1",
            company_id = "co1",
            contact_id = "ct1",
            phone_number_id = "pn1",
            status = "open",
            is_spam = false,
            last_message_at = messages.first().created_at,
            created_at = "2026-07-01T00:00:00Z",
            updated_at = "2026-07-01T00:00:00Z",
            contact = ConversationDetailContact(id = "ct1", phone_e164 = "+15555550100"),
            messages = Page(data = messages, next_cursor = nextCursor),
        )

        private fun liveSession() = Session(
            accessToken = "token-1",
            refreshToken = "refresh-1",
            expiresAt = System.currentTimeMillis() / 1000 + 3600,
            userId = "u1",
            email = "a@b.c",
        )
    }

    private class FakeSessions(initial: Session?) : SessionSource {
        private val flow = MutableStateFlow(initial)
        override val session = flow
        override suspend fun current(): Session? = flow.value
        override suspend fun save(session: Session) {
            flow.value = session
        }

        override suspend fun clear() {
            flow.value = null
        }
    }
}
