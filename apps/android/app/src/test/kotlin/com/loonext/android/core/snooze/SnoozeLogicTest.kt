package com.loonext.android.core.snooze

import java.time.LocalDateTime
import java.time.ZoneId
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * #293 — the presets, and the rule that decides which are offered.
 *
 * Mirrors packages/shared/src/snooze.test.ts and SnoozeLogicTests.swift case
 * for case. A divergence here is one the crew meets as a thread coming back at
 * the wrong time on one device, which is worse than no snooze at all.
 *
 * A FIXED zone throughout: the presets resolve in the device's own zone, so a
 * test that used the machine's would pass or fail depending on where CI runs.
 */
class SnoozeLogicTest {
    private val zone: ZoneId = ZoneId.of("America/Toronto")

    /** 2026-08-05 is a Wednesday. */
    private fun at(hour: Int, minute: Int = 0, day: Int = 5): LocalDateTime =
        LocalDateTime.of(2026, 8, day, hour, minute)

    private fun instant(hour: Int, minute: Int = 0, day: Int = 5) =
        at(hour, minute, day).atZone(zone).toInstant()

    private fun millis(hour: Int, minute: Int = 0, day: Int = 5) =
        instant(hour, minute, day).toEpochMilli()

    @Test
    fun `offers the whole ladder first thing in the morning`() {
        val presets = snoozePresets(instant(7), zone)
        assertEquals(
            listOf(
                SnoozePresetId.LATER_TODAY,
                SnoozePresetId.THIS_EVENING,
                SnoozePresetId.TOMORROW,
                SnoozePresetId.NEXT_WEEK,
            ),
            presets.map { it.id },
        )
        assertEquals(
            listOf("This afternoon", "This evening", "Tomorrow morning", "Next week"),
            presets.map { it.label },
        )
    }

    @Test
    fun `resolves each preset to the right hour of the right day`() {
        val byId = snoozePresets(instant(7), zone).associate { it.id to it.at }
        assertEquals(millis(15), byId[SnoozePresetId.LATER_TODAY])
        assertEquals(millis(18), byId[SnoozePresetId.THIS_EVENING])
        assertEquals(millis(8, day = 6), byId[SnoozePresetId.TOMORROW])
        // Wednesday the 5th → Monday the 10th.
        assertEquals(millis(8, day = 10), byId[SnoozePresetId.NEXT_WEEK])
    }

    @Test
    fun `drops a preset once it is behind us rather than greying it out`() {
        assertEquals(
            listOf(
                SnoozePresetId.THIS_EVENING,
                SnoozePresetId.TOMORROW,
                SnoozePresetId.NEXT_WEEK,
            ),
            snoozePresets(instant(16), zone).map { it.id },
        )
        assertEquals(
            listOf(SnoozePresetId.TOMORROW, SnoozePresetId.NEXT_WEEK),
            snoozePresets(instant(19), zone).map { it.id },
        )
    }

    @Test
    fun `drops a preset that is ahead but uselessly close`() {
        // 14:55 — "This afternoon" is five minutes away, so the thread would
        // blink out and come straight back.
        assertFalse(
            snoozePresets(instant(14, 55), zone).any {
                it.id == SnoozePresetId.LATER_TODAY
            },
        )
        // The boundary is the lead time, not the hour.
        val justEnough = instant(15).minusMillis(SnoozeTiming.MIN_LEAD_MS + 60_000L)
        assertTrue(
            snoozePresets(justEnough, zone).any {
                it.id == SnoozePresetId.LATER_TODAY
            },
        )
    }

    @Test
    fun `never returns a preset in the past, at any hour of any day`() {
        for (day in 1..14) {
            for (hour in 0..23) {
                val now = instant(hour, 30, day)
                for (preset in snoozePresets(now, zone)) {
                    assertTrue(
                        "day=$day hour=$hour offered ${preset.id} in the past",
                        preset.at > now.toEpochMilli(),
                    )
                }
            }
        }
    }

