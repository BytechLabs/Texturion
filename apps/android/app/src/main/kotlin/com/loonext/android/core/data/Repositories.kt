package com.loonext.android.core.data

import com.loonext.android.core.model.Contact
import com.loonext.android.core.model.ConversationListItem
import com.loonext.android.core.model.ForYou
import com.loonext.android.core.model.Me
import com.loonext.android.core.model.NotificationItem
import com.loonext.android.core.model.Page
import com.loonext.android.core.model.SearchResult
import com.loonext.android.core.model.Task
import com.loonext.android.core.model.UnreadCount
import com.loonext.android.core.net.ApiClient

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
