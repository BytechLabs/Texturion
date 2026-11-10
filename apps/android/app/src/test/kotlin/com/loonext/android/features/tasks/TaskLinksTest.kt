package com.loonext.android.features.tasks

import com.loonext.android.core.auth.Session
import com.loonext.android.core.auth.SessionSource
import com.loonext.android.core.auth.SupabaseAuth
import com.loonext.android.core.model.Task
import com.loonext.android.core.model.TaskFeedItem
import com.loonext.android.core.net.ApiClient
import com.loonext.android.core.net.ApiErrorCode
import com.loonext.android.core.net.ApiException
import com.loonext.android.features.compose.ComposerDrafts
import com.loonext.android.features.compose.ComposerState
import com.loonext.android.features.thread.PickedMention
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import mockwebserver3.MockResponse
import mockwebserver3.MockWebServer
import okhttp3.OkHttpClient
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

/** #690 and #689 G: links, references, saved task views and the Filters model. */
class TaskLinksTest {
    private val me = "11111111-1111-4111-8111-111111111111"
    private val sam = "22222222-2222-4222-8222-222222222222"
    private val tag = "33333333-3333-4333-8333-333333333333"
    private val customer = "44444444-4444-4444-8444-444444444444"

    private fun obj(vararg pairs: Pair<String, Any>): JsonObject = buildJsonObject {
        for ((k, v) in pairs) {
            when (v) {
                is Boolean -> put(k, JsonPrimitive(v))
                else -> put(k, JsonPrimitive(v.toString()))
            }
        }
    }

    // --- saved views -----------------------------------------------------------

    @Test
    fun `every task filter the shared list names is kept, and a stale key is dropped`() {
        val all = obj(
            "status" to "open", "assigned_user_id" to sam, "unassigned" to true, "overdue" to true,
            "has_location" to true, "due_before" to "2026-11-12T00:00:00Z", "due_after" to "2026-11-10",
            "priority" to "urgent,high", "tag_id" to tag, "sort" to "updated", "contact_id" to customer,
            "conversation_id" to customer, "created_by" to "me", "source" to "call",
            "has_attachments" to true, "has_references" to true, "group" to "priority",
        )
        assertEquals(all.keys, sanitizeTaskFilters(all).keys)
        val stale = obj("status" to "archived", "sort" to "newest", "made_up" to "x", "source" to "fax")
        assertTrue(sanitizeTaskFilters(stale).isEmpty())
        // A "true" typed as text is not a boolean, and a bad uuid is not a uuid.
        assertTrue(sanitizeTaskFilters(obj("overdue" to "true", "tag_id" to "nope")).isEmpty())
        assertTrue(sanitizeTaskFilters(obj("priority" to "urgent,whenever")).isEmpty())
    }

    private fun state(
        tab: TasksTabKind,
        chip: String? = null,
        unassigned: Boolean = false,
        due: DueChip? = null,
        extra: TaskExtraFilters = TaskExtraFilters(),
    ) = TaskViewState(tab, chip, unassigned, due, extra)

    @Test
    fun `a view reopens as the arrangement that saved it`() {
        val extra = TaskExtraFilters(
            priorities = setOf("urgent", "high"), tagId = tag, sort = TaskSort.Updated,
            contactId = customer, createdBy = "me", source = "text", hasAttachments = true,
            hasReferences = true, group = TaskGroup.Assignee,
        )
        val cases = listOf(
            state(TasksTabKind.Open),
            state(TasksTabKind.Done),
            state(TasksTabKind.Mine),
            state(TasksTabKind.All),
            state(TasksTabKind.Open, chip = sam),
            state(TasksTabKind.Open, chip = ASSIGNEE_ALL),
            state(TasksTabKind.Open, unassigned = true),
            state(TasksTabKind.Mine, due = DueChip.Overdue, extra = extra),
            state(TasksTabKind.All, extra = extra.copy(dueAfter = "2026-11-10T00:00:00Z", dueBefore = "2026-11-17T00:00:00Z")),
        )
        for (case in cases) {
            val stored = taskStateToView(case, me)
            assertEquals("stored view is clean for $case", stored, sanitizeTaskFilters(stored))
            assertEquals("round trip of $case", case, taskViewToState(stored, me))
        }
    }

