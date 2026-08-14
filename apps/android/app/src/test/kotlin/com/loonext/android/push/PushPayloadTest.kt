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
    fun `being handed work routes to the assignments channel`() {
        // #515. Separate from Messages for the same reason task reminders are:
        // the inbox is the first thing a busy crew silences, and somebody
        // putting a job on your name is the alert that must survive that.
        val thread = parsePush(
            mapOf(
                "kind" to "conversation_assigned",
                "title" to "Sam assigned you a conversation",
                "body" to "Dana Reyes",
                "url" to "/inbox/conv-4",
            ),
        )
        val task = parsePush(
            mapOf(
                "kind" to "task_assigned",
                "title" to "Sam assigned you a task",
                "body" to "Re-pipe the basement",
                "url" to "/tasks/task-2",
            ),
        )

        assertEquals(ChannelIds.ASSIGNMENTS, thread.channelId)
        assertEquals(ChannelIds.ASSIGNMENTS, task.channelId)
    }

    @Test
    fun `an urgent text routes to its own channel, not Messages`() {
        // #564: it used to land on Messages at ordinary importance — buzzing no
        // louder than "on my way?" and silenced by the same switch — while the
        // reply we send that customer says the crew has been alerted.
        val content = parsePush(
            mapOf(
                "kind" to "emergency",
                "title" to "EMERGENCY from Maria Alvarez",
                "body" to "URGENT no heat",
                "url" to "/inbox/conv-9",
            ),
        )

        assertEquals(ChannelIds.EMERGENCY, content.channelId)
        assertEquals(PushKind.EMERGENCY, content.kind)
    }

    @Test
    fun `money moving routes to Payments, whichever way it moved`() {
        // #607 option B. All three outcomes share one kind because they share
        // one destination: a refund on a channel the deposit is not would be a
        // switch somebody could silence without ever knowing they had.
        val paid = parsePush(
            mapOf(
                "kind" to "payment",
                "title" to "Maria Alvarez paid \$250",
                "body" to "Deposit for the driveway",
                "url" to "/inbox/conv-9",
                "tag" to "payment:paid:req-1",
            ),
        )
        val disputed = parsePush(
            mapOf(
                "kind" to "payment",
                "title" to "Maria Alvarez's bank pulled back \$250",
                "body" to "Deposit for the driveway",
                "url" to "/inbox/conv-9",
                "tag" to "payment:disputed:req-1",
            ),
        )

        assertEquals(ChannelIds.PAYMENTS, paid.channelId)
        assertEquals(ChannelIds.PAYMENTS, disputed.channelId)
        assertEquals(PushKind.PAYMENT, paid.kind)
        // The server's per-outcome tag survives: a refund must not replace the
        // "paid" alert it followed, because both are facts the crew needs.
        assertEquals("payment:paid:req-1", paid.tag)
        assertEquals("payment:disputed:req-1", disputed.tag)
    }

    @Test
    fun `an ordinary text stays on Messages`() {
        // The other half of the pairing. Everything on the loud channel is a
        // channel everybody mutes, which tells nobody anything.
        val content = parsePush(
            mapOf(
                "title" to "Maria Alvarez",
                "body" to "on my way?",
                "url" to "/inbox/conv-9",
            ),
        )

        assertEquals(ChannelIds.MESSAGES, content.channelId)
        assertNull(content.kind)
    }

    @Test
    fun `the urgent channel is not the ringing channel`() {
        // Borrowing INCOMING_CALLS would give a text a ringtone, and would mean
        // somebody who silences ringing silences this too.
        assertNotEquals(ChannelIds.EMERGENCY, ChannelIds.INCOMING_CALLS)
        assertNotEquals(ChannelIds.EMERGENCY, ChannelIds.MESSAGES)
    }

    @Test
    fun `a hand-off keeps the server's collapse identity, not the url's`() {
        // The server keys a hand-off per THING (`assigned:conversation:<id>`)
        // so a re-assignment replaces its own earlier alert — and, critically,
        // so it never collides with an incoming text on the same thread, whose
        // tag is `conversation:<id>`.
        val handoff = parsePush(
            mapOf(
                "kind" to "conversation_assigned",
                "url" to "/inbox/conv-7",
                "tag" to "assigned:conversation:conv-7",
            ),
        )
        val text = parsePush(mapOf("title" to "Dana", "url" to "/inbox/conv-7"))

        assertEquals("assigned:conversation:conv-7", handoff.tag)
        assertEquals("conversation:conv-7", text.tag)
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
