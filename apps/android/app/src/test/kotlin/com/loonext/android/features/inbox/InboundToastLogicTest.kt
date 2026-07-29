package com.loonext.android.features.inbox

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import com.loonext.android.features.compose.MmsKind

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
            inboundToastLine(
                "Dana", "  ", hasAttachments = true,
                attachmentKind = MmsKind.Image,
            ),
        )
        assertEquals(
            "Dana: Sent a message",
            inboundToastLine("Dana", null, hasAttachments = false),
        )
    }

    @Test
    fun `a voice message is never announced as a photo`() {
        assertEquals(
            "Dana: Sent an audio message",
            inboundToastLine(
                "Dana", "", hasAttachments = true,
                attachmentKind = MmsKind.Audio,
            ),
        )
    }

    @Test
    fun `several attachments are counted, not pluralized by hand`() {
        assertEquals(
            "Dana: Sent 3 photos",
            inboundToastLine(
                "Dana", "", hasAttachments = true,
                attachmentKind = MmsKind.Image, attachmentCount = 3,
            ),
        )
    }

    @Test
    fun `an unknown or mixed set falls back to the neutral noun`() {
        assertEquals(
            "Dana: Sent an attachment",
            inboundToastLine("Dana", "", hasAttachments = true),
        )
        assertEquals(
            "Dana: Sent 2 attachments",
            inboundToastLine(
                "Dana", "", hasAttachments = true,
                attachmentKind = null, attachmentCount = 2,
            ),
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

    @Test
    fun `an acronym label keeps its capitals`() {
        // #271: attachmentLabel returns "PDF" for a single document, and a bare
        // replaceFirstChar turned that into "Sent a pDF" — visible in the banner
        // to every customer who was sent one. iOS carries the same rule.
        assertEquals(
            "Dana: Sent a PDF",
            inboundToastLine(
                contactName = "Dana",
                body = null,
                hasAttachments = true,
                attachmentKind = MmsKind.Document,
                attachmentCount = 1,
            ),
        )
    }

    @Test
    fun `an ordinary label is lowercased mid-sentence`() {
        assertEquals(
            "Dana: Sent a photo",
            inboundToastLine(
                contactName = "Dana",
                body = null,
                hasAttachments = true,
                attachmentKind = MmsKind.Image,
                attachmentCount = 1,
            ),
        )
    }

    @Test
    fun `the article follows the sound, not a rule about vowels only`() {
        // "an audio message" and "an attachment" take "an"; "a PDF" takes "a"
        // because P reads as a consonant even though the label is uppercase.
        assertTrue(
            inboundToastLine(
                contactName = "Dana", body = null, hasAttachments = true,
                attachmentKind = MmsKind.Audio, attachmentCount = 1,
            ).endsWith("an audio message"),
        )
        assertTrue(
            inboundToastLine(
                contactName = "Dana", body = null, hasAttachments = true,
                attachmentKind = null, attachmentCount = 1,
            ).endsWith("an attachment"),
        )
        assertTrue(
            inboundToastLine(
                contactName = "Dana", body = null, hasAttachments = true,
                attachmentKind = MmsKind.Document, attachmentCount = 1,
            ).endsWith("a PDF"),
        )
    }
}
