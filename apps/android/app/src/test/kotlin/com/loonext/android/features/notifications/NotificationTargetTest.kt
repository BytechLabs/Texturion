package com.loonext.android.features.notifications

import com.loonext.android.core.model.NotificationItem
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/** #718: a notification opens what it is about, at the message it names. */
class NotificationTargetTest {

    private fun item(
        type: String,
        conversationId: String? = "c1",
        messageId: String? = "m1",
        taskId: String? = null,
    ) = NotificationItem(
        id = "n1",
        type = type,
        conversation_id = conversationId,
        message_id = messageId,
        task_id = taskId,
        created_at = "2026-11-10T10:00:00Z",
    )

    @Test
    fun `a mention opens its thread at the message`() {
        assertEquals(
            NotificationTarget.Thread("c1", "m1"),
            notificationTarget(item("mention")),
        )
    }

    @Test
    fun `a notification that names no message opens the plain thread`() {
        assertEquals(
            NotificationTarget.Thread("c1", null),
            notificationTarget(item("assigned", messageId = null)),
        )
    }

    @Test
    fun `a task assignment opens the task, not the thread`() {
        assertEquals(
            NotificationTarget.Task("t1"),
            notificationTarget(item("task_assigned", taskId = "t1")),
        )
    }

    @Test
    fun `nothing to open when it names nothing`() {
        assertNull(notificationTarget(item("x", conversationId = null, messageId = null)))
    }
}
