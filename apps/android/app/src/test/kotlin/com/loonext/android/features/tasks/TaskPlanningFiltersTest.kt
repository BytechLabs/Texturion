package com.loonext.android.features.tasks

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNull
import org.junit.Test

/** #693: priority, label and sort in the GET /v1/tasks query and the cache keys. */
class TaskPlanningFiltersTest {

    @Test
    fun `priority label and sort ride the query`() {
        val arm = taskListArms(
            TasksTabKind.Open, null, false, null, null,
            extra = TaskExtraFilters(
                priorities = setOf("urgent", "high"),
                tagId = "g1",
                sort = TaskSort.Priority,
            ),
        ).single()
        val params = taskQueryParams(arm)
        assertEquals("urgent,high", params["priority"])
        assertEquals("g1", params["tag_id"])
        assertEquals("priority", params["sort"])
        assertEquals("open", params["status"])
    }

    @Test
    fun `no extra filters adds no params`() {
        val params = taskQueryParams(taskListArms(TasksTabKind.Open, null, false, null, null).single())
        assertNull(params["priority"])
        assertNull(params["tag_id"])
        assertNull(params["sort"])
    }

    @Test
    fun `statusless tabs carry the extras on both arms`() {
        val arms = taskListArms(
            TasksTabKind.All, null, false, null, null,
            extra = TaskExtraFilters(priorities = setOf("low"), sort = TaskSort.Due),
        )
        assertEquals(2, arms.size)
        arms.forEach {
            assertEquals(listOf("low"), it.priorities)
            assertEquals("due", it.sort)
        }
    }

    @Test
    fun `a sort changes the cursor ordering key`() {
        assertEquals("created", orderingKey(TaskListFilters()))
        assertEquals("priority", orderingKey(TaskListFilters(sort = "priority")))
        assertEquals("due", orderingKey(TaskListFilters(sort = "due")))
        assertEquals("due", orderingKey(TaskListFilters(overdue = true)))
    }

    @Test
    fun `a sorted or filtered list never shares the default cache key`() {
        assertEquals("default", taskListFilterKey(TasksTabKind.Open, null, false, null, null))
        val sorted = taskListFilterKey(
            TasksTabKind.Open, null, false, null, null,
            TaskExtraFilters(sort = TaskSort.Priority),
        )
        assertNotEquals("default", sorted)
        val filtered = taskListFilterKey(
            TasksTabKind.Open, null, false, null, null,
            TaskExtraFilters(priorities = setOf("high")),
        )
        assertNotEquals(sorted, filtered)
    }

    @Test
    fun `the board key carries the extras too`() {
        val plain = taskBoardFilterKey(TasksTabKind.Mine, null, false, null, null)
        val filtered = taskBoardFilterKey(
            TasksTabKind.Mine, null, false, null, null,
            TaskExtraFilters(tagId = "g1"),
        )
        assertNotEquals(plain, filtered)
    }
}
