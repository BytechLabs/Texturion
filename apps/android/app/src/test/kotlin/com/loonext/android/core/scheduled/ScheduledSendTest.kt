package com.loonext.android.core.scheduled

import java.time.Instant
import java.time.ZoneId
import java.time.ZonedDateTime
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * #233 — the send-later port, against the same cases the TypeScript original
 * is pinned to.
 *
 * A hand-port only proves anything if it is compiled and exercised: a Kotlin
 * `when` that silently falls through to `else`, or a preset landing an hour out
 * across a DST boundary, are both invisible in review and invisible at runtime
 * until a customer gets a text at 7am.
 */
class ScheduledSendTest {

    private val toronto = ZoneId.of("America/Toronto")

    private fun hourIn(instant: Instant, zone: ZoneId): Int =
        instant.atZone(zone).hour

    @Test
    fun `presets land on 8am where the customer is`() {
        // Mid-afternoon UTC is still morning on the west coast — the case where
        // "tomorrow" is ambiguous if the arithmetic happens in the wrong zone.
        val vancouver = ZoneId.of("America/Vancouver")
        val now = Instant.parse("2026-06-15T21:00:00Z")
        val tomorrow = ScheduledSend.presets(now, vancouver)[0].at!!
        assertEquals(8, hourIn(tomorrow, vancouver))
    }

    @Test
    fun `still 8am across the spring-forward boundary`() {
        // 2026-03-08, clocks jump 2am to 3am. A fixed-offset implementation
        // returns 9am here, and nobody notices until a customer does.
        val now = Instant.parse("2026-03-07T12:00:00Z")
        val tomorrow = ScheduledSend.presets(now, toronto)[0].at!!
        assertEquals(8, hourIn(tomorrow, toronto))
    }

    @Test
    fun `still 8am across the fall-back boundary`() {
        val now = Instant.parse("2026-10-31T12:00:00Z")
        val tomorrow = ScheduledSend.presets(now, toronto)[0].at!!
        assertEquals(8, hourIn(tomorrow, toronto))
    }

    @Test
    fun `monday lands on a monday, at 8am there`() {
        val now = Instant.parse("2026-06-17T15:00:00Z") // a Wednesday
        val monday = ScheduledSend.presets(now, toronto)[1].at!!
        val there: ZonedDateTime = monday.atZone(toronto)
        assertEquals("MONDAY", there.dayOfWeek.name)
        assertEquals(8, there.hour)
    }

    @Test
    fun `monday means NEXT monday when today is already monday`() {
        // Otherwise the preset is a time that has passed, which the API refuses
        // — an option that cannot be used.
        val now = Instant.parse("2026-06-15T18:00:00Z") // Monday
        val monday = ScheduledSend.presets(now, toronto)[1].at!!
        assertEquals("MONDAY", monday.atZone(toronto).dayOfWeek.name)
        assertTrue(monday.isAfter(now))
    }

    @Test
    fun `no preset is ever already in the past`() {
        val vancouver = ZoneId.of("America/Vancouver")
        for (hour in 0..23) {
            val now = ZonedDateTime.of(2026, 6, 15, hour, 0, 0, 0, ZoneId.of("UTC")).toInstant()
            for (preset in ScheduledSend.presets(now, vancouver)) {
                preset.at?.let {
                    assertTrue("${preset.id} at hour $hour is in the past", it.isAfter(now))
                }
            }
        }
    }

    @Test
    fun `two presets and a way out, in that order`() {
        val presets = ScheduledSend.presets(Instant.parse("2026-06-15T12:00:00Z"), toronto)
        assertEquals(listOf("tomorrow", "monday", "custom"), presets.map { it.id })
        assertTrue(presets[2].at == null)
    }

    @Test
    fun `every reason has copy, and none of it is a code`() {
        for ((reason, copy) in ScheduledSend.HOLD_REASONS) {
            assertTrue("$reason has no copy", copy.length > 20)
            assertTrue("$reason reads like a code", copy.contains(" "))
            assertEquals(copy.trim(), copy)
        }
    }

    @Test
    fun `does not promise a retry against something that will never change`() {
        // The distinction that matters. Marking an opt-out recoverable would
        // retry against a STOP forever, and the copy would be promising to send
        // a message that must never go.
        assertFalse(ScheduledSend.reasonRecovers("recipient_opted_out"))
        assertFalse(ScheduledSend.reasonRecovers("invalid_destination"))
        assertFalse(ScheduledSend.reasonRecovers("expired"))
        assertFalse(ScheduledSend.reasonRecovers("workspace_closed"))

        assertTrue(ScheduledSend.reasonRecovers("subscription_inactive"))
        assertTrue(ScheduledSend.reasonRecovers("registration_pending"))
        assertTrue(ScheduledSend.reasonRecovers("service_unavailable"))
        assertTrue(ScheduledSend.reasonRecovers("calendar_unverified"))
        assertTrue(ScheduledSend.reasonRecovers("customer_replied"))
    }

    @Test
    fun `offers no remedy for the one that has none`() {
        assertTrue(
            ScheduledSend.HOLD_REASONS["recipient_opted_out"]!!.contains("Only they can"),
        )
    }

    @Test
    fun `the weakest clock rung admits it is ours`() {
        assertTrue(ScheduledSend.clockProvenance("company").contains("we don't know theirs"))
        assertTrue(ScheduledSend.clockProvenance("contact").contains("their time"))
        assertTrue(ScheduledSend.clockProvenance("area_code").contains("area code"))
    }

    @Test
    fun `live means pending or held, and nothing else`() {
        assertEquals(
            listOf("pending", "held"),
            ScheduledSend.STATUSES.filter { ScheduledSend.isLive(it) },
        )
    }
}
