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
import com.loonext.android.core.model.Tag
import com.loonext.android.core.model.TaskFeedItem
import com.loonext.android.core.model.TaskLabel
import com.loonext.android.core.model.TaskRepeat
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonPrimitive
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
        /** #693: for `set_priority`. */
        priority: String? = null,
        /** #693: for `add_label` / `remove_label`. */
        tagId: String? = null,
        /**
         * #689 C: for `assign`, these people are ADDED to every selected task
         * and nobody is removed. Wins over [targetUserId].
         */
        assigneeIds: List<String>? = null,
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
                    if (filters.priorities.isNotEmpty()) {
                        putJsonArray("priority") { filters.priorities.forEach { add(it) } }
                    }
                    filters.tagId?.let { put("tag_id", it) }
                }
            }
            // Explicit null is meaningful (unassign), so it is only written when
            // the caller says so rather than whenever the id is absent.
            if (assigneeIds != null) {
                putJsonArray("assignee_ids") { assigneeIds.forEach { add(it) } }
            } else if (targetUserId != null) put("target_user_id", targetUserId)
            else if (unassign) put("target_user_id", JsonNull)
            if (priority != null) put("priority", priority)
            if (tagId != null) put("tag_id", tagId)
        },
        companyId = companyId,
    )

    /** #693: the workspace tags, the same list conversations and contacts use. */
    suspend fun tags(companyId: String): Page<Tag> =
        api.get("/v1/tags", companyId = companyId)

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

    /**
     * Metadata-only edit. Null-bearing fields must SEND null (clear). #693: a
     * [scope] rides along on a repeating job; absent means "this one".
     */
    private suspend fun patch(
        companyId: String,
        taskId: String,
        body: JsonObject,
        scope: TaskScope? = null,
    ): Task = api.patch("/v1/tasks/$taskId", withScope(body, scope), companyId = companyId)

    suspend fun rename(
        companyId: String,
        taskId: String,
        title: String,
        scope: TaskScope? = null,
    ): Task = patch(companyId, taskId, buildJsonObject { put("title", title) }, scope)

    suspend fun describe(
        companyId: String,
        taskId: String,
        description: String,
        scope: TaskScope? = null,
    ): Task = patch(companyId, taskId, buildJsonObject { put("description", description) }, scope)

    suspend fun assign(
        companyId: String,
        taskId: String,
        userId: String?,
        scope: TaskScope? = null,
    ): Task =
        patch(
            companyId,
            taskId,
            buildJsonObject {
                if (userId == null) put("assigned_user_id", JsonNull)
                else put("assigned_user_id", userId)
            },
            scope,
        )

    /**
     * #689 C: replace the whole crew. An empty list unassigns everyone; the
     * server answers 422 for more than ten or for a non-member.
     */
    suspend fun setAssignees(
        companyId: String,
        taskId: String,
        userIds: List<String>,
        scope: TaskScope? = null,
    ): Task =
        patch(
            companyId,
            taskId,
            buildJsonObject { putJsonArray("assignee_ids") { userIds.forEach { add(it) } } },
            scope,
        )

    /** [dueAt] must be ISO 8601 WITH offset ([encodeDueAt]); null clears. */
    suspend fun setDue(
        companyId: String,
        taskId: String,
        dueAt: String?,
        scope: TaskScope? = null,
    ): Task =
        patch(
            companyId,
            taskId,
            buildJsonObject {
                if (dueAt == null) put("due_at", JsonNull) else put("due_at", dueAt)
            },
            scope,
        )

    /** #693: none | low | normal | high | urgent. */
    suspend fun setPriority(
        companyId: String,
        taskId: String,
        priority: String,
        scope: TaskScope? = null,
    ): Task = patch(companyId, taskId, buildJsonObject { put("priority", priority) }, scope)

    /**
     * #693: set or change the repeat rule, or clear it with null. The server
     * always applies a repeat change to this job and the ones after it, so no
     * scope is sent.
     */
    suspend fun setRepeat(companyId: String, taskId: String, repeat: TaskRepeat?): Task =
        patch(
            companyId,
            taskId,
            buildJsonObject {
                if (repeat == null) put("repeat", JsonNull) else put("repeat", repeatJson(repeat))
            },
        )

    /** #693: attach a workspace tag by id, or by name (created if new). */
    suspend fun addLabel(
        companyId: String,
        taskId: String,
        tagId: String? = null,
        name: String? = null,
        scope: TaskScope? = null,
    ): TaskTagAdded = api.post(
        "/v1/tasks/$taskId/tags",
        withScope(
            buildJsonObject {
                if (tagId != null) put("tag_id", tagId) else put("name", name.orEmpty())
            },
            scope,
        ),
        companyId = companyId,
    )

    suspend fun removeLabel(
        companyId: String,
        taskId: String,
        tagId: String,
        scope: TaskScope? = null,
    ) {
        api.raw(
            "DELETE",
            "/v1/tasks/$taskId/tags/$tagId",
            query = mapOf("scope" to scope?.wire),
            companyId = companyId,
        )
    }

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
    suspend fun setAddress(
        companyId: String,
        taskId: String,
        address: TaskAddressInput?,
        scope: TaskScope? = null,
    ): Task =
        patch(
            companyId,
            taskId,
            buildJsonObject {
                if (address == null) put("address", JsonNull)
                else put("address", taskAddressJson(address))
            },
            scope,
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

    /**
     * D64: the done write for ANY task, branched on its source. A message task
     * writes its source message (above); a task promoted from a call has no
     * message and owns its done state, so it is written on the task itself.
     * The API answers 422 if a message task is patched here.
     */
    suspend fun setTaskDone(companyId: String, task: Task, done: Boolean) {
        val messageId = task.message_id
        if (messageId != null) setDone(companyId, messageId, done)
        else setCallTaskDone(companyId, task.id, done)
    }

    /** D64: the done write for a task with no message (see [setTaskDone]). */
    suspend fun setCallTaskDone(companyId: String, taskId: String, done: Boolean) {
        // The answer is the raw task row; nothing here reads it, so it is not decoded as one.
        api.patch<JsonObject, JsonObject>(
            "/v1/tasks/$taskId",
            buildJsonObject { put("done", done) },
            companyId = companyId,
        )
    }

    /**
     * #689 D: follow or unfollow a task. Following asks for a push when it
     * changes; an unfollow is remembered by the server, so a later comment does
     * not bring it back.
     */
    suspend fun follow(companyId: String, taskId: String, follow: Boolean) {
        val path = "/v1/tasks/$taskId/subscription"
        if (follow) {
            api.raw("POST", path, body = "{}", companyId = companyId)
        } else {
            api.delete(path, companyId = companyId)
        }
    }

    /**
     * Soft-delete to the Trash; needs records.delete (403 otherwise). #693: on a
     * repeating job, "this" skips one and "future" ends the repeat.
     */
    suspend fun delete(companyId: String, taskId: String, scope: TaskScope? = null) {
        api.raw(
            "DELETE",
            "/v1/tasks/$taskId",
            query = mapOf("scope" to scope?.wire),
            companyId = companyId,
        )
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

    /** One page of a task's history and comments, newest page first (#689). */
    suspend fun activity(
        companyId: String,
        taskId: String,
        cursor: String? = null,
    ): Page<TaskFeedItem> = api.get(
        "/v1/tasks/$taskId/activity",
        query = if (cursor == null) emptyMap() else mapOf("cursor" to cursor),
        companyId = companyId,
    )

    suspend fun addComment(companyId: String, taskId: String, body: String): TaskFeedItem =
        api.post(
            "/v1/tasks/$taskId/comments",
            buildJsonObject { put("body", body) },
            companyId = companyId,
        )

    suspend fun editComment(
        companyId: String,
        taskId: String,
        commentId: String,
        body: String,
    ): TaskFeedItem = api.patch(
        "/v1/tasks/$taskId/comments/$commentId",
        buildJsonObject { put("body", body) },
        companyId = companyId,
    )

    suspend fun deleteComment(companyId: String, taskId: String, commentId: String) {
        api.delete("/v1/tasks/$taskId/comments/$commentId", companyId = companyId)
    }

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
     * Promote a message, or (D64) an answered call, to a task ("Make a task"). 409 = already a task.
     * #214: [address] carries the confirmed enriched/hand-entered job address.
     */
    suspend fun create(
        companyId: String,
        messageId: String? = null,
        title: String?,
        assignedUserId: String?,
        dueAt: String?,
        address: TaskAddressInput? = null,
        /**
         * #689 C: the whole crew (up to ten). Wins over [assignedUserId] on the
         * server, and an empty list means nobody — so it is written whenever it
         * is non-null.
         */
        assigneeIds: List<String>? = null,
        /** D64: an answered call to promote instead. At most one of the two. */
        sourceCallId: String? = null,
        /** #689: with neither source, a standalone task may link to these. */
        contactId: String? = null,
        conversationId: String? = null,
        /** #693: omitted leaves the server's default (normal). */
        priority: String? = null,
        labelIds: List<String> = emptyList(),
        repeat: TaskRepeat? = null,
    ): Task = api.post(
        "/v1/tasks",
        buildJsonObject {
            if (messageId != null) put("message_id", messageId)
            if (sourceCallId != null) put("source_call_id", sourceCallId)
            if (title != null) put("title", title)
            if (assigneeIds != null) {
                putJsonArray("assignee_ids") { assigneeIds.forEach { add(it) } }
            } else if (assignedUserId != null) put("assigned_user_id", assignedUserId)
            if (dueAt != null) put("due_at", dueAt)
            if (address != null) put("address", taskAddressJson(address))
            if (contactId != null) put("contact_id", contactId)
            if (conversationId != null) put("conversation_id", conversationId)
            if (priority != null) put("priority", priority)
            if (labelIds.isNotEmpty()) putJsonArray("label_ids") { labelIds.forEach { add(it) } }
            if (repeat != null) put("repeat", repeatJson(repeat))
        },
        companyId = companyId,
    )
}

/** POST /v1/tasks/:id/tags answer: the tag and the task's labels after it. */
@Serializable
data class TaskTagAdded(
    val tag: Tag? = null,
    val labels: List<TaskLabel> = emptyList(),
)

/** Adds `scope` to a patch/post body when the caller chose one. */
internal fun withScope(body: JsonObject, scope: TaskScope?): JsonObject =
    if (scope == null) body else JsonObject(body + ("scope" to JsonPrimitive(scope.wire)))

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
