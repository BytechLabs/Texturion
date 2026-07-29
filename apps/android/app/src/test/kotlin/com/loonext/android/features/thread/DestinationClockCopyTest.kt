package com.loonext.android.features.thread

import com.loonext.android.core.model.DestinationClock
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * #225 — the composer's "what time is it there" line.
 *
 * Two things are pinned, and both are about restraint: it appears ONLY when it
 * is quiet there, and it never claims more certainty than the rung it came
 * from. Ported 1:1 to iOS and web, because the failure mode is one app telling
 * somebody a different hour than another — worse than no hint at all.
 */
class DestinationClockCopyTest {
    private fun clock(
        hour: Int = 21,
        quiet: Boolean = true,
        source: String = "area_code",
    ) = DestinationClock(
        timezone = "America/Toronto",
        source = source,
        local_hour = hour,
        quiet = quiet,
    )

    @Test
    fun `says nothing during the day`() {
        // The whole design: silent when the answer would not change anything.
        assertNull(theirTimeLine(clock(hour = 14, quiet = false)))
    }

    @Test
    fun `says nothing when the clock could not be resolved`() {
        assertNull(theirTimeLine(null))
    }

    @Test
    fun `gives the hour in plain twelve-hour terms when it is quiet`() {
        val line = theirTimeLine(clock(hour = 21))
        assertTrue(line, line!!.contains("9pm"))
        assertTrue(line, line.contains("where they are"))
    }

    @Test
    fun `handles midnight and noon without saying zero`() {
        assertTrue(theirTimeLine(clock(hour = 0))!!.contains("12am"))
        // Noon is never quiet under the default window, but Texas Sundays make
        // it reachable — and "0pm" would be the giveaway nobody checked.
        assertTrue(theirTimeLine(clock(hour = 12))!!.contains("12pm"))
    }

    @Test
    fun `names the rung, because an area code is a guess that can be wrong`() {
        assertEquals("from their area code", clockProvenance("area_code"))
        assertEquals("set on their contact", clockProvenance("contact"))
    }

    @Test
    fun `admits it when the answer is really our own clock`() {
        // Letting the weakest rung read as the customer's time would be the
        // quiet lie this whole ladder exists to avoid.
        assertTrue(clockProvenance("company").contains("we don't know theirs"))
    }
}
