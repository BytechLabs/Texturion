package com.loonext.android.core.time

import java.io.File
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * #720: every date the app shows goes through [TimestampFormat].
 *
 * About forty files each drew their own date with `DateTimeFormatter`, so one
 * moment read "Sep 9" here and "9:42 AM" there, and none could be long-pressed
 * for the exact time. This fails on a direct date format anywhere outside the
 * formatter, unless the ROSTER below says why: a calendar day with no time of
 * day, a machine format, or a sentence shape other clients pin.
 *
 * T-0  the scan read source files and found the calls it is about.
 * T-1  no unlisted file formats a date itself.
 * T-2  the roster is closed: an entry whose file no longer makes that call fails.
 * T-3  every entry gives a reason.
 */
class TimestampGuardTest {
    private val formatterFiles = setOf("core/time/TimestampFormat.kt", "core/time/TimestampShape.kt")

    private class Rule(val call: String, val pattern: Regex)

    private val rules = listOf(
        Rule("DateTimeFormatter", Regex("""\bDateTimeFormatter\.""")),
        Rule("SimpleDateFormat", Regex("""\bSimpleDateFormat\(""")),
        Rule("DateUtils", Regex("""\bDateUtils\.""")),
        Rule("DateFormat", Regex("""\bDateFormat\.""")),
        Rule("getDisplayName", Regex("""\.getDisplayName\(""")),
    )

    private class Entry(val file: String, val call: String, val reason: String)

    private val roster = listOf(
        Entry("core/diag/RecentErrors.kt", "DateTimeFormatter", "A UTC HH:mm:ss stamp on a diagnostics line a developer reads, not a date a person is shown."),
        Entry("core/oncall/OnCall.kt", "SimpleDateFormat", "The wire format of an instant sent to the API."),
        Entry("core/snooze/SnoozeLogic.kt", "DateTimeFormatter", "The snooze return sentence shapes are pinned to the shared snoozeReturnShape and the other clients; the time and day inside are one sentence."),
        Entry("core/snooze/SnoozeLogic.kt", "getDisplayName", "The weekday name inside the shared snooze return sentence."),
        Entry("features/calls/CallsScreen.kt", "DateTimeFormatter", "The day heading that groups the call list: a calendar day, never a time."),
        Entry("features/contacts/ContactCallsLogic.kt", "DateTimeFormatter", "The day heading that groups a contact's calls: a calendar day, never a time."),
        Entry("features/activity/ActivityLine.kt", "DateTimeFormatter", "The day heading that groups the activity timeline: a calendar day, never a time."),
        Entry("features/contacts/ContactsData.kt", "DateTimeFormatter", "Record lines say \"Added by Sam on {date}\" and \"Consent · {date}\": a calendar day inside a sentence."),
        Entry("features/settings/BillingSection.kt", "DateTimeFormatter", "Billing period ends and renewal days: calendar days with no time of day."),
        Entry("features/settings/OnCallCard.kt", "SimpleDateFormat", "Parses the server's wall-clock text as UTC; a machine format."),
        Entry("features/settings/UsageExportCard.kt", "DateTimeFormatter", "ISO_INSTANT builds the range sent to the export endpoint; a machine format."),
        Entry("features/settings/UsageSection.kt", "DateTimeFormatter", "Billing-period bounds and month names on the history bars: calendar days and months."),
        Entry("features/tasks/QuickAdd.kt", "DateTimeFormatter", "The ISO instant a parsed quick-add sends to the API; a machine format."),
        Entry("features/tasks/TaskCalendar.kt", "DateTimeFormatter", "Calendar grid: month title, day numbers, day headings and the ISO day keys, not timestamps."),
        Entry("features/tasks/TaskFilters.kt", "DateTimeFormatter", "ISO offset bounds sent to the tasks API; a machine format."),
        Entry("features/tasks/TaskFormat.kt", "DateTimeFormatter", "The offset-bearing ISO a picked due time is sent to the API as; a machine format."),
        Entry("features/tasks/TaskPlanning.kt", "getDisplayName", "A weekday NAME for a repeat rule, not a moment."),
        Entry("features/tasks/TaskPlanningUi.kt", "getDisplayName", "Weekday chips for a repeat rule, not a moment."),
        Entry("features/thread/Timeline.kt", "DateTimeFormatter", "The day divider in a thread: a calendar day, never a time."),
    )

    private fun stripComments(text: String): String =
        text.replace(Regex("""/\*[\s\S]*?\*/""")) { m -> "\n".repeat(m.value.count { it == '\n' }) }
            .lines().joinToString("\n") { it.replace(Regex("""(^|\s)//.*$"""), "") }

    private val scanned: List<Pair<String, String>> by lazy {
        val root = listOf(
            "src/main/kotlin/com/loonext/android",
            "app/src/main/kotlin/com/loonext/android",
            "apps/android/app/src/main/kotlin/com/loonext/android",
        ).map(::File).firstOrNull { it.exists() }
            ?: error("main source root not found (cwd=${File(".").absolutePath})")
        root.walkTopDown().filter { it.isFile && it.extension == "kt" }
            .map { it.relativeTo(root).invariantSeparatorsPath to stripComments(it.readText()) }
            .filter { it.first !in formatterFiles }
            .toList()
    }

