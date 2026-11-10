package com.loonext.android.features.tasks

import com.loonext.android.core.i18n.AppStrings
import com.loonext.android.core.model.TaskRepeat
import com.loonext.android.core.model.TaskRepeatEnds
import java.time.DayOfWeek
import java.time.LocalDate
import java.time.format.TextStyle
import java.util.Locale
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.add
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

/**
 * #693: priority, labels and repeating jobs. Pure rules only: nothing here
 * draws, so the wire shapes and the sentences are unit-testable.
 */

object TaskPriority {
    const val NONE = "none"
    const val LOW = "low"
    const val NORMAL = "normal"
    const val HIGH = "high"
    const val URGENT = "urgent"

    /** Most pressing first, the order the pickers list them in. */
    val PICKER = listOf(URGENT, HIGH, NORMAL, LOW, NONE)

    /** An unknown or missing value reads as the default, never as a crash. */
    fun normalize(value: String?): String = value?.takeIf { it in PICKER } ?: NORMAL

    /** Only the two that ask for attention are drawn on a row or card. */
    fun isFlagged(value: String?): Boolean = value == HIGH || value == URGENT

    fun labelKey(value: String?): String = when (normalize(value)) {
        URGENT -> "contactsTasks.priorityUrgent"
        HIGH -> "contactsTasks.priorityHigh"
        LOW -> "contactsTasks.priorityLow"
        NONE -> "contactsTasks.priorityNone"
        else -> "contactsTasks.priorityNormal"
    }
}

/** The list order the filter sheet offers; [wire] null is the server default. */
enum class TaskSort(val wire: String?, val labelKey: String) {
    Created(null, "contactsTasks.sortCreated"),
    Due("due", "contactsTasks.sortDue"),
    Priority("priority", "contactsTasks.sortPriority"),
}

/** The #693 filter dimensions, carried beside the tab and chips as one value. */
data class TaskExtraFilters(
    val priorities: Set<String> = emptySet(),
    val tagId: String? = null,
    val sort: TaskSort = TaskSort.Created,
) {
    val isFiltering: Boolean get() = priorities.isNotEmpty() || tagId != null

    /** True when anything differs from the plain list. */
    val isCustom: Boolean get() = isFiltering || sort != TaskSort.Created

    /** Stable text for cache keys: the same filters always spell the same. */
    fun key(): String = listOf(
        TaskPriority.PICKER.filter { it in priorities }.joinToString(",").ifEmpty { "-" },
        tagId ?: "-",
        sort.wire ?: "-",
    ).joinToString("/")
}

/** Which occurrences an edit or a delete reaches on a repeating job. */
enum class TaskScope(val wire: String) {
    This("this"),
    Future("future"),
}

/**
 * Whether to ask "this one / this and future". Only a repeat that is still
 * producing jobs has a future; a stopped one has none to carry an edit to.
 */
fun needsScopeChoice(repeat: TaskRepeat?): Boolean = repeat != null && !repeat.stopped

/** The row/card repeat icon: a repeat that has not ended. */
fun showsRepeatIcon(repeat: TaskRepeat?): Boolean = repeat != null && !repeat.stopped

object RepeatKind {
    const val SCHEDULE = "schedule"
    const val AFTER_DONE = "after_done"
}

object RepeatUnit {
    const val DAY = "day"
    const val WEEK = "week"
    const val MONTH = "month"
    const val YEAR = "year"

    /** "After it's done" has no yearly form. */
    fun allowed(kind: String): List<String> =
        if (kind == RepeatKind.AFTER_DONE) listOf(DAY, WEEK, MONTH) else listOf(DAY, WEEK, MONTH, YEAR)
}

object RepeatEnd {
    const val NEVER = "never"
    const val ON = "on"
    const val AFTER = "after"
}

/** How a monthly schedule picks its day. */
enum class MonthlyMode { Date, Nth }

/**
 * The repeat sheet's working copy. [toRepeat] turns it into the wire rule, and
 * [problem] says why it cannot be saved yet (a schedule with no due date).
 */
