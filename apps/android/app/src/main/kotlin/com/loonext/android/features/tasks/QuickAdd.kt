package com.loonext.android.features.tasks

import java.time.Instant
import java.time.LocalDate
import java.time.YearMonth
import java.time.ZoneId
import java.time.format.DateTimeFormatter

/**
 * #689 A: the quick-add line.
 *
 *   "Fix furnace @rehman tomorrow 9am #urgent"
 *
 * becomes a title, one person, a due time, a priority and labels. Nothing here
 * saves anything: it returns what it understood, and the screen shows that as a
 * preview the member confirms.
 *
 * Hand port of `packages/shared/src/quick-add.ts`; the rules are written out in
 * its header and the vectors in `packages/shared/vectors/quick-add.json` are run
 * by `QuickAddVectorsTest`. No look-behind and no word-boundary escape: `\b` is a
 * backspace in a Kotlin string, so the words are split by hand and matched with
 * anchored patterns. All wall-clock times are the MEMBER's zone.
 */
data class QuickAddMember(val userId: String, val name: String)

data class QuickAddLabel(val id: String, val name: String)

data class QuickAddContext(
    /** The instant the line is typed. */
    val now: Instant,
    /** IANA zone of the member who is typing. */
    val timeZone: String,
    /** The member typing, for "@me". */
    val selfUserId: String,
    val members: List<QuickAddMember>,
    val labels: List<QuickAddLabel>,
)

data class QuickAddUnderstood(
    /** "assignee", "due", "priority" or "label". */
    val kind: String,
    /** The words as typed. */
    val text: String,
)

data class QuickAddResult(
    /** What is left once everything understood is taken out. */
    val title: String,
    val assignee: QuickAddMember?,
    /** UTC instant, ISO 8601, or null. */
    val dueAt: String?,
    /** True when the line named a time of day. */
    val dueHasTime: Boolean,
    val priority: String?,
    val labels: List<QuickAddLabel>,
    val understood: List<QuickAddUnderstood>,
    /** Words that looked like a mention or a label and matched nothing; they stay in the title. */
    val ignored: List<String>,
)

private val PRIORITY_WORDS = mapOf(
    "urgent" to "urgent",
    "high" to "high",
    "low" to "low",
    "normal" to "normal",
)

private val WEEKDAYS = mapOf(
    "sunday" to 0, "sun" to 0,
    "monday" to 1, "mon" to 1,
    "tuesday" to 2, "tue" to 2, "tues" to 2,
    "wednesday" to 3, "wed" to 3,
    "thursday" to 4, "thu" to 4, "thur" to 4, "thurs" to 4,
    "friday" to 5, "fri" to 5,
    "saturday" to 6, "sat" to 6,
)

private val MONTHS = mapOf(
    "jan" to 1, "january" to 1, "feb" to 2, "february" to 2, "mar" to 3, "march" to 3,
    "apr" to 4, "april" to 4, "may" to 5, "jun" to 6, "june" to 6, "jul" to 7, "july" to 7,
    "aug" to 8, "august" to 8, "sep" to 9, "sept" to 9, "september" to 9,
    "oct" to 10, "october" to 10, "nov" to 11, "november" to 11, "dec" to 12, "december" to 12,
)

private const val DEFAULT_HOUR = 9
private const val AFTERNOON_HOUR = 17
private const val TONIGHT_HOUR = 18
private const val MINUTE_MS = 60_000L
private const val HOUR_MS = 3_600_000L

/** What a JavaScript `\s` matches, so the words split exactly as the web's do. */
private val WHITESPACE = Regex("""[\s   -     　﻿]+""")

private val CLOCK_AMPM = Regex("""^(\d{1,2})(?::(\d{2}))?(am|pm)$""")
private val CLOCK_24 = Regex("""^(\d{1,2}):(\d{2})$""")
private val BARE_HOUR = Regex("""^(\d{1,2})$""")
private val ORDINAL_DAY = Regex("""^(\d{1,2})(?:st|nd|rd|th)?$""")
private val AMOUNT = Regex("""^(\d{1,3})$""")
private val MINUTES = Regex("""^(minutes?|mins?)$""")
private val HOURS = Regex("""^(hours?|hrs?)$""")
private val DAYS = Regex("""^(days?)$""")
private val WEEKS = Regex("""^(weeks?)$""")
private val ISO_DATE = Regex("""^(\d{4})-(\d{2})-(\d{2})$""")
private val TASK_TAG = Regex("""^t-\d{1,9}$""")
private val CONTACT_TAG = Regex("""^contact-[0-9a-f]{8}$""")
private val CONV_TAG = Regex("""^conv-[0-9a-f]{8}$""")

