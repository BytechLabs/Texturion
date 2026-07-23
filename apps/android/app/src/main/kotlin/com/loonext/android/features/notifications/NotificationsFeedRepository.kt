package com.loonext.android.features.notifications

import com.loonext.android.core.model.MarkReadResult
import com.loonext.android.core.model.NewlyRead
import com.loonext.android.core.model.NotificationItem
import com.loonext.android.core.model.NotificationPrefs
import com.loonext.android.core.model.Page
import com.loonext.android.core.model.UnreadCount
import com.loonext.android.core.net.ApiClient
import kotlinx.serialization.Serializable

/**
 * POST /v1/notifications/mark-read body — the tapped item's `created_at`
 * (ISO-8601 with offset). The watermark RPC keeps the greatest value, so this
 * marks the item and everything older read; newer items stay unread
 * (apps/api/src/routes/notifications.ts markReadSchema).
 */
@Serializable
data class MarkReadBody(val before: String)

/**
 * POST /v1/notifications/:id/read body — the item's `created_at` EXACTLY as
 * the feed returned it (never re-serialized through a Date type: millisecond
 * truncation was one of the two #188 root causes).
 */
@Serializable
data class MarkReadItemBody(val created_at: String)

/**
 * The notifications feature's own /v1 surface: derived feed + watermark
 * advances + per-user prefs (D24). Read semantics live in
 * [applyWatermark]/[advanceWatermark]; this class is transport only.
 */
class NotificationsFeedRepository(private val api: ApiClient) {
    suspend fun feed(
        companyId: String,
        cursor: String? = null,
        limit: Int = 25,
    ): Page<NotificationItem> = api.get(
        "/v1/notifications",
        query = mapOf("cursor" to cursor, "limit" to limit.toString()),
        companyId = companyId,
    )

    suspend fun unreadCount(companyId: String): UnreadCount =
        api.get("/v1/notifications/unread-count", companyId = companyId)

    /** Advance the watermark to one item's `created_at` (it + older = read). */
    suspend fun markRead(companyId: String, before: String): MarkReadResult =
        api.post("/v1/notifications/mark-read", MarkReadBody(before), companyId = companyId)

    /** Mark ONE notification read (#188) — older and newer items keep their state. */
    suspend fun markReadItem(companyId: String, id: String, createdAt: String): NewlyRead =
        api.post(
            "/v1/notifications/$id/read",
            MarkReadItemBody(createdAt),
            companyId = companyId,
        )

    /** Advance the watermark to now — every current item reads as read. */
    suspend fun markAllRead(companyId: String): MarkReadResult =
        api.post("/v1/notifications/mark-all-read", companyId = companyId)

    suspend fun prefs(companyId: String): NotificationPrefs =
        api.get("/v1/notification-prefs", companyId = companyId)

    /** PUT upserts BOTH toggles — always send the full pair. */
    suspend fun updatePrefs(companyId: String, prefs: NotificationPrefs): NotificationPrefs =
        api.put("/v1/notification-prefs", prefs, companyId = companyId)
}
