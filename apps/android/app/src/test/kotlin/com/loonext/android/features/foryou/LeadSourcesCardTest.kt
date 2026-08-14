package com.loonext.android.features.foryou

import com.loonext.android.core.model.LeadSourceCount
import com.loonext.android.core.model.LeadSourceReport
import com.loonext.android.core.model.MessageLocale
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/**
 * #301 — the two readings the lead-source card computes for itself.
 *
 * Both are hand-ports of web's, and the point of testing them here is that a
 * hand-port is where two platforms quietly start disagreeing: an owner who
 * reads "most of your work came from the truck" on a laptop and sees no such
 * sentence on their phone has been shown two different pictures of the same
 * month.
 */
class LeadSourcesCardTest {

    /**
     * #228 moved both sentences into `InboxStrings`, so each one now takes the
     * reader's language. Asserted in English because English is what the web
     * twin is written in and what this suite exists to stay level with; the
     * French is held to the same shape by `AppStringsTest`.
     */
    private val locale = MessageLocale.DEFAULT

    private fun source(name: String, total: Int) =
        LeadSourceCount(lead_source_id = name, name = name, by_number = total, total = total)

    @Test
    fun `headline names the leader when there is one`() {
        val report = LeadSourceReport(
            sources = listOf(source("Truck", 30), source("Google", 10)),
            unknown = 10,
            total = 50,
        )
        assertEquals(
            "Most of the work you can account for came from Truck — 30 of 40.",
            leadingSentence(report, locale),
        )
    }

    @Test
    fun `a leader too small to lead gets no sentence`() {
        // "Most of your work came from X" at 27% is simply false, and the
        // table says it better than a wrong sentence would.
        val spread = LeadSourceReport(
            sources = listOf(source("A", 10), source("B", 9), source("C", 9), source("D", 8)),
            unknown = 0,
            total = 36,
        )
        assertNull(leadingSentence(spread, locale))
    }

    @Test
    fun `the sentence is silent when nothing is attributed`() {
        // Dividing by an attributed count of zero is how a card ends up
        // printing NaN at somebody.
        val blind = LeadSourceReport(sources = emptyList(), unknown = 12, total = 12)
        assertNull(leadingSentence(blind, locale))
    }

    @Test
    fun `a long tail is folded into one row rather than listed`() {
        // A list of eleven channels is a list nobody reads to the bottom.
        val many = LeadSourceReport(
            sources = listOf(
                source("A", 10),
                source("B", 9),
                source("C", 8),
                source("D", 7),
                source("E", 6),
                source("F", 5),
            ),
            unknown = 0,
            total = 45,
        )
        val rows = visibleRows(many, locale)
        assertEquals(5, rows.size)
        assertEquals("2 more" to 11, rows[4])
    }

    @Test
    fun `the website is ranked with the sources, not pinned under them`() {
        // #232. A workspace whose site brings in most of the work should read
        // that at the TOP of the list — position is what an owner reads first,
        // and a row pinned last says the opposite of its own number. Same
        // order as web's LC-8 and iOS's, because a hand-port is exactly where
        // two platforms start showing different pictures of one month.
        val report = LeadSourceReport(
            sources = listOf(source("Truck", 30), source("Google", 10)),
            widget = 45,
            unknown = 10,
            total = 95,
        )
        assertEquals(
            listOf("Your website" to 45, "Truck" to 30, "Google" to 10),
            visibleRows(report, locale),
        )
        // And it can carry the headline, because "most of your work came from
        // your website" is the sentence #232 exists to be able to say.
        assertEquals(
            "Most of the work you can account for came from your website — 45 of 85.",
            leadingSentence(report, locale),
        )
    }

    @Test
    fun `a short list is not folded at all`() {
        val few = LeadSourceReport(
            sources = listOf(source("A", 10), source("B", 9)),
            unknown = 0,
            total = 19,
        )
        assertEquals(listOf("A" to 10, "B" to 9), visibleRows(few, locale))
    }
}
