package com.loonext.android.core.time

import java.time.Instant
import java.time.LocalDateTime
import java.time.ZoneId
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/**
 * #539 — turning "8:30 their time" into a moment.
 *
 * `java.time` resolves both DST edges the way the shared module's iterative version
 * does, but "the platform probably does the right thing" is not a claim worth
 * shipping on the two mornings a year it matters. These assert the behaviour rather
 * than the implementation, so the same set can be read against the TypeScript.
 */
class InstantForWallClockTest {

    private fun at(y: Int, m: Int, d: Int, h: Int, min: Int) =
        LocalDateTime.of(y, m, d, h, min)

    @Test
    fun `finds the instant when the customer's clock reads what was typed`() {
        val at = TwoClocks.instantForWallClock(
            at(2026, 8, 11, 8, 0),
            "America/Vancouver",
        )
        assertEquals(Instant.parse("2026-08-11T15:00:00Z"), at)
    }

    @Test
    fun `round-trips every whole hour of a day in a half-hour zone`() {
        // Newfoundland is UTC-3:30. An offset rounded to hours would be wrong every
        // single hour of every day here, not twice a year.
        val zone = ZoneId.of("America/St_Johns")
        for (hour in 0 until 24) {
            val wall = at(2026, 8, 11, hour, 45)
            val instant = TwoClocks.instantForWallClock(wall, "America/St_Johns")!!
            assertEquals("hour $hour", wall, instant.atZone(zone).toLocalDateTime())
        }
    }

    @Test
    fun `takes the FIRST of a repeated hour when the clocks go back`() {
        // 1:30am happens twice on 2026-11-01 in Toronto. The second would send an
        // hour later than asked for, on a day nobody is thinking about DST.
        val at = TwoClocks.instantForWallClock(
            at(2026, 11, 1, 1, 30),
            "America/Toronto",
        )
        // EDT is UTC-4, so the first 1:30 is 05:30Z; the second is 06:30Z.
        assertEquals(Instant.parse("2026-11-01T05:30:00Z"), at)
    }

    @Test
    fun `lands past the gap when the typed time never happens`() {
        // 2:30am does not exist on 2026-03-08 in Toronto — the clocks jump 2 to 3.
        // A send asked for then has to go at the first moment that did happen,
        // never at 1:30, which is EARLIER than the sender asked for.
        val zone = ZoneId.of("America/Toronto")
        val at = TwoClocks.instantForWallClock(at(2026, 3, 8, 2, 30), "America/Toronto")!!
        val landed = at.atZone(zone).toLocalDateTime()
        assertEquals(3, landed.hour)
        assertEquals(30, landed.minute)
    }

    @Test
    fun `handles midnight without moving the day`() {
        val zone = ZoneId.of("America/Toronto")
        val wall = at(2026, 8, 11, 0, 0)
        val instant = TwoClocks.instantForWallClock(wall, "America/Toronto")!!
        assertEquals(wall, instant.atZone(zone).toLocalDateTime())
    }

    @Test
    fun `returns null for a zone the runtime rejects`() {
        assertNull(
            TwoClocks.instantForWallClock(at(2026, 8, 11, 8, 0), "Mars/Olympus_Mons"),
        )
    }
}
