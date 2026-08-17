package com.loonext.android.features.quotes

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/**
 * #287 — the derived quote status, held to the TypeScript it was ported from.
 *
 * ## Why this rule is worth a hand-port and a guard
 *
 * Nothing ever writes `expired`. A quote whose deadline passed an hour ago
 * still says `sent` in the database, so a client rendering the stored column
 * shows a live offer on a price the business has already withdrawn — to the
 * crew member who then goes and chases it.
 *
 * The server sends `effective_status` too, so the port is not about trust. It
 * is about FRESHNESS: a row read at 4:59 and rendered at 5:01 carries a stale
 * derived string and a perfectly good `expires_at`. Timestamps survive a cache
 * round-trip; a derived string is only as fresh as the read that brought it.
 */
class QuotesRuleTest {

    private val hour = 3_600_000L
    private val now = 1_770_000_000_000L
    private val past = java.time.Instant.ofEpochMilli(now - hour).toString()
    private val future = java.time.Instant.ofEpochMilli(now + hour).toString()

    @Test
    fun `a sent quote past its deadline reads as expired without anything writing it`() {
        assertEquals(
            QuoteStatus.EXPIRED,
            Quotes.effectiveStatus(QuoteStatus.SENT, past, now),
        )
        assertEquals(
            QuoteStatus.SENT,
            Quotes.effectiveStatus(QuoteStatus.SENT, future, now),
        )
    }

    @Test
    fun `a decision is final, and a deadline cannot undo it`() {
        // The branch that matters most. Expiry must not un-accept a quote
        // somebody accepted, nor re-open one they declined — the deadline was
        // for ANSWERING, and it has been answered.
        assertEquals(
            QuoteStatus.ACCEPTED,
            Quotes.effectiveStatus(QuoteStatus.ACCEPTED, past, now),
        )
        assertEquals(
            QuoteStatus.DECLINED,
            Quotes.effectiveStatus(QuoteStatus.DECLINED, past, now),
        )
    }

    @Test
    fun `a draft never expires, because an unsent price is not an offer`() {
        assertEquals(
            QuoteStatus.DRAFT,
            Quotes.effectiveStatus(QuoteStatus.DRAFT, past, now),
        )
    }

    @Test
    fun `an unreadable date is not an expiry`() {
        // Fail toward the LIVE offer. Reading a bad string as a deadline would
        // silently withdraw a price the business is still honouring, and the
        // crew would never learn why the customer stopped hearing about it.
        assertEquals(QuoteStatus.SENT, Quotes.effectiveStatus(QuoteStatus.SENT, "not a date", now))
        assertEquals(QuoteStatus.SENT, Quotes.effectiveStatus(QuoteStatus.SENT, null, now))
        assertEquals(QuoteStatus.SENT, Quotes.effectiveStatus(QuoteStatus.SENT, "", now))
    }

    @Test
    fun `outstanding is asked-and-unanswered, and nothing else`() {
        assertTrue(Quotes.isOutstanding(QuoteStatus.SENT, future, now))
        assertTrue(Quotes.isOutstanding(QuoteStatus.VIEWED, future, now))
        // Lapsed is not outstanding: nobody is waiting on an answer to a price
        // that is no longer offered.
        assertFalse(Quotes.isOutstanding(QuoteStatus.SENT, past, now))
        assertFalse(Quotes.isOutstanding(QuoteStatus.DRAFT, future, now))
        assertFalse(Quotes.isOutstanding(QuoteStatus.ACCEPTED, future, now))
        assertFalse(Quotes.isOutstanding(QuoteStatus.DECLINED, future, now))
    }

    @Test
    fun `names exactly the statuses the shared module declares, both directions`() {
        val shared = sharedSource()
        val declared = Regex("\"(draft|sent|viewed|accepted|declined|expired)\"")
            .findAll(shared.substringAfter("QUOTE_STATUSES").substringBefore("] as const"))
            .map { it.groupValues[1] }
            .toSet()

        // A guard that reads nothing passes for the wrong reason.
        assertEquals(
            "expected six statuses in quotes.ts, found $declared",
            6,
            declared.size,
        )

        val ported = setOf(
            QuoteStatus.DRAFT, QuoteStatus.SENT, QuoteStatus.VIEWED,
            QuoteStatus.ACCEPTED, QuoteStatus.DECLINED, QuoteStatus.EXPIRED,
        )
        // SET EQUALITY, BOTH DIRECTIONS. A status added to the shared rule and
        // not here renders nothing for a state the server can now send; one
        // here and not there is a state no client will ever see.
        assertEquals(declared, ported)
        assertEquals(ported, QUOTE_STATUS_KEYS.keys)
    }

    /** Walk UP to the repo root; Gradle's working directory is a runner detail. */
    private fun sharedSource(): String {
        var dir: File? = File("").absoluteFile
        while (dir != null) {
            val candidate = File(dir, "packages/shared/src/quotes.ts")
            if (candidate.exists()) return candidate.readText()
            dir = dir.parentFile
        }
        throw AssertionError(
            "packages/shared/src/quotes.ts not found walking up from " +
                File("").absolutePath,
        )
    }
}
