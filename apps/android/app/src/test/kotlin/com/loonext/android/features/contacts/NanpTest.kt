package com.loonext.android.features.contacts

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Vectors ported from packages/shared/src/nanp.test.ts (the Kotlin port keeps
 * only the key set — region/timezone assertions stay TypeScript-side), plus
 * the Android-only normalize/format helpers.
 */
class NanpTest {

    // ---- the area-code table ------------------------------------------------

    @Test
    fun `table carries every in-service US-CA code from the NANPA report`() {
        assertEquals(446, Nanp.AREA_CODES.size)
    }

    @Test
    fun `every code is a valid NXX area code`() {
        val nxx = Regex("^[2-9]\\d{2}$")
        Nanp.AREA_CODES.forEach { code ->
            assertTrue("bad code $code", nxx.matches(code))
        }
    }

    @Test
    fun `excludes Caribbean NANP and NANP-wide shared service codes`() {
        for (code in listOf(
            "242", "264", "809", "829", "876", "658", // Caribbean
            "800", "833", "888", "900", "500", "700", // service codes
        )) {
            assertFalse("$code must be absent", code in Nanp.AREA_CODES)
        }
    }

    // ---- lookupAreaCode -----------------------------------------------------

    @Test
    fun `resolves Canadian and US codes`() {
        assertEquals("416", Nanp.lookupAreaCode("+14165550123"))
        assertEquals("604", Nanp.lookupAreaCode("+16045550123"))
        assertEquals("902", Nanp.lookupAreaCode("+19025550123"))
        assertEquals("212", Nanp.lookupAreaCode("+12125550123"))
        assertEquals("305", Nanp.lookupAreaCode("+13055550123"))
        assertEquals("907", Nanp.lookupAreaCode("+19075550123"))
        assertEquals("808", Nanp.lookupAreaCode("+18085550123"))
    }

    @Test
    fun `resolves US-CA non-geographic codes too`() {
        assertEquals("710", Nanp.lookupAreaCode("+17105550123")) // US federal
        assertEquals("600", Nanp.lookupAreaCode("+16005550123")) // CA non-geo
    }

    @Test
    fun `null for Jamaica — Caribbean NANP is not US-CA`() {
        assertNull(Nanp.lookupAreaCode("+18765550123"))
    }

    @Test
    fun `null for unassigned 555`() {
        assertNull(Nanp.lookupAreaCode("+15555550123"))
    }

    @Test
    fun `null for malformed input — strict plus-1-NXX-NXX-XXXX only`() {
        for (bad in listOf(
            "",
            "4165550123", // no +1
            "14165550123", // no +
            "+4165550123", // wrong country code
            "+441655501234", // UK
            "+1416555012", // 9 national digits
            "+141655501234", // 11 national digits
            "+1 416 555 0123", // spaces
            "+1-416-555-0123", // dashes
            "+11165550123", // area code starts with 1
            "+10165550123", // area code starts with 0
            "+14161550123x", // trailing junk
            "+14160550123", // exchange starts with 0
            "+14161550123 ", // trailing space
            "+1416555O123", // letter O
        )) {
            assertNull("expected null for '$bad'", Nanp.lookupAreaCode(bad))
        }
    }

    // ---- isUsCaDestination (the SMS-pumping destination check) ---------------

    @Test
    fun `accepts US and CA geographic and non-geographic destinations`() {
        assertTrue(Nanp.isUsCaDestination("+12125550123"))
        assertTrue(Nanp.isUsCaDestination("+16045550123"))
        assertTrue(Nanp.isUsCaDestination("+17105550123"))
    }

    @Test
    fun `rejects Caribbean, toll-free, unassigned, and malformed`() {
        assertFalse(Nanp.isUsCaDestination("+18765550123")) // Jamaica
        assertFalse(Nanp.isUsCaDestination("+12425550123")) // Bahamas
        assertFalse(Nanp.isUsCaDestination("+18095550123")) // Dominican Republic
        assertFalse(Nanp.isUsCaDestination("+18005550123")) // toll-free
        assertFalse(Nanp.isUsCaDestination("+15555550123")) // unassigned
        assertFalse(Nanp.isUsCaDestination("+447911123456")) // not +1 at all
        assertFalse(Nanp.isUsCaDestination("2125550123")) // not E.164
    }

    // ---- normalize (Android-only: free-form input → E.164) -------------------

    @Test
    fun `normalizes the human formats people actually type`() {
        assertEquals("+14165550123", Nanp.normalize("(416) 555-0123"))
        assertEquals("+14165550123", Nanp.normalize("416-555-0123"))
        assertEquals("+14165550123", Nanp.normalize("1 416 555 0123"))
        assertEquals("+14165550123", Nanp.normalize("+1 (416) 555-0123"))
        assertEquals("+14165550123", Nanp.normalize("4165550123"))
    }

    @Test
    fun `rejects what the destination check rejects`() {
        assertNull(Nanp.normalize("876-555-0123")) // Jamaica
        assertNull(Nanp.normalize("800 555 0123")) // toll-free
        assertNull(Nanp.normalize("555-0123")) // 7 digits
        assertNull(Nanp.normalize("")) // nothing
        assertNull(Nanp.normalize("2 416 555 0123")) // 11 digits, not a 1 prefix
    }

    // ---- formatAsYouType ------------------------------------------------------

    @Test
    fun `formats progressively as the user types`() {
        assertEquals("", Nanp.formatAsYouType(""))
        assertEquals("(4", Nanp.formatAsYouType("4"))
        assertEquals("(416", Nanp.formatAsYouType("416"))
        assertEquals("(416) 5", Nanp.formatAsYouType("4165"))
        assertEquals("(416) 555", Nanp.formatAsYouType("416555"))
        assertEquals("(416) 555-0123", Nanp.formatAsYouType("4165550123"))
    }

    @Test
    fun `drops a leading country code and non-digits, capping at ten digits`() {
        assertEquals("(416) 555-0123", Nanp.formatAsYouType("14165550123"))
        assertEquals("(416) 555-0123", Nanp.formatAsYouType("+1 (416) 555-0123"))
        assertEquals("(416) 555-0123", Nanp.formatAsYouType("41655501239999"))
        assertEquals("", Nanp.formatAsYouType("abc"))
    }
}