data class RepeatDraft(
    val kind: String = RepeatKind.SCHEDULE,
    val unit: String = RepeatUnit.WEEK,
    val every: Int = 1,
    val weekdays: Set<Int> = emptySet(),
    val monthly: MonthlyMode = MonthlyMode.Date,
    val endKind: String = RepeatEnd.NEVER,
    val endOn: LocalDate? = null,
    val endAfter: Int = 5,
    val paused: Boolean = false,
) {
    /** Null when the draft can be saved, otherwise a catalogue key saying why not. */
    fun problem(due: LocalDate?): String? = when {
        kind == RepeatKind.SCHEDULE && due == null -> "contactsTasks.repeatNeedsDue"
        kind == RepeatKind.AFTER_DONE && unit == RepeatUnit.YEAR -> "contactsTasks.repeatNoYearly"
        every < 1 -> "contactsTasks.repeatEveryMin"
        endKind == RepeatEnd.ON && endOn == null -> "contactsTasks.repeatNeedsEndDate"
        endKind == RepeatEnd.AFTER && endAfter < 1 -> "contactsTasks.repeatEveryMin"
        else -> null
    }

    /** [due] anchors the weekday / day-of-month / nth-weekday a bare choice means. */
    fun toRepeat(due: LocalDate?): TaskRepeat {
        val schedule = kind == RepeatKind.SCHEDULE
        val days = if (schedule && unit == RepeatUnit.WEEK) {
            weekdays.sorted().ifEmpty { due?.let { listOf(it.dayOfWeek.value) } ?: emptyList() }
        } else {
            emptyList()
        }
        val monthDate = schedule && unit == RepeatUnit.MONTH && monthly == MonthlyMode.Date
        val monthNth = schedule && unit == RepeatUnit.MONTH && monthly == MonthlyMode.Nth
        return TaskRepeat(
            kind = kind,
            unit = unit,
            every = every,
            weekdays = days.ifEmpty { null },
            month_day = if (monthDate) due?.dayOfMonth else null,
            nth = if (monthNth && due != null) nthOfMonth(due) else null,
            nth_weekday = if (monthNth) due?.dayOfWeek?.value else null,
            ends = TaskRepeatEnds(
                kind = endKind,
                on = if (endKind == RepeatEnd.ON) endOn?.toString() else null,
                after = if (endKind == RepeatEnd.AFTER) endAfter else null,
            ),
            paused = paused,
        )
    }

    companion object {
        /** A job tied to a conversation or contact reads better as "after it's done". */
        fun forLinked(linked: Boolean) = RepeatDraft(
            kind = if (linked) RepeatKind.AFTER_DONE else RepeatKind.SCHEDULE,
            unit = if (linked) RepeatUnit.MONTH else RepeatUnit.WEEK,
        )

        fun from(repeat: TaskRepeat) = RepeatDraft(
            kind = repeat.kind,
            unit = repeat.unit,
            every = repeat.every,
            weekdays = repeat.weekdays?.toSet() ?: emptySet(),
            monthly = if (repeat.nth != null) MonthlyMode.Nth else MonthlyMode.Date,
            endKind = repeat.ends.kind,
            endOn = repeat.ends.on?.let { runCatching { LocalDate.parse(it) }.getOrNull() },
            endAfter = repeat.ends.after ?: 5,
            paused = repeat.paused,
        )
    }
}

/** 1..4, or -1 for the last, of this weekday in its month. */
fun nthOfMonth(date: LocalDate): Int {
    val nth = (date.dayOfMonth - 1) / 7 + 1
    val isLast = date.plusDays(7).month != date.month
    return if (isLast) -1 else minOf(nth, 4)
}

/** The wire rule for POST /v1/tasks and PATCH /v1/tasks/:id. */
fun repeatJson(repeat: TaskRepeat): JsonObject = buildJsonObject {
    put("kind", repeat.kind)
    put("unit", repeat.unit)
    put("every", repeat.every)
    repeat.weekdays?.takeIf { it.isNotEmpty() }?.let { days ->
        put("weekdays", buildJsonArray { days.forEach { add(it) } })
    }
    repeat.month_day?.let { put("month_day", it) }
    repeat.nth?.let { put("nth", it) }
    repeat.nth_weekday?.let { put("nth_weekday", it) }
    put(
        "ends",
        buildJsonObject {
            put("kind", repeat.ends.kind)
            repeat.ends.on?.let { put("on", it) }
            repeat.ends.after?.let { put("after", it) }
        },
    )
    if (repeat.paused) put("paused", true)
}

