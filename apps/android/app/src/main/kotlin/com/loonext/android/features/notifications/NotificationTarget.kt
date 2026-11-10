package com.loonext.android.features.notifications

import com.loonext.android.core.model.NotificationItem

/** Where a tapped notification goes (#718). */
sealed interface NotificationTarget {
    /** A task assignment is about the task, so it opens the task. */
    data class Task(val taskId: String) : NotificationTarget

    /** Everything else opens its thread, at the message it names when it names one. */
    data class Thread(val conversationId: String, val messageId: String?) : NotificationTarget
}

fun notificationTarget(item: NotificationItem): NotificationTarget? {
    if (item.type == "task_assigned" && item.task_id != null) {
        return NotificationTarget.Task(item.task_id)
    }
    val conversationId = item.conversation_id ?: return null
    return NotificationTarget.Thread(conversationId, item.message_id)
}