    @Test
    fun `the group is a view setting that no list request carries`() {
        val arms = taskListArms(
            TasksTabKind.Open, null, false, null, null,
            extra = TaskExtraFilters(group = TaskGroup.Priority),
        )
        assertFalse(taskQueryParams(arms[0]).keys.any { it == "group" })
        assertEquals("priority", taskStateToView(state(TasksTabKind.Open, extra = TaskExtraFilters(group = TaskGroup.Priority)), me)["group"]?.let { (it as JsonPrimitive).content })
    }

    @Test
    fun `Today and This week are not stored, because their windows would go stale`() {
        val stored = taskStateToView(state(TasksTabKind.Open, due = DueChip.Today), me)
        assertFalse(stored.containsKey("due_after"))
        assertFalse(stored.containsKey("due_before"))
        assertTrue(taskStateToView(state(TasksTabKind.Open, due = DueChip.Overdue), me).containsKey("overdue"))
    }

    @Test
    fun `the new filters ride the list query, and the bulk filter, under the names the server takes`() {
        val extra = TaskExtraFilters(
            contactId = customer, createdBy = "me", source = "call", hasAttachments = true, hasReferences = true,
            sort = TaskSort.Updated,
        )
        val params = taskQueryParams(taskListArms(TasksTabKind.Open, null, false, null, null, extra = extra)[0])
        assertEquals(customer, params["contact_id"])
        assertEquals("me", params["created_by"])
        assertEquals("call", params["source"])
        assertEquals("true", params["has_attachments"])
        assertEquals("true", params["has_references"])
        assertEquals("updated", params["sort"])
        assertEquals("updated", orderingKey(taskListArms(TasksTabKind.Open, null, false, null, null, extra = extra)[0]))
    }

    @Test
    fun `a view applies as the open arrangement only when it holds something`() {
        val open = state(TasksTabKind.Open)
        val stored = taskStateToView(open, me)
        assertTrue(taskViewMatches(stored, open, me))
        assertFalse(taskViewMatches(JsonObject(emptyMap()), state(TasksTabKind.All), me))
    }

    @Test
    fun `the Filters pill counts what the sheet holds`() {
        assertEquals(0, TaskExtraFilters().activeCount)
        assertEquals(
            3,
            TaskExtraFilters(contactId = customer, hasReferences = true, source = "text").activeCount,
        )
    }

    // --- grouping --------------------------------------------------------------

    private fun task(id: String, priority: String = "normal", assignee: String? = null, done: Boolean = false) = Task(
        id = id, company_id = "c", title = id, created_by_user_id = me, created_at = "2026-11-01T00:00:00Z",
        updated_at = "2026-11-01T00:00:00Z", priority = priority, assigned_user_id = assignee, done = done,
    )

    @Test
    fun `tasks group by priority most pressing first, and by assignee with nobody last`() {
        val tasks = listOf(
            task("a", "low", sam), task("b", "urgent", me), task("c", "normal", null), task("d", "urgent", sam),
        )
        assertEquals(
            listOf("urgent", "normal", "low"),
            bucketTasks(tasks, TaskGroup.Priority) { null }.map { it.id },
        )
        val byPerson = bucketTasks(tasks, TaskGroup.Assignee) { if (it.assigned_user_id == sam) "Sam" else "Rehman" }
        assertEquals(listOf("Rehman", "Sam", null), byPerson.map { it.name })
        assertEquals("nobody", byPerson.last().id)
        assertEquals(listOf("a", "d"), byPerson[1].tasks.map { it.id })
        val byStatus = bucketTasks(listOf(task("x", done = true), task("y")), TaskGroup.Status) { null }
        assertEquals(listOf("todo", "done"), byStatus.map { it.id })
    }

    // --- activity sentences ------------------------------------------------------

    private fun feed(kind: String, build: (TaskFeedItem) -> TaskFeedItem = { it }) =
        build(TaskFeedItem(kind = kind, id = "i1", created_at = "2026-11-10T12:00:00Z"))

    @Test
    fun `a link event reads as blocked by, sub-task of and their removals`() {
        fun event(name: String, relation: String, side: String): TaskFeedItem {
            val link = obj("relation" to relation, "task_id" to sam, "title" to "Order the part").let {
                JsonObject(it + ("number" to JsonPrimitive(4)))
            }
            return feed("event") { item ->
                item.copy(event = name, to = if (side == "to") link else null, from = if (side == "from") link else null)
            }
        }
        assertEquals(
            "Rehman marked it blocked by T-4 Order the part",
            taskHistorySentence(event("link_added", "blocked_by", "to"), "Rehman"),
        )
        assertEquals(
            "Rehman made it a sub-task of T-4 Order the part",
            taskHistorySentence(event("link_added", "parent", "to"), "Rehman"),
        )
        assertEquals(
            "Rehman removed T-4 Order the part as a sub-task",
            taskHistorySentence(event("link_removed", "sub_task", "from"), "Rehman"),
        )
        assertEquals("Rehman updated this task", taskHistorySentence(feed("event") { it.copy(event = "link_added") }, "Rehman"))
    }

