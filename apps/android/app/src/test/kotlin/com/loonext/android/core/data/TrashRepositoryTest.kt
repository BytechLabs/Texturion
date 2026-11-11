package com.loonext.android.core.data

import com.loonext.android.core.auth.Session
import com.loonext.android.core.auth.SessionSource
import com.loonext.android.core.auth.SupabaseAuth
import com.loonext.android.core.model.TrashItem
import com.loonext.android.core.net.ApiClient
import com.loonext.android.core.net.ApiException
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.test.runTest
import mockwebserver3.MockResponse
import mockwebserver3.MockWebServer
import okhttp3.OkHttpClient
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.fail
import org.junit.Before
import org.junit.Test

/** #735 wire checks: the Trash list decodes every kind, restore and purge hit their routes. */
class TrashRepositoryTest {

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
    private lateinit var repo: TrashRepository

    @Before
    fun setUp() {
        server = MockWebServer().also { it.start() }
        repo = TrashRepository(
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

    private val listBody = """
        {"data":[
          {"id":"cv1","kind":"conversation","deleted_at":"2026-11-08T15:00:00Z","deleted_by_user_id":"user-1",
           "purge_after":"2026-12-08T15:00:00Z",
           "conversation":{"contact_name":"Dana Whitcomb","contact_phone":"+14165550134","message_count":12}},
          {"id":"m1","kind":"message","deleted_at":"2026-11-08T14:00:00Z","deleted_by_user_id":null,
           "purge_after":"2026-12-08T14:00:00Z",
           "message":{"contact_name":null,"contact_phone":"+14165550134","conversation_id":"cv9","direction":"outbound","snippet":"See you Tuesday"}},
          {"id":"call1","kind":"call","deleted_at":"2026-11-07T14:00:00Z","purge_after":"2026-12-07T14:00:00Z",
           "call":{"contact_name":"Sam","contact_phone":null,"outcome":"voicemail","started_at":"2026-11-07T13:00:00Z","has_voicemail":true}},
          {"id":"call1","kind":"voicemail","deleted_at":"2026-11-06T14:00:00Z","purge_after":"2026-12-06T14:00:00Z",
           "voicemail":{"contact_name":"Sam","contact_phone":null,"started_at":"2026-11-07T13:00:00Z","voicemail_seconds":42,"future_field":1}}
        ],"next_cursor":"cur-2"}
    """.trimIndent()

    @Test
    fun `the list decodes every kind and keeps the cursor`() = runTest {
        server.enqueue(MockResponse(body = listBody))
        val page = repo.list("co1", cursor = "cur-1", limit = 50)

        val r = server.takeRequest()
        assertEquals("GET", r.method)
        assertEquals("/v1/trash", r.url.encodedPath)
        assertEquals("cur-1", r.url.queryParameter("cursor"))
        assertEquals("50", r.url.queryParameter("limit"))
        assertEquals("co1", r.headers["X-Company-Id"])

        assertEquals(listOf("conversation", "message", "call", "voicemail"), page.data.map { it.kind })
        assertEquals("cur-2", page.next_cursor)
        assertEquals(12, page.data[0].conversation?.message_count)
        assertNull(page.data[0].message)
        assertNull(page.data[1].deleted_by_user_id)
        assertEquals("outbound", page.data[1].message?.direction)
        assertEquals(true, page.data[2].call?.has_voicemail)
        assertEquals(42, page.data[3].voicemail?.voicemail_seconds)
        // A call and its voicemail share an id; the kind tells them apart.
        assertEquals(page.data[2].id, page.data[3].id)
    }

    @Test
    fun `an empty trash decodes to an empty page`() = runTest {
        server.enqueue(MockResponse(body = """{"data":[],"next_cursor":null}"""))
        val page = repo.list("co1")
        assertEquals(emptyList<TrashItem>(), page.data)
        assertNull(page.next_cursor)
    }

    private fun item(kind: String, id: String) = TrashItem(
        id = id,
        kind = kind,
        deleted_at = "2026-11-08T15:00:00Z",
        purge_after = "2026-12-08T15:00:00Z",
    )

    @Test
    fun `restore posts the kind and id`() = runTest {
        server.enqueue(MockResponse(body = """{"kind":"voicemail","id":"call1"}"""))
        repo.restore("co1", item("voicemail", "call1"))
        val r = server.takeRequest()
        assertEquals("POST", r.method)
        assertEquals("/v1/trash/restore", r.url.encodedPath)
        assertEquals("co1", r.headers["X-Company-Id"])
        assertEquals("""{"kind":"voicemail","id":"call1"}""", r.body?.utf8())
    }

    @Test
    fun `a refused restore carries the server sentence`() = runTest {
        val sentence = "Its conversation is in the Trash. Restore the conversation first."
        server.enqueue(
            MockResponse(
                code = 409,
                body = """{"error":{"code":"conflict","message":"$sentence"}}""",
            ),
        )
        try {
            repo.restore("co1", item("message", "m1"))
            fail("a 409 must surface as an ApiException")
        } catch (e: ApiException) {
            assertEquals(409, e.httpStatus)
            assertEquals(sentence, e.message)
        }
    }

    @Test
    fun `delete forever hits the kind and id route and accepts a 204`() = runTest {
        server.enqueue(MockResponse(code = 204))
        repo.purge("co1", item("conversation", "cv1"))
        val r = server.takeRequest()
        assertEquals("DELETE", r.method)
        assertEquals("/v1/trash/conversation/cv1", r.url.encodedPath)
        assertEquals("co1", r.headers["X-Company-Id"])
    }

    @Test
    fun `a legal hold refuses delete forever`() = runTest {
        server.enqueue(
            MockResponse(
                code = 409,
                body = """{"error":{"code":"conflict","message":"This workspace is under a legal hold, so nothing can be erased yet."}}""",
            ),
        )
        try {
            repo.purge("co1", item("call", "call1"))
            fail("a 409 must surface as an ApiException")
        } catch (e: ApiException) {
            assertEquals(409, e.httpStatus)
        }
    }
}