private fun unitKey(unit: String, plural: Boolean): String {
    val base = when (unit) {
        RepeatUnit.WEEK -> "Week"
        RepeatUnit.MONTH -> "Month"
        RepeatUnit.YEAR -> "Year"
        else -> "Day"
    }
    return "contactsTasks.unit$base${if (plural) "N" else "1"}"
}

/** "day" / "days" in the reader's language. */
fun repeatUnitWord(unit: String, count: Int, locale: String? = null): String =
    AppStrings.translate(locale, unitKey(unit, count != 1))

internal fun weekdayName(isoDay: Int, locale: String?): String =
    DayOfWeek.of(isoDay.coerceIn(1, 7))
        .getDisplayName(TextStyle.FULL, Locale.forLanguageTag(locale ?: "en"))

internal fun ordinalWord(nth: Int?, locale: String?): String = AppStrings.translate(
    locale,
    when (nth) {
        1 -> "contactsTasks.nthFirst"
        2 -> "contactsTasks.nthSecond"
        3 -> "contactsTasks.nthThird"
        4 -> "contactsTasks.nthFourth"
        else -> "contactsTasks.nthLast"
    },
)

/**
 * The one line a repeating job is described by: "Repeats every Monday",
 * "Repeats 6 months after it's done". Paused and ended repeats say so after it.
 */
fun repeatSummary(repeat: TaskRepeat, locale: String? = null): String {
    fun say(key: String, vararg vars: Pair<String, String>) =
        AppStrings.translate(locale, key, vars.toMap())

    val n = repeat.every.coerceAtLeast(1)
    val unit = repeat.unit
    val base = if (repeat.kind == RepeatKind.AFTER_DONE) {
        say(
            "contactsTasks.repeatAfterDone",
            "count" to "$n",
            "unit" to repeatUnitWord(unit, n, locale),
        )
    } else {
        val days = repeat.weekdays.orEmpty().sorted().joinToString(", ") { weekdayName(it, locale) }
        val nthDay = repeat.nth_weekday
        val monthDay = repeat.month_day
        when {
            unit == RepeatUnit.WEEK && days.isNotEmpty() && n == 1 ->
                say("contactsTasks.repeatWeekdays", "days" to days)

            unit == RepeatUnit.WEEK && days.isNotEmpty() ->
                say("contactsTasks.repeatWeekdaysEvery", "count" to "$n", "days" to days)

            unit == RepeatUnit.MONTH && repeat.nth != null && nthDay != null ->
                say(
                    if (n == 1) "contactsTasks.repeatNthMonthly" else "contactsTasks.repeatNthMonthlyEvery",
                    "nth" to ordinalWord(repeat.nth, locale),
                    "day" to weekdayName(nthDay, locale),
                    "count" to "$n",
                )

            unit == RepeatUnit.MONTH && monthDay != null ->
                say(
                    if (n == 1) "contactsTasks.repeatMonthDay" else "contactsTasks.repeatMonthDayEvery",
                    "date" to "$monthDay",
                    "count" to "$n",
                )

            n == 1 -> say("contactsTasks.repeatEvery1", "unit" to repeatUnitWord(unit, 1, locale))
            else -> say(
                "contactsTasks.repeatEveryN",
                "count" to "$n",
                "unit" to repeatUnitWord(unit, n, locale),
            )
        }
    }
    val tail = buildList {
        when (repeat.ends.kind) {
            RepeatEnd.ON -> repeat.ends.on?.let { add(say("contactsTasks.repeatUntil", "date" to it)) }
            RepeatEnd.AFTER -> repeat.ends.after?.let {
                add(say("contactsTasks.repeatTimes", "count" to "$it"))
            }
        }
        if (repeat.stopped) add(say("contactsTasks.repeatEnded"))
        else if (repeat.paused) add(say("contactsTasks.repeatPausedTag"))
    }
    return (listOf(base) + tail).joinToString(" · ")
}
