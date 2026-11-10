package com.loonext.android.features.tasks

import com.loonext.android.core.auth.Session
import com.loonext.android.core.auth.SessionSource
import com.loonext.android.core.auth.SupabaseAuth
import com.loonext.android.core.model.TaskRepeat
import com.loonext.android.core.model.TaskRepeatEnds
import com.loonext.android.core.net.ApiClient
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import mockwebserver3.MockResponse
import mockwebserver3.MockWebServer
import okhttp3.OkHttpClient
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Before
import org.junit.Test

/** #693: the wire shape of priority, label, repeat and scope on the task routes. */
class TaskPlanningWireTest {

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

    private val taskBody = """
        {"id":"t1","company_id":"c1","message_id":null,"conversation_id":null,
         "title":"Furnace service","created_by_user_id":"u1",
         "created_at":"2026-07-01T00:00:00Z","updated_at":"2026-07-01T00:00:00Z",
         "priority":"high","labels":[],"repeat":null}
    """.trimIndent()

    private fun bodyOf(request: mockwebserver3.RecordedRequest) =
        Json.parseToJsonElement(request.body!!.utf8()).jsonObject

    @Test
    fun `create carries priority label ids and a repeat`() = runTest {
        server.enqueue(MockResponse(code = 201, body = taskBody))
        mutations.create(
            companyId = "c1",
            title = "Furnace service",
            assignedUserId = null,
            dueAt = "2026-11-12T09:00:00-05:00",
            priority = "high",
            labelIds = listOf("g1", "g2"),
            repeat = TaskRepeat(
                kind = "schedule", unit = "week", every = 1, weekdays = listOf(4),
                ends = TaskRepeatEnds(kind = "after", after = 6),
            ),
        )
        val body = bodyOf(server.takeRequest())
        assertEquals("high", body["priority"]?.jsonPrimitive?.content)
        assertEquals(listOf("g1", "g2"), body["label_ids"]?.jsonArray?.map { it.jsonPrimitive.content })
        val repeat = body["repeat"]!!.jsonObject
        assertEquals("week", repeat["unit"]?.jsonPrimitive?.content)
        assertEquals("4", repeat["weekdays"]?.jsonArray?.single()?.jsonPrimitive?.content)
        assertEquals("6", repeat["ends"]?.jsonObject?.get("after")?.jsonPrimitive?.content)
    }

    @Test
    fun `create without the new fields sends none of them`() = runTest {
        server.enqueue(MockResponse(code = 201, body = taskBody))
        mutations.create(companyId = "c1", title = "Call back", assignedUserId = null, dueAt = null)
        assertEquals("""{"title":"Call back"}""", server.takeRequest().body?.utf8())
    }

    @Test
    fun `priority patch sends the value and the chosen scope`() = runTest {
        server.enqueue(MockResponse(body = taskBody))
        mutations.setPriority("c1", "t1", "urgent", TaskScope.Future)
        val recorded = server.takeRequest()
        assertEquals("PATCH", recorded.method)
        assertEquals("/v1/tasks/t1", recorded.url.encodedPath)
        assertEquals("""{"priority":"urgent","scope":"future"}""", recorded.body?.utf8())
    }

    @Test
    fun `an edit with no scope sends none`() = runTest {
        server.enqueue(MockResponse(body = taskBody))
        mutations.rename("c1", "t1", "New title")
        assertEquals("""{"title":"New title"}""", server.takeRequest().body?.utf8())
        server.enqueue(MockResponse(body = taskBody))
        mutations.rename("c1", "t1", "New title", TaskScope.This)
        assertEquals("""{"title":"New title","scope":"this"}""", server.takeRequest().body?.utf8())
    }

    @Test
    fun `a repeat patch sets the rule and null clears it`() = runTest {
        server.enqueue(MockResponse(body = taskBody))
        mutations.setRepeat("c1", "t1", TaskRepeat(kind = "after_done", unit = "month", every = 6))
        val set = bodyOf(server.takeRequest())
        assertEquals("after_done", set["repeat"]?.jsonObject?.get("kind")?.jsonPrimitive?.content)
        assertNull(set["scope"])

        server.enqueue(MockResponse(body = taskBody))
        mutations.setRepeat("c1", "t1", null)
        assertEquals("""{"repeat":null}""", server.takeRequest().body?.utf8())
    }

