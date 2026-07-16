package com.loonext.android.features.inbox

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The global inbound toast's decision + copy (#165). The suppression rule is
 * the load-bearing part: a toast over the thread the user is reading would
 * duplicate the bubble that just rendered.
 */
class InboundToastLogicTest {

    @Test
    fun `toasts an inbound message for a conversation that is not on screen`() {
        assertTrue(
            shouldToastInbound(
                eventName = "message.created",
                conversationId = "conv-2",
                direction = "inbound",
                viewedConversationId = "conv-1",
            ),
        )
    }

    @Test
    fun `toasts when no thread is open at all`() {
        assertTrue(
            shouldToastInbound("message.created", "conv-2", "inbound", null),
        )
    }

    @Test
    fun `suppressed while its own thread is open`() {
        assertFalse(
            shouldToastInbound("message.created", "conv-1", "inbound", "conv-1"),
        )
    }

    @Test
    fun `only inbound messages toast — own sends and notes stay quiet`() {
        assertFalse(shouldToastInbound("message.created", "conv-2", "outbound", null))
        assertFalse(shouldToastInbound("message.created", "conv-2", "note", null))
        assertFalse(shouldToastInbound("message.created", "conv-2", null, null))
    }

    @Test
    fun `only message-created events toast`() {
        assertFalse(shouldToastInbound("message.status", "conv-2", "inbound", null))
        assertFalse(shouldToastInbound("conversation.updated", "conv-2", "inbound", null))
    }

    @Test
    fun `a payload without a conversation id cannot be routed`() {
        assertFalse(shouldToastInbound("message.created", null, "inbound", null))
    }

    // --- copy ---------------------------------------------------------------

    @Test
    fun `line is name colon body`() {
        assertEquals(
            "Dana: Sure, 3pm works",
            inboundToastLine("Dana", "Sure, 3pm works", hasAttachments = false),
        )
    }

    @Test
    fun `media-only text says what arrived instead of an empty snippet`() {
        assertEquals(
            "Dana: Sent a photo",
            inboundToastLine("Dana", "  ", hasAttachments = true),
        )
        assertEquals(
            "Dana: Sent a message",
            inboundToastLine("Dana", null, hasAttachments = false),
        )
    }

    @Test
    fun `whitespace collapses so the toast stays one line`() {
        assertEquals(
            "Dana: two lines",
            inboundToastLine("Dana", "two\n  lines", hasAttachments = false),
        )
    }

    @Test
    fun `a long body is trimmed with an ellipsis`() {
        val line = inboundToastLine("Dana", "x".repeat(200), hasAttachments = false)
        assertEquals(90, line.length)
        assertTrue(line.endsWith("…"))
    }

    @Test
    fun `a blank contact name falls back to a generic label`() {
        assertEquals(
            "New message: hi",
            inboundToastLine("  ", "hi", hasAttachments = false),
        )
    }
}
