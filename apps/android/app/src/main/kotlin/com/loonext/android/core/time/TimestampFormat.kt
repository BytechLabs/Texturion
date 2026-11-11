package com.loonext.android.core.time

import com.loonext.android.core.i18n.AppStrings
import com.loonext.android.core.model.MessageLocale
import java.time.Instant
import java.time.ZoneId
import java.time.ZonedDateTime
import java.time.format.DateTimeFormatter
import java.time.format.FormatStyle
import java.util.Locale

/**
 * #720: the ONE place this app draws a date or a time a person reads.
 *
 * The label comes from [timestampShape] ("now", "12m", "3:42 PM", "Yesterday",
 * "Sat", "Sep 9", "Sep 9, 2025"); [exact] is the full moment with its zone
 * ("Tue, Nov 10, 2026, 3:42 PM EST") for a long-press and for a screen reader.
 * `TimestampGuardTest` fails on any other file drawing a date itself.
 */
object TimestampFormat {
    /** The one compact label ("12m"), which a screen reader cannot say. */
    private val MINUTES_LABEL = Regex("""\d+m""")

    enum class Style { SHORT, LONG }

    /**
     * The reader's language for callers that have no composition to read it
     * from. MainActivity keeps it in step with `LocalAppLocale`.
     */
    @Volatile
    var readerLocale: String = MessageLocale.DEFAULT

    private fun tagOf(locale: String?): Locale =
        Locale.forLanguageTag(locale ?: readerLocale)

    private fun isFrench(tag: Locale) = tag.language == "fr"

    /** The server sends Z; a due time may carry an offset ("-04:00"). */
    private fun parse(iso: String?): Instant? = iso?.let { text ->
        runCatching { Instant.parse(text) }.recoverCatching {
            java.time.OffsetDateTime.parse(text).toInstant()
        }.getOrNull()
    }

    /** "3:42 PM" in English, the locale's own short time elsewhere ("15 h 42"). */
    private fun drawClock(at: ZonedDateTime, tag: Locale): String =
        if (isFrench(tag)) {
            at.format(DateTimeFormatter.ofLocalizedTime(FormatStyle.SHORT).withLocale(tag))
        } else {
            at.format(DateTimeFormatter.ofPattern("h:mm a", Locale.ENGLISH))
        }

    /** A time of day alone ("3:42 PM"), for a clock that sits under a heading that names the day. */
    fun clock(at: ZonedDateTime, locale: String? = null): String = drawClock(at, tagOf(locale))

    fun clock(at: Instant, zone: ZoneId, locale: String? = null): String =
        clock(at.atZone(zone), locale)

    /** A wall-clock time with no date or zone, such as the hour where a number is. */
    fun clock(at: java.time.LocalTime, locale: String? = null): String =
        clock(at.atDate(java.time.LocalDate.EPOCH).atZone(ZoneId.of("UTC")), locale)

    private fun draw(at: ZonedDateTime, tag: Locale, english: String, french: String): String =
        at.format(DateTimeFormatter.ofPattern(if (isFrench(tag)) french else english, tag))

    /** A bad or absent timestamp is blank, never "Invalid Date". */
    fun label(
        iso: String?,
        style: Style = Style.SHORT,
        locale: String? = null,
        now: Instant = Instant.now(),
        zone: ZoneId = ZoneId.systemDefault(),
    ): String {
        val instant = parse(iso) ?: return ""
        val tag = tagOf(locale)
        val key = locale ?: readerLocale
        val at = instant.atZone(zone)
        val long = style == Style.LONG
        val shape = timestampShape(instant.toEpochMilli(), now.toEpochMilli(), zone)
        return when (shape.bucket) {
            TimestampBucket.NOW -> AppStrings.translate(key, "time.now")
            TimestampBucket.MINUTES_AGO -> "${shape.minutes}m"
            TimestampBucket.TODAY -> drawClock(at, tag)
            TimestampBucket.YESTERDAY ->
                if (long) {
                    AppStrings.translate(key, "time.yesterdayAt", mapOf("time" to drawClock(at, tag)))
                } else {
                    AppStrings.translate(key, "time.yesterday")
                }
            TimestampBucket.TOMORROW ->
                if (long) {
                    AppStrings.translate(key, "time.tomorrowAt", mapOf("time" to drawClock(at, tag)))
                } else {
                    AppStrings.translate(key, "time.tomorrow")
                }
            TimestampBucket.THIS_WEEK -> {
                val day = draw(at, tag, "EEE", "EEE")
                if (long) "$day ${drawClock(at, tag)}" else day
            }
            TimestampBucket.THIS_YEAR -> {
                val day = draw(at, tag, "MMM d", "d MMM")
                if (long) "$day, ${drawClock(at, tag)}" else day
            }
            TimestampBucket.OLDER -> {
                val day = draw(at, tag, "MMM d, yyyy", "d MMM yyyy")
                if (long) "$day, ${drawClock(at, tag)}" else day
            }
        }
    }

    /** A plain calendar date, "Aug 8, 2026" or "8 août 2026", in the reader's zone; blank when unparseable. */
    fun calendarDate(
        iso: String?,
        locale: String? = null,
        zone: ZoneId = ZoneId.systemDefault(),
    ): String {
        val instant = parse(iso) ?: return ""
        return draw(instant.atZone(zone), tagOf(locale), "MMM d, yyyy", "d MMM yyyy")
    }

    /** "Tue, Nov 10, 2026, 3:42 PM EST": weekday, date, time and zone. */
    fun exact(
        iso: String?,
        locale: String? = null,
        zone: ZoneId = ZoneId.systemDefault(),
    ): String {
        val instant = parse(iso) ?: return ""
        val tag = tagOf(locale)
        val at = instant.atZone(zone)
        val date = draw(at, tag, "EEE, MMM d, yyyy", "EEE d MMM yyyy")
        return "$date, ${drawClock(at, tag)} ${at.format(DateTimeFormatter.ofPattern("zzz", tag))}"
    }

    /** What a screen reader says: the visible label, then the exact time. */
    fun spoken(
        iso: String?,
        locale: String? = null,
        now: Instant = Instant.now(),
        zone: ZoneId = ZoneId.systemDefault(),
    ): String {
        val exact = exact(iso, locale, zone)
        if (exact.isEmpty()) return ""
        val label = label(iso, Style.LONG, locale, now, zone)
        // "12m" is read aloud as "12 m"; the exact time says the same thing in words.
        return if (label.matches(MINUTES_LABEL)) exact else "$label, $exact"
    }
}
