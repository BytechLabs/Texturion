package com.loonext.android.features.contacts.device

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/** #183 part 2: the pure digits → best-contact-match correlation. */
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
}
