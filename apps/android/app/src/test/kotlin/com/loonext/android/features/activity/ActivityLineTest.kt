package com.loonext.android.features.activity

import com.loonext.android.core.i18n.AppStrings
import com.loonext.android.core.model.MessageLocale
import java.time.LocalDate
import java.time.ZoneOffset
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * #714 / #725: the vectors of `apps/web/src/components/activity/activity-line.test.ts`
 * and `activity-timeline.test.tsx`, so the phone reads one event the way the web does.
 */
class ActivityLineTest {
    private val fr = MessageLocale.FR_CA
    private val names = mapOf("u1" to "Sam Ortiz", "u2" to "Ana Lee")
    private val nameOf: (String?) -> String? = { id -> id?.let { names[it] } }

    private fun item(
        kind: String,
        payload: JsonObject = JsonObject(emptyMap()),
        category: String = "change",
        source: ActivitySource? = null,
        at: String = "2026-11-10T15:00:00.000Z",
        actor: ActivityActor = ActivityActor("member", "u1", "Sam Ortiz"),
    ) = ActivityItem("id-$kind", kind, category, at, actor, payload, source)

    private fun say(
        item: ActivityItem,
        locale: String? = null,
        type: ActivityRecordType = ActivityRecordType.CONTACT,
        recordId: String = "c1",
    ) = activityLine(item, type, recordId, nameOf, locale).text

    private fun step(kind: String, payload: JsonObject = JsonObject(emptyMap())) =
        item(kind, payload, "call", ActivitySource("call", "call-1", null))

    private fun obj(vararg pairs: Pair<String, JsonElement>) = JsonObject(mapOf(*pairs))

    private val callSteps = listOf(
        "call_arrived", "call_placed", "call_rang", "call_declined",
        "call_answered", "call_voicemail", "call_ended",
    )

    @Test
    fun `every call step kind has its own sentence in both languages`() {
        val unknownEn = AppStrings.translate(null, "activity.unknownKind")
        val unknownFr = AppStrings.translate(fr, "activity.unknownKind")
        for (kind in callSteps) {
            assertNotEquals(kind, unknownEn, say(step(kind)))
            assertNotEquals(kind, unknownFr, say(step(kind), fr))
        }
    }

    @Test
    fun `names whose phones rang and who asked to be rung`() {
        val both = obj("user_ids" to JsonArray(listOf(JsonPrimitive("u1"), JsonPrimitive("u2"))))
        assertEquals("Rang Sam Ortiz, Ana Lee", say(step("call_rang", both)))
        val asked = obj("user_ids" to JsonArray(listOf(JsonPrimitive("u2"))), "asked" to JsonPrimitive(true))
        assertEquals("Ana Lee asked to be rung", say(step("call_rang", asked)))
        val gone = obj("user_ids" to JsonArray(listOf(JsonPrimitive("nobody"))))
        assertEquals("Rang someone", say(step("call_rang", gone)))
    }

    @Test
    fun `says why it came in and why it went to voicemail`() {
        assertEquals("Call came in", say(step("call_arrived", buildJsonObject { put("routing", "rang") })))
        assertEquals(
            "Call came in · " + AppStrings.translate(null, "shell.callRoutingAfterHours"),
            say(step("call_arrived", buildJsonObject { put("routing", "after_hours") })),
        )
        assertEquals(
            "Went to voicemail · " + AppStrings.translate(null, "shell.callEndedNoAnswerInTime"),
            say(step("call_voicemail", buildJsonObject { put("cause", "no_answer_in_time") })),
        )
        assertEquals(
            "Went to voicemail · " + AppStrings.translate(null, "shell.callRoutingAfterHours"),
            say(step("call_voicemail", buildJsonObject { put("cause", "after_hours") })),
        )
        assertEquals("Went to voicemail", say(step("call_voicemail", obj("cause" to JsonNull))))
    }

    @Test
    fun `says how long the call lasted and why it ended`() {
        assertEquals(
            "Call ended · after 12s · " + AppStrings.translate(null, "shell.callEndedCallerHungUp"),
            say(step("call_ended", buildJsonObject { put("reason", "caller_hung_up"); put("seconds", 12) })),
        )
        assertEquals(
            "Call ended",
            say(step("call_ended", buildJsonObject { put("reason", "answered"); put("seconds", 0) })),
        )
    }

    @Test
    fun `an automated text says which automation sent it`() {
        fun text(payload: JsonObject) = item("text_out", payload, "message")
        assertEquals(
            "Text sent automatically · Missed-call text",
            say(text(buildJsonObject { put("automated", true); put("automation", "missed_call_text") })),
        )
        assertEquals(
            "Text sent automatically",
            say(text(obj("automated" to JsonPrimitive(true), "automation" to JsonNull))),
        )
        assertEquals("Text sent", say(text(buildJsonObject { put("automated", false) })))
        assertEquals(
            "Texto envoyé automatiquement · Texto d’appel manqué",
            say(text(buildJsonObject { put("automated", true); put("automation", "missed_call_text") }), fr),
        )
    }

    @Test
    fun `says a call with its direction, outcome, talk time and why it ended`() {
        val line = say(
            item(
                "call",
                buildJsonObject {
                    put("direction", "inbound")
                    put("outcome", "missed")
                    put("talk_seconds", 0)
                    put("ended_reason", "no_answer_in_time")
                },
                "call",
            ),
        )
        assertTrue(line, line.contains("Incoming call, not answered"))
        assertEquals(2, line.split(" · ").size)
    }

    @Test
    fun `says an edit with the field, before and after`() {
        assertEquals(
            "Changed name from Jane to Jane Doe",
            say(item("edited", buildJsonObject { put("field", "name"); put("from", "Jane"); put("to", "Jane Doe") })),
        )
    }

