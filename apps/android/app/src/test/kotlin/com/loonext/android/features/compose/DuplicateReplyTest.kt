package com.loonext.android.features.compose

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * #408 — port of EVERY vector in packages/shared/src/duplicate-reply.test.ts.
 *
 * The assertions that matter most are the ones about NOT warning. A
 * confirmation that fires when it should not is worse than none: the first
 * false one teaches people to dismiss it, and then the true one — the send
 * landing on top of a colleague's answer — gets dismissed too.
 */
class DuplicateReplyTest {

    private val me = "user-me"
    private val sam = "user-sam"

    @Test
    fun `warns when a teammate replied while the draft was being written`() {
        val result = duplicateReplyWarning(
            draftStartedAt = "2026-07-29T10:00:00.000Z",
            lastOutboundAt = "2026-07-29T10:00:40.000Z",
            lastOutboundByUserId = sam,
            meUserId = me,
        )
        assertEquals(DuplicateReplyWarning(warn = true, byUserId = sam), result)
    }

    @Test
    fun `does not warn about a reply that predates the draft`() {
        assertFalse(
            duplicateReplyWarning(
                "2026-07-29T10:00:00.000Z", "2026-07-29T09:58:00.000Z", sam, me,
            ).warn,
        )
    }

    @Test
    fun `does not warn about your own previous send`() {
        // Sending twice in a row is deliberate and ordinary; warning here would
        // fire on the most common action there is.
        assertFalse(
            duplicateReplyWarning(
                "2026-07-29T10:00:00.000Z", "2026-07-29T10:00:40.000Z", me, me,
            ).warn,
        )
    }

    @Test
    fun `warns about an automatic send, with no name to give`() {
        val result = duplicateReplyWarning(
            "2026-07-29T10:00:00.000Z", "2026-07-29T10:00:05.000Z", null, me,
        )
        assertEquals(DuplicateReplyWarning(warn = true, byUserId = null), result)
    }

    @Test
    fun `stays silent when the draft start is unknown`() {
        assertFalse(
            duplicateReplyWarning(null, "2026-07-29T10:00:40.000Z", sam, me).warn,
        )
    }

    @Test
    fun `stays silent in a thread nobody has replied in`() {
        assertFalse(
            duplicateReplyWarning("2026-07-29T10:00:00.000Z", null, null, me).warn,
        )
    }

    @Test
    fun `stays silent on a timestamp it cannot read`() {
        assertFalse(
            duplicateReplyWarning("not a date", "2026-07-29T10:00:40.000Z", sam, me).warn,
        )
    }

    @Test
    fun `warns on a draft left overnight and sent in the morning`() {
        // A recency window would miss this, and it is the case where the sender
        // is LEAST likely to have seen the reply.
        assertTrue(
            duplicateReplyWarning(
                "2026-07-28T18:00:00.000Z", "2026-07-29T08:00:00.000Z", sam, me,
            ).warn,
        )
    }

    @Test
    fun `names the person, because that is a fact somebody can act on`() {
        assertEquals("Sam replied just now.", duplicateReplyPrompt("Sam", 40))
        assertEquals("Sam replied 1 minute ago.", duplicateReplyPrompt("Sam", 60))
        assertEquals("Sam replied 2 minutes ago.", duplicateReplyPrompt("Sam", 120))
        assertEquals("Sam replied 2 hours ago.", duplicateReplyPrompt("Sam", 7200))
    }

    @Test
    fun `does not borrow a name it does not have`() {
        assertEquals(
            "An automatic reply went out just now.",
            duplicateReplyPrompt(null, 5),
        )
        assertEquals(
            "An automatic reply went out just now.",
            duplicateReplyPrompt("  ", 5),
        )
    }

    @Test
    fun `stops counting past a day rather than saying 31 hours ago`() {
        assertEquals(
            "Sam replied since you started writing.",
            duplicateReplyPrompt("Sam", 200_000),
        )
    }
}