    @Test
    fun `a reference reads as where it was written and who wrote it`() {
        val inNote = feed("reference") {
            it.copy(
                direction = "in", source_kind = "note",
                contact = com.loonext.android.core.model.TaskRefContact("c1", "Jane Smith"),
            )
        }
        assertEquals(
            "Referenced in a note on the conversation with Jane Smith, by Rehman",
            taskReferenceSentence(inNote, "Rehman"),
        )
        val fromTask = feed("reference") {
            it.copy(
                direction = "in", source_kind = "task_description",
                task = com.loonext.android.core.model.TaskRefTask("t1", 139, "Order the part"),
            )
        }
        assertEquals("Referenced from T-139 Order the part, by Rehman", taskReferenceSentence(fromTask, "Rehman"))
        val toContact = feed("reference") {
            it.copy(
                direction = "out", target_kind = "contact",
                contact = com.loonext.android.core.model.TaskRefContact("c1", "Jane Smith"),
            )
        }
        assertEquals("Linked to customer Jane Smith, by Rehman", taskReferenceSentence(toContact, "Rehman"))
        // French reads too, and no key is left showing.
        assertFalse(taskReferenceSentence(toContact, "Rehman", "fr-CA").contains("taskLinks."))
    }

    @Test
    fun `a refused link is said plainly`() {
        val loop = ApiException(ApiErrorCode.VALIDATION_FAILED, "task_id: that would make a loop.", 422)
        val parent = ApiException(ApiErrorCode.CONFLICT, "That task already has a parent. Remove it first.", 409)
        assertEquals("That would make the two tasks wait on each other.", linkErrorMessage(loop, "en"))
        assertEquals("That task already has a parent.", linkErrorMessage(parent, "en"))
    }

    @Test
    fun `a task is named by its number and title`() {
        assertEquals("T-142 Fix furnace", taskLinkLabel(142, "Fix furnace"))
        assertEquals("Fix furnace", taskLinkLabel(null, "Fix furnace"))
    }

    // --- the SMS composer ------------------------------------------------------

    @Test
    fun `typing a hash into a text to a customer leaves it plain and opens nothing`() {
        assertNull(composerReferenceQuery(isInternalNote = false, text = "#T-142"))
        assertNull(composerReferenceQuery(isInternalNote = false, text = "call #"))
        // The same words in an internal note do open the picker: the gate, not the text, decides.
        assertNotNull(composerReferenceQuery(isInternalNote = true, text = "see #T-14"))

        val drafts = object : ComposerDrafts {
            override suspend fun load(conversationId: String) = ""
            override suspend fun save(conversationId: String, text: String) = Unit
            override suspend fun clear(conversationId: String) = Unit
            override suspend fun loadMentions(conversationId: String) = emptyList<PickedMention>()
            override suspend fun saveMentions(conversationId: String, mentions: List<PickedMention>) = Unit
        }
        val state = ComposerState("conv-1", drafts)
        state.onTextChange("#T-142")
        assertEquals("#T-142", state.text)
    }

    // --- the wire --------------------------------------------------------------

