package com.loonext.android.a11y

import com.loonext.android.core.model.Message
import com.loonext.android.features.thread.ThreadAnnouncement
import com.loonext.android.features.thread.threadAnnouncement
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/**
 * What a screen reader is told when a thread changes under it. The emulator TalkBack
 * pass heard nothing when a send came back undelivered: the bubble changed and the
 * reader stayed silent.
 */
class ThreadAnnouncementTest {

    private fun message(id: String, direction: String, status: String? = null, body: String = "hi") =
        Message(
            id = id,
            conversation_id = "c1",
            direction = direction,
            body = body,
            status = status,
            created_at = "2026-11-10T10:00:00Z",
        )

    @Test fun `opening a thread announces nothing`() {
        assertNull(threadAnnouncement(null, listOf(message("1", "inbound"))))
    }

    @Test fun `a customer text arriving is announced with its words`() {
        val before = listOf(message("1", "inbound"))
        val after = before + message("2", "inbound", body = "I'm outside")
        assertEquals(ThreadAnnouncement.Incoming("I'm outside"), threadAnnouncement(before, after))
    }

    @Test fun `a send coming back undelivered is announced and outranks an arrival`() {
        val before = listOf(message("1", "outbound", "queued"))
        val after = listOf(message("1", "outbound", "failed"), message("2", "inbound"))
        assertEquals(ThreadAnnouncement.Failed, threadAnnouncement(before, after))
    }

    @Test fun `our own sends and a re-read of the same messages are not announced`() {
        val before = listOf(message("1", "inbound"))
        assertNull(threadAnnouncement(before, before + message("2", "outbound", "queued")))
        assertNull(threadAnnouncement(before, before))
    }
}
