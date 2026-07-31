package com.loonext.android.core.snooze

import java.time.DayOfWeek
import java.time.Instant
import java.time.LocalDateTime
import java.time.ZoneId

/**
 * #293 — when "later" is.
 *
 * A hand-port of packages/shared/src/snooze.ts, mirrored again in
 * apps/ios/Loonext/Core/SnoozeLogic.swift. A snooze set on this phone has to
 * mean the same instant as the identical tap on a laptop, so what is shared is
 * the SPEC: which presets exist, what hour each lands on, the order they are
 * offered in, the wording, and the rule that decides when one is not offered.
 *
 * The calendar arithmetic is deliberately NOT shared. It uses java.time here
 * and Foundation on iOS because only a real calendar gets DST right — "tomorrow
 * at 8" the night the clocks go forward is not "now plus 24 hours", and a
 * hand-rolled millisecond offset would be wrong twice a year in a way nobody
 * would report as a bug, only as the app being odd.
 *
 * Resolved in the DEVICE's zone, which is the user's zone (#292): the client
 * sends an absolute instant, so the server never guesses a timezone it was not
 * told, and somebody working away from home gets the morning they are in.
 */
object SnoozeTiming {
    /** The hours a deferral lands on, in the user's own clock. */
    const val MORNING_HOUR = 8
    const val AFTERNOON_HOUR = 15
    const val EVENING_HOUR = 18

    /**
     * A preset resolving nearer than this is not offered. At 14:55 "This
     * afternoon" is five minutes away — the thread would blink out and come
     * straight back, which reads as a broken feature rather than a badly
     * chosen time.
     */
    const val MIN_LEAD_MS = 10L * 60L * 1000L

    /** Snoozing further out than this is neither offered nor accepted. */
    const val MAX_DAYS = 365L

    /**
     * The reason a person leaves on a deferral, in characters. This is the
     * `char_length(note) <= 120` CHECK on conversation_snoozes, so the picker
     * stops taking characters exactly where the database stops accepting them
     * rather than turning a thoughtful note into an error on Snooze.
     */
    const val NOTE_MAX = 120
}

enum class SnoozePresetId { LATER_TODAY, THIS_EVENING, TOMORROW, NEXT_WEEK }

/** The wording, one place, so three clients cannot drift apart on it. */
val SNOOZE_PRESET_LABELS: Map<SnoozePresetId, String> = mapOf(
    SnoozePresetId.LATER_TODAY to "This afternoon",
    SnoozePresetId.THIS_EVENING to "This evening",
    SnoozePresetId.TOMORROW to "Tomorrow morning",
    SnoozePresetId.NEXT_WEEK to "Next week",
)

data class SnoozePreset(
    val id: SnoozePresetId,
    val label: String,
    /** The absolute instant it resolves to, epoch milliseconds. */
    val at: Long,
)

/** Days from [date] forward to the next Monday — never 0, always next week. */
fun daysUntilNextMonday(date: LocalDateTime): Long =
    if (date.dayOfWeek == DayOfWeek.SUNDAY) 1L
    // Monday = 1 … Saturday = 6, so Monday itself lands seven days out:
    // "next week" on a Monday is not today.
    else 8L - date.dayOfWeek.value

/**
 * The presets to offer right now, in order, already resolved.
 *
 * Anything at or before `now + MIN_LEAD_MS` is dropped rather than disabled:
 * at 4pm there is no "this afternoon" to offer, and a shorter list is a better
 * answer than a greyed-out button.
 */
fun snoozePresets(
    now: Instant = Instant.now(),
    zone: ZoneId = ZoneId.systemDefault(),
): List<SnoozePreset> {
    val local = LocalDateTime.ofInstant(now, zone)
    val floor = now.toEpochMilli() + SnoozeTiming.MIN_LEAD_MS

    fun at(addDays: Long, hour: Int): Long =
        local.toLocalDate().plusDays(addDays).atTime(hour, 0)
            .atZone(zone).toInstant().toEpochMilli()

    val candidates = listOf(
        SnoozePresetId.LATER_TODAY to at(0, SnoozeTiming.AFTERNOON_HOUR),
        SnoozePresetId.THIS_EVENING to at(0, SnoozeTiming.EVENING_HOUR),
        SnoozePresetId.TOMORROW to at(1, SnoozeTiming.MORNING_HOUR),
        SnoozePresetId.NEXT_WEEK to
            at(daysUntilNextMonday(local), SnoozeTiming.MORNING_HOUR),
    )

    return candidates
        .filter { (_, millis) -> millis > floor }
        .map { (id, millis) ->
            SnoozePreset(id, SNOOZE_PRESET_LABELS.getValue(id), millis)
        }
}

// ---------------------------------------------------------------------------
// #293 — the other ladder.
// ---------------------------------------------------------------------------

/** How a deferral comes back: quietly, or as something to chase. */
object DeferralKind {
    const val SNOOZE = "snooze"
    const val FOLLOW_UP = "follow_up"
}

enum class FollowUpPresetId { THREE_DAYS, NEXT_WEEK, TWO_WEEKS }

val FOLLOW_UP_PRESET_LABELS: Map<FollowUpPresetId, String> = mapOf(
    FollowUpPresetId.THREE_DAYS to "In 3 days",
    FollowUpPresetId.NEXT_WEEK to "Next week",
    FollowUpPresetId.TWO_WEEKS to "In 2 weeks",
)

data class FollowUpPreset(
    val id: FollowUpPresetId,
    val label: String,
    val at: Long,
)

/**
 * When to chase.
 *
 * A SEPARATE ladder from [snoozePresets], and that is the point rather than
 * duplication: "this afternoon" is a meaningful time to pick a thread back up
 * and a meaningless time to chase a quote. Deferring your own next action and
 * waiting on somebody else's answer run on different clocks, so one ladder for
 * both would put three useless options in front of whichever job you were
 * actually doing.
 *
 * All three land on the morning hour, in the user's own clock: a reminder that
 * fires at 11pm is read the next day anyway.
 */
