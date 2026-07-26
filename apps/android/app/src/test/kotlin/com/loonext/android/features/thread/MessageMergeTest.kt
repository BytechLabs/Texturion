package com.loonext.android.features.thread

import com.loonext.android.core.model.Message
import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * The same rule the web client pins: a page refetch may not walk a message's
 * status backwards. All three clients show the same bubble, so they must agree
 * on what "sent" means.
 */
class MessageMergeTest {

    private fun message(id: String, status: String?, body: String = "hi") = Message(
        id = id,
        conversation_id = "c1",
        direction = "outbound",
        body = body,
        status = status,
        created_at = "2026-07-26T10:00:00Z",
    )

    @Test
    fun `a stale page does not move a sent message back to queued`() {
        // The send inserts the queued row and bumps the conversation in one
        // transaction, so the refetch that bump triggers can read 'queued' and
        // land after the broadcast that already said 'sent'.
        val merged = mergeMessage(message("m1", "sent"), message("m1", "queued"))
        assertEquals("sent", merged.status)
    }

    @Test
    fun `a real forward transition is taken`() {
        assertEquals("delivered", mergeMessage(message("m1", "sent"), message("m1", "delivered")).status)
        assertEquals("failed", mergeMessage(message("m1", "sent"), message("m1", "failed")).status)
        assertEquals("sent", mergeMessage(message("m1", "queued"), message("m1", "sent")).status)
    }

    @Test
    fun `the rest of a newer row is still taken when only the status is behind`() {
        val merged = mergeMessage(
            message("m1", "delivered", body = "old"),
            message("m1", "queued", body = "edited"),
        )
        assertEquals("edited", merged.body)
        assertEquals("delivered", merged.status)
    }

    @Test
    fun `a note has no status to protect`() {
        val merged = mergeMessage(message("m1", null), message("m1", null, body = "note"))
        assertEquals("note", merged.body)
        assertEquals(null, merged.status)
    }

    @Test
    fun `merging a page keeps the furthest status and still adds new rows`() {
        val existing = listOf(message("m1", "sent"))
        val fresh = listOf(message("m1", "queued"), message("m2", "received"))
        val merged = mergeMessagesFirstPage(existing, fresh)
        assertEquals("sent", merged.first { it.id == "m1" }.status)
        assertEquals(2, merged.size)
    }
}
