package com.loonext.android.core.oncall

import java.util.Date
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * #244 — the same cases as `on-call.test.ts` and `OnCallTests`.
 *
 * The two that matter are silent: a backdated shift claims hours nobody was
 * holding, and a weekend booked eight days out leaves tonight uncovered by the
 * very action taken to cover it. Neither produces an error — they produce a
 * phone that does not ring.
 */
class OnCallTest {

    /** Toronto in August: UTC-4. */
    private val toronto = -240

    private fun localOf(iso: String): String {
        val millis = java.text.SimpleDateFormat(
            "yyyy-MM-dd'T'HH:mm:ss.SSS'Z'",
            java.util.Locale.US,
        ).apply { timeZone = java.util.TimeZone.getTimeZone("UTC") }
            .parse(iso)!!.time
        return java.text.SimpleDateFormat(
            "yyyy-MM-dd'T'HH:mm",
            java.util.Locale.US,
        ).apply { timeZone = java.util.TimeZone.getTimeZone("UTC") }
            .format(Date(millis + toronto * 60_000L))
    }

    /** Wednesday 2026-08-05, 14:00 local. */
    private val wednesdayAfternoon = Date(1786_000_000_000L).let {
        java.text.SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss'Z'", java.util.Locale.US)
            .apply { timeZone = java.util.TimeZone.getTimeZone("UTC") }
            .parse("2026-08-05T18:00:00Z")!!
    }

    private fun at(iso: String): Date =
        java.text.SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss'Z'", java.util.Locale.US)
            .apply { timeZone = java.util.TimeZone.getTimeZone("UTC") }
            .parse(iso)!!

    @Test
    fun `tonight is 6pm to 8am in the crew's own clock`() {
        val window = OnCall.window("tonight", wednesdayAfternoon, toronto)

        assertEquals("2026-08-05T18:00", localOf(window.startsAt))
        assertEquals("2026-08-06T08:00", localOf(window.endsAt))
    }

    @Test
    fun `set after 6pm it starts now rather than retroactively`() {
        // A shift backdated to 6pm would claim responsibility for hours nobody
        // was holding — including a call that already woke the whole crew.
        val window = OnCall.window("tonight", at("2026-08-06T01:00:00Z"), toronto)

        assertEquals("2026-08-05T21:00", localOf(window.startsAt))
        assertEquals("2026-08-06T08:00", localOf(window.endsAt))
    }

    @Test
    fun `this weekend set on the weekend means this one`() {
        val window = OnCall.window("weekend", at("2026-08-08T13:00:00Z"), toronto)

        assertEquals("2026-08-07T18:00", localOf(window.startsAt))
        assertEquals("2026-08-10T08:00", localOf(window.endsAt))
    }

    @Test
    fun `midweek this weekend is the coming friday`() {
        val window = OnCall.window("weekend", wednesdayAfternoon, toronto)

        assertEquals("2026-08-07T18:00", localOf(window.startsAt))
        assertEquals("2026-08-10T08:00", localOf(window.endsAt))
    }

    @Test
    fun `every window ends after it starts in every timezone we sell to`() {
        // The API refuses a backwards window with a 422, so a preset producing
        // one is a button that never works — in one timezone only, which is how
        // it would reach a customer.
        for (offset in listOf(-480, -420, -360, -300, -240, -210, -180)) {
            for (preset in listOf("tonight", "weekend", "week")) {
                for (day in 3..9) {
                    val now = at("2026-08-0${day}T13:00:00Z")
                    val window = OnCall.window(preset, now, offset)
                    assertTrue(
                        "$preset at offset $offset on the ${day}th",
                        isoMillis(window.endsAt) > isoMillis(window.startsAt),
                    )
                }
            }
        }
    }

    private fun isoMillis(iso: String): Long =
        java.text.SimpleDateFormat(
            "yyyy-MM-dd'T'HH:mm:ss.SSS'Z'",
            java.util.Locale.US,
        ).apply { timeZone = java.util.TimeZone.getTimeZone("UTC") }
            .parse(iso)!!.time
}
