package com.loonext.android.core.oncall

import com.loonext.android.core.i18n.AppStrings
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

    /**
     * #228 — how every sentence in this object reaches a reader.
     *
     * `t()` is `@Composable` and this object is not: it is a plain `object`
     * whose constants are read at class-init, long before any composition
     * exists. So each sentence is a KEY, resolved by a function that takes the
     * reader's language LAST and DEFAULTED — the shape `AppLock.headline` and
     * `ongoingStatusLabel` already use.
     *
     * The old `const val` names are kept as properties over those functions, so
     * a call site that has not been given a reader keeps rendering exactly what
     * it rendered before rather than a bare key. A screen that HAS one should
     * move to the `…_KEY` constant and `t()`, or to the locale-taking function
     * beside it.
     */
    private fun say(key: String, locale: String? = null): String =
        AppStrings.translate(locale, key)

    const val PRESET_TONIGHT_KEY = "domain.onCallPresetTonight"
    const val PRESET_TONIGHT_DETAIL_KEY = "domain.onCallPresetTonightDetail"
    const val PRESET_WEEKEND_KEY = "domain.onCallPresetWeekend"
    const val PRESET_WEEKEND_DETAIL_KEY = "domain.onCallPresetWeekendDetail"
    const val PRESET_WEEK_KEY = "domain.onCallPresetWeek"
    const val PRESET_WEEK_DETAIL_KEY = "domain.onCallPresetWeekDetail"

    /** The three offers, in the reader's language. */
    fun presets(locale: String? = null): List<Preset> = listOf(
        Preset("tonight", say(PRESET_TONIGHT_KEY, locale), say(PRESET_TONIGHT_DETAIL_KEY, locale)),
        Preset("weekend", say(PRESET_WEEKEND_KEY, locale), say(PRESET_WEEKEND_DETAIL_KEY, locale)),
        Preset("week", say(PRESET_WEEK_KEY, locale), say(PRESET_WEEK_DETAIL_KEY, locale)),
    )

    val PRESETS: List<Preset> get() = presets()

    /** Nobody holding it — states the CONSEQUENCE, which is the decision. */
    const val NOBODY_KEY = "domain.onCallNobody"
    val NOBODY: String get() = say(NOBODY_KEY)

    const val UNTIL_KEY = "domain.onCallUntil"
    val UNTIL: String get() = say(UNTIL_KEY)

    const val ESCALATION_KEY = "domain.onCallEscalation"
    val ESCALATION: String get() = say(ESCALATION_KEY)

    const val READ_ONLY_KEY = "domain.onCallReadOnly"
    val READ_ONLY: String get() = say(READ_ONLY_KEY)

    /**
     * One whole sentence rather than a name glued to a fragment: the verb sits
     * in a different place in the two languages, and a sentence assembled from
     * pieces can only ever be assembled in one word order.
     */
    fun line(name: String, until: String, locale: String? = null): String =
        AppStrings.translate(
            locale,
            "domain.onCallLine",
            mapOf("name" to name, "until" to until),
        )

    // -- #244 the unclaimed-page banner ------------------------------------

    /** Unclaimed. Says what is owed, not what happened. */
    const val BANNER_WAITING_KEY = "domain.onCallBannerWaiting"
    val BANNER_WAITING: String get() = say(BANNER_WAITING_KEY)

    /** The action. First person, because that is what tapping it means. */
    const val BANNER_CLAIM_KEY = "domain.onCallBannerClaim"
    val BANNER_CLAIM: String get() = say(BANNER_CLAIM_KEY)

    /** Claimed by somebody else — the sentence that stops a second callback. */
    const val BANNER_TAKEN_KEY = "domain.onCallBannerTaken"
    val BANNER_TAKEN: String get() = say(BANNER_TAKEN_KEY)

    /** Claimed by you. Confirms it stuck, and that the others were told. */
    const val BANNER_YOURS_KEY = "domain.onCallBannerYours"
    val BANNER_YOURS: String get() = say(BANNER_YOURS_KEY)

    fun alertTakenLine(name: String, locale: String? = null): String =
        AppStrings.translate(locale, "domain.onCallTakenLine", mapOf("name" to name))

    // -- #244 a member's own quiet hours -----------------------------------

    const val QUIET_HEADING_KEY = "domain.quietHoursHeading"
    val QUIET_HEADING: String get() = say(QUIET_HEADING_KEY)

    /**
     * THE LOAD-BEARING SENTENCE. The reason people do not set quiet hours is
     * the fear of missing the emergency, so a control that offers silence
     * without saying what still gets through does not get switched on — and
     * the member goes back to turning notifications off entirely.
     */
    const val QUIET_REASSURANCE_KEY = "domain.quietHoursReassurance"
    val QUIET_REASSURANCE: String get() = say(QUIET_REASSURANCE_KEY)

    const val QUIET_OFF_KEY = "domain.quietHoursOff"
    val QUIET_OFF: String get() = say(QUIET_OFF_KEY)

    const val QUIET_ON_KEY = "domain.quietHoursOn"
    val QUIET_ON: String get() = say(QUIET_ON_KEY)

    const val QUIET_SCOPE_KEY = "domain.quietHoursScope"
    val QUIET_SCOPE: String get() = say(QUIET_SCOPE_KEY)

    /** The window most people want, offered rather than imposed. */
    const val QUIET_DEFAULT_FROM = "22:00"
    const val QUIET_DEFAULT_TO = "07:00"

    /** One sentence, for the same reason [line] is one. */
    fun quietHoursLine(from: String, to: String, locale: String? = null): String =
        AppStrings.translate(
            locale,
            "domain.quietHoursLine",
            mapOf("from" to from, "to" to to),
        )

    // -- #297 how loud each kind of notification is ------------------------

    const val DELIVERY_HEADING_KEY = "domain.deliveryHeading"
    val DELIVERY_HEADING: String get() = say(DELIVERY_HEADING_KEY)

    /**
     * THE PROMISE THAT MAKES A QUIETER SETTING PICKABLE. Without it nobody
     * chooses one, because the fear is missing the call that mattered — and
     * they go back to turning notifications off entirely.
     */
    const val DELIVERY_URGENT_ALWAYS_KEY = "domain.deliveryUrgentAlways"
    val DELIVERY_URGENT_ALWAYS: String get() = say(DELIVERY_URGENT_ALWAYS_KEY)

    const val DELIVERY_IMMEDIATE_KEY = "domain.deliveryImmediate"
    const val DELIVERY_BATCHED_KEY = "domain.deliveryBatched"
    const val DELIVERY_SUMMARY_KEY = "domain.deliverySummary"
    val DELIVERY_IMMEDIATE: String get() = say(DELIVERY_IMMEDIATE_KEY)
    val DELIVERY_BATCHED: String get() = say(DELIVERY_BATCHED_KEY)
    val DELIVERY_SUMMARY: String get() = say(DELIVERY_SUMMARY_KEY)

    /** Said next to "Once a day", the option people misread as off. */
    const val DELIVERY_SUMMARY_DETAIL_KEY = "domain.deliverySummaryDetail"
    val DELIVERY_SUMMARY_DETAIL: String get() = say(DELIVERY_SUMMARY_DETAIL_KEY)

    /**
     * The categories, in the words a member would use.
     *
     * The KEYS are the stored vocabulary and never change; the labels beside
     * them are what a person reads. Ordered, because the order is the order the
     * rows are drawn in.
     */
    val CATEGORY_KEYS = linkedMapOf(
        "messages_mine" to "domain.categoryMessagesMine",
        "messages_all" to "domain.categoryMessagesAll",
        "mentions" to "domain.categoryMentions",
        "assignments" to "domain.categoryAssignments",
        "missed_calls" to "domain.categoryMissedCalls",
        "voicemails" to "domain.categoryVoicemails",
    )

    fun categoryLabels(locale: String? = null): Map<String, String> =
        CATEGORY_KEYS.mapValues { (_, key) -> say(key, locale) }

    val CATEGORY_LABELS: Map<String, String> get() = categoryLabels()

    val DELIVERY_MODES = listOf("immediate", "batched", "summary")

    val BATCH_WINDOW_CHOICES = listOf(5, 15, 30, 60)

    const val DEFAULT_BATCH_WINDOW = 15

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
