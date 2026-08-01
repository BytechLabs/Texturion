package com.loonext.android.features.contacts.device

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * #183 part 2: the pure digits → best-contact-match correlation.
 * #459: and the keypad's letters, which make it a name search too.
 */
class DialerCorrelationTest {

    private fun app(name: String?, number: String) =
        DialerCandidate(name = name, number = number, source = MatchSource.APP)

    private fun device(name: String?, number: String) =
        DialerCandidate(name = name, number = number, source = MatchSource.DEVICE)

    @Test
    fun `returns null below the minimum digit threshold`() {
        assertNull(correlateDialedNumber("416", listOf(app("Ada", "+14165550123"))))
        assertNull(correlateDialedNumber("", listOf(app("Ada", "+14165550123"))))
    }

    @Test
    fun `matches on the typed tail of the number`() {
        val match = correlateDialedNumber("5550123", listOf(app("Ada", "+14165550123")))
        assertEquals("Ada", match?.name)
        assertEquals(MatchSource.APP, match?.source)
    }

    @Test
    fun `exact full-number match ignores a leading country code`() {
        val match = correlateDialedNumber(
            "4165550123",
            listOf(device("Grace", "+14165550123")),
        )
        assertEquals("Grace", match?.name)
    }

    @Test
    fun `app contact wins a tie over a device contact`() {
        val match = correlateDialedNumber(
            "4165550123",
            // Same number, equal (exact) score — app is listed first and wins.
            listOf(app("App Ada", "+14165550123"), device("Device Ada", "+14165550123")),
        )
        assertEquals("App Ada", match?.name)
        assertEquals(MatchSource.APP, match?.source)
    }

    @Test
    fun `app still wins the tie regardless of list order`() {
        val match = correlateDialedNumber(
            "4165550123",
            listOf(device("Device Ada", "+14165550123"), app("App Ada", "+14165550123")),
        )
        assertEquals("App Ada", match?.name)
    }

    @Test
    fun `a stronger device match beats a weaker app match`() {
        // Device is an exact match (score 3); the app candidate only CONTAINS
        // the typed digits mid-string (score 1). Score dominates source
        // precedence, so the device contact wins despite app-first ordering.
        val match = correlateDialedNumber(
            "4165550123",
            listOf(
                app("App Partial", "+141655501235"), // contains "4165550123", not exact
                device("Device Exact", "+14165550123"),
            ),
        )
        assertEquals("Device Exact", match?.name)
        assertEquals(MatchSource.DEVICE, match?.source)
    }

    @Test
    fun `number-only candidate returns a formatted number`() {
        val match = correlateDialedNumber("5550123", listOf(app(null, "+14165550123")))
        assertEquals("(416) 555-0123", match?.name)
    }

    @Test
    fun `no candidate matches returns null`() {
        assertNull(correlateDialedNumber("5550123", listOf(app("Ada", "+14165559999"))))
    }

    // -----------------------------------------------------------------------
    // #459 — the keypad as a name search. The vitest twin of these cases lives
    // in packages/shared/src/dialer.test.ts; both must agree or the phone and
    // the browser disagree about who is at the top of the list.
    // -----------------------------------------------------------------------

    @Test
    fun `spells a name the way the keypad is printed`() {
        assertEquals(listOf("262"), t9Words("Bob"))
        assertEquals(listOf("3262", "94482662"), t9Words("Dana Whitcomb"))
    }

    @Test
    fun `splits on anything that is not a letter or a digit`() {
        // "O'Brien" and "Smith-Jones" are names people have, and the second
        // part of each has to be reachable.
        assertEquals(listOf("6", "27436"), t9Words("O'Brien"))
        assertEquals(listOf("76484", "56637"), t9Words("Smith-Jones"))
        assertEquals(listOf("21", "75862464"), t9Words("A1 Plumbing"))
    }

    @Test
    fun `finds a first name from its keypad letters`() {
        // B-O-B is 2-6-2. This is the whole feature in one assertion.
        val match = correlateDialedNumber("262", listOf(app("Bob Vance", "+14165550123")))
        assertEquals("Bob Vance", match?.name)
    }

    @Test
    fun `ranks a first word above a later word`() {
        val first = scoreDialerCandidate("3262", app("Dana Whitcomb", "+14165550123"))
        val later = scoreDialerCandidate("94482662", app("Dana Whitcomb", "+14165550123"))
        assertTrue(first > later)
        assertTrue(later > 0)
    }

    @Test
    fun `does not match in the middle of a word`() {
        // "Alaska" contains L-A-S mid-word. A list that returns names nobody
        // typed is one people stop reading.
        assertEquals(0, scoreDialerCandidate("527", app("Alaska Roofing", "+14165550123")))
    }

    @Test
    fun `needs two digits before a name matches`() {
        assertEquals(0, scoreDialerCandidate("2", app("Bob Vance", "+14165550123")))
        assertTrue(scoreDialerCandidate("26", app("Bob Vance", "+14165550123")) > 0)
    }

    @Test
    fun `an exact number beats a name that also matches`() {
        val exact = scoreDialerCandidate("4165550123", app("Zoe", "+14165550123"))
        val nameOnly = scoreDialerCandidate("963", app("Zoe", "+14165559999"))
        assertTrue(exact > nameOnly)
    }

    @Test
    fun `the shared book wins over a personal phone entry for one person`() {
        val ranked = rankDialerCandidates(
            "5550123",
            listOf(
                app("Dana Whitcomb", "+14165550123"),
                device("Dana (roofer)", "+1 416-555-0123"),
            ),
        )
        assertEquals(1, ranked.size)
        assertEquals("Dana Whitcomb", ranked[0].name)
        assertEquals(MatchSource.APP, ranked[0].source)
    }

    @Test
    fun `our book wins the tie no matter which order they arrive in`() {
        // The regression this exists to stop: collapsing duplicates before
        // sorting keeps whichever row came first, which hands the tie to the
        // device contact whenever it is listed first.
        val ranked = rankDialerCandidates(
            "5550123",
            listOf(
                device("Dana (roofer)", "+1 416-555-0123"),
                app("Dana Whitcomb", "+14165550123"),
            ),
        )
        assertEquals(1, ranked.size)
        assertEquals("Dana Whitcomb", ranked[0].name)
    }

    @Test
    fun `keeps a device contact our book does not have`() {
        val ranked = rankDialerCandidates(
            "262",
            listOf(
                app("Dana Whitcomb", "+14165550123"),
                device("Bob Vance", "+14165550188"),
            ),
        )
        assertEquals(listOf("Bob Vance"), ranked.map { it.name })
        assertEquals(MatchSource.DEVICE, ranked[0].source)
    }

    @Test
    fun `caps the list at four rows`() {
        val many = (0 until 20).map { app("Bobby $it", "+1416555" + (1000 + it)) }
        assertEquals(MAX_DIALER_MATCHES, rankDialerCandidates("262", many).size)
    }

    @Test
    fun `drops a candidate with no dialable digits`() {
        assertTrue(rankDialerCandidates("262", listOf(app("Bob Vance", ""))).isEmpty())
    }
}
