package com.loonext.android.push

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class PushPayloadTest {
    // --- parsePush ---

    @Test
    fun `message push lands on the messages channel with a conversation tag`() {
        val content = parsePush(
            mapOf(
                "title" to "New text from Dana",
                "body" to "Can you come by Thursday?",
                "url" to "https://app.loonext.com/inbox/1f0f7a5e-1111-2222-3333-444455556666",
            ),
        )

        assertEquals(ChannelIds.MESSAGES, content.channelId)
        assertEquals("conversation:1f0f7a5e-1111-2222-3333-444455556666", content.tag)
        assertEquals("New text from Dana", content.title)
        assertEquals("Can you come by Thursday?", content.body)
        assertNull(content.kind)
    }

    @Test
    fun `call push is high-urgency channel with a per-session tag and session id`() {
        val content = parsePush(
            mapOf(
                "kind" to "call",
                "title" to "Incoming call",
                "body" to "(415) 555-0134",
                "url" to "/calls?call=sess-abc-123",
            ),
        )

        assertTrue(content.isCall)
        assertEquals(ChannelIds.INCOMING_CALLS, content.channelId)
        assertEquals("call:sess-abc-123", content.tag)
        assertEquals("sess-abc-123", content.callSessionId)
        assertEquals("https://app.loonext.com/calls?call=sess-abc-123", content.url)
    }

    @Test
    fun `call_end shares the call's session tag and channel but is a revocation`() {
        val content = parsePush(
            mapOf(
                "kind" to "call_end",
                "url" to "/calls?call=sess-abc-123",
            ),
        )

        // calls-v3 §9.2: the tag IS the revocation key — a call_end cancels
        // the `call:<session>` tray entry by matching this exact tag.
        assertTrue(content.isCallEnd)
        assertFalse(content.isCall)
        assertEquals("call:sess-abc-123", content.tag)
        assertEquals(ChannelIds.INCOMING_CALLS, content.channelId)
        assertEquals("sess-abc-123", content.callSessionId)
    }

    @Test
    fun `a call and its call_end resolve to the exact same coalescing tag`() {
        val ring = parsePush(mapOf("kind" to "call", "url" to "/calls?call=sess-9"))
        val end = parsePush(mapOf("kind" to "call_end", "url" to "/calls?call=sess-9"))

        assertEquals(ring.tag, end.tag)
    }

    @Test
    fun `two concurrent calls get two distinct tags`() {
        val first = parsePush(mapOf("kind" to "call", "url" to "/calls?call=sess-1"))
        val second = parsePush(mapOf("kind" to "call", "url" to "/calls?call=sess-2"))

        assertTrue(first.tag != second.tag)
    }

    @Test
    fun `missed_call kind routes to the missed calls channel`() {
        val content = parsePush(
            mapOf(
                "kind" to "missed_call",
                "title" to "Missed call from Dana",
                "body" to "We sent them a text.",
                "url" to "/inbox/conv-9",
            ),
        )

        assertEquals(ChannelIds.MISSED_CALLS, content.channelId)
        assertEquals("conversation:conv-9", content.tag)
    }

    @Test
    fun `task_due kind routes to the task reminders channel`() {
        // A busy inbox is the first thing someone mutes, and a due-date
        // reminder is time-critical in a way an inbox notification is not.
        val content = parsePush(
            mapOf(
                "kind" to "task_due",
                "title" to "Replace the outdoor tap",
                "body" to "Due in 30 min",
                "url" to "/inbox/conv-4",
            ),
        )

        assertEquals(ChannelIds.TASK_REMINDERS, content.channelId)
    }

    @Test
    fun `a task reminder never replaces a text from the same customer`() {
        // The reminder deep-links to the job over its customer's thread, so a
        // conversation-keyed tag would let the two cancel each other out.
        val reminder = parsePush(
            mapOf(
                "kind" to "task_due",
                "title" to "Replace the outdoor tap",
                "body" to "Due in 30 min",
                "url" to "/inbox/conv-7?task=task-3",
            ),
        )
        val text = parsePush(
            mapOf("title" to "Dana", "body" to "On my way", "url" to "/inbox/conv-7"),
        )

        assertEquals("task:task-3", reminder.tag)
        assertEquals("conversation:conv-7", text.tag)
    }

    @Test
    fun `an unknown kind still lands somewhere rather than being dropped`() {
        // A newer server than this build: render it on the general channel.
        val content = parsePush(
            mapOf("kind" to "something_new", "title" to "Hi", "url" to "/inbox/c"),
        )

        assertEquals(ChannelIds.MESSAGES, content.channelId)
        assertEquals("Hi", content.title)
    }

    @Test
    fun `empty payload degrades to a calm generic notice, never dropped`() {
        val content = parsePush(emptyMap())

        assertEquals("Loonext", content.title)
        assertEquals("You have a new notification.", content.body)
        assertEquals(FALLBACK_DEEP_LINK, content.url)
        assertEquals(ChannelIds.MESSAGES, content.channelId)
    }

    @Test
    fun `call push with no url still rings with a fallback tag`() {
        val content = parsePush(mapOf("kind" to "call"))

        assertTrue(content.isCall)
        assertEquals("Incoming call", content.title)
        assertEquals(ChannelIds.INCOMING_CALLS, content.channelId)
        assertEquals("call:$FALLBACK_DEEP_LINK", content.tag)
        assertNull(content.callSessionId)
    }

    @Test
    fun `blank title and body fall back without touching a valid url`() {
        val content = parsePush(mapOf("title" to "  ", "body" to "", "url" to "/inbox/c1"))

        assertEquals("Loonext", content.title)
        assertEquals("You have a new notification.", content.body)
        assertEquals("https://app.loonext.com/inbox/c1", content.url)
    }

    // --- normalizeDeepLink ---

    @Test
    fun `relative paths resolve against the app origin`() {
        assertEquals(
            "https://app.loonext.com/inbox/abc",
            normalizeDeepLink("/inbox/abc"),
        )
    }

    @Test
    fun `legacy conversations paths normalize to inbox`() {
        assertEquals(
            "https://app.loonext.com/inbox/abc",
            normalizeDeepLink("https://app.loonext.com/conversations/abc"),
        )
        assertEquals(
            "https://app.loonext.com/inbox/abc",
            normalizeDeepLink("/conversations/abc"),
        )
    }

    @Test
    fun `query strings survive for the calls wake link`() {
        assertEquals(
            "https://app.loonext.com/calls?call=sess-1",
            normalizeDeepLink("https://app.loonext.com/calls?call=sess-1"),
        )
    }

    @Test
    fun `foreign origins fall back to the inbox`() {
        assertEquals(FALLBACK_DEEP_LINK, normalizeDeepLink("https://evil.example.com/inbox/x"))
        assertEquals(FALLBACK_DEEP_LINK, normalizeDeepLink("http://app.loonext.com/inbox/x"))
    }

    @Test
    fun `garbage and blanks fall back to the inbox`() {
        assertEquals(FALLBACK_DEEP_LINK, normalizeDeepLink(null))
        assertEquals(FALLBACK_DEEP_LINK, normalizeDeepLink("   "))
        assertEquals(FALLBACK_DEEP_LINK, normalizeDeepLink("::not a url::"))
    }

    // --- coalescingTag ---

    @Test
    fun `repeat pushes for one thread coalesce on one tag`() {
        val url = normalizeDeepLink("/inbox/conv-1")

        assertEquals(coalescingTag(null, url), coalescingTag("missed_call", url))
    }

    @Test
    fun `non-thread links tag per deep link`() {
        val tag = coalescingTag(null, "https://app.loonext.com/tasks")

        assertEquals("notice:https://app.loonext.com/tasks", tag)
    }

    @Test
    fun `the server's tag wins, so a mention is not erased by the thread`() {
        // The server keys a mention on the NOTE (#266): two asks in one thread
        // are two separate asks. Deriving the tag from the url collapsed them
        // onto the conversation, so the second replaced the first — and the
        // customer's next text replaced the mention entirely.
        val url = "$APP_ORIGIN/inbox/conv-1"
        val first = parsePush(mapOf("url" to url, "tag" to "mention:note-1"))
        val second = parsePush(mapOf("url" to url, "tag" to "mention:note-2"))
        val text = parsePush(mapOf("url" to url, "tag" to "conversation:conv-1"))

        assertEquals("mention:note-1", first.tag)
        assertEquals("mention:note-2", second.tag)
        assertNotEquals(first.tag, text.tag)
        // Repeat texts in one thread still collapse — that key is per thread.
        assertEquals(text.tag, parsePush(mapOf("url" to url, "tag" to "conversation:conv-1")).tag)
    }

    @Test
    fun `a call keeps its session tag whatever the server sends`() {
        // `call:<session>` is the key call_end cancels by (§9.2); overriding it
        // would leave the ring on screen after the call is over.
        val ring = parsePush(
            mapOf("kind" to "call", "url" to "/calls?call=sess-A", "tag" to "conversation:conv-1"),
        )

        assertEquals("call:sess-A", ring.tag)
    }

    @Test
    fun `a blank server tag falls back to the url-derived one`() {
        val url = "$APP_ORIGIN/inbox/conv-1"

        assertEquals("conversation:conv-1", parsePush(mapOf("url" to url, "tag" to "  ")).tag)
        assertEquals("conversation:conv-1", parsePush(mapOf("url" to url)).tag)
    }

    // --- queryParam ---

    @Test
    fun `queryParam reads the first value and decodes it`() {
        assertEquals("a b", queryParam("https://app.loonext.com/x?call=a%20b&other=1", "call"))
        assertNull(queryParam("https://app.loonext.com/x?other=1", "call"))
        assertNull(queryParam("https://app.loonext.com/x?call=", "call"))
    }
}
