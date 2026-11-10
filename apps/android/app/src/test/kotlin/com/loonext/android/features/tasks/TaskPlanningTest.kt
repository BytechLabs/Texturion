package com.loonext.android.features.tasks

import com.loonext.android.core.model.Task
import com.loonext.android.core.model.TaskDetail
import com.loonext.android.core.model.TaskFeedItem
import com.loonext.android.core.model.TaskLabel
import com.loonext.android.core.model.TaskRepeat
import com.loonext.android.core.model.TaskRepeatEnds
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.LocalDate

/**
 * #693: the pure rules behind priority, labels and repeating jobs: how the new
 * fields decode (including from an older server that sends none of them), the
 * sentence a repeat reads as, the draft the repeat sheet edits, and when an
 * edit has to ask "this one or this and future".
 */
class TaskPlanningTest {

    private val json = Json {
        ignoreUnknownKeys = true
        explicitNulls = false
        encodeDefaults = true
        coerceInputValues = true
    }

    // ---- decoding ----------------------------------------------------------

    private val oldTask = """
        {"id":"t1","company_id":"c1","title":"Send the quote","created_by_user_id":"u1",
         "created_at":"2026-07-01T00:00:00Z","updated_at":"2026-07-01T00:00:00Z"}
    """.trimIndent()

    @Test
    fun `a task from an older server decodes with the defaults`() {
        val task = json.decodeFromString<Task>(oldTask)
        assertEquals("normal", task.priority)
        assertTrue(task.labels.isEmpty())
        assertNull(task.series_id)
        assertNull(task.occurrence_no)
        assertNull(task.repeat)
    }

    @Test
    fun `a task detail from an older server decodes with the defaults`() {
        val detail = json.decodeFromString<TaskDetail>(oldTask)
        assertEquals("normal", detail.priority)
        assertTrue(detail.labels.isEmpty())
        assertNull(detail.repeat)
    }

    @Test
    fun `priority labels and a repeat decode from the new payload`() {
        val task = json.decodeFromString<Task>(
            """
            {"id":"t1","company_id":"c1","title":"Furnace service","created_by_user_id":"u1",
             "created_at":"2026-07-01T00:00:00Z","updated_at":"2026-07-01T00:00:00Z",
             "priority":"urgent","series_id":"s1","occurrence_no":3,
             "labels":[{"id":"g1","name":"Warranty","color":"#112233"},{"id":"g2","name":"VIP","color":null}],
             "repeat":{"id":"r1","kind":"schedule","unit":"week","every":2,"weekdays":[1,3],
                       "month_day":null,"nth":null,"nth_weekday":null,
                       "ends":{"kind":"after","on":null,"after":6},"paused":true,"stopped":false},
             "something_new":true}
            """.trimIndent(),
        )
        assertEquals("urgent", task.priority)
        assertEquals(listOf("Warranty", "VIP"), task.labels.map { it.name })
        assertNull(task.labels[1].color)
        assertEquals("s1", task.series_id)
        assertEquals(3, task.occurrence_no)
        val repeat = task.repeat!!
        assertEquals("schedule", repeat.kind)
        assertEquals(2, repeat.every)
        assertEquals(listOf(1, 3), repeat.weekdays)
        assertEquals("after", repeat.ends.kind)
        assertEquals(6, repeat.ends.after)
        assertTrue(repeat.paused)
        assertFalse(repeat.stopped)
    }

    @Test
    fun `a repeat with missing optional fields still decodes`() {
        val repeat = json.decodeFromString<TaskRepeat>(
            """{"kind":"after_done","unit":"month","every":6}""",
        )
        assertEquals("never", repeat.ends.kind)
        assertNull(repeat.weekdays)
        assertFalse(repeat.paused)
        assertEquals("", repeat.id)
    }