private val ISO_MILLIS: DateTimeFormatter =
    DateTimeFormatter.ofPattern("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'").withZone(ZoneId.of("UTC"))

private data class Clock(val h: Int, val mi: Int)

private data class Word(val raw: String, val low: String)

private sealed interface DateHit {
    val words: Int

    data class Civil(val civil: LocalDate, override val words: Int) : DateHit
    data class At(val instant: Long, override val words: Int) : DateHit
    data class Tonight(val civil: LocalDate, override val words: Int) : DateHit
}

private fun weekdayOf(date: LocalDate): Int = date.dayOfWeek.value % 7

private fun civilKey(c: LocalDate): Int = c.year * 10000 + c.monthValue * 100 + c.dayOfMonth

/** The instant at which a zone's wall clock reads this civil date and time. */
private fun zonedToInstant(civil: LocalDate, clock: Clock, zone: ZoneId): Long {
    fun offsetAt(instant: Long): Long =
        zone.rules.getOffset(Instant.ofEpochMilli(instant)).totalSeconds * 1000L

    val guess = civil.atTime(clock.h, clock.mi).toEpochSecond(java.time.ZoneOffset.UTC) * 1000L
    var instant = guess - offsetAt(guess)
    // Across a daylight-saving change the offset at the guess is not the offset
    // at the answer; one more step settles it.
    val corrected = guess - offsetAt(instant)
    if (corrected != instant) instant = corrected
    return instant
}

private fun stripTail(text: String): String = text.trimEnd { it in ",.;!?)" }

private fun toWords(line: String): List<Word> =
    line.split(WHITESPACE)
        .filter { it.isNotEmpty() }
        .map { Word(it, stripTail(it).lowercase()) }

/** A time of day written as one word: 9am, 9:30pm, 14:00, noon. */
private fun parseClockWord(low: String): Clock? {
    if (low == "noon") return Clock(12, 0)
    CLOCK_AMPM.find(low)?.let { m ->
        val hour = m.groupValues[1].toInt()
        val minute = if (m.groupValues[2].isEmpty()) 0 else m.groupValues[2].toInt()
        if (hour < 1 || hour > 12 || minute > 59) return null
        return Clock((hour % 12) + (if (m.groupValues[3] == "pm") 12 else 0), minute)
    }
    CLOCK_24.find(low)?.let { m ->
        val hour = m.groupValues[1].toInt()
        val minute = m.groupValues[2].toInt()
        if (hour > 23 || minute > 59) return null
        return Clock(hour, minute)
    }
    return null
}

/** "at 9": the hour alone, read the way a trade day is read. */
private fun parseBareHour(low: String): Clock? {
    val m = BARE_HOUR.find(low) ?: return null
    val hour = m.groupValues[1].toInt()
    if (hour < 1 || hour > 23) return null
    if (hour >= 13) return Clock(hour, 0)
    if (hour == 12) return Clock(12, 0)
    return Clock(if (hour <= 6) hour + 12 else hour, 0)
}

private fun ordinalDay(low: String): Int? {
    val m = ORDINAL_DAY.find(low) ?: return null
    val day = m.groupValues[1].toInt()
    return if (day in 1..31) day else null
}

/** The next time this month and day come round, today included; null when no year has it. */
private fun nextOccurrence(month: Int, day: Int, today: LocalDate): LocalDate? {
    for (year in today.year..today.year + 4) {
        if (day > YearMonth.of(year, month).lengthOfMonth()) continue
        val candidate = LocalDate.of(year, month, day)
        if (civilKey(candidate) >= civilKey(today)) return candidate
    }
    return null
}