    @Test
    fun `the chase ladder is a DIFFERENT ladder, every rung a morning`() {
        // Deferring your own next action and waiting on somebody else's answer
        // run on different clocks. One ladder for both would put three useless
        // options in front of whichever job you were doing.
        val presets = followUpPresets(instant(9), zone)
        assertEquals(
            listOf(
                FollowUpPresetId.THREE_DAYS,
                FollowUpPresetId.NEXT_WEEK,
                FollowUpPresetId.TWO_WEEKS,
            ),
            presets.map { it.id },
        )
        assertEquals(
            listOf("In 3 days", "Next week", "In 2 weeks"),
            presets.map { it.label },
        )
        // Wednesday the 5th → the 8th, Monday the 10th, the 19th, all at 08:00.
        assertEquals(
            listOf(millis(8, day = 8), millis(8, day = 10), millis(8, day = 19)),
            presets.map { it.at },
        )
    }

    @Test
    fun `the chase ladder never offers a rung in the past`() {
        for (day in 1..14) {
            for (hour in 0..23) {
                val now = instant(hour, 30, day)
                for (preset in followUpPresets(now, zone)) {
                    assertTrue(
                        "day=$day hour=$hour offered ${preset.id} in the past",
                        preset.at > now.toEpochMilli(),
                    )
                }
            }
        }
    }

    @Test
    fun `next Monday is next week's, never today`() {
        assertEquals(7L, daysUntilNextMonday(at(9, day = 3))) // Monday
        assertEquals(5L, daysUntilNextMonday(at(9, day = 5))) // Wednesday
        assertEquals(2L, daysUntilNextMonday(at(9, day = 8))) // Saturday
        assertEquals(1L, daysUntilNextMonday(at(9, day = 9))) // Sunday
    }

    @Test
    fun `a custom target must be ahead and inside the cap`() {
        val now = millis(9)
        assertFalse(isSnoozeTargetValid(now - 1, now))
        assertFalse(isSnoozeTargetValid(now, now))
        assertTrue(isSnoozeTargetValid(now + 1, now))
        val cap = SnoozeTiming.MAX_DAYS * 86_400_000L
        assertTrue(isSnoozeTargetValid(now + cap, now))
        assertFalse(isSnoozeTargetValid(now + cap + 1, now))
    }

    @Test
    fun `the return shape counts day boundaries, not elapsed hours`() {
        // 11pm to 1am is two hours and still "tomorrow"…
        assertEquals(
            SnoozeReturnShape.TOMORROW,
            snoozeReturnShape(millis(1, day = 6), millis(23, day = 5), zone),
        )
        // …and 1am to 11pm is twenty-two hours and still "today".
        assertEquals(
            SnoozeReturnShape.TODAY,
            snoozeReturnShape(millis(23, day = 5), millis(1, day = 5), zone),
        )
    }

    @Test
    fun `the return shape uses a weekday inside the week and a date beyond it`() {
        val now = millis(9, day = 5)
        assertEquals(SnoozeReturnShape.WEEKDAY, snoozeReturnShape(millis(9, day = 8), now, zone))
        assertEquals(SnoozeReturnShape.WEEKDAY, snoozeReturnShape(millis(9, day = 11), now, zone))
        // Seven days out, "Wednesday" could be either one.
        assertEquals(SnoozeReturnShape.DATE, snoozeReturnShape(millis(9, day = 12), now, zone))
        // An already-elapsed return is today, not a negative date.
        assertEquals(SnoozeReturnShape.TODAY, snoozeReturnShape(millis(9, day = 1), now, zone))
    }

    @Test
    fun `deferral is computed from the return time, never the field's presence`() {
        val now = millis(10)
        assertFalse(isSnoozed(null, now))
        assertTrue(isSnoozed("2026-08-05T18:00:00Z", now))
        assertFalse(isSnoozed("2026-08-05T00:00:00Z", now))
    }

    @Test
    fun `an unparseable timestamp counts as not deferred, never as hidden`() {
        // Hiding a live thread because a date failed to parse is the one
        // direction this must never fail in.
        assertFalse(isSnoozed("not a date", millis(10)))
    }

    @Test
    fun `PostgREST's plus-zero-zero offset parses, not just Z`() {
        // The API renders timestamptz as "+00:00". Instant.parse rejects that
        // outright, which would have made every real snooze look elapsed.
        assertEquals(
            java.time.Instant.parse("2026-08-05T18:00:00Z").toEpochMilli(),
            parseInstantMillis("2026-08-05T18:00:00+00:00"),
        )
        assertTrue(isSnoozed("2026-08-05T18:00:00+00:00", millis(10)))
    }
}
