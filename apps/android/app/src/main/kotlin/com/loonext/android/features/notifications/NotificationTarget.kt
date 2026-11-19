package com.loonext.android.features.notifications

import com.loonext.android.core.model.NotificationItem
import com.loonext.android.core.model.NotificationType

/** Where a tapped notification goes (#718). */
sealed interface NotificationTarget {
    data object Webhooks : NotificationTarget

    /** A task assignment is about the task, so it opens the task. */
    data class Task(val taskId: String) : NotificationTarget

    data class Thread(val conversationId: String, val messageId: String?) : NotificationTarget
}

fun notificationTarget(item: NotificationItem): NotificationTarget? {
    if (item.type == NotificationType.WEBHOOK_DISABLED) return NotificationTarget.Webhooks
    if (item.type == "task_assigned" && item.task_id != null) {
        return NotificationTarget.Task(item.task_id)
    }
    val conversationId = item.conversation_id ?: return null
    return NotificationTarget.Thread(conversationId, item.message_id)
}
