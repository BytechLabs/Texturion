package com.loonext.android.features.tasks

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
import org.junit.Before
import org.junit.Test

/**
 * Wire-level checks of the binding task invariants: derived done is ALWAYS a
 * message PATCH (a task has no done column), metadata clears send explicit
 * JSON nulls, and delete is the task soft-delete route.
 */
class TaskMutationsTest {

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
    private lateinit var mutations: TaskMutations

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
        mutations = TaskMutations(api)
    }

    @After
    fun tearDown() {
        server.close()
    }

    private val messageBody = """
        {"id":"m1","conversation_id":"cv1","direction":"inbound","body":"hi",
         "status":"received","created_at":"2026-07-15T12:00:00Z",
         "done_at":"2026-07-15T13:00:00Z","done_by_user_id":"u1"}
    """.trimIndent()

    private val taskBody = """
        {"id":"t1","company_id":"c1","message_id":"m1","conversation_id":"cv1",
         "title":"Send the quote","created_by_user_id":"u1",
         "created_at":"2026-07-01T00:00:00Z","updated_at":"2026-07-01T00:00:00Z",
         "done":false,"status":"open"}
    """.trimIndent()

    @Test
    fun `derived done writes PATCH on the SOURCE MESSAGE, never a task route`() = runTest {
        server.enqueue(MockResponse(body = messageBody))
        mutations.setDone("c1", "m1", true)
        val recorded = server.takeRequest()
        assertEquals("PATCH", recorded.method)
        assertEquals("/v1/messages/m1", recorded.url.encodedPath)
        assertEquals("""{"done":true}""", recorded.body?.utf8())
        assertEquals("c1", recorded.headers["X-Company-Id"])
    }

    @Test
    fun `clearing the due date sends an explicit JSON null`() = runTest {
        server.enqueue(MockResponse(body = taskBody))
        mutations.setDue("c1", "t1", null)
        val recorded = server.takeRequest()
        assertEquals("PATCH", recorded.method)
        assertEquals("/v1/tasks/t1", recorded.url.encodedPath)
        assertEquals("""{"due_at":null}""", recorded.body?.utf8())
    }

    @Test
    fun `unassigning sends an explicit JSON null`() = runTest {
        server.enqueue(MockResponse(body = taskBody))
        mutations.assign("c1", "t1", null)
        assertEquals("""{"assigned_user_id":null}""", server.takeRequest().body?.utf8())
    }

    @Test
    fun `replacing the crew sends assignee_ids and an empty list unassigns everyone`() = runTest {
        server.enqueue(MockResponse(body = taskBody))
        mutations.setAssignees("c1", "t1", listOf("u1", "u2"))
        assertEquals("""{"assignee_ids":["u1","u2"]}""", server.takeRequest().body?.utf8())
        server.enqueue(MockResponse(body = taskBody))
        mutations.setAssignees("c1", "t1", emptyList())
        assertEquals("""{"assignee_ids":[]}""", server.takeRequest().body?.utf8())
    }

    @Test
    fun `create sends the whole crew and assignee_ids wins over the single id`() = runTest {
        server.enqueue(MockResponse(code = 201, body = taskBody))
        mutations.create(
            companyId = "c1",
            title = "Pour the slab",
            assignedUserId = "u1",
            assigneeIds = listOf("u1", "u2"),
            dueAt = null,
        )
        assertEquals(
            """{"title":"Pour the slab","assignee_ids":["u1","u2"]}""",
            server.takeRequest().body?.utf8(),
        )
        server.enqueue(MockResponse(code = 201, body = taskBody))
        mutations.create(
            companyId = "c1", title = "Nobody", assignedUserId = null,
            assigneeIds = emptyList(), dueAt = null,
        )
        assertEquals("""{"title":"Nobody","assignee_ids":[]}""", server.takeRequest().body?.utf8())
    }

    @Test
    fun `bulk assign adds people by assignee_ids`() = runTest {
        server.enqueue(MockResponse(body = """{"action":"assign","matched":1}"""))
        mutations.bulk("c1", "assign", ids = listOf("t1"), assigneeIds = listOf("u2", "u3"))
        assertEquals(
            """{"action":"assign","ids":["t1"],"assignee_ids":["u2","u3"]}""",
            server.takeRequest().body?.utf8(),
        )
    }

    @Test
    fun `create threads the confirmed address as a nested block with provenance`() = runTest {
        server.enqueue(MockResponse(code = 201, body = taskBody))
        mutations.create(
            companyId = "c1",
            messageId = "m1",
            title = "Fix the sink",
            assignedUserId = null,
            dueAt = null,
            address = com.loonext.android.core.model.TaskAddressInput(
                street = "12 Elm St",
                unit = null,
                city = "Toronto",
                state = null,
                postal_code = null,
                country = null,
                provenance = "message",
            ),
        )
        val recorded = server.takeRequest()
        assertEquals("POST", recorded.method)
        assertEquals("/v1/tasks", recorded.url.encodedPath)
        assertEquals(
            """{"message_id":"m1","title":"Fix the sink","address":""" +
                """{"street":"12 Elm St","unit":null,"city":"Toronto","state":null,""" +
                """"postal_code":null,"country":null,"provenance":"message"}}""",
            recorded.body?.utf8(),
        )
    }

    @Test
    fun `setAddress sends the address object with provenance`() = runTest {
        server.enqueue(MockResponse(body = taskBody))
        mutations.setAddress(
            "c1",
            "t1",
            com.loonext.android.core.model.TaskAddressInput(
                city = "Ottawa",
                provenance = "manual",
            ),
        )
        val recorded = server.takeRequest()
        assertEquals("PATCH", recorded.method)
        assertEquals("/v1/tasks/t1", recorded.url.encodedPath)
        assertEquals(
            """{"address":{"street":null,"unit":null,"city":"Ottawa","state":null,""" +
                """"postal_code":null,"country":null,"provenance":"manual"}}""",
            recorded.body?.utf8(),
        )
    }

    @Test
    fun `clearing the address sends an explicit top-level null`() = runTest {
        server.enqueue(MockResponse(body = taskBody))
        mutations.setAddress("c1", "t1", null)
        assertEquals("""{"address":null}""", server.takeRequest().body?.utf8())
    }

    @Test
    fun `delete is the task soft-delete route`() = runTest {
        server.enqueue(MockResponse(code = 204))
        mutations.delete("c1", "t1")
        val recorded = server.takeRequest()
        assertEquals("DELETE", recorded.method)
        assertEquals("/v1/tasks/t1", recorded.url.encodedPath)
    }

    @Test
    fun `discussion notes post to the conversation with the task link`() = runTest {
        server.enqueue(
            MockResponse(
                code = 201,
                body = """
                    {"id":"n1","conversation_id":"cv1","direction":"note",
                     "body":"On it","created_at":"2026-07-15T12:00:00Z","task_id":"t1"}
                """.trimIndent(),
            ),
        )
        mutations.postNote("c1", "cv1", "On it", "t1")
        val recorded = server.takeRequest()
        assertEquals("POST", recorded.method)
        assertEquals("/v1/conversations/cv1/notes", recorded.url.encodedPath)
        assertEquals("""{"body":"On it","task_id":"t1"}""", recorded.body?.utf8())
    }

    private val callTaskBody = """
        {"id":"t2","company_id":"c1","message_id":null,"conversation_id":"cv1",
         "source":{"kind":"call","id":"call1"},
         "title":"Call from Ana","created_by_user_id":"u1",
         "created_at":"2026-07-01T00:00:00Z","updated_at":"2026-07-01T00:00:00Z"}
    """.trimIndent()

    @Test
    fun `a call task writes done on the TASK, a message task on its message`() = runTest {
        val json = kotlinx.serialization.json.Json { ignoreUnknownKeys = true }
        val callTask = json.decodeFromString<com.loonext.android.core.model.Task>(callTaskBody)
        val messageTask = json.decodeFromString<com.loonext.android.core.model.Task>(taskBody)

        server.enqueue(MockResponse(body = callTaskBody))
        mutations.setTaskDone("c1", callTask, true)
        val call = server.takeRequest()
        assertEquals("PATCH", call.method)
        assertEquals("/v1/tasks/t2", call.url.encodedPath)
        assertEquals("""{"done":true}""", call.body?.utf8())

        server.enqueue(MockResponse(body = messageBody))
        mutations.setTaskDone("c1", messageTask, true)
        assertEquals("/v1/messages/m1", server.takeRequest().url.encodedPath)
    }

    @Test
    fun `promoting a call sends source_call_id and no message_id`() = runTest {
        server.enqueue(MockResponse(code = 201, body = callTaskBody))
        mutations.create(
            companyId = "c1",
            title = "Call from Ana",
            assignedUserId = null,
            dueAt = null,
            sourceCallId = "call1",
        )
        val recorded = server.takeRequest()
        assertEquals("/v1/tasks", recorded.url.encodedPath)
        assertEquals("""{"source_call_id":"call1","title":"Call from Ana"}""", recorded.body?.utf8())
    }

    @Test
    fun `a standalone task sends a title and its links, no source`() = runTest {
        server.enqueue(MockResponse(code = 201, body = callTaskBody))
        mutations.create(
            companyId = "c1",
            title = "Order a filter",
            assignedUserId = "u1",
            dueAt = null,
            contactId = "k1",
        )
        assertEquals(
            """{"title":"Order a filter","assigned_user_id":"u1","contact_id":"k1"}""",
            server.takeRequest().body?.utf8(),
        )

        server.enqueue(MockResponse(code = 201, body = callTaskBody))
        mutations.create(
            companyId = "c1",
            title = "Call back",
            assignedUserId = null,
            dueAt = null,
            conversationId = "v1",
        )
        assertEquals("""{"title":"Call back","conversation_id":"v1"}""", server.takeRequest().body?.utf8())
    }

    @Test
    fun `comments go to the task's own routes and the activity pages by cursor`() = runTest {
        val comment = """
            {"kind":"comment","id":"k1","body":"hi","created_at":"2026-11-10T12:00:00Z",
             "author":{"user_id":"u1","display_name":"Rehman"},"attachments":[]}
        """.trimIndent()
        server.enqueue(MockResponse(code = 201, body = comment))
        assertEquals("k1", mutations.addComment("c1", "t1", "hi").id)
        val posted = server.takeRequest()
        assertEquals("POST", posted.method)
        assertEquals("/v1/tasks/t1/comments", posted.url.encodedPath)
        assertEquals("""{"body":"hi"}""", posted.body?.utf8())

        server.enqueue(MockResponse(body = """{"data":[$comment],"next_cursor":"abc"}"""))
        val page = mutations.activity("c1", "t1", cursor = "abc")
        assertEquals("abc", page.next_cursor)
        val fetched = server.takeRequest()
        assertEquals("/v1/tasks/t1/activity", fetched.url.encodedPath)
        assertEquals("abc", fetched.url.queryParameter("cursor"))

        server.enqueue(MockResponse(code = 204))
        mutations.deleteComment("c1", "t1", "k1")
        val deleted = server.takeRequest()
        assertEquals("DELETE", deleted.method)
        assertEquals("/v1/tasks/t1/comments/k1", deleted.url.encodedPath)
    }
}
