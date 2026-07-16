package com.loonext.android.features.tasks

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import java.time.Clock
import java.time.Duration
import java.time.Instant
import java.time.OffsetDateTime
import java.time.ZoneId
import java.time.ZoneOffset

/**
 * The GET /v1/tasks default-filter matrix. The route's frozen contract: NO
 * params silently means status=open + assignee=me, and ANY explicit param
 * kills BOTH defaults — so every tab must serialize an explicit filter set,
 * and "All" needs a status=open sentinel when nothing else would survive.
 */
class TaskFiltersTest {

    // 2026-07-15 noon in Toronto (16:00Z), an EDT (-04:00) date.
    private val clock: Clock = Clock.fixed(
        Instant.parse("2026-07-15T16:00:00Z"),
        ZoneId.of("America/Toronto"),
    )

    // ---- tab → arms matrix -------------------------------------------------

    @Test
    fun `open tab is one arm, explicitly open plus me`() {
        val arms = taskListArms(TasksTabKind.Open, null, false, null, null)
        assertEquals(1, arms.size)
        val params = taskQueryParams(arms[0])
        assertEquals("open", params["status"])
        assertEquals(ASSIGNEE_ME, params["assigned_user_id"])
        assertNull(params["unassigned"])
        assertNull(params["overdue"])
        assertNull(params["due_before"])
        assertNull(params["due_after"])
        assertNull(params["conversation_id"])
        assertNull(params["q"])
        assertNull(params["cursor"])
        assertEquals("25", params["limit"])
    }

    @Test
    fun `done tab is one arm, done plus me`() {
        val arms = taskListArms(TasksTabKind.Done, null, false, null, null)
        assertEquals(1, arms.size)
        val params = taskQueryParams(arms[0])
        assertEquals("done", params["status"])
        assertEquals(ASSIGNEE_ME, params["assigned_user_id"])
    }

    @Test
    fun `mine tab unions two status arms, open first, both pinned to me`() {
        val arms = taskListArms(TasksTabKind.Mine, null, false, null, null)
        assertEquals(listOf("open", "done"), arms.map { it.status })
        arms.forEach { assertEquals(ASSIGNEE_ME, it.assignedUserId) }
    }

    @Test
    fun `all tab drops the assignee pin but keeps explicit statuses`() {
        val arms = taskListArms(TasksTabKind.All, null, false, null, null)
        assertEquals(listOf("open", "done"), arms.map { it.status })
        arms.forEach { arm ->
            val params = taskQueryParams(arm)
            assertNull(params["assigned_user_id"])
            assertEquals(arm.status, params["status"])
        }
    }

    // ---- the "all" sugar and its sentinel ---------------------------------

    @Test
    fun `bare all-assignees filter injects the status=open sentinel`() {
        val params = taskQueryParams(TaskListFilters(assignedUserId = ASSIGNEE_ALL))
        assertEquals("open", params["status"])
        assertNull(params["assigned_user_id"])
    }

    @Test
    fun `all-assignees with a surviving explicit param sends no sentinel`() {
        val withQ = taskQueryParams(
            TaskListFilters(assignedUserId = ASSIGNEE_ALL, q = "roof"),
        )
        assertNull(withQ["status"])
        assertEquals("roof", withQ["q"])
        assertNull(withQ["assigned_user_id"])

        val withOverdue = taskQueryParams(
            TaskListFilters(assignedUserId = ASSIGNEE_ALL, overdue = true),
        )
        assertNull(withOverdue["status"])
        assertEquals("true", withOverdue["overdue"])
    }

    @Test
    fun `an explicit status is never overwritten by the sentinel`() {
        val params = taskQueryParams(
            TaskListFilters(status = TaskStatus.DONE, assignedUserId = ASSIGNEE_ALL),
        )
        assertEquals("done", params["status"])
    }

    // ---- chips -------------------------------------------------------------

    @Test
    fun `a concrete assignee chip overrides the tab's me pin on every arm`() {
        val arms = taskListArms(TasksTabKind.Mine, "user-7", false, null, null)
        assertEquals(2, arms.size)
        arms.forEach { assertEquals("user-7", it.assignedUserId) }
    }

    @Test
    fun `the unassigned chip sends the flag and no assignee`() {
        val arms = taskListArms(TasksTabKind.Open, null, true, null, null)
        val params = taskQueryParams(arms[0])
        assertEquals("true", params["unassigned"])
        assertNull(params["assigned_user_id"])
    }

    @Test
    fun `booleans are sent only when true`() {
        val params = taskQueryParams(TaskListFilters(status = TaskStatus.OPEN))
        assertNull(params["unassigned"])
        assertNull(params["overdue"])
    }

    @Test
    fun `blank search is dropped, real search is trimmed onto every arm`() {
        val blank = taskListArms(TasksTabKind.Open, null, false, null, "   ")
        assertNull(blank[0].q)

        val arms = taskListArms(TasksTabKind.Mine, null, false, null, "  furnace  ")
        arms.forEach { assertEquals("furnace", it.q) }
    }

    // ---- due chips and the dual-cursor orderings ---------------------------

    @Test
    fun `overdue chip sets the flag and flips to the due ordering`() {
        val arms = taskListArms(TasksTabKind.Open, null, false, DueChip.Overdue, null, clock)
        val arm = arms[0]
        assertEquals(true, arm.overdue)
        assertNull(arm.dueBefore)
        assertNull(arm.dueAfter)
        assertEquals("due", orderingKey(arm))
    }

    @Test
    fun `due today is a one-day window from local midnight`() {
        val filters = dueChipFilters(DueChip.Today, clock)
        val after = OffsetDateTime.parse(filters.dueAfter)
        val before = OffsetDateTime.parse(filters.dueBefore)
        // Local midnight in Toronto on Jul 15 2026 is 04:00Z (EDT).
        assertEquals(Instant.parse("2026-07-15T04:00:00Z"), after.toInstant())
        assertEquals(ZoneOffset.ofHours(-4), after.offset)
        assertEquals(Duration.ofDays(1), Duration.between(after, before))
        assertEquals("due", orderingKey(filters))
    }

    @Test
    fun `due this week is a seven-day window from local midnight`() {
        val filters = dueChipFilters(DueChip.Week, clock)
        val after = OffsetDateTime.parse(filters.dueAfter)
        val before = OffsetDateTime.parse(filters.dueBefore)
        assertEquals(Instant.parse("2026-07-15T04:00:00Z"), after.toInstant())
        assertEquals(Duration.ofDays(7), Duration.between(after, before))
        assertEquals("due", orderingKey(filters))
    }

    @Test
    fun `filters without a due dimension use the created ordering`() {
        assertEquals("created", orderingKey(TaskListFilters()))
        assertEquals(
            "created",
            orderingKey(TaskListFilters(status = "open", assignedUserId = "u", q = "x")),
        )
    }

    // ---- serialization passthrough -----------------------------------------

    @Test
    fun `cursor and limit ride the query unchanged`() {
        val params = taskQueryParams(
            TaskListFilters(status = TaskStatus.OPEN),
            cursor = "opaque-token",
            limit = 100,
        )
        assertEquals("opaque-token", params["cursor"])
        assertEquals("100", params["limit"])
    }

    @Test
    fun `conversation scope serializes and suppresses the sentinel`() {
        val params = taskQueryParams(
            TaskListFilters(assignedUserId = ASSIGNEE_ALL, conversationId = "conv-1"),
        )
        assertEquals("conv-1", params["conversation_id"])
        assertNull(params["status"])
    }
}
