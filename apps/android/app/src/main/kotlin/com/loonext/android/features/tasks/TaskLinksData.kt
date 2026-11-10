package com.loonext.android.features.tasks

import com.loonext.android.core.model.Page
import com.loonext.android.core.model.SearchResult
import com.loonext.android.core.model.Task
import com.loonext.android.core.net.ApiClient
import java.util.concurrent.ConcurrentHashMap
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

/** What the OTHER task is to this one (GET /v1/tasks/:id/links). */
object TaskRelation {
    const val BLOCKED_BY = "blocked_by"
    const val BLOCKS = "blocks"
    const val PARENT = "parent"
    const val SUB_TASK = "sub_task"

    /** The order the Links section lists them in. */
    val ALL = listOf(BLOCKED_BY, BLOCKS, PARENT, SUB_TASK)

    fun labelKey(relation: String): String = when (relation) {
        BLOCKED_BY -> "taskLinks.relBlockedBy"
        BLOCKS -> "taskLinks.relBlocks"
        PARENT -> "taskLinks.relParent"
        else -> "taskLinks.relSubTask"
    }

    /** The sentence in the activity feed for a link added or removed. */
    fun historyKey(relation: String, added: Boolean): String = when (relation) {
        BLOCKED_BY -> if (added) "taskLinks.histBlockedBy" else "taskLinks.histBlockedByRemoved"
        BLOCKS -> if (added) "taskLinks.histBlocks" else "taskLinks.histBlocksRemoved"
        PARENT -> if (added) "taskLinks.histParent" else "taskLinks.histParentRemoved"
        else -> if (added) "taskLinks.histSubTask" else "taskLinks.histSubTaskRemoved"
    }
}

@Serializable
data class TaskLink(
    val relation: String,
    val task_id: String,
    val number: Int? = null,
    val title: String = "",
    val done: Boolean = false,
)

/** A task linked to a conversation or a contact. `how` is anchored, mentioned and/or points_at. */
@Serializable
data class LinkedTask(
    val id: String,
    val number: Int? = null,
    val title: String = "",
    val done: Boolean = false,
    val due_at: String? = null,
    val how: List<String> = emptyList(),
)

@Serializable
data class ResolvedTask(
    val number: Int,
    val id: String,
    val title: String = "",
    val done: Boolean = false,
)

@Serializable
data class ResolvedContact(val prefix: String, val id: String, val name: String? = null)

@Serializable
data class ResolvedConversation(
    val prefix: String,
    val id: String,
    val contact_name: String? = null,
)

@Serializable
data class ResolvedReferences(
    val tasks: List<ResolvedTask> = emptyList(),
    val contacts: List<ResolvedContact> = emptyList(),
    val conversations: List<ResolvedConversation> = emptyList(),
)

/** What a chip stands for once resolved. */
sealed interface ResolvedRef {
    data class TaskRef(val id: String, val number: Int, val title: String, val done: Boolean) : ResolvedRef
    data class ContactRef(val id: String, val name: String?) : ResolvedRef
    data class ConversationRef(val id: String, val contactName: String?) : ResolvedRef
}

/** Where a tap on a chip goes. */
sealed interface ReferenceTarget {
    data class Task(val id: String) : ReferenceTarget
    data class Contact(val id: String) : ReferenceTarget
    data class Conversation(val id: String) : ReferenceTarget
}

fun ResolvedRef.target(): ReferenceTarget = when (this) {
    is ResolvedRef.TaskRef -> ReferenceTarget.Task(id)
    is ResolvedRef.ContactRef -> ReferenceTarget.Contact(id)
    is ResolvedRef.ConversationRef -> ReferenceTarget.Conversation(id)
}

/** The key a token resolves under; the same for the cache and the lookup. */
fun ReferenceToken.cacheKey(): String = when (kind) {
    ReferenceKind.Task -> "t:$key"
    ReferenceKind.Contact -> "c:$key"
    ReferenceKind.Conversation -> "v:$key"
}

/** The most one resolve request may carry of each kind. */
const val RESOLVE_MAX = 50

/** How long a resolved chip is trusted before it is asked again. */
private const val RESOLVE_TTL_MS = 60_000L

private const val PICKER_LIMIT = 6

private data class Cached(val value: ResolvedRef?, val at: Long)

/** Shared by every screen: the same chip in a note and in the activity feed asks once. */
private val referenceCache = ConcurrentHashMap<String, Cached>()

/** Reads and writes for references, links and linked tasks (#690). */
class ReferenceRepository(private val api: ApiClient) {
    suspend fun links(companyId: String, taskId: String): List<TaskLink> =
        api.get<Page<TaskLink>>("/v1/tasks/$taskId/links", companyId = companyId).data