    @Test
    fun `an unknown priority reads as normal and only high and urgent are flagged`() {
        assertEquals("normal", TaskPriority.normalize("whenever"))
        assertEquals("normal", TaskPriority.normalize(null))
        assertEquals("low", TaskPriority.normalize("low"))
        assertTrue(TaskPriority.isFlagged("urgent"))
        assertTrue(TaskPriority.isFlagged("high"))
        assertFalse(TaskPriority.isFlagged("normal"))
        assertFalse(TaskPriority.isFlagged("low"))
        assertFalse(TaskPriority.isFlagged("none"))
        assertFalse(TaskPriority.isFlagged(null))
    }

    // ---- the scope question ------------------------------------------------

    private fun repeat(stopped: Boolean = false) = TaskRepeat(
        kind = "schedule",
        unit = "day",
        every = 1,
        stopped = stopped,
    )

    @Test
    fun `only a repeat that is still running asks this or future`() {
        assertFalse(needsScopeChoice(null))
        assertTrue(needsScopeChoice(repeat()))
        assertFalse(needsScopeChoice(repeat(stopped = true)))
    }

    @Test
    fun `the repeat icon shows for a live repeat only`() {
        assertFalse(showsRepeatIcon(null))
        assertTrue(showsRepeatIcon(repeat()))
        assertFalse(showsRepeatIcon(repeat(stopped = true)))
    }

    @Test
    fun `a scope goes on the body only when one was chosen`() {
        val body = buildJsonObject { put("title", "x") }
        assertEquals(body, withScope(body, null))
        val scoped = withScope(body, TaskScope.Future)
        assertEquals("future", scoped["scope"]?.jsonPrimitive?.content)
        assertEquals("x", scoped["title"]?.jsonPrimitive?.content)
        assertEquals("this", withScope(body, TaskScope.This)["scope"]?.jsonPrimitive?.content)
    }

    // ---- the repeat sentence ----------------------------------------------

    private fun summary(r: TaskRepeat) = repeatSummary(r, "en")

    @Test
    fun `weekly on one day reads as every Monday`() {
        assertEquals(
            "Repeats every Monday",
            summary(TaskRepeat(kind = "schedule", unit = "week", every = 1, weekdays = listOf(1))),
        )
    }

    @Test
    fun `weekly on two days lists them in week order`() {
        assertEquals(
            "Repeats every Monday, Thursday",
            summary(TaskRepeat(kind = "schedule", unit = "week", every = 1, weekdays = listOf(4, 1))),
        )
    }

    @Test
    fun `every second week names the days`() {
        assertEquals(
            "Repeats every 2 weeks on Friday",
            summary(TaskRepeat(kind = "schedule", unit = "week", every = 2, weekdays = listOf(5))),
        )
    }

    @Test
    fun `daily and every N days`() {
        assertEquals("Repeats every day", summary(TaskRepeat(kind = "schedule", unit = "day", every = 1)))
        assertEquals("Repeats every 3 days", summary(TaskRepeat(kind = "schedule", unit = "day", every = 3)))
    }

    @Test
    fun `monthly by date and by nth weekday`() {
        assertEquals(
            "Repeats on day 15 of every month",
            summary(TaskRepeat(kind = "schedule", unit = "month", every = 1, month_day = 15)),
        )
        assertEquals(
            "Repeats on the last Friday of every month",
            summary(
                TaskRepeat(kind = "schedule", unit = "month", every = 1, nth = -1, nth_weekday = 5),
            ),
        )
        assertEquals(
            "Repeats on the second Tuesday every 3 months",
            summary(
                TaskRepeat(kind = "schedule", unit = "month", every = 3, nth = 2, nth_weekday = 2),
            ),
        )
    }

    @Test
    fun `yearly`() {
        assertEquals("Repeats every year", summary(TaskRepeat(kind = "schedule", unit = "year", every = 1)))
    }

    @Test
    fun `after it's done counts from completion`() {
        assertEquals(
            "Repeats 6 months after it's done",
            summary(TaskRepeat(kind = "after_done", unit = "month", every = 6)),
        )
        assertEquals(
            "Repeats 1 week after it's done",
            summary(TaskRepeat(kind = "after_done", unit = "week", every = 1)),
        )
    }

