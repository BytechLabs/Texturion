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

    // -- #244 the unclaimed-page banner ------------------------------------

    /** Unclaimed. Says what is owed, not what happened. */
    const val BANNER_WAITING = "Nobody has picked this up yet"

    /** The action. First person, because that is what tapping it means. */
    const val BANNER_CLAIM = "I have this"

    /** Claimed by somebody else — the sentence that stops a second callback. */
    const val BANNER_TAKEN = "has this"

    /** Claimed by you. Confirms it stuck, and that the others were told. */
    const val BANNER_YOURS = "You have this. The rest of the crew has been told."

    fun alertTakenLine(name: String): String = "$name $BANNER_TAKEN"

    // -- #244 a member's own quiet hours -----------------------------------

    const val QUIET_HEADING = "Quiet hours"

    /**
     * THE LOAD-BEARING SENTENCE. The reason people do not set quiet hours is
     * the fear of missing the emergency, so a control that offers silence
     * without saying what still gets through does not get switched on — and
     * the member goes back to turning notifications off entirely.
     */
    const val QUIET_REASSURANCE =
        "Your phone stays quiet for ordinary messages. If you are on call, or " +
            "an alert nobody picked up widens to the crew, it still comes through."

    const val QUIET_OFF = "Off — every notification reaches you at any hour."

    const val QUIET_ON = "Quiet from"

    const val QUIET_SCOPE = "This applies to this workspace only."

    /** The window most people want, offered rather than imposed. */
    const val QUIET_DEFAULT_FROM = "22:00"
    const val QUIET_DEFAULT_TO = "07:00"

    fun quietHoursLine(from: String, to: String): String = "$QUIET_ON $from to $to"

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