    @Test
    fun `adding a label by id or by name posts to the tags of the task`() = runTest {
        val answer = """{"tag":{"id":"g1","name":"Warranty"},"labels":[{"id":"g1","name":"Warranty","color":null}]}"""
        server.enqueue(MockResponse(code = 201, body = answer))
        val added = mutations.addLabel("c1", "t1", tagId = "g1", scope = TaskScope.Future)
        assertEquals(listOf("Warranty"), added.labels.map { it.name })
        val byId = server.takeRequest()
        assertEquals("POST", byId.method)
        assertEquals("/v1/tasks/t1/tags", byId.url.encodedPath)
        assertEquals("""{"tag_id":"g1","scope":"future"}""", byId.body?.utf8())

        server.enqueue(MockResponse(code = 201, body = answer))
        mutations.addLabel("c1", "t1", name = "Warranty")
        assertEquals("""{"name":"Warranty"}""", server.takeRequest().body?.utf8())
    }

    @Test
    fun `removing a label is a DELETE with the scope in the query`() = runTest {
        server.enqueue(MockResponse(code = 204))
        mutations.removeLabel("c1", "t1", "g1", TaskScope.This)
        val recorded = server.takeRequest()
        assertEquals("DELETE", recorded.method)
        assertEquals("/v1/tasks/t1/tags/g1", recorded.url.encodedPath)
        assertEquals("this", recorded.url.queryParameter("scope"))

        server.enqueue(MockResponse(code = 204))
        mutations.removeLabel("c1", "t1", "g1")
        assertNull(server.takeRequest().url.queryParameter("scope"))
    }

    @Test
    fun `deleting a repeating job names the scope`() = runTest {
        server.enqueue(MockResponse(code = 204))
        mutations.delete("c1", "t1", TaskScope.Future)
        val recorded = server.takeRequest()
        assertEquals("DELETE", recorded.method)
        assertEquals("/v1/tasks/t1", recorded.url.encodedPath)
        assertEquals("future", recorded.url.queryParameter("scope"))
    }

    @Test
    fun `list sends priority tag and sort`() = runTest {
        server.enqueue(MockResponse(body = """{"data":[],"next_cursor":null}"""))
        val arm = taskListArms(
            TasksTabKind.Open, null, false, null, null,
            extra = TaskExtraFilters(priorities = setOf("high"), tagId = "g1", sort = TaskSort.Priority),
        ).single()
        mutations.list("c1", arm, cursor = null)
        val url = server.takeRequest().url
        assertEquals("high", url.queryParameter("priority"))
        assertEquals("g1", url.queryParameter("tag_id"))
        assertEquals("priority", url.queryParameter("sort"))
    }

    @Test
    fun `bulk set priority and label actions carry their values and the filter`() = runTest {
        server.enqueue(MockResponse(body = """{"action":"set_priority","matched":2,"applied":[],"failed":[]}"""))
        mutations.bulk("c1", "set_priority", ids = listOf("t1", "t2"), priority = "low")
        val byIds = bodyOf(server.takeRequest())
        assertEquals("set_priority", byIds["action"]?.jsonPrimitive?.content)
        assertEquals("low", byIds["priority"]?.jsonPrimitive?.content)

        server.enqueue(MockResponse(body = """{"action":"add_label","matched":0,"applied":[],"failed":[]}"""))
        mutations.bulk(
            "c1", "add_label",
            filters = TaskListFilters(
                status = "open", assignedUserId = "me",
                priorities = listOf("urgent", "high"), tagId = "g9",
            ),
            tagId = "g1",
        )
        val filtered = bodyOf(server.takeRequest())
        assertEquals("g1", filtered["tag_id"]?.jsonPrimitive?.content)
        val filter = filtered["filter"]!!.jsonObject
        assertEquals("g9", filter["tag_id"]?.jsonPrimitive?.content)
        assertEquals(listOf("urgent", "high"), filter["priority"]?.jsonArray?.map { it.jsonPrimitive.content })
    }
}
