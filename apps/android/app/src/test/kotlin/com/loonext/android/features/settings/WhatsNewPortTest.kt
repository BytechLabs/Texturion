package com.loonext.android.features.settings

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * #321 — the marker rule, hand-ported from `packages/shared/src/whats-new.ts`.
 *
 * A badge that lights on one client and not another is worse than no badge, so
 * the rule has to answer identically on three clients. These are the same cases
 * the TypeScript suite asserts, in the same order.
 *
 * The cases that would make the marker USELESS matter more than the ones that
 * light it correctly, so most of these are about staying dark.
 */
class WhatsNewPortTest {

    private val entries = listOf(
        WhatsNewEntry("2026-07-01", "Older", "b"),
        WhatsNewEntry("2026-08-01", "Newer", "b"),
    )

    @Test
    fun `lights when something shipped since they last looked`() {
        assertTrue(hasUnseenWhatsNew("2026-07-15", "2026-01-01", entries))
    }

    @Test
    fun `goes dark once they have looked`() {
        assertFalse(hasUnseenWhatsNew("2026-08-01", "2026-01-01", entries))
    }

    @Test
    fun `does NOT light for a workspace that just arrived`() {
        // The case that would make the marker useless. A workspace created
        // today has no memory of missing anything, and a badge advertising six
        // months of changes is one they learn to ignore on day one.
        assertFalse(hasUnseenWhatsNew(null, "2026-08-02", entries))
    }

    @Test
    fun `does light for one that arrived before the newest change`() {
        assertTrue(hasUnseenWhatsNew(null, "2026-07-15", entries))
    }

    @Test
    fun `says nothing when nothing is known`() {
        // A wrong badge costs trust in every later one, so an unknown member
        // gets silence rather than a guess.
        assertFalse(hasUnseenWhatsNew(null, null, entries))
    }

    @Test
    fun `tolerates a full timestamp where a date is expected`() {
        // The client stores an ISO instant; the entries carry a date.
        assertTrue(hasUnseenWhatsNew("2026-07-15T09:30:00Z", null, entries))
        assertFalse(hasUnseenWhatsNew("2026-08-01T09:30:00Z", null, entries))
    }

    @Test
    fun `reports which entries are new`() {
        assertEquals(
            listOf("Newer"),
            unseenEntries("2026-07-15", null, entries).map { it.title },
        )
    }

    @Test
    fun `finds the newest date regardless of order`() {
        assertEquals("2026-08-01", latestWhatsNewDate(entries))
        assertEquals("", latestWhatsNewDate(emptyList()))
    }

    @Test
    fun `the shipped entries are ordered newest first and carry no future date`() {
        val dates = WHATS_NEW.map { it.date }
        assertEquals(dates.sortedDescending(), dates)
        val today = java.time.LocalDate.now().toString()
        for (entry in WHATS_NEW) {
            assertTrue("${entry.title} is dated ${entry.date}", entry.date <= today)
        }
    }

    @Test
    fun `no entry announces something that has not happened`() {
        // The honesty rule: a roadmap presented as news is how a changelog
        // loses credibility, and it does not come back.
        for (entry in WHATS_NEW) {
            val text = "${entry.title} ${entry.body}".lowercase()
            assertFalse(entry.title, text.contains("coming soon"))
            assertFalse(entry.title, text.contains("we will"))
            assertFalse(entry.title, text.contains("roadmap"))
            // Law 6: no em or en dash in rendered copy.
            assertFalse(entry.title, text.contains("—"))
            assertFalse(entry.title, text.contains("–"))
        }
    }
}