    @Test
    fun `an end paused and ended repeat say so after the rule`() {
        assertEquals(
            "Repeats every day · until 2026-12-31",
            summary(
                TaskRepeat(
                    kind = "schedule", unit = "day", every = 1,
                    ends = TaskRepeatEnds(kind = "on", on = "2026-12-31"),
                ),
            ),
        )
        assertEquals(
            "Repeats every day · 5 times · Paused",
            summary(
                TaskRepeat(
                    kind = "schedule", unit = "day", every = 1,
                    ends = TaskRepeatEnds(kind = "after", after = 5), paused = true,
                ),
            ),
        )
        assertEquals(
            "Repeats every day · Repeat ended",
            summary(TaskRepeat(kind = "schedule", unit = "day", every = 1, stopped = true)),
        )
    }

    @Test
    fun `the sentence reads in Canadian French`() {
        assertEquals(
            "Se répète chaque lundi",
            repeatSummary(
                TaskRepeat(kind = "schedule", unit = "week", every = 1, weekdays = listOf(1)),
                "fr-CA",
            ),
        )
        assertEquals(
            "Se répète 6 mois après avoir été terminée",
            repeatSummary(TaskRepeat(kind = "after_done", unit = "month", every = 6), "fr-CA"),
        )
    }

    // ---- the draft the sheet edits ----------------------------------------

    private val monday = LocalDate.of(2026, 11, 9)

    @Test
    fun `a schedule with no due date cannot be saved, after it's done can`() {
        assertEquals("contactsTasks.repeatNeedsDue", RepeatDraft().problem(null))
        assertNull(RepeatDraft().problem(monday))
        assertNull(RepeatDraft(kind = RepeatKind.AFTER_DONE, unit = RepeatUnit.MONTH).problem(null))
    }

    @Test
    fun `after it's done has no yearly form`() {
        assertEquals(
            listOf("day", "week", "month"),
            RepeatUnit.allowed(RepeatKind.AFTER_DONE),
        )
        assertEquals(
            "contactsTasks.repeatNoYearly",
            RepeatDraft(kind = RepeatKind.AFTER_DONE, unit = RepeatUnit.YEAR).problem(monday),
        )
    }

    @Test
    fun `an end date and a count are required when chosen`() {
        assertEquals(
            "contactsTasks.repeatNeedsEndDate",
            RepeatDraft(endKind = RepeatEnd.ON).problem(monday),
        )
        assertNull(RepeatDraft(endKind = RepeatEnd.ON, endOn = LocalDate.of(2027, 1, 1)).problem(monday))
    }

    @Test
    fun `a weekly draft with no days picks the due date's weekday`() {
        val rule = RepeatDraft(unit = RepeatUnit.WEEK).toRepeat(monday)
        assertEquals(listOf(1), rule.weekdays)
    }

    @Test
    fun `a monthly draft anchors on the due date`() {
        val date = RepeatDraft(unit = RepeatUnit.MONTH, monthly = MonthlyMode.Date).toRepeat(monday)
        assertEquals(9, date.month_day)
        assertNull(date.nth)
        val nth = RepeatDraft(unit = RepeatUnit.MONTH, monthly = MonthlyMode.Nth).toRepeat(monday)
        assertEquals(2, nth.nth)
        assertEquals(1, nth.nth_weekday)
        assertNull(nth.month_day)
    }

    @Test
    fun `the last weekday of a month is nth -1`() {
        assertEquals(-1, nthOfMonth(LocalDate.of(2026, 11, 27)))
        assertEquals(4, nthOfMonth(LocalDate.of(2026, 11, 22)))
        assertEquals(1, nthOfMonth(LocalDate.of(2026, 11, 2)))
    }

    @Test
    fun `a draft round-trips through the rule it makes`() {
        val rule = RepeatDraft(
            kind = RepeatKind.SCHEDULE,
            unit = RepeatUnit.WEEK,
            every = 2,
            weekdays = setOf(1, 5),
            endKind = RepeatEnd.AFTER,
            endAfter = 8,
            paused = true,
        ).toRepeat(monday)
        val back = RepeatDraft.from(rule)
        assertEquals(setOf(1, 5), back.weekdays)
        assertEquals(2, back.every)
        assertEquals(RepeatEnd.AFTER, back.endKind)
        assertEquals(8, back.endAfter)
        assertTrue(back.paused)
    }