fun followUpPresets(
    now: Instant = Instant.now(),
    zone: ZoneId = ZoneId.systemDefault(),
): List<FollowUpPreset> {
    val local = LocalDateTime.ofInstant(now, zone)
    val floor = now.toEpochMilli() + SnoozeTiming.MIN_LEAD_MS

    fun at(addDays: Long): Long =
        local.toLocalDate().plusDays(addDays).atTime(SnoozeTiming.MORNING_HOUR, 0)
            .atZone(zone).toInstant().toEpochMilli()

    return listOf(
        FollowUpPresetId.THREE_DAYS to at(3),
        FollowUpPresetId.NEXT_WEEK to at(daysUntilNextMonday(local)),
        FollowUpPresetId.TWO_WEEKS to at(14),
    )
        // Every rung here is days out, so the floor cannot bite — but it stays,
        // because the day this gains a "this evening" is the day somebody
        // discovers it silently could.
        .filter { (_, millis) -> millis > floor }
        .map { (id, millis) ->
            FollowUpPreset(id, FOLLOW_UP_PRESET_LABELS.getValue(id), millis)
        }
}

/**
 * Is a custom instant one the API will accept?
 *
 * Mirrors the route's two gates so the picker can say so before the round trip
 * instead of rendering an error the user could have been spared.
 */
fun isSnoozeTargetValid(targetMs: Long, nowMs: Long = System.currentTimeMillis()): Boolean =
    targetMs > nowMs && targetMs - nowMs <= SnoozeTiming.MAX_DAYS * 86_400_000L

/**
 * The SHAPE of a return-time label. Only the shape is decided here; the
 * formatting is the platform's, because a hand-rolled month table is how a
 * product ends up saying "Aug" to somebody whose phone is in French.
 */
enum class SnoozeReturnShape { TODAY, TOMORROW, WEEKDAY, DATE }

fun snoozeReturnShape(
    untilMs: Long,
    nowMs: Long = System.currentTimeMillis(),
    zone: ZoneId = ZoneId.systemDefault(),
): SnoozeReturnShape {
    // Day boundaries, not elapsed hours: 11pm to 1am is "tomorrow", and 1am to
    // 11pm is "today", however few or many hours that is.
    val today = LocalDateTime.ofInstant(Instant.ofEpochMilli(nowMs), zone).toLocalDate()
    val back = LocalDateTime.ofInstant(Instant.ofEpochMilli(untilMs), zone).toLocalDate()
    val days = back.toEpochDay() - today.toEpochDay()
    return when {
        days <= 0L -> SnoozeReturnShape.TODAY
        days == 1L -> SnoozeReturnShape.TOMORROW
        // Inside a week a weekday name is unambiguous and shorter than a date;
        // past that "Thursday" could be any of several, so it has to be a date.
        days < 7L -> SnoozeReturnShape.WEEKDAY
        else -> SnoozeReturnShape.DATE
    }
}

/**
 * Is this row currently deferred by the caller?
 *
 * Computed from the return time rather than the field's presence, matching the
 * server exactly: a snooze whose moment has passed is simply over, with no
 * sweep to run late. An unparseable timestamp counts as NOT deferred — hiding a
 * live thread because a date failed to parse is the one direction this must
 * never fail in.
 */
fun isSnoozed(snoozedUntil: String?, nowMs: Long = System.currentTimeMillis()): Boolean {
    val until = snoozedUntil?.let { parseInstantMillis(it) } ?: return false
    return until > nowMs
}

/** ISO-8601 → epoch millis, or null when it is not a timestamp we understand. */
fun parseInstantMillis(iso: String): Long? =
    try {
        Instant.parse(iso).toEpochMilli()
    } catch (_: java.time.format.DateTimeParseException) {
        // PostgREST renders timestamptz as "+00:00" rather than "Z", which
        // Instant.parse rejects outright.
        try {
            java.time.OffsetDateTime.parse(iso).toInstant().toEpochMilli()
        } catch (_: java.time.format.DateTimeParseException) {
            null
        }
    }

/**
 * "Back at 3:00 PM" / "Back tomorrow, 8:00 AM" / "Back Thursday, 8:00 AM" /
 * "Back 12 Aug".
 *
 * The SHAPE comes from [snoozeReturnShape]; the words come from java.time with
 * the device's locale, so a phone set to French says août rather than whatever
 * a hand-rolled month table would have said.
 */
fun snoozeReturnLabel(
    untilIso: String,
    nowMs: Long = System.currentTimeMillis(),
    zone: ZoneId = ZoneId.systemDefault(),
): String {
    val untilMs = parseInstantMillis(untilIso) ?: return "Snoozed"
    val local = LocalDateTime.ofInstant(Instant.ofEpochMilli(untilMs), zone)
    val time = local.format(
        java.time.format.DateTimeFormatter.ofLocalizedTime(
            java.time.format.FormatStyle.SHORT,
        ),
    )
    return when (snoozeReturnShape(untilMs, nowMs, zone)) {
        SnoozeReturnShape.TODAY -> "Back at $time"
        SnoozeReturnShape.TOMORROW -> "Back tomorrow, $time"
        SnoozeReturnShape.WEEKDAY -> {
            val day = local.dayOfWeek.getDisplayName(
                java.time.format.TextStyle.FULL,
                java.util.Locale.getDefault(),
            )
            "Back $day, $time"
        }
        SnoozeReturnShape.DATE ->
            "Back " + local.format(java.time.format.DateTimeFormatter.ofPattern("d MMM"))
    }
}
