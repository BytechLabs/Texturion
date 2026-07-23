package com.loonext.android.features.tasks

import com.loonext.android.core.model.AttachmentUrl
import com.loonext.android.core.model.Member
import com.loonext.android.core.model.Message
import com.loonext.android.core.model.Page
import com.loonext.android.core.model.Task
import com.loonext.android.core.model.TaskDetail
import com.loonext.android.core.net.ApiClient
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

/**
 * Tasks feature data access. Mutations honor the binding invariants:
 * completion is ALWAYS `PATCH /v1/messages/{message_id} {done}` (a task has
 * no done column), task PATCH is metadata-only, and attachment URLs are
 * minted per view (never cached).
 */
class TaskMutations(private val api: ApiClient) {

    suspend fun list(
        companyId: String,
        filters: TaskListFilters,
        cursor: String?,
        limit: Int = 25,
    ): Page<Task> = api.get(
        "/v1/tasks",
        query = taskQueryParams(filters, cursor, limit),
        companyId = companyId,
    )

    suspend fun detail(companyId: String, taskId: String): TaskDetail =
        api.get("/v1/tasks/$taskId", companyId = companyId)

    suspend fun members(companyId: String): Page<Member> =
        api.get("/v1/members", companyId = companyId)

    /** Metadata-only edit. Null-bearing fields must SEND null (clear). */
    private suspend fun patch(companyId: String, taskId: String, body: JsonObject): Task =
        api.patch("/v1/tasks/$taskId", body, companyId = companyId)

    suspend fun rename(companyId: String, taskId: String, title: String): Task =
        patch(companyId, taskId, buildJsonObject { put("title", title) })

    suspend fun describe(companyId: String, taskId: String, description: String): Task =
        patch(companyId, taskId, buildJsonObject { put("description", description) })

    suspend fun assign(companyId: String, taskId: String, userId: String?): Task =
        patch(
            companyId,
            taskId,
            buildJsonObject {
                if (userId == null) put("assigned_user_id", JsonNull)
                else put("assigned_user_id", userId)
            },
        )

    /** [dueAt] must be ISO 8601 WITH offset ([encodeDueAt]); null clears. */
    suspend fun setDue(companyId: String, taskId: String, dueAt: String?): Task =
        patch(
            companyId,
            taskId,
            buildJsonObject {
                if (dueAt == null) put("due_at", JsonNull) else put("due_at", dueAt)
            },
        )

    /**
     * THE one completion path (D14/T2): flip done on the SOURCE MESSAGE.
     * Idempotent server-side; derived task done updates ride message.status.
     */
    suspend fun setDone(companyId: String, messageId: String, done: Boolean): Message =
        api.patch(
            "/v1/messages/$messageId",
            buildJsonObject { put("done", done) },
            companyId = companyId,
        )

    /** Soft-delete; creator or owner/admin only (403 otherwise). */
    suspend fun delete(companyId: String, taskId: String) {
        api.delete("/v1/tasks/$taskId", companyId = companyId)
    }

    /** Task discussion: an internal note linked to a live task (D-D). */
    suspend fun postNote(
        companyId: String,
        conversationId: String,
        body: String,
        taskId: String,
    ): Message = api.post(
        "/v1/conversations/$conversationId/notes",
        buildJsonObject {
            put("body", body)
            put("task_id", taskId)
        },
        companyId = companyId,
    )

    /** Mint a short-lived signed URL for one derived-union attachment. */
    suspend fun attachmentUrl(companyId: String, attachmentId: String): AttachmentUrl =
        api.get("/v1/attachments/$attachmentId/url", companyId = companyId)

    /**
     * The Map view's arm of GET /v1/tasks (#184/D25): `has_location=true`
     * inner-joins conversations→contacts server-side, so every returned row
     * embeds the source contact's cached geocode as `contact` and rows whose
     * contact has no location are excluded by the join. `has_location` is
     * itself an explicit filter param, so the route's Open·Mine default never
     * re-applies here (web parity: the map plots open AND done tasks for the
     * picked assignee scope). No due filters → created-sorted cursor only.
     */
    suspend fun listLocated(
        companyId: String,
        assigneeUserId: String?,
        unassigned: Boolean,
        cursor: String?,
        limit: Int = 100,
    ): Page<Task> = api.get(
        "/v1/tasks",
        query = mapOf(
            "has_location" to "true",
            "assigned_user_id" to assigneeUserId,
            "unassigned" to if (unassigned) "true" else null,
            "cursor" to cursor,
            "limit" to limit.toString(),
        ),
        companyId = companyId,
    )

    /** Promote a message to a task ("Make a task"). 409 = already a task. */
    suspend fun create(
        companyId: String,
        messageId: String,
        title: String?,
        assignedUserId: String?,
        dueAt: String?,
    ): Task = api.post(
        "/v1/tasks",
        buildJsonObject {
            put("message_id", messageId)
            if (title != null) put("title", title)
            if (assignedUserId != null) put("assigned_user_id", assignedUserId)
            if (dueAt != null) put("due_at", dueAt)
        },
        companyId = companyId,
    )
}

/**
 * Sequential multi-arm cursor pagination over GET /v1/tasks.
 *
 * Statusless tabs (Mine / All) have no all-statuses mode on the route, so
 * they run TWO status-scoped queries — the loader drains arm 0 (open) before
 * starting arm 1 (done), which keeps open rows listed before done rows.
 *
 * The dual-cursor invariant is structural here: each arm's cursor is only
 * ever passed back with that arm's own (immutable) filter set, and any filter
 * change builds a NEW loader — a cursor can never cross orderings.
 */
class TaskListLoader(
    private val mutations: TaskMutations,
    private val companyId: String,
    private val arms: List<TaskListFilters>,
    private val limit: Int = 25,
) {
    private var armIndex = 0
    private var cursor: String? = null
    private var exhausted = arms.isEmpty()

    val hasMore: Boolean get() = !exhausted

    /** Load the next page (empty when everything is drained). */
    suspend fun nextPage(): List<Task> {
        while (!exhausted) {
            val page = mutations.list(companyId, arms[armIndex], cursor, limit)
            if (page.next_cursor != null) {
                cursor = page.next_cursor
            } else if (armIndex + 1 < arms.size) {
                armIndex++
                cursor = null
            } else {
                exhausted = true
            }
            if (page.data.isNotEmpty()) return page.data
            // An empty page with a follow-up arm: keep going so "Load more"
            // never returns nothing while rows still exist in the next arm.
        }
        return emptyList()
    }
}

/**
 * Drain EVERY page of located tasks so the map plots all pins, not just the
 * first page (web parity: map-view's useAllTasks + flattenPages). One filter
 * set for the whole drain, so the cursor is always passed back with the exact
 * params that minted it. The page cap is a runaway guard, not a depth anyone
 * should reach (40 × 100 rows); the id de-dupe absorbs rows that shift pages
 * while a drain is in flight.
 */
suspend fun drainLocatedTasks(
    mutations: TaskMutations,
    companyId: String,
    assigneeUserId: String?,
    unassigned: Boolean,
): List<Task> {
    // ASSIGNEE_ALL is UI sugar meaning "no assignee pin" (taskQueryParams
    // parity) — normalize it away before it reaches the wire.
    val assignee = assigneeUserId?.takeUnless { it == ASSIGNEE_ALL }
    val acc = mutableListOf<Task>()
    var cursor: String? = null
    var pages = 0
    do {
        val page = mutations.listLocated(companyId, assignee, unassigned, cursor)
        acc += page.data
        cursor = page.next_cursor
        pages++
    } while (cursor != null && pages < 40)
    return acc.distinctBy { it.id }
}
