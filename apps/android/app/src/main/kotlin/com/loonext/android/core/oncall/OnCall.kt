package com.loonext.android.core.oncall

import java.text.SimpleDateFormat
import java.util.Calendar
import java.util.Date
import java.util.Locale
import java.util.TimeZone

/**
 * #244 — the windows and the words for "who is holding the phone tonight".
 *
 * Hand-port of `packages/shared/src/on-call.ts`; `OnCallTest` carries the same
 * cases as the TS and Swift suites.
 *
 * PRESETS, NOT A DATETIME BUILDER. The decision a contractor is making is "Dana
 * has tonight", not a pair of ISO instants. A start/end picker turns a
 * five-second choice into a form, and a form does not get filled in from a van.
 */
object OnCall {

    const val EVENING_START_HOUR = 18
    const val MORNING_END_HOUR = 8

    data class Window(val startsAt: String, val endsAt: String)

    data class Preset(val key: String, val label: String, val detail: String)

    val PRESETS = listOf(
        Preset("tonight", "Tonight", "6pm until 8am tomorrow"),
        Preset("weekend", "This weekend", "Friday 6pm until Monday 8am"),
        Preset("week", "The next 7 days", "Starting now"),
    )

    /** Nobody holding it — states the CONSEQUENCE, which is the decision. */
    const val NOBODY =
        "Nobody is on call, so an after-hours call wakes everyone who can see " +
            "the number. Put one person on and the rest get a quiet night."

    const val UNTIL = "on call until"

    const val ESCALATION =
        "If they do not pick it up, everyone else is told a few minutes later."

    const val READ_ONLY = "Only an owner or admin can change who is on call."

    fun line(name: String, until: String): String = "$name is $UNTIL $until"

    /**
     * Turn a preset into a real window.
     *
     * `offsetMinutes` is the crew's offset from UTC, passed in rather than
     * resolved here so the three ports only have to agree about arithmetic and
     * not about a tz database.
     */
    fun window(preset: String, now: Date, offsetMinutes: Int): Window {
        val nowMs = now.time
        val localMs = nowMs + offsetMinutes * 60_000L
        val utc = TimeZone.getTimeZone("UTC")
        val cal = Calendar.getInstance(utc).apply { timeInMillis = localMs }
        val startOfLocalDay = Calendar.getInstance(utc).apply {
            timeInMillis = localMs
            set(Calendar.HOUR_OF_DAY, 0)
            set(Calendar.MINUTE, 0)
            set(Calendar.SECOND, 0)
            set(Calendar.MILLISECOND, 0)
        }.timeInMillis

        if (preset == "week") {
            return Window(iso(nowMs), iso(nowMs + 7 * 86_400_000L))
        }

        if (preset == "weekend") {
            // ALREADY the weekend means THIS one. Booking eight days out would
            // leave tonight uncovered by the very action taken to cover it.
            val weekday = cal.get(Calendar.DAY_OF_WEEK) - 1 // 0 = Sunday
            val daysToFriday = when (weekday) {
                6 -> -1
                0 -> -2
                else -> 5 - weekday
            }
            val friday = startOfLocalDay + daysToFriday * 86_400_000L
            return Window(
                toUtc(friday + EVENING_START_HOUR * 3_600_000L, offsetMinutes),
                toUtc(
                    friday + 3 * 86_400_000L + MORNING_END_HOUR * 3_600_000L,
                    offsetMinutes,
                ),
            )
        }

        // Past 6pm already, it starts NOW rather than retroactively — a
        // backdated shift claims responsibility for hours nobody was holding.
        val eveningStart = startOfLocalDay + EVENING_START_HOUR * 3_600_000L
        val start = if (localMs > eveningStart) localMs else eveningStart
        return Window(
            toUtc(start, offsetMinutes),
            toUtc(
                startOfLocalDay + 86_400_000L + MORNING_END_HOUR * 3_600_000L,
                offsetMinutes,
            ),
        )
    }

    private fun toUtc(local: Long, offsetMinutes: Int): String =
        iso(local - offsetMinutes * 60_000L)

    private fun iso(millis: Long): String {
        // Locale.US and an explicit UTC zone for the same reason the rating
        // formatter pins its locale: a device in another locale would otherwise
        // emit a string the API cannot parse, on that device only.
        val format = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US)
        format.timeZone = TimeZone.getTimeZone("UTC")
        return format.format(Date(millis))
    }
}