    suspend fun addLink(
        companyId: String,
        taskId: String,
        relation: String,
        otherTaskId: String,
    ): List<TaskLink> = api.post<Page<TaskLink>, kotlinx.serialization.json.JsonObject>(
        "/v1/tasks/$taskId/links",
        buildJsonObject {
            put("relation", relation)
            put("task_id", otherTaskId)
        },
        companyId = companyId,
    ).data

    suspend fun removeLink(
        companyId: String,
        taskId: String,
        otherTaskId: String,
        relation: String,
    ): List<TaskLink> {
        val path = "/v1/tasks/$taskId/links/$otherTaskId"
        val body = api.raw("DELETE", path, query = mapOf("relation" to relation), companyId = companyId)
        return api.decodeBody<Page<TaskLink>>(path, body).data
    }

    suspend fun linkedTasksOfConversation(companyId: String, conversationId: String): List<LinkedTask> =
        api.get<Page<LinkedTask>>("/v1/conversations/$conversationId/linked-tasks", companyId = companyId).data

    suspend fun linkedTasksOfContact(companyId: String, contactId: String): List<LinkedTask> =
        api.get<Page<LinkedTask>>("/v1/contacts/$contactId/linked-tasks", companyId = companyId).data

    /** Tasks by number, title or customer. `status` is left out on purpose: done tasks are found too. */
    suspend fun searchTasks(companyId: String, q: String, limit: Int = PICKER_LIMIT): List<Task> =
        api.get<Page<Task>>(
            "/v1/tasks",
            query = mapOf("q" to q.trim().ifEmpty { null }, "limit" to limit.toString()),
            companyId = companyId,
        ).data

    /** Contacts and conversations (and tasks, with their number) from the one search. */
    suspend fun search(companyId: String, q: String, limit: Int = PICKER_LIMIT): SearchResult =
        api.get(
            "/v1/search",
            query = mapOf("q" to q.trim(), "limit" to limit.toString()),
            companyId = companyId,
        )

    /**
     * Resolve the tokens in one request per [RESOLVE_MAX], cached for a minute.
     * Anything unknown, deleted or on a number the viewer is denied comes back
     * absent: the caller leaves that token as plain text.
     */
    suspend fun resolve(companyId: String, tokens: List<ReferenceToken>): Map<String, ResolvedRef> {
        val now = System.currentTimeMillis()
        val out = HashMap<String, ResolvedRef>()
        val unique = tokens.distinctBy { it.cacheKey() }
        val capped = ReferenceKind.entries.flatMap { kind -> unique.filter { it.kind == kind }.take(RESOLVE_MAX) }
        val wanted = capped.filter { token ->
            val hit = referenceCache[companyId + token.cacheKey()]
            if (hit != null && now - hit.at < RESOLVE_TTL_MS) {
                hit.value?.let { out[token.cacheKey()] = it }
                false
            } else {
                true
            }
        }
        if (wanted.isEmpty()) return out

        val tasks = wanted.filter { it.kind == ReferenceKind.Task }.map { it.key }
        val contacts = wanted.filter { it.kind == ReferenceKind.Contact }.map { it.key }
        val conversations = wanted.filter { it.kind == ReferenceKind.Conversation }.map { it.key }
        val answer = api.get<ResolvedReferences>(
            "/v1/references/resolve",
            query = mapOf(
                "tasks" to tasks.joinToString(",").ifEmpty { null },
                "contacts" to contacts.joinToString(",").ifEmpty { null },
                "conversations" to conversations.joinToString(",").ifEmpty { null },
            ),
            companyId = companyId,
        )
        val found = HashMap<String, ResolvedRef>()
        answer.tasks.forEach {
            found["t:${it.number}"] = ResolvedRef.TaskRef(it.id, it.number, it.title, it.done)
        }
        answer.contacts.forEach { found["c:${it.prefix.lowercase()}"] = ResolvedRef.ContactRef(it.id, it.name) }
        answer.conversations.forEach {
            found["v:${it.prefix.lowercase()}"] = ResolvedRef.ConversationRef(it.id, it.contact_name)
        }
        for (token in wanted) {
            val value = found[token.cacheKey()]
            referenceCache[companyId + token.cacheKey()] = Cached(value, now)
            if (value != null) out[token.cacheKey()] = value
        }
        return out
    }

    /** Forget what was resolved, so the next read asks again (a task was finished). */
    fun forget() = referenceCache.clear()
}