    private val hits: List<Pair<String, String>> by lazy {
        scanned.flatMap { (file, text) ->
            rules.filter { it.pattern.containsMatchIn(text) }.map { file to it.call }
        }
    }

    @Test
    fun `T-0 the scan read sources and found the calls it is about`() {
        assertTrue("the scan found no sources", scanned.size > 100)
        assertTrue("no date calls found in ${scanned.size} files", hits.isNotEmpty())
    }

    @Test
    fun `T-1 no date is drawn outside the formatter unless the roster says why`() {
        val unlisted = hits.filter { hit -> roster.none { it.file == hit.first && it.call == hit.second } }
            .map { "${it.first}  ${it.second}" }
        assertEquals(
            "Scanned ${scanned.size} files. These draw a date or time themselves. Use " +
                "Timestamp(iso) in a composable, or TimestampFormat.label/clock/exact in " +
                "a sentence; a calendar day with no time of day may go on the ROSTER:\n" +
                unlisted.joinToString("\n"),
            emptyList<String>(),
            unlisted,
        )
    }

    @Test
    fun `T-2 the roster excuses code that still exists`() {
        val stale = roster.filter { e -> hits.none { it.first == e.file && it.second == e.call } }
            .map { "${it.file}  ${it.call}" }
        assertEquals("These roster entries no longer match a call. Delete them:", emptyList<String>(), stale)
    }

    @Test
    fun `T-3 every roster entry gives a reason`() {
        assertEquals(emptyList<String>(), roster.filter { it.reason.trim().length < 15 }.map { it.file })
    }

    /**
     * #238: a compact time ("5m") drawn as plain text is read by TalkBack as "5 m". Every
     * compact time a screen draws needs its spoken twin: `timedText { time -> ... time(iso) }`
     * and `Modifier.spokenAs`, or `Modifier.spokenTimeOf(iso)` beside a lone `relativeTime`.
     * A file may draw no more compact times than it speaks, unless the file only DEFINES
     * those helpers (below). LONG labels name the day and clock and are not counted.
     *
     * T-4  the compact-time scan found the calls it is about.
     * T-5  no unlisted file draws a compact time it does not speak.
     * T-6  the compact roster is closed and gives a reason for each file.
     */
    private val compactCalls = Regex("""(?<!fun )\b(?:relativeTime|formatDue)\(""")
    private val labelCalls = Regex("""TimestampFormat\.label\(""")
    private val spokenCalls = Regex("""\bspokenTimeOf\(""")

    /** Compact draws in [text]: relativeTime, formatDue, and a TimestampFormat.label that is not LONG. */
    private fun compactDraws(text: String): Int =
        compactCalls.findAll(text).count() +
            labelCalls.findAll(text).count { text.substring(it.range.first, minOf(text.length, it.range.first + 220)).let { call -> "Style.LONG" !in call } }

    private val compactRoster = mapOf(
        "ui/common/Ui.kt" to "Defines relativeTime and timedText, which draw the compact label and build its spoken twin.",
        "ui/common/Timestamp.kt" to "The Timestamp composable: draws the compact label and speaks it with clearAndSetSemantics.",
        "features/tasks/TaskFormat.kt" to "Defines formatDue and timedDue, which draw the due label and build its spoken twin.",
    )

    private val compactFiles: List<Triple<String, Int, Int>> by lazy {
        scanned.map { (file, text) -> Triple(file, compactDraws(text), spokenCalls.findAll(text).count()) }
            .filter { it.second > 0 }
    }

    @Test
    fun `T-4 the compact-time scan found the calls it is about`() {
        assertTrue("no compact times found in ${scanned.size} files", compactFiles.isNotEmpty())
        assertTrue("the compact scan read no sources", scanned.isNotEmpty())
    }

    @Test
    fun `T-5 a compact time drawn as plain text has its spoken twin`() {
        val unspoken = compactFiles
            .filter { it.first !in compactRoster && it.second > it.third }
            .map { "${it.first}  draws ${it.second} compact time(s), speaks ${it.third}" }
        assertEquals(
            "Scanned ${scanned.size} files, ${compactFiles.size} draw compact times. A compact " +
                "time reads as \"5 m\" aloud. Build the line with timedText { time -> ... } and " +
                "Modifier.spokenAs, or add Modifier.spokenTimeOf(iso) to a lone relativeTime:\n" +
                unspoken.joinToString("\n"),
            emptyList<String>(),
            unspoken,
        )
    }

    @Test
    fun `T-6 the compact roster excuses files that still draw compact times`() {
        val stale = compactRoster.keys.filter { file -> compactFiles.none { it.first == file } }
        assertEquals("These compact roster entries no longer draw one. Delete them:", emptyList<String>(), stale)
        assertEquals(emptyList<String>(), compactRoster.filter { it.value.trim().length < 15 }.keys.toList())
    }
}
