package com.loonext.android.core.format

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/**
 * #239 — the SAME table as `packages/shared/src/response-time.test.ts` and
 * `LoonextTests/ResponseTimeFormatTests.swift`.
 *
 * The point of duplicating the cases rather than trusting the port is that
 * hand-ported logic drifts silently. Two of these cases exist because the first
 * TS implementation got them wrong: a rounded remainder can reach a whole unit of
 * the next size up, and without carrying it, 3,599 seconds printed "60 min" and
 * 86,399 printed "23 hr 60 min".
 */
class ResponseTimeFormatTest {

    private val cases = listOf(
        0.0 to "0 sec",
        5.0 to "5 sec",
        59.0 to "59 sec",
        60.0 to "1 min",
        90.0 to "2 min",
        240.0 to "4 min",
        3599.0 to "1 hr",
        3600.0 to "1 hr",
        5400.0 to "1 hr 30 min",
        10800.0 to "3 hr",
        86399.0 to "1 day",
        86400.0 to "1 day",
        172800.0 to "2 days",
    )

    @Test
    fun `says the largest unit that still tells the truth`() {
        for ((seconds, expected) in cases) {
            assertEquals("$seconds", expected, ResponseTimeFormat.format(seconds))
        }
    }

    @Test
    fun `refuses to invent a zero when there is no median`() {
        assertEquals("—", ResponseTimeFormat.format(null))
        assertEquals("—", ResponseTimeFormat.format(Double.NaN))
    }

    @Test
    fun `draws no arc for a change under a minute`() {
        for (seconds in listOf(0.0, 30.0, -30.0, 59.0, -59.0)) {
            assertNull("$seconds", ResponseTimeFormat.arcDirection(seconds))
        }
    }

    @Test
    fun `names the direction honestly, including the wrong one`() {
        assertEquals("faster", ResponseTimeFormat.arcDirection(600.0))
        assertEquals("slower", ResponseTimeFormat.arcDirection(-600.0))
        assertNull(ResponseTimeFormat.arcDirection(null))
    }
}
