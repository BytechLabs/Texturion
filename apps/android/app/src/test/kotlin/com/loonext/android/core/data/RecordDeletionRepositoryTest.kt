package com.loonext.android.core.data

import com.loonext.android.core.auth.Session
import com.loonext.android.core.auth.SessionSource
import com.loonext.android.core.auth.SupabaseAuth
import com.loonext.android.core.model.TrashKind
import com.loonext.android.core.net.ApiClient
import com.loonext.android.core.net.ApiException
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.test.runTest
import mockwebserver3.MockResponse
import mockwebserver3.MockWebServer
import okhttp3.OkHttpClient
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.fail
import org.junit.Before
import org.junit.Test

/**
 * #691 wire checks: each delete hits its own route with the workspace header,
 * the call routes take the list row id, and Undo is the Trash restore.
 */
class RecordDeletionRepositoryTest {

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
    private lateinit var repo: RecordDeletionRepository

    @Before
    fun setUp() {
        server = MockWebServer().also { it.start() }
        repo = RecordDeletionRepository(
            ApiClient(
                http = OkHttpClient(),
                baseUrl = server.url("/").toString().trimEnd('/'),
                sessionStore = FakeSessions(),
                supabaseAuth = SupabaseAuth(
                    client = OkHttpClient(),
                    supabaseUrl = server.url("/gotrue").toString(),
                    publishableKey = "pk",
                ),
            ),
        )
    }

    @After
    fun tearDown() {
        server.close()
    }

    private fun answer(kind: String, id: String) =
        server.enqueue(MockResponse(body = """{"kind":"$kind","id":"$id"}"""))

    @Test
    fun `each delete uses its own route`() = runTest {
        answer("message", "m1")
        answer("conversation", "cv1")
        answer("call", "call1")
        answer("voicemail", "call1")

        assertEquals("m1", repo.deleteMessage("co1", "m1").id)
        assertEquals("conversation", repo.deleteConversation("co1", "cv1").kind)
        assertEquals("call", repo.deleteCall("co1", "call1").kind)
        assertEquals("voicemail", repo.deleteVoicemail("co1", "call1").kind)

        val paths = (1..4).map {
            val r = server.takeRequest()
            assertEquals("DELETE", r.method)
            assertEquals("co1", r.headers["X-Company-Id"])
            r.url.encodedPath
        }
        assertEquals(
            listOf(
                "/v1/messages/m1",
                "/v1/conversations/cv1",
                "/v1/calls/call1",
                "/v1/calls/call1/voicemail",
            ),
            paths,
        )
    }

    @Test
    fun `undo posts the kind and id to the trash restore route`() = runTest {
        server.enqueue(MockResponse(body = """{"kind":"message","id":"m1"}"""))
        repo.restore("co1", TrashKind.MESSAGE, "m1")
        val r = server.takeRequest()
        assertEquals("POST", r.method)
        assertEquals("/v1/trash/restore", r.url.encodedPath)
        assertEquals("""{"kind":"message","id":"m1"}""", r.body?.utf8())
    }

    @Test
    fun `a member without records delete is refused`() = runTest {
        server.enqueue(
            MockResponse(
                code = 403,
                body = """{"error":{"code":"FORBIDDEN","message":"No."}}""",
            ),
        )
        try {
            repo.deleteMessage("co1", "m1")
            fail("a 403 must surface as an ApiException")
        } catch (e: ApiException) {
            assertEquals(403, e.httpStatus)
        }
    }
}
