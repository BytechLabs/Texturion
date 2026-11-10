package com.loonext.android.features.tasks

import com.loonext.android.core.model.ConversationEvent
import com.loonext.android.core.model.Task
import com.loonext.android.core.model.TaskDetail
import com.loonext.android.core.model.isCallTask
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** D64: a task promotes a message or an answered call; decoding survives both shapes. */
class CallTaskTest {
    private val json = Json { ignoreUnknownKeys = true }

    private val messageTask = """
        {"id":"t1","company_id":"c1","message_id":"m1","conversation_id":"cv1",
         "source":{"kind":"message","id":"m1"},"call":null,
         "title":"Send the quote","created_by_user_id":"u1",
         "created_at":"2026-07-01T00:00:00Z","updated_at":"2026-07-01T00:00:00Z",
         "done":false,"status":"open"}
    """.trimIndent()

    private val callTask = """
        {"id":"t2","company_id":"c1","message_id":null,"conversation_id":"cv1",
         "source":{"kind":"call","id":"call1"},
         "call":{"id":"call1","call_session_id":"s1","caller_e164":"+14165550100",
                 "caller_name":null,"outcome":"answered","forward_seconds":192,
                 "started_at":"2026-07-01T10:00:00Z","ended_at":"2026-07-01T10:03:12Z",
                 "contact_id":null,"has_voicemail":true},
         "title":"Call from +1 416 555 0100","created_by_user_id":"u1",
         "created_at":"2026-07-01T00:00:00Z","updated_at":"2026-07-01T00:00:00Z",
         "done":true,"status":"done"}
    """.trimIndent()

    @Test
    fun `a message task and a call task both decode`() {
        val m = json.decodeFromString<Task>(messageTask)
        assertEquals("m1", m.message_id)
        assertEquals("message", m.source?.kind)
        assertNull(m.call)
        assertFalse(m.isCallTask)

        val c = json.decodeFromString<Task>(callTask)
        assertNull(c.message_id)
        assertEquals("call1", c.source?.id)
        assertEquals(192, c.call?.forward_seconds)
        assertTrue(c.call?.has_voicemail == true)
        assertTrue(c.isCallTask)
    }

    @Test
    fun `a task row from an older server with no source still decodes`() {
        val old = json.decodeFromString<Task>(
            """{"id":"t1","company_id":"c1","message_id":"m1","conversation_id":"cv1",
               "title":"x","created_by_user_id":"u1",
               "created_at":"2026-07-01T00:00:00Z","updated_at":"2026-07-01T00:00:00Z"}""",
        )
        assertNull(old.source)
    }

    @Test
    fun `task detail decodes a source_call`() {
        val d = json.decodeFromString<TaskDetail>(
            """{"id":"t2","company_id":"c1","message_id":null,"conversation_id":"cv1",
               "source":{"kind":"call","id":"call1"},"source_message":null,
               "source_call":{"id":"call1","call_session_id":"s1","caller_e164":null,
                 "caller_name":"Ana","outcome":"answered","forward_seconds":0,
                 "started_at":"2026-07-01T10:00:00Z","ended_at":null,
                 "contact_id":null,"has_voicemail":false},
               "title":"Call from Ana","created_by_user_id":"u1",
               "created_at":"2026-07-01T00:00:00Z","updated_at":"2026-07-01T00:00:00Z"}""",
        )
        assertTrue(d.isCallTask)
        assertEquals("Ana", d.source_call?.caller_name)
        assertEquals("Ana", taskCallerName(d.source_call!!, "en"))
    }

    private fun event(vararg pairs: Pair<String, String>) = ConversationEvent(
        id = "e1",
        conversation_id = "cv1",
        type = "call_completed",
        payload = JsonObject(pairs.associate { it.first to JsonPrimitive(it.second) }),
        created_at = "2026-07-01T00:00:00Z",
    )

    @Test
    fun `only a plain answered call line offers a task`() {
        assertEquals(
            "s1",
            answeredCallSessionOf(event("outcome" to "answered", "call_session_id" to "s1")),
        )
        assertNull(answeredCallSessionOf(event("outcome" to "missed", "call_session_id" to "s1")))
        assertNull(
            answeredCallSessionOf(
                event("outcome" to "answered", "kind" to "voicemail", "call_session_id" to "s1"),
            ),
        )
        assertNull(answeredCallSessionOf(event("outcome" to "answered")))
    }

    @Test
    fun `a standalone task has no source and may have no conversation`() {
        val t = json.decodeFromString<Task>(
            """{"id":"t3","company_id":"c1","message_id":null,"conversation_id":null,
               "source":null,"call":null,"contact":{"id":"k1","name":"Pat"},
               "title":"Order a filter","created_by_user_id":"u1",
               "created_at":"2026-07-01T00:00:00Z","updated_at":"2026-07-01T00:00:00Z"}""",
        )
        assertNull(t.source)
        assertNull(t.conversation_id)
        assertEquals("Pat", t.contact?.name)
        assertTrue(t.isCallTask)

        val d = json.decodeFromString<TaskDetail>(
            """{"id":"t3","company_id":"c1","message_id":null,"conversation_id":null,
               "source":null,"title":"Order a filter","created_by_user_id":"u1",
               "created_at":"2026-07-01T00:00:00Z","updated_at":"2026-07-01T00:00:00Z"}""",
        )
        assertNull(d.conversation_id)
        assertTrue(d.isCallTask)
    }

    @Test
    fun `a For You task with no conversation decodes`() {
        val row = json.decodeFromString<com.loonext.android.core.model.ForYouTask>(
            """{"task_id":"t3","title":"Order a filter","conversation_id":null,"message_id":null}""",
        )
        assertNull(row.conversation_id)
    }
}
