package com.loonext.android.features.tasks

import com.loonext.android.core.data.taskAddressJson
import com.loonext.android.core.model.AttachmentUrl
import com.loonext.android.core.model.BulkTasksResult
import com.loonext.android.core.model.Member
import com.loonext.android.core.model.Message
import com.loonext.android.core.model.Page
import com.loonext.android.core.model.Task
import com.loonext.android.core.model.TaskAddressInput
import com.loonext.android.core.model.TaskDetail
import com.loonext.android.core.net.ApiClient
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.add
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import kotlinx.serialization.json.putJsonArray
import kotlinx.serialization.json.putJsonObject
import com.loonext.android.core.model.JobPhotoLink

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

    /**
     * #478: one action, every task matching either explicit ids or the CURRENT
     * filter.
     *
     * The filter branch sends the SAME field names GET /v1/tasks takes, because
     * the server resolves them with the same query builder the list uses —
     * "everything I am looking at" cannot mean something different here.
     *
     * There is no send action and there never can be: the server's zod enum and
     * the SQL enum are the two gates, and this method has no way to express one.
     */
    suspend fun bulk(
        companyId: String,
        action: String,
        ids: List<String>? = null,
        filters: TaskListFilters? = null,
        targetUserId: String? = null,
        /** True when the caller means "unassign", which is a null the server needs. */
        unassign: Boolean = false,
    ): BulkTasksResult = api.post(
        "/v1/tasks/bulk",
        buildJsonObject {
            put("action", action)
            if (ids != null) {
                putJsonArray("ids") { ids.forEach { add(it) } }
            } else if (filters != null) {
                putJsonObject("filter") {
                    filters.status?.let { put("status", it) }
                    filters.assignedUserId?.let { put("assigned_user_id", it) }
                    if (filters.unassigned) put("unassigned", true)
                    if (filters.overdue) put("overdue", true)
                }
            }
            // Explicit null is meaningful (unassign), so it is only written when
            // the caller says so rather than whenever the id is absent.
            if (targetUserId != null) put("target_user_id", targetUserId)
            else if (unassign) put("target_user_id", JsonNull)
        },
        companyId = companyId,
    )

    suspend fun detail(companyId: String, taskId: String): TaskDetail =
        api.get("/v1/tasks/$taskId", companyId = companyId)

    suspend fun members(companyId: String): Page<Member> =
        api.get("/v1/members", companyId = companyId)

    /**
     * #294 — a link to this job's photos, for the customer.
     *
     * The plaintext token comes back exactly ONCE (D75) and is never retrievable
     * again, so whatever the caller does with the URL it does immediately.
     */
    suspend fun shareJobPhotos(companyId: String, taskId: String): JobPhotoLink =
        api.post("/v1/tasks/$taskId/photos/share", companyId = companyId)

    /** #294 — the customer should not be able to open it any more. */
    suspend fun revokeJobPhotos(companyId: String, taskId: String) {
        api.raw("DELETE", "/v1/tasks/$taskId/photos/share", companyId = companyId)
    }

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
     * #237 — stop (or restart) this job's reminders.
     *
     * Its own route rather than a field on the metadata patch: the patch
     * describes the JOB, and this decides whether we text somebody about it.
     * The server clears the queued reminders BEFORE answering, so by the time
     * this returns the thread strip is already right.
     */
    suspend fun setReminders(companyId: String, taskId: String, off: Boolean): Task =
        api.put(
            "/v1/tasks/$taskId/reminders",
            body = buildJsonObject { put("off", off) },
            companyId = companyId,
        )

    /**
     * #214: replace the task's whole structured address block. A non-null
     * [address] sets it (provenance = the enrichment's value, or "manual" when
     * hand-edited); null CLEARS it (an explicit top-level JSON null the RPC
     * distinguishes from "leave untouched").
     */
    suspend fun setAddress(companyId: String, taskId: String, address: TaskAddressInput?): Task =
        patch(
            companyId,
            taskId,
            buildJsonObject {
                if (address == null) put("address", JsonNull)
                else put("address", taskAddressJson(address))
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

    /**
     * Mint a short-lived signed URL for one derived-union attachment.
     *
     * #240: the DEFAULT is the preview, because the callers that mint the most
     * of these are thread bubbles and gallery tiles, and a 25 MB original
     * behind a 176dp thumbnail was the single worst egress shape in the
     * product — on our allowance and on the tech's own mobile data (#289).
     *
     * Pass "original" to OPEN or DOWNLOAD the file: a deliberate act by a
     * caller that wants the file rather than a picture of it. A row with no
     * preview serves its original either way, so nothing uploaded before this
     * shipped changes behaviour.
     */
    suspend fun attachmentUrl(
        companyId: String,
        attachmentId: String,
        variant: String = "preview",
    ): AttachmentUrl =
        api.get(
            "/v1/attachments/$attachmentId/url",
            query = if (variant == "original") mapOf("variant" to "original") else emptyMap(),
            companyId = companyId,
        )

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
        due: TaskListFilters,
        q: String?,
        cursor: String?,
        limit: Int = 100,
    ): Page<Task> = api.get(
        "/v1/tasks",
        query = mapOf(
            "has_location" to "true",
            "assigned_user_id" to assigneeUserId,
            "unassigned" to if (unassigned) "true" else null,
            "due_before" to due.dueBefore,
            "due_after" to due.dueAfter,
            "overdue" to if (due.overdue) "true" else null,
            "q" to q,
            "cursor" to cursor,
            "limit" to limit.toString(),
        ),
        companyId = companyId,
    )

    /**
     * Promote a message to a task ("Make a task"). 409 = already a task.
     * #214: [address] carries the confirmed enriched/hand-entered job address.
     */
    suspend fun create(
        companyId: String,
        messageId: String,
        title: String?,
        assignedUserId: String?,
        dueAt: String?,
        address: TaskAddressInput? = null,
    ): Task = api.post(
        "/v1/tasks",
        buildJsonObject {
            put("message_id", messageId)
            if (title != null) put("title", title)
            if (assignedUserId != null) put("assigned_user_id", assignedUserId)
            if (dueAt != null) put("due_at", dueAt)
            if (address != null) put("address", taskAddressJson(address))
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
    due: DueChip? = null,
    q: String? = null,
): List<Task> {
    // ASSIGNEE_ALL is UI sugar meaning "no assignee pin" (taskQueryParams
    // parity) — normalize it away before it reaches the wire.
    val assignee = assigneeUserId?.takeUnless { it == ASSIGNEE_ALL }
    val acc = mutableListOf<Task>()
    var cursor: String? = null
    var pages = 0
    do {
        val page = mutations.listLocated(
            companyId,
            assignee,
            unassigned,
            due?.let { dueChipFilters(it) } ?: TaskListFilters(),
            q?.trim()?.ifEmpty { null },
            cursor,
        )
        acc += page.data
        cursor = page.next_cursor
        pages++
    } while (cursor != null && pages < 40)
    return acc.distinctBy { it.id }
}
