package com.loonext.android.features.compose

import java.time.Instant
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** NANP entry helpers: normalization, formatting, destination checks. */
class NanpTest {

    @Test
    fun `nationalDigits strips formatting and one leading country code`() {
        assertEquals("4155550134", Nanp.nationalDigits("+1 (415) 555-0134"))
        assertEquals("4155550134", Nanp.nationalDigits("415.555.0134"))
        assertEquals("4155550134", Nanp.nationalDigits("14155550134"))
        assertEquals("", Nanp.nationalDigits("abc"))
    }

    @Test
    fun `formatAsYouType is progressive`() {
        assertEquals("", Nanp.formatAsYouType(""))
        assertEquals("(4", Nanp.formatAsYouType("4"))
        assertEquals("(415", Nanp.formatAsYouType("415"))
        assertEquals("(415) 55", Nanp.formatAsYouType("41555"))
        assertEquals("(415) 555-0134", Nanp.formatAsYouType("4155550134"))
    }

    @Test
    fun `toE164 needs a complete 10-digit national number`() {
        assertEquals("+14155550134", Nanp.toE164("(415) 555-0134"))
        assertNull(Nanp.toE164("415555013"))
    }

    @Test
    fun `US and CA area codes resolve with countries`() {
        assertEquals("US", Nanp.destinationCountry("+14155550134"))
        assertEquals("CA", Nanp.destinationCountry("+16045550134"))
        assertTrue(Nanp.isUsCaDestination("+14155550134"))
    }

    @Test
    fun `non-NANP and unassigned codes are rejected`() {
        assertFalse(Nanp.isUsCaDestination("+442071234567"))
        assertFalse(Nanp.isUsCaDestination("+18005550134")) // toll-free absent by design
        assertFalse(Nanp.isUsCaDestination("+11115550134")) // invalid NPA shape
    }

    @Test
    fun `destination local time uses the area code's primary zone`() {
        val at = Instant.parse("2026-07-15T00:00:00Z")
        // 415 = America/Los_Angeles = UTC-7 in July.
        assertEquals(17, Nanp.destinationLocalTime("+14155550134", at)?.hour)
        // Non-geographic 521 has no zone → no hint.
        assertNull(Nanp.destinationLocalTime("+15215550134", at))
    }

    // ---------------------------------------------------------------------
    // #225 — the quiet-hours boundary, same table as the server's
    // destination-clock.test.ts and the Swift twin. Three hand-ports of one
    // legal-ish rule, so the boundary is asserted rather than assumed.
    // ---------------------------------------------------------------------

    @Test
    fun `the quiet window is 8pm to 8am, boundaries included`() {
        assertTrue("7am is quiet", Nanp.isQuietHour(7))
        assertFalse("8am opens", Nanp.isQuietHour(8))
        assertFalse("7pm is fine", Nanp.isQuietHour(19))
        assertTrue("8pm closes", Nanp.isQuietHour(20))
        assertTrue("midnight is quiet", Nanp.isQuietHour(0))
    }

    @Test
    fun `every ordinary working hour is not quiet`() {
        for (hour in 8..19) {
            assertFalse("hour $hour should be sendable", Nanp.isQuietHour(hour))
        }
    }

    @Test
    fun `the window matches the constants it is built from`() {
        assertEquals(20, Nanp.QUIET_HOURS_START)
        assertEquals(8, Nanp.QUIET_HOURS_END)
    }
}
