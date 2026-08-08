package com.loonext.android.features.compose

import com.loonext.android.core.model.DestinationClock
import com.loonext.android.core.time.TwoClocks
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * #539 — the clock switch on the Android picker.
 *
 * The part worth testing is not that two buttons render — it is that choosing
 * "their time" resolves the same digits to a DIFFERENT instant, and that the note
 * under the picker states the other clock rather than an hours-apart number.
 */
class SendLaterSwitchTest {

    private val toronto = ZoneId.of("America/Toronto")
    private val vancouver = ZoneId.of("America/Vancouver")
    private val date = LocalDate.of(2026, 8, 11)

    private fun instant(choice: TwoClocks.Choice, canSwitch: Boolean = true): Instant =
        wallInstant(date, 8, 30, toronto, vancouver, choice, canSwitch)

    @Test
    fun `their time and your time are different moments`() {
        // THE WHOLE POINT. If both branches produced the same instant the switch
        // would be decorative, which is exactly the failure mode worth a test.
        assertNotEquals(
            instant(TwoClocks.Choice.YOURS),
            instant(TwoClocks.Choice.THEIRS),
        )
    }

    @Test
    fun `their time really is that time on their clock`() {
        val at = instant(TwoClocks.Choice.THEIRS)
        val there = at.atZone(vancouver).toLocalTime()
        assertEquals(8, there.hour)
        assertEquals(30, there.minute)
    }

    @Test
    fun `your time really is that time on this device's clock`() {
        // The other half of the claim, and the half a one-sided assertion misses.
        val at = instant(TwoClocks.Choice.YOURS)
        val here = at.atZone(toronto).toLocalTime()
        assertEquals(8, here.hour)
        assertEquals(30, here.minute)
    }

    @Test
    fun `with no switch offered the device's clock always wins`() {
        // A crew whose customers are all in town never sees the toggle, and the
        // picker must behave exactly as it did before it existed.
        assertEquals(
            instant(TwoClocks.Choice.YOURS, canSwitch = false),
            instant(TwoClocks.Choice.THEIRS, canSwitch = false),
        )
    }

    @Test
    fun `an unresolvable destination zone sends at the time on screen`() {
        // Rather than at a guessed instant. `destinationZone` already falls back to
        // the device, so this is belt and braces on the path that matters most.
        val at = wallInstant(date, 8, 30, toronto, toronto, TwoClocks.Choice.THEIRS, true)
        assertEquals(8, at.atZone(toronto).toLocalTime().hour)
    }

    @Test
    fun `the note names the other clock as a time, not a gap`() {
        val clock = DestinationClock(
            timezone = "America/Vancouver",
            source = "area_code",
            local_hour = 8,
            quiet = false,
        )
        val theirs = pickerClockNote(
            clock, toronto, canSwitch = true,
            choice = TwoClocks.Choice.THEIRS,
            at = instant(TwoClocks.Choice.THEIRS), theirZone = vancouver,
        )
        assertTrue(theirs, theirs.endsWith(TwoClocks.HERE))
        assertTrue(theirs, theirs.contains("11:30"))

        val yours = pickerClockNote(
            clock, toronto, canSwitch = true,
            choice = TwoClocks.Choice.YOURS,
            at = instant(TwoClocks.Choice.YOURS), theirZone = vancouver,
        )
        assertTrue(yours, yours.endsWith(TwoClocks.THERE))
        assertTrue(yours, yours.contains("5:30"))
    }
}
