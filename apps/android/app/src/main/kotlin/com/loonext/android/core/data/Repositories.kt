package com.loonext.android.core.data

import com.loonext.android.core.model.CompanyAiSettings
import com.loonext.android.core.model.Contact
import com.loonext.android.core.model.ConversationListItem
import com.loonext.android.core.model.ForYou
import com.loonext.android.core.model.Me
import com.loonext.android.core.model.NotificationItem
import com.loonext.android.core.model.Page
import com.loonext.android.core.model.SearchResult
import com.loonext.android.core.model.Task
import com.loonext.android.core.model.TaskAddressInput
import com.loonext.android.core.model.TaskEnrichment
import com.loonext.android.core.model.UnreadCount
import com.loonext.android.core.net.ApiClient
import java.util.concurrent.ConcurrentHashMap
import kotlin.coroutines.cancellation.CancellationException
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

/**
 * Thin, typed /v1 readers. Feature modules own their mutation repositories;
 * these are the shared list/bootstrap reads the shell needs.
 */
class MeRepository(private val api: ApiClient) {
    /** Company-exempt without [companyId]; hydrated company view with it. */
    suspend fun me(companyId: String? = null): Me =
        api.get("/v1/me", companyId = companyId)

    suspend fun updateDisplayName(name: String): Map<String, String> =
        api.patch("/v1/me", mapOf("display_name" to name), companyId = null)
}

class ForYouRepository(private val api: ApiClient) {
    suspend fun forYou(companyId: String): ForYou =
        api.get("/v1/for-you", companyId = companyId)
}

class InboxRepository(private val api: ApiClient) {
    suspend fun conversations(
        companyId: String,
        status: String? = null,
        assignedUserId: String? = null,
        tagId: String? = null,
        spam: Boolean? = null,
        unread: Boolean? = null,
        pinned: String? = null,
        q: String? = null,
        cursor: String? = null,
        limit: Int = 25,
    ): Page<ConversationListItem> = api.get(
        "/v1/conversations",
        query = mapOf(
            "status" to status,
            "assigned_user_id" to assignedUserId,
            "tag_id" to tagId,
            "is_spam" to spam?.toString(),
            "unread" to unread?.toString(),
            "pinned" to pinned,
            "q" to q,
            "cursor" to cursor,
            "limit" to limit.toString(),
        ),
        companyId = companyId,
    )
}

class TasksRepository(private val api: ApiClient) {
    /**
     * NO params silently means status=open + assignee=me; ANY param disables
     * both defaults (mirror the web's status=open sentinel when filtering).
     */
    suspend fun tasks(
        companyId: String,
        status: String? = null,
        assignedUserId: String? = null,
        unassigned: Boolean? = null,
        q: String? = null,
        dueBefore: String? = null,
        dueAfter: String? = null,
        overdue: Boolean? = null,
        cursor: String? = null,
        limit: Int = 25,
    ): Page<Task> = api.get(
        "/v1/tasks",
        query = mapOf(
            "status" to status,
            "assigned_user_id" to assignedUserId,
            "unassigned" to unassigned?.toString(),
            "q" to q,
            "due_before" to dueBefore,
            "due_after" to dueAfter,
            "overdue" to overdue?.toString(),
            "cursor" to cursor,
            "limit" to limit.toString(),
        ),
        companyId = companyId,
    )
}

class ContactsRepository(private val api: ApiClient) {
    suspend fun contacts(
        companyId: String,
        q: String? = null,
        cursor: String? = null,
        limit: Int = 25,
    ): Page<Contact> = api.get(
        "/v1/contacts",
        query = mapOf("q" to q, "cursor" to cursor, "limit" to limit.toString()),
        companyId = companyId,
    )
}

class NotificationsRepository(private val api: ApiClient) {
    suspend fun feed(companyId: String, cursor: String? = null): Page<NotificationItem> =
        api.get(
            "/v1/notifications",
            query = mapOf("cursor" to cursor),
            companyId = companyId,
        )

    suspend fun unreadCount(companyId: String): UnreadCount =
        api.get("/v1/notifications/unread-count", companyId = companyId)

    suspend fun markAllRead(companyId: String) {
        api.post<kotlinx.serialization.json.JsonObject>(
            "/v1/notifications/mark-all-read",
            companyId = companyId,
        )
    }
}

class SearchRepository(private val api: ApiClient) {
    suspend fun search(companyId: String, q: String, cursor: String? = null): SearchResult =
        api.get(
            "/v1/search",
            query = mapOf("q" to q, "cursor" to cursor),
            companyId = companyId,
        )
}

/**
 * #214 — the task-enrichment call + the per-company AI opt-in. The enrichment
 * POST is session-cached per (company, message): reopening the make-task sheet
 * for the same message reuses the cached suggestion instead of spending another
 * AI call (mirror apps/web/src/lib/api/task-enrichment.ts). One instance lives
 * in the object graph so the cache is process-lifetime = app session, cleared
 * only on process restart. NEVER throws to the caller — any error resolves to
 * the empty enrichment so task creation is never blocked by the AI path.
 */
class AiRepository(private val api: ApiClient) {
    /** Session cache, keyed by "companyId:messageId". Thread-safe. */
    private val enrichmentCache = ConcurrentHashMap<String, TaskEnrichment>()

    /** GET /v1/company/ai-settings (member) — defaults to all-off when unset. */
    suspend fun getAiSettings(companyId: String): CompanyAiSettings =
        api.get("/v1/company/ai-settings", companyId = companyId)

    /** PATCH /v1/company/ai-settings (admin) — same body/shape. */
    suspend fun updateAiSettings(
        companyId: String,
        settings: CompanyAiSettings,
    ): CompanyAiSettings =
        api.patch("/v1/company/ai-settings", settings, companyId = companyId)

    /**
     * POST /v1/tasks/enrich — infer an address + due date/time from task text.
     * Session-cached per (company, message). Never rejects: any network/decode
     * error resolves to the empty enrichment. The cached value (including an
     * empty/disabled one) is reused so a second sheet-open never re-spends.
     */
    suspend fun enrichTask(
        companyId: String,
        text: String,
        messageId: String?,
        conversationId: String?,
    ): TaskEnrichment {
        val key = messageId?.let { "$companyId:$it" }
        if (key != null) enrichmentCache[key]?.let { return it }
        val result = try {
            api.post<TaskEnrichment, JsonObject>(
                "/v1/tasks/enrich",
                buildJsonObject {
                    put("text", text)
                    if (messageId != null) put("message_id", messageId)
                    if (conversationId != null) put("conversation_id", conversationId)
                },
                companyId = companyId,
            )
        } catch (e: CancellationException) {
            // The sheet was dismissed mid-enrich: never swallow cancellation and
            // never poison the cache with an empty result — leave the key unset
            // so reopening re-runs the (possibly already server-billed) call.
            throw e
        } catch (_: Exception) {
            TaskEnrichment()
        }
        if (key != null) enrichmentCache[key] = result
        return result
    }
}

/**
 * #214 build the nested `address` object for a create/update body — explicit
 * nulls for absent fields (mirroring the web client), `provenance` always sent.
 * The server RPC forces provenance to null when every field is empty.
 */
fun taskAddressJson(address: TaskAddressInput): JsonObject = buildJsonObject {
    fun field(name: String, value: String?) =
        put(name, value?.let { JsonPrimitive(it) } ?: JsonNull)
    field("street", address.street)
    field("unit", address.unit)
    field("city", address.city)
    field("state", address.state)
    field("postal_code", address.postal_code)
    field("country", address.country)
    put("provenance", address.provenance)
}
