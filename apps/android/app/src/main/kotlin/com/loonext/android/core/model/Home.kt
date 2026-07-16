package com.loonext.android.core.model

import kotlinx.serialization.Serializable

// --- For You (D23) ---

@Serializable
data class ForYouWaiting(
    val conversation_id: String,
    val status: String,
    val contact: ContactSummary? = null,
    val assigned_user_id: String? = null,
    val last_message_at: String,
    val unread: Boolean = false,
    val has_overdue_task: Boolean = false,
    /** 0 overdue-task · 1 waiting · 2 unread · 3 new (lower = more urgent). */
    val urgency: Int = 3,
)

@Serializable
data class ForYouTask(
    val task_id: String,
    val title: String,
    val conversation_id: String,
    val message_id: String,
    val assigned_user_id: String? = null,
    val due_at: String? = null,
    val overdue: Boolean = false,
)

@Serializable
data class ForYouUnread(
    val conversation_id: String,
    val status: String,
    val contact: ContactSummary? = null,
    val assigned_user_id: String? = null,
    val last_message_at: String,
)

@Serializable
data class ForYouTriageConversation(
    val conversation_id: String,
    val status: String,
    val contact: ContactSummary? = null,
    val last_message_at: String,
    val unread: Boolean = false,
)

@Serializable
data class ForYouTriageTask(
    val task_id: String,
    val title: String,
    val conversation_id: String,
    val message_id: String,
    val due_at: String? = null,
    val overdue: Boolean = false,
)

/** Owner/admin-only strip; the whole field is null for a member. */
@Serializable
data class ForYouTriage(
    val conversations: List<ForYouTriageConversation> = emptyList(),
    val tasks: List<ForYouTriageTask> = emptyList(),
)

/** GET /v1/for-you — the four-section focus queue. */
@Serializable
data class ForYou(
    val waiting_on_you: List<ForYouWaiting> = emptyList(),
    val my_tasks: List<ForYouTask> = emptyList(),
    val unread: List<ForYouUnread> = emptyList(),
    val triage: ForYouTriage? = null,
)

// --- Notifications (D24 derived feed) ---

object NotificationType {
    const val INBOUND_MESSAGE = "inbound_message"
    const val ASSIGNED = "assigned"
    const val TASK_ASSIGNED = "task_assigned"
    const val MISSED_CALL = "missed_call"
}

@Serializable
data class NotificationItem(
    val id: String,
    val type: String,
    val conversation_id: String? = null,
    val message_id: String? = null,
    val task_id: String? = null,
    val contact: ContactSummary? = null,
    val created_at: String,
    val unread: Boolean = false,
)

@Serializable
data class UnreadCount(val count: Int)

@Serializable
data class MarkReadResult(val last_seen_at: String)

/** GET /v1/notification-prefs (+ vapid_public_key for web; unused natively). */
@Serializable
data class NotificationPrefs(
    val email_enabled: Boolean,
    val push_enabled: Boolean,
)