/** The date phrase that starts at `i`, if any. */
private fun dateAt(words: List<Word>, i: Int, today: LocalDate, now: Long): DateHit? {
    val w = words[i].low
    fun next(offset: Int): String? = words.getOrNull(i + offset)?.low
    val todayWeekday = weekdayOf(today)

    if (w == "today") return DateHit.Civil(today, 1)
    if (w == "tomorrow" || w == "tmrw" || w == "tmr") return DateHit.Civil(today.plusDays(1), 1)
    if (w == "tonight") return DateHit.Tonight(today, 1)

    if (w == "next" && next(1) == "week") {
        val toMonday = ((8 - todayWeekday) % 7).let { if (it == 0) 7 else it }
        return DateHit.Civil(today.plusDays(toMonday.toLong()), 2)
    }
    val second = next(1)
    if ((w == "next" || w == "this") && second != null && WEEKDAYS[second] != null) {
        val target = WEEKDAYS.getValue(second)
        if (w == "this") {
            val ahead = ((target - todayWeekday + 7) % 7).let { if (it == 0) 7 else it }
            return DateHit.Civil(today.plusDays(ahead.toLong()), 2)
        }
        val toMonday = ((8 - todayWeekday) % 7).let { if (it == 0) 7 else it }
        val fromMonday = (target + 6) % 7
        return DateHit.Civil(today.plusDays((toMonday + fromMonday).toLong()), 2)
    }
    WEEKDAYS[w]?.let { target ->
        val ahead = ((target - todayWeekday + 7) % 7).let { if (it == 0) 7 else it }
        return DateHit.Civil(today.plusDays(ahead.toLong()), 1)
    }

    val third = next(2)
    if (w == "in" && second != null && third != null) {
        val amount = AMOUNT.find(second)
        if (amount != null) {
            val n = amount.groupValues[1].toLong()
            if (n >= 1) {
                if (MINUTES.matches(third)) return DateHit.At(now + n * MINUTE_MS, 3)
                if (HOURS.matches(third)) return DateHit.At(now + n * HOUR_MS, 3)
                if (DAYS.matches(third)) return DateHit.Civil(today.plusDays(n), 3)
                if (WEEKS.matches(third)) return DateHit.Civil(today.plusDays(n * 7), 3)
            }
        }
    }

    ISO_DATE.find(w)?.let { m ->
        val y = m.groupValues[1].toInt()
        val mo = m.groupValues[2].toInt()
        val d = m.groupValues[3].toInt()
        if (mo in 1..12 && d >= 1 && d <= YearMonth.of(y, mo).lengthOfMonth()) {
            return DateHit.Civil(LocalDate.of(y, mo, d), 1)
        }
        return null
    }

    // "nov 12" and "12 nov": the next such date on or after today.
    val monthFirst = MONTHS[w]
    val dayAfter = second?.let { ordinalDay(it) }
    if (monthFirst != null && dayAfter != null) {
        return nextOccurrence(monthFirst, dayAfter, today)?.let { DateHit.Civil(it, 2) }
    }
    val dayFirst = ordinalDay(w)
    val monthAfter = second?.let { MONTHS[it] }
    if (dayFirst != null && monthAfter != null) {
        return nextOccurrence(monthAfter, dayFirst, today)?.let { DateHit.Civil(it, 2) }
    }
    return null
}

private fun isReferenceTag(tag: String): Boolean =
    TASK_TAG.matches(tag) || CONTACT_TAG.matches(tag) || CONV_TAG.matches(tag)

/** The one member the query names, or null when it names none or several. */
private fun matchMember(members: List<QuickAddMember>, query: String): QuickAddMember? {
    val q = stripTail(query)
    if (q.isEmpty()) return null
    fun parts(m: QuickAddMember): List<String> = m.name.lowercase().split(WHITESPACE)
    val exactFirst = members.filter { parts(it)[0] == q }
    if (exactFirst.size == 1) return exactFirst[0]
    val starts = members.filter { m -> parts(m).any { it.startsWith(q) } }
    if (starts.size == 1) return starts[0]
    val whole = members.filter { m -> m.name.lowercase().replace(WHITESPACE, "").startsWith(q) }
    return if (whole.size == 1) whole[0] else null
}

