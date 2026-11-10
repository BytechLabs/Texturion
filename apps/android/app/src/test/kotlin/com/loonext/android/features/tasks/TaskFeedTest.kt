package com.loonext.android.features.tasks

import com.loonext.android.core.model.TaskFeedItem
import com.loonext.android.core.model.TaskProfile
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.Clock
import java.time.Instant
import java.time.ZoneId

/** The history lines of a task, in the same words as the web. */
class TaskFeedTest {

    private val clock: Clock =
        Clock.fixed(Instant.parse("2026-11-10T16:00:00Z"), ZoneId.of("UTC"))

    private fun event(
        kind: String,
        to: kotlinx.serialization.json.JsonElement? = null,
        toUser: TaskProfile? = null,
    ) = TaskFeedItem(
        kind = "event",
        id = "e1",
        created_at = "2026-11-10T12:00:00Z",
        event = kind,
        to = to,
        to_user = toUser,
    )

    @Test
    fun `names the person and the change`() {
        assertEquals(
            "Rehman created this task",
            taskHistorySentence(event("created"), "Rehman", clock),
        )
        assertTrue(
            taskHistorySentence(event("title", JsonPrimitive("Fix furnace")), "Rehman", clock)
                .contains("Fix furnace"),
        )
    }

    @Test
    fun `says who it was assigned to or that it was unassigned`() {
        val assigned = event("assignee", JsonPrimitive("u2"), TaskProfile("u2", "Sam"))
        assertEquals(
            "Rehman assigned this to Sam",
            taskHistorySentence(assigned, "Rehman", clock),
        )
        assertEquals(
            "Rehman unassigned this task",
            taskHistorySentence(event("assignee", JsonNull), "Rehman", clock),
        )
    }

    @Test
    fun `says who was added to and who was removed from the crew`() {
        val added = TaskFeedItem(
            kind = "event", id = "e2", created_at = "2026-11-10T12:00:00Z",
            event = "assignee_added", to = JsonPrimitive("u3"),
            to_user = TaskProfile("u3", "Ines"),
        )
        val removed = TaskFeedItem(
            kind = "event", id = "e3", created_at = "2026-11-10T12:00:00Z",
            event = "assignee_removed", from = JsonPrimitive("u3"),
            from_user = TaskProfile("u3", "Ines"),
        )
        assertEquals("Rehman added Ines to this task", taskHistorySentence(added, "Rehman", clock))
        assertEquals(
            "Rehman removed Ines from this task",
            taskHistorySentence(removed, "Rehman", clock),
        )
        assertEquals(
            "Rehman a ajouté Ines à cette tâche",
            taskHistorySentence(added, "Rehman", clock, locale = "fr-CA"),
        )
    }

    @Test
    fun `a due time reads as a weekday and time and a cleared one as cleared`() {
        assertEquals(
            "Rehman changed the due time to Tue 2:00 PM",
            taskHistorySentence(
                event("due", JsonPrimitive("2026-11-10T14:00:00Z")),
                "Rehman",
                clock,
            ),
        )
        assertEquals(
            "Rehman cleared the due time",
            taskHistorySentence(event("due", JsonNull), "Rehman", clock),
        )
    }

    @Test
    fun `reminders on and off and done and reopened`() {
        assertEquals(
            "Sam turned reminders off",
            taskHistorySentence(event("reminders", JsonPrimitive(true)), "Sam", clock),
        )
        assertEquals(
            "Sam turned reminders on",
            taskHistorySentence(event("reminders", JsonPrimitive(false)), "Sam", clock),
        )
        assertEquals("Sam marked this done", taskHistorySentence(event("done"), "Sam", clock))
        assertEquals(
            "Sam reopened this task",
            taskHistorySentence(event("reopened"), "Sam", clock),
        )
    }

    @Test
    fun `an unknown kind says the task was updated`() {
        assertEquals(
            "Sam updated this task",
            taskHistorySentence(event("something_new"), "Sam", clock),
        )
    }
}