    private class FakeSessions : SessionSource {
        val flow = MutableStateFlow<Session?>(
            Session("token-1", "refresh-1", System.currentTimeMillis() / 1000 + 3600, "user-1", "a@b.c"),
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
    private lateinit var repo: ReferenceRepository

    @Before
    fun setUp() {
        server = MockWebServer().also { it.start() }
        val api = ApiClient(
            http = OkHttpClient(),
            baseUrl = server.url("/").toString().trimEnd('/'),
            sessionStore = FakeSessions(),
            supabaseAuth = SupabaseAuth(OkHttpClient(), server.url("/gotrue").toString(), "pk"),
        )
        repo = ReferenceRepository(api)
    }

    @After
    fun tearDown() {
        server.close()
    }

    private val links = """{"data":[{"relation":"blocked_by","task_id":"t2","number":4,"title":"Order the part","done":true}]}"""

    @Test
    fun `adding and removing a link use the routes and bodies the server defines`() = runTest {
        server.enqueue(MockResponse(code = 201, body = links))
        val added = repo.addLink("co", "t1", TaskRelation.BLOCKED_BY, "t2")
        val post = server.takeRequest()
        assertEquals("POST", post.method)
        assertEquals("/v1/tasks/t1/links", post.url.encodedPath)
        assertEquals("""{"relation":"blocked_by","task_id":"t2"}""", post.body?.utf8())
        assertEquals(4, added.single().number)
        assertTrue(added.single().done)

        server.enqueue(MockResponse(body = """{"data":[]}"""))
        assertTrue(repo.removeLink("co", "t1", "t2", TaskRelation.BLOCKED_BY).isEmpty())
        val delete = server.takeRequest()
        assertEquals("DELETE", delete.method)
        assertEquals("/v1/tasks/t1/links/t2", delete.url.encodedPath)
        assertEquals("blocked_by", delete.url.queryParameter("relation"))
    }

    @Test
    fun `chips resolve in one request and are remembered`() = runTest {
        server.enqueue(
            MockResponse(
                body = """{"tasks":[{"number":142,"id":"t9","title":"Fix furnace","done":true}],
                    "contacts":[{"prefix":"1a2b3c4d","id":"c1","name":"Jane Smith"}],"conversations":[]}""",
            ),
        )
        val tokens = parseReferenceTokens("see #T-142, #contact-1A2B3C4D and #conv-abcdef01")
        val first = repo.resolve("co-resolve", tokens)
        val request = server.takeRequest()
        assertEquals("/v1/references/resolve", request.url.encodedPath)
        assertEquals("142", request.url.queryParameter("tasks"))
        assertEquals("1a2b3c4d", request.url.queryParameter("contacts"))
        assertEquals("abcdef01", request.url.queryParameter("conversations"))
        val task = first["t:142"] as ResolvedRef.TaskRef
        assertTrue(task.done)
        assertEquals("T-142 Fix furnace, finished", referenceChipLabel(tokens[0], task, "en"))
        assertEquals("Jane Smith", referenceChipLabel(tokens[1], first["c:1a2b3c4d"]!!, "en"))
        // The conversation that did not resolve stays plain text.
        assertNull(first["v:abcdef01"])
        // A second read inside the minute asks nobody.
        val before = server.requestCount
        repo.resolve("co-resolve", tokens)
        assertEquals(before, server.requestCount)
    }

    @Test
    fun `a task is found by number or title without naming a status`() = runTest {
        server.enqueue(MockResponse(body = """{"data":[]}"""))
        repo.searchTasks("co", "T-142")
        val request = server.takeRequest()
        assertEquals("/v1/tasks", request.url.encodedPath)
        assertEquals("T-142", request.url.queryParameter("q"))
        assertNull(request.url.queryParameter("status"))
    }

    @Test
    fun `a conversation and a customer list their linked tasks`() = runTest {
        server.enqueue(MockResponse(body = """{"data":[{"id":"t1","number":7,"title":"Visit","done":false,"how":["anchored","mentioned"]}]}"""))
        val rows = repo.linkedTasksOfConversation("co", "cv1")
        assertEquals("/v1/conversations/cv1/linked-tasks", server.takeRequest().url.encodedPath)
        assertEquals(listOf("anchored", "mentioned"), rows.single().how)
        server.enqueue(MockResponse(body = """{"data":[]}"""))
        repo.linkedTasksOfContact("co", "ct1")
        assertEquals("/v1/contacts/ct1/linked-tasks", server.takeRequest().url.encodedPath)
    }

    @Test
    fun `quick add preview names only what was understood`() {
        val result = parseQuickAdd(
            "Fix furnace @sam tomorrow 9am #urgent",
            QuickAddContext(
                now = java.time.Instant.parse("2026-11-11T15:30:00Z"),
                timeZone = "America/Toronto",
                selfUserId = me,
                members = listOf(QuickAddMember(sam, "Sam Rivera")),
                labels = emptyList(),
            ),
        )
        val lines = quickAddPreviewLines(result, dueText = { "due:$it" }, priorityText = { "pri:$it" })
        assertEquals(
            listOf("quickAdd.assigneeLabel", "quickAdd.dueLabel", "quickAdd.priorityLabel"),
            lines.map { it.labelKey },
        )
        assertEquals("Fix furnace", result.title)
        assertTrue(quickAddPreviewLines(parseQuickAdd("Order the part", QuickAddContext(java.time.Instant.EPOCH, "UTC", me, emptyList(), emptyList())), { it }, { it }).isEmpty())
    }
}
