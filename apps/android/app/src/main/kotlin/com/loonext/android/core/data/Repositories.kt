package com.loonext.android.core.data

import com.loonext.android.core.model.ReplySuggestions
import com.loonext.android.core.model.SatisfactionReport
import com.loonext.android.core.model.CompanyAiSettings
import com.loonext.android.core.model.Contact
import com.loonext.android.core.model.ConversationListItem
import com.loonext.android.core.model.ForYou
import com.loonext.android.core.model.Me
import com.loonext.android.core.model.MemberFirsts
import com.loonext.android.core.model.NotificationItem
import com.loonext.android.core.model.Page
import com.loonext.android.core.model.PipelineReportResponse
import com.loonext.android.core.model.ResponseTimeReport
import com.loonext.android.core.model.SearchResult
import com.loonext.android.core.model.SpamReviewPage
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

    /**
     * #476: what this member has done in this workspace. NOT company-exempt,
     * unlike [me] — the answer is scoped to the workspace they are in, so the
     * id is required rather than optional.
     */
    suspend fun firsts(companyId: String): MemberFirsts =
        api.get("/v1/me/firsts", companyId = companyId)
}

class ForYouRepository(private val api: ApiClient) {
    suspend fun forYou(companyId: String): ForYou =
        api.get("/v1/for-you", companyId = companyId)

    /**
     * #239: the response-time report. Its own call rather than a section of
     * /v1/for-you — it answers a different question (how are we doing) from the
     * queue (what needs doing), and it is windowed, so folding it in would make
     * the queue refetch every time somebody switched 7/30/90 days.
     */
    suspend fun responseTime(companyId: String, days: Int): ResponseTimeReport =
        api.get("/v1/reports/response-time?days=$days", companyId = companyId)

    /**
     * #354: quoted, won, still out. Its own read for the same reason the
     * response time above is — it answers "how are we doing" rather than "what
     * needs doing", and folding it into the queue would refetch everything.
     */
    /**
     * #313: how customers rate the work. Windowed like its two neighbours and
     * read separately for the same reason.
     */
    suspend fun satisfaction(companyId: String, days: Int = 30): SatisfactionReport =
        api.get("/v1/reports/satisfaction?days=$days", companyId = companyId)

    suspend fun pipeline(companyId: String, days: Int = 30): PipelineReportResponse =
        api.get("/v1/reports/pipeline?days=$days", companyId = companyId)

    /**
     * #342: spam marks that do not look like spam. Its own call rather than a
     * section of /v1/for-you — it answers a different question and is empty on
     * nearly every day.
     */
    suspend fun spamReview(companyId: String): SpamReviewPage =
        api.get("/v1/spam-review", companyId = companyId)

    /**
     * #342: the two answers to the review prompt. Lifting the mark puts the
     * thread back in the inbox; confirming it says "yes, still spam" without
     * making the decision permanent again — new activity can raise it later.
     */
    suspend fun answerSpamReview(
        companyId: String,
        conversationId: String,
        notSpam: Boolean,
    ) {
        api.patch<JsonObject, JsonObject>(
            "/v1/conversations/$conversationId",
            if (notSpam) {
                buildJsonObject { put("is_spam", false) }
            } else {
                buildJsonObject { put("spam_reviewed", true) }
            },
            companyId = companyId,
        )
    }
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
        /**
         * #459: read the digits in [q] as keypad letters too, so 2-6-2 finds
         * "Bob". Opt-in, because in a search box "416" means an area code and
         * quietly returning names as well would answer a question nobody asked.
         */
        t9: Boolean = false,
    ): Page<Contact> = api.get(
        "/v1/contacts",
        query = mapOf(
            "q" to q,
            "cursor" to cursor,
            "limit" to limit.toString(),
            "t9" to if (t9 && !q.isNullOrEmpty()) "1" else null,
        ),
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

    /**
     * POST /v1/conversations/:id/reply-suggestions — drafted replies for the
     * open thread. `draft` is whatever is already typed, so the server finishes
     * that sentence instead of talking past it.
     *
     * NOT cached: each call is a metered request the person asked for, and a
     * draft is only useful for the conversation as it stands right now. Never
     * rejects — any network/decode failure resolves to no suggestions, so the
     * composer degrades to exactly what it was before.
     */
    suspend fun suggestReplies(
        companyId: String,
        conversationId: String,
        draft: String,
    ): ReplySuggestions = try {
        api.post<ReplySuggestions, JsonObject>(
            "/v1/conversations/$conversationId/reply-suggestions",
            buildJsonObject {
                if (draft.isNotBlank()) put("draft", draft)
            },
            companyId = companyId,
        )
    } catch (e: CancellationException) {
        // The composer moved on mid-request: never swallow cancellation.
        throw e
    } catch (_: Exception) {
        ReplySuggestions(reason = "model_error")
    }

    /**
     * #431 — record what a human did with one piece of AI output.
     *
     * We metered every AI unit we spent and recorded nothing about whether
     * anyone used it, so "is Lou worth what it costs?" was unanswerable rather
     * than merely unanswered. `feature` is a LEDGER key and `outcome` one of
     * three enum strings; no message content ever leaves the device for this.
     *
     * Silent on failure by design. Losing an outcome costs a data point;
     * surfacing an error here would cost the person sending a text their
     * attention at the worst possible moment.
     */
    suspend fun reportAiOutcome(companyId: String, feature: String, outcome: String) {
        try {
            api.post<JsonObject, JsonObject>(
                "/v1/ai/outcome",
                buildJsonObject {
                    put("feature", JsonPrimitive(feature))
                    put("outcome", JsonPrimitive(outcome))
                },
                companyId = companyId,
            )
        } catch (e: CancellationException) {
            throw e
        } catch (_: Exception) {
            // Intentionally silent. See above.
        }
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
