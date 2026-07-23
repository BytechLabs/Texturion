package com.loonext.android.features.tasks

import com.loonext.android.core.model.Task
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.Clock
import java.time.DayOfWeek
import java.time.Instant
import java.time.YearMonth
import java.time.ZoneId
import java.time.temporal.ChronoUnit
import java.time.temporal.TemporalAdjusters

/**
 * The pure calendar-view helpers: the Mon..Sun week-aligned grid window, the
 * tab→assignee collapse the fetch rides once status goes client-side, the
 * cache filterKey discipline, and the client-side status/due-chip predicates
 * that narrow one cached month payload. Fixed clocks throughout.
 */
class TaskCalendarTest {

    private val toronto = ZoneId.of("America/Toronto")

    // 2026-07-15 noon in Toronto (16:00Z).
    private val clock: Clock =
        Clock.fixed(Instant.parse("2026-07-15T16:00:00Z"), toronto)

    private fun task(done: Boolean = false, dueAt: String? = null) = Task(
        id = "t1",
        company_id = "c1",
        message_id = "m1",
        conversation_id = "cv1",
        title = "Send the quote",
        created_by_user_id = "u1",
        created_at = "2026-07-01T00:00:00Z",
        updated_at = "2026-07-01T00:00:00Z",
        done = done,
        status = if (done) TaskStatus.DONE else TaskStatus.OPEN,
        due_at = dueAt,
    )

    // ---- the week-aligned grid window -------------------------------------

    @Test
    fun `grid start is the Monday on or before the 1st, end the Sunday on or after month end`() {
        // Differential check against java-time's own adjusters, across two
        // years of months (leap February included).
        var month = YearMonth.of(2026, 1)
        repeat(24) {
            val start = calendarGridStart(month)
            val end = calendarGridEnd(month)
            assertEquals(DayOfWeek.MONDAY, start.dayOfWeek)
            assertEquals(DayOfWeek.SUNDAY, end.dayOfWeek)
            assertEquals(
                month.atDay(1).with(TemporalAdjusters.previousOrSame(DayOfWeek.MONDAY)),
                start,
            )
            assertEquals(
                month.atEndOfMonth().with(TemporalAdjusters.nextOrSame(DayOfWeek.SUNDAY)),
                end,
            )
            // Whole weeks only: 4, 5, or 6 rows.
            val days = ChronoUnit.DAYS.between(start, end) + 1
            assertEquals(0L, days % 7)
            assertTrue(days in 28..42)
            month = month.plusMonths(1)
        }
    }

    // ---- tab → assignee collapse (status is client-side on the calendar) --

    @Test
    fun `status tabs collapse to me, All to every assignee, chips override`() {
        assertEquals(ASSIGNEE_ME, taskCalendarBaseAssignee(TasksTabKind.Open, null, false))
        assertEquals(ASSIGNEE_ME, taskCalendarBaseAssignee(TasksTabKind.Mine, null, false))
        assertEquals(ASSIGNEE_ME, taskCalendarBaseAssignee(TasksTabKind.Done, null, false))
        assertEquals(ASSIGNEE_ALL, taskCalendarBaseAssignee(TasksTabKind.All, null, false))
        // A concrete member chip overrides every tab baseline.
        assertEquals("u9", taskCalendarBaseAssignee(TasksTabKind.All, "u9", false))
        // The unassigned chip drops the pin entirely.
        assertNull(taskCalendarBaseAssignee(TasksTabKind.Open, null, true))
    }

    // ---- cache filterKey discipline ---------------------------------------

    @Test
    fun `calendar keys are cal-prefixed, never default, distinct per scope`() {
        val july = YearMonth.of(2026, 7)
        val base = taskCalendarFilterKey(july, ASSIGNEE_ME, false, null)
        assertTrue(base.startsWith("cal|"))
        assertNotEquals("default", base)
        assertNotEquals(base, taskCalendarFilterKey(july.plusMonths(1), ASSIGNEE_ME, false, null))
        assertNotEquals(base, taskCalendarFilterKey(july, ASSIGNEE_ALL, false, null))
        assertNotEquals(base, taskCalendarFilterKey(july, null, true, null))
        assertNotEquals(base, taskCalendarFilterKey(july, ASSIGNEE_ME, false, "roof"))
    }

    // ---- client-side status predicate -------------------------------------

    @Test
    fun `Open and Done tabs partition by done, Mine and All pass everything`() {
        val open = task(done = false)
        val done = task(done = true)
        assertTrue(matchesCalendarTab(open, TasksTabKind.Open))
        assertFalse(matchesCalendarTab(done, TasksTabKind.Open))
        assertTrue(matchesCalendarTab(done, TasksTabKind.Done))
        assertFalse(matchesCalendarTab(open, TasksTabKind.Done))
        assertTrue(matchesCalendarTab(open, TasksTabKind.Mine))
        assertTrue(matchesCalendarTab(done, TasksTabKind.All))
    }

    // ---- client-side due-chip predicate -----------------------------------

    @Test
    fun `no chip passes everything, dated or not`() {
        assertTrue(matchesDueChip(task(), null, clock))
        assertTrue(matchesDueChip(task(dueAt = "2026-07-20T12:00:00-04:00"), null, clock))
    }

    @Test
    fun `overdue chip is past-due AND not done, and undated never matches`() {
        val pastDue = "2026-07-15T10:00:00-04:00" // 14:00Z, before the 16:00Z clock
        assertTrue(matchesDueChip(task(dueAt = pastDue), DueChip.Overdue, clock))
        assertFalse(matchesDueChip(task(done = true, dueAt = pastDue), DueChip.Overdue, clock))
        assertFalse(matchesDueChip(task(), DueChip.Overdue, clock))
    }

    @Test
    fun `today chip is the local calendar day, half-open`() {
        // 23:00 Toronto tonight is still today; 09:00 tomorrow is not.
        assertTrue(
            matchesDueChip(task(dueAt = "2026-07-15T23:00:00-04:00"), DueChip.Today, clock),
        )
        assertFalse(
            matchesDueChip(task(dueAt = "2026-07-16T09:00:00-04:00"), DueChip.Today, clock),
        )
        assertFalse(matchesDueChip(task(), DueChip.Today, clock))
    }

    @Test
    fun `week chip spans seven local days from the start of today`() {
        assertTrue(
            matchesDueChip(task(dueAt = "2026-07-16T09:00:00-04:00"), DueChip.Week, clock),
        )
        assertTrue(
            matchesDueChip(task(dueAt = "2026-07-21T12:00:00-04:00"), DueChip.Week, clock),
        )
        // The 22nd is day eight — outside the half-open window.
        assertFalse(
            matchesDueChip(task(dueAt = "2026-07-22T12:00:00-04:00"), DueChip.Week, clock),
        )
    }
}
