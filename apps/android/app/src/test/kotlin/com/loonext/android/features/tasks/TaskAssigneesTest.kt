package com.loonext.android.features.tasks

import com.loonext.android.core.model.Task
import com.loonext.android.core.model.TaskProfile
import kotlinx.serialization.json.Json
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** #689 C: several people on a task, and every place that used to assume one. */
class TaskAssigneesTest {

    private val json = Json { ignoreUnknownKeys = true }

    private val base = """
        "id":"t1","company_id":"c1","title":"Pour the slab","created_by_user_id":"u1",
        "created_at":"2026-07-01T00:00:00Z","updated_at":"2026-07-01T00:00:00Z"
    """.trimIndent()

    @Test
    fun `a payload with the crew decodes it and the first stays the single assignee`() {
        val task = json.decodeFromString<Task>(
            """{$base,"assigned_user_id":"u2","assignee_ids":["u2","u3"],
                "assignees":[{"user_id":"u2","display_name":"Sam"},{"user_id":"u3","display_name":"Ines"}]}""",
        )
        assertEquals(listOf("u2", "u3"), task.assigneeIdList)
        assertEquals(listOf("Sam", "Ines"), task.assignees.map { it.display_name })
    }

    @Test
    fun `an older payload falls back to the single assignee and an unassigned one is empty`() {
        val old = json.decodeFromString<Task>("""{$base,"assigned_user_id":"u2"}""")
        assertEquals(listOf("u2"), old.assigneeIdList)
        val nobody = json.decodeFromString<Task>("""{$base,"assigned_user_id":null,"assignee_ids":[]}""")
        assertTrue(nobody.assigneeIdList.isEmpty())
    }

    @Test
    fun `mine is membership in the crew, not equality with the first assignee`() {
        assertTrue(taskAssignedTo(listOf("u2", "u3"), "u2", "u3"))
        assertFalse(taskAssignedTo(listOf("u2", "u3"), "u2", "u9"))
        assertTrue(taskAssignedTo(emptyList(), "u2", "u2"))
        assertFalse(taskAssignedTo(emptyList(), null, "u2"))
        assertFalse(taskAssignedTo(listOf("u2"), "u2", null))
    }

    @Test
    fun `names prefer the server profile then the member list`() {
        val names = taskAssigneeNames(
            listOf("u2", "u3", "u4"),
            listOf(TaskProfile("u2", "Sam"), TaskProfile("u3", " ".trim())),
        ) { id -> if (id == "u3") "Ines" else null }
        assertEquals(listOf<String?>("Sam", "Ines", null), names)
    }

    @Test
    fun `toggling adds, removes and refuses the eleventh person`() {
        assertEquals(listOf("a", "b"), toggleAssignee(listOf("a"), "b"))
        assertEquals(listOf("a"), toggleAssignee(listOf("a", "b"), "b"))
        val ten = (1..MAX_TASK_ASSIGNEES).map { "u$it" }
        assertNull(toggleAssignee(ten, "extra"))
        assertEquals(ten.drop(1), toggleAssignee(ten, "u1"))
    }
}
