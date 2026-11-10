package com.loonext.android.features.tasks

import com.loonext.android.core.model.TaskSource
import com.loonext.android.core.model.TaskSourceCall
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/**
 * #718: a task's source link names its source and exists only with one. A
 * standalone task never says "Open conversation".
 */
class TaskSourceLinkTest {

    private val call = TaskSourceCall(
        id = "k1",
        call_session_id = "sess-1",
        caller_name = "Sam",
        started_at = "2026-11-10T10:00:00Z",
    )

    private fun link(
        conversationId: String? = "c1",
        messageId: String? = "m1",
        source: TaskSource? = TaskSource("message", "m1"),
        call: TaskSourceCall? = null,
        direction: String? = "inbound",
        contactName: String? = "Sam",
    ) = taskSourceLink(conversationId, messageId, source, call, direction, contactName)

    @Test
    fun `a text names who it is from`() {
        val result = link()!!
        assertEquals("From a text from Sam", result.label)
        assertEquals("c1", result.conversationId)
        assertEquals("m1", result.messageId)
    }

    @Test
    fun `a text from an unnamed contact still names the kind`() {
        assertEquals("From a text", link(contactName = " ")!!.label)
        assertEquals("From a text", link(contactName = null)!!.label)
    }

    @Test
    fun `a note is a note, from the row or from the detail`() {
        assertEquals("Mentioned in a note", link(direction = "note")!!.label)
        assertEquals(
            "Mentioned in a note",
            link(source = TaskSource("message", "m1", direction = "note"), direction = null)!!.label,
        )
    }

    @Test
    fun `a call names the caller and opens the thread without a message`() {
        val result = link(messageId = null, source = TaskSource("call", "k1"), call = call)!!
        assertEquals("From a call with Sam", result.label)
        assertNull(result.messageId)
        assertEquals("sess-1", result.callSessionId)
    }

    @Test
    fun `no source means no link`() {
        // A standalone task: no conversation, no message, no call.
        assertNull(link(conversationId = null, messageId = null, source = null))
        // Linked to a customer's thread but promoted from nothing in it.
        assertNull(link(messageId = null, source = null))
        // A source whose thread is gone.
        assertNull(link(conversationId = null))
        assertNull(link(conversationId = null, messageId = null, source = TaskSource("call", "k1"), call = call))
    }

    @Test
    fun `the label is French when the reader is`() {
        val fr = taskSourceLink("c1", "m1", null, null, "inbound", "Sam", locale = "fr-CA")!!
        assertEquals("À partir d'un texto de Sam", fr.label)
    }
}