    @Test
    fun `a job tied to a conversation starts on after it's done`() {
        assertEquals(RepeatKind.AFTER_DONE, RepeatDraft.forLinked(true).kind)
        assertEquals(RepeatKind.SCHEDULE, RepeatDraft.forLinked(false).kind)
    }

    @Test
    fun `the wire rule carries only what the rule uses`() {
        val body: JsonObject = repeatJson(
            TaskRepeat(
                kind = "schedule", unit = "week", every = 2, weekdays = listOf(1, 3),
                ends = TaskRepeatEnds(kind = "on", on = "2026-12-31"),
            ),
        )
        assertEquals("schedule", body["kind"]?.jsonPrimitive?.content)
        assertEquals("2", body["every"]?.jsonPrimitive?.content)
        assertEquals(listOf("1", "3"), body["weekdays"]?.jsonArray?.map { it.jsonPrimitive.content })
        assertNull(body["month_day"])
        assertNull(body["paused"])
        val ends = body["ends"]!!.jsonObject
        assertEquals("on", ends["kind"]?.jsonPrimitive?.content)
        assertEquals("2026-12-31", ends["on"]?.jsonPrimitive?.content)
        assertNull(ends["after"])
        assertEquals(
            JsonPrimitive(true),
            repeatJson(TaskRepeat(kind = "after_done", unit = "day", every = 1, paused = true))["paused"],
        )
    }

    // ---- filters -----------------------------------------------------------

    @Test
    fun `extra filters key is stable and plain when nothing is set`() {
        assertFalse(TaskExtraFilters().isCustom)
        val a = TaskExtraFilters(priorities = setOf("high", "urgent"), tagId = "g1", sort = TaskSort.Priority)
        val b = TaskExtraFilters(priorities = setOf("urgent", "high"), tagId = "g1", sort = TaskSort.Priority)
        assertEquals(a.key(), b.key())
        assertEquals("urgent,high/g1/priority", a.key())
        assertTrue(a.isCustom)
        assertTrue(TaskExtraFilters(sort = TaskSort.Due).isCustom)
    }

    // ---- history -----------------------------------------------------------

    private fun event(kind: String, from: kotlinx.serialization.json.JsonElement? = null, to: kotlinx.serialization.json.JsonElement? = null) =
        TaskFeedItem(kind = "event", id = "e", created_at = "2026-11-10T12:00:00Z", event = kind, from = from, to = to)

    @Test
    fun `history reads the new event kinds`() {
        assertEquals(
            "Sam set the priority to Urgent",
            taskHistorySentence(event("priority", to = JsonPrimitive("urgent")), "Sam", locale = "en"),
        )
        assertEquals(
            "Sam added the label Warranty",
            taskHistorySentence(
                event("label_added", to = buildJsonObject { put("tag_id", "g1"); put("name", "Warranty") }),
                "Sam", locale = "en",
            ),
        )
        assertEquals(
            "Sam removed the label VIP",
            taskHistorySentence(
                event("label_removed", from = buildJsonObject { put("tag_id", "g2"); put("name", "VIP") }),
                "Sam", locale = "en",
            ),
        )
        assertEquals(
            "Sam set this to repeat: Repeats every day",
            taskHistorySentence(
                event("repeat", to = buildJsonObject { put("kind", "schedule"); put("unit", "day"); put("every", 1) }),
                "Sam", locale = "en",
            ),
        )
        assertEquals(
            "Sam stopped this repeating",
            taskHistorySentence(event("repeat"), "Sam", locale = "en"),
        )
    }

    @Test
    fun `history on a label with no name falls back to updated`() {
        assertEquals(
            "Sam updated this task",
            taskHistorySentence(event("label_added", to = JsonPrimitive("x")), "Sam", locale = "en"),
        )
    }

    @Test
    fun `a label is just a name and a colour`() {
        val label = TaskLabel(id = "g1", name = "Warranty")
        assertNull(label.color)
        assertNotNull(label.id)
    }
}