fun parseQuickAdd(line: String, ctx: QuickAddContext): QuickAddResult {
    val words = toWords(line)
    val zone = ZoneId.of(ctx.timeZone)
    val now = ctx.now.toEpochMilli()
    val today = ctx.now.atZone(zone).toLocalDate()
    val todayKey = civilKey(today)

    val kept: Array<String?> = Array(words.size) { words[it].raw }
    val understood = mutableListOf<QuickAddUnderstood>()
    val ignored = mutableListOf<String>()
    val labels = mutableListOf<QuickAddLabel>()
    var assignee: QuickAddMember? = null
    var priority: String? = null

    var dateHit: DateHit? = null
    var dateText = ""
    var clock: Clock? = null
    var clockText = ""

    fun take(from: Int, count: Int): String {
        val text = words.subList(from, from + count).joinToString(" ") { it.raw }
        for (k in from until from + count) kept[k] = null
        return text
    }

    var i = 0
    while (i < words.size) {
        val word = words[i]
        val low = word.low

        if (low.startsWith("@") && low.length > 1) {
            val query = low.substring(1)
            val found = if (query == "me") {
                ctx.members.firstOrNull { it.userId == ctx.selfUserId }
            } else {
                matchMember(ctx.members, query)
            }
            if (found != null && assignee == null) {
                assignee = found
                understood += QuickAddUnderstood("assignee", take(i, 1))
            } else if (found == null) {
                ignored += word.raw
            }
            i += 1
            continue
        }

        if (low.startsWith("#") && low.length > 1) {
            val tag = low.substring(1)
            if (isReferenceTag(tag)) {
                i += 1
                continue
            }
            val named = PRIORITY_WORDS[tag]
            if (named != null) {
                if (priority == null) {
                    priority = named
                    understood += QuickAddUnderstood("priority", take(i, 1))
                }
                i += 1
                continue
            }
            val label = ctx.labels.firstOrNull { it.name.lowercase() == tag }
            if (label != null) {
                if (labels.none { it.id == label.id }) {
                    labels += label
                    understood += QuickAddUnderstood("label", take(i, 1))
                } else {
                    take(i, 1)
                }
            } else {
                ignored += word.raw
            }
            i += 1
            continue
        }

        if (dateHit == null) {
            val hit = dateAt(words, i, today, now)
            if (hit != null) {
                dateHit = hit
                dateText = take(i, hit.words)
                i += hit.words
                continue
            }
        }

        if (clock == null) {
            var found = parseClockWord(low)
            var consumed = 1
            if (found == null && low == "at" && words.getOrNull(i + 1) != null) {
                val after = words[i + 1].low
                found = parseClockWord(after) ?: parseBareHour(after)
                consumed = 2
            }
            if (found != null) {
                clock = found
                clockText = take(i, consumed)
                i += consumed
                continue
            }
        }
        i += 1
    }

    var dueAt: String? = null
    var dueHasTime = false
    val hit = dateHit
    val at = clock
    if (hit != null || at != null) {
        var instant: Long
        if (hit is DateHit.At) {
            instant = hit.instant
            dueHasTime = true
            if (at != null) {
                val wall = Instant.ofEpochMilli(instant).atZone(zone).toLocalDate()
                instant = zonedToInstant(wall, at, zone)
            }
        } else if (hit != null) {
            val civil = when (hit) {
                is DateHit.Civil -> hit.civil
                is DateHit.Tonight -> hit.civil
                is DateHit.At -> today
            }
            if (at != null) {
                instant = zonedToInstant(civil, at, zone)
                dueHasTime = true
            } else if (hit is DateHit.Tonight) {
                instant = zonedToInstant(civil, Clock(TONIGHT_HOUR, 0), zone)
                dueHasTime = true
            } else {
                instant = zonedToInstant(civil, Clock(DEFAULT_HOUR, 0), zone)
                if (civilKey(civil) == todayKey && instant <= now) {
                    instant = zonedToInstant(civil, Clock(AFTERNOON_HOUR, 0), zone)
                }
            }
        } else {
            val only = at as Clock
            instant = zonedToInstant(today, only, zone)
            if (instant <= now) instant = zonedToInstant(today.plusDays(1), only, zone)
            dueHasTime = true
        }
        dueAt = ISO_MILLIS.format(Instant.ofEpochMilli(instant))
        understood += QuickAddUnderstood(
            "due",
            listOf(dateText, clockText).filter { it.isNotEmpty() }.joinToString(" "),
        )
    }

    val title = kept.filterNotNull().joinToString(" ")
    return QuickAddResult(title, assignee, dueAt, dueHasTime, priority, labels, understood, ignored)
}