    @Test
    fun `says a cleared field and a boolean`() {
        assertEquals(
            "Cleared email (was a@b.co)",
            say(item("edited", obj("field" to JsonPrimitive("email"), "from" to JsonPrimitive("a@b.co"), "to" to JsonNull))),
        )
        assertEquals(
            "Set spam flag to yes",
            say(item("edited", buildJsonObject { put("field", "spam"); put("to", true) })),
        )
    }

    @Test
    fun `names the teammate in an assignment and a mention and falls back for one who left`() {
        assertEquals("Assigned to Sam Ortiz", say(item("assigned", buildJsonObject { put("to_user_id", "u1") })))
        assertEquals("Mentioned someone", say(item("mentioned", buildJsonObject { put("user_id", "gone") })))
        assertEquals("Unassigned", say(item("unassigned")))
    }

    @Test
    fun `says how an opt-out happened`() {
        assertEquals(
            "Opted out by texting STOP",
            say(item("opted_out", buildJsonObject { put("source", "stop_keyword") })),
        )
        assertEquals(
            "Opted out by a teammate",
            say(item("opted_out", buildJsonObject { put("source", "manual") })),
        )
        assertEquals("Opted out", say(item("opted_out")))
    }

    @Test
    fun `links a text to its message in its thread and a job to the job`() {
        val text = activityLine(
            item("text_in", category = "message", source = ActivitySource("message", "m1", "conv-1")),
            ActivityRecordType.CONTACT, "c1", nameOf,
        )
        assertEquals(ActivityOpen.Thread("conv-1", "m1"), text.open)
        val task = activityLine(
            item("task_created", buildJsonObject { put("title", "Fix tap") }, source = ActivitySource("task", "t1", null)),
            ActivityRecordType.CONTACT, "c1", nameOf,
        )
        assertEquals(ActivityOpen.Task("t1"), task.open)
        assertEquals("Job created: Fix tap", task.text)
    }

    @Test
    fun `does not link a job's own events back to the job`() {
        val line = activityLine(
            item("created", source = ActivitySource("task", "t1", null)),
            ActivityRecordType.TASK, "t1", nameOf,
        )
        assertNull(line.open)
    }

    @Test
    fun `speaks French for every kind it knows`() {
        val kinds = listOf(
            "text_in", "text_out", "scheduled_queued", "scheduled_sent", "scheduled_cancelled",
            "call", "voicemail", "created", "edited", "tagged", "untagged", "merged", "unmerged",
            "deleted", "restored", "assigned", "unassigned", "mentioned", "referenced",
            "opted_out", "opted_in", "blocked", "unblocked", "task_created", "task_completed",
            "completed", "reopened",
        ) + callSteps
        val unknown = AppStrings.translate(null, "activity.unknownKind")
        for (kind in kinds) {
            assertNotEquals(kind, "", say(item(kind), fr))
            assertNotEquals(kind, unknown, say(item(kind)))
        }
    }

    @Test
    fun `the catalogue has the same activity keys in both languages`() {
        val en = AppStrings.en.keys.filter { it.startsWith("activity.") }.toSet()
        val french = AppStrings.frCA.keys.filter { it.startsWith("activity.") }.toSet()
        assertEquals(en, french)
        assertTrue(en.size > 100)
    }

    @Test
    fun `who did it`() {
        assertEquals("Sam Ortiz", activityActor(item("created"), nameOf))
        assertEquals(
            "Ana Lee",
            activityActor(item("created", actor = ActivityActor("member", "u2", null)), nameOf),
        )
        assertEquals(
            "A teammate",
            activityActor(item("created", actor = ActivityActor("member", "gone", null)), nameOf),
        )
        assertEquals("The customer", activityActor(item("text_in", actor = ActivityActor("customer")), nameOf))
        assertEquals("Automation", activityActor(item("text_out", actor = ActivityActor("automation")), nameOf))
        assertEquals("Loonext", activityActor(item("call_arrived", actor = ActivityActor("system")), nameOf))
    }

    @Test
    fun `the four paths and the four filters`() {
        assertEquals("/v1/contacts/x/activity", ActivityRecordType.CONTACT.path("x"))
        assertEquals("/v1/conversations/x/activity", ActivityRecordType.CONVERSATION.path("x"))
        assertEquals("/v1/calls/x/activity", ActivityRecordType.CALL.path("x"))
        assertEquals("/v1/tasks/x/record-activity", ActivityRecordType.TASK.path("x"))
        assertEquals(
            listOf("All", "Messages", "Calls", "Changes"),
            ACTIVITY_FILTERS.map { AppStrings.translate(null, it.second) },
        )
        assertEquals(listOf(null, "message", "call", "change"), ACTIVITY_FILTERS.map { it.first?.wire })
    }

    @Test
    fun `keeps the order given and groups by local calendar day`() {
        val rows = listOf("2026-11-10T20:00:00Z", "2026-11-10T08:00:00Z", "2026-11-09T08:00:00Z")
        val groups = groupActivityByDay(rows, { it }, ZoneOffset.UTC)
        assertEquals(listOf(LocalDate.parse("2026-11-10"), LocalDate.parse("2026-11-09")), groups.map { it.first })
        assertEquals(2, groups[0].second.size)
        val offset = groupActivityByDay(listOf("2026-11-10T03:00:00+00:00"), { it }, ZoneOffset.ofHours(-8))
        assertEquals(LocalDate.parse("2026-11-09"), offset.single().first)
    }

    @Test
    fun `a day heading is a calendar day in the reader's language`() {
        assertEquals("November 10, 2026", activityDayLabel(LocalDate.parse("2026-11-10"), null))
        assertTrue(activityDayLabel(LocalDate.parse("2026-11-10"), fr).contains("novembre"))
    }
}
