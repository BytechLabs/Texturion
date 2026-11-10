package com.loonext.android.features.tasks

import java.io.File
import java.time.Instant
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.boolean
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * #689 A and #690: the Kotlin ports against the cases the TypeScript owns.
 *
 * The vectors are read from `packages/shared/vectors/` rather than copied, for
 * the reason `ParityVectorsTest` gives: a copy is a fourth place the cases live.
 */
class TaskReferenceVectorsTest {
    private fun vectors(name: String): JsonArray {
        var dir: File? = File("").absoluteFile
        while (dir != null) {
            val candidate = File(dir, "packages/shared/vectors/$name")
            if (candidate.exists()) return Json.parseToJsonElement(candidate.readText()).jsonArray
            dir = dir.parentFile
        }
        throw AssertionError("vectors/$name not found walking up from ${File("").absolutePath}")
    }

    private fun JsonElement.str(key: String): String = jsonObject.getValue(key).jsonPrimitive.content

    @Test
    fun `reference tokens agree with the TypeScript`() {
        val cases = vectors("task-references.json").map { it.jsonObject }.filter { it.str("kind") == "tokens" }
        assertTrue("no token vectors", cases.isNotEmpty())
        for (case in cases) {
            val text = case.str("text")
            val expected = case.getValue("tokens").jsonArray.map { it.jsonObject }
            val actual = parseReferenceTokens(text)
            assertEquals("count for '$text'", expected.size, actual.size)
            expected.zip(actual).forEach { (want, got) ->
                val label = "token in '$text'"
                val kind = when (want.str("kind")) {
                    "task" -> ReferenceKind.Task
                    "contact" -> ReferenceKind.Contact
                    else -> ReferenceKind.Conversation
                }
                assertEquals("$label kind", kind, got.kind)
                assertEquals("$label key", want.str("key"), got.key)
                assertEquals("$label start", want.getValue("start").jsonPrimitive.int, got.start)
                assertEquals("$label end", want.getValue("end").jsonPrimitive.int, got.end)
            }
        }
    }

    @Test
    fun `the query at the caret agrees with the TypeScript`() {
        val cases = vectors("task-references.json").map { it.jsonObject }.filter { it.str("kind") == "query" }
        assertTrue("no query vectors", cases.isNotEmpty())
        for (case in cases) {
            val text = case.str("text")
            val caret = case.getValue("caret").jsonPrimitive.int
            val got = referenceQueryAt(text, caret)
            val want = case.getValue("at")
            if (want is JsonNull) {
                assertNull("query in '$text'", got)
            } else {
                assertNotNull("query in '$text'", got)
                assertEquals(want.jsonObject.getValue("start").jsonPrimitive.int, got!!.start)
                assertEquals(want.str("query"), got.query)
            }
        }
    }

    @Test
    fun `a picked reference writes plain text`() {
        assertEquals("#T-142", taskReferenceText(142))
        assertEquals("T-142", taskNumberLabel(142))
        assertEquals(
            "#contact-1a2b3c4d",
            recordReferenceText(ReferenceKind.Contact, "1A2B3C4D-0000-4000-8000-000000000000"),
        )
        assertEquals(
            "#conv-abcdef01",
            recordReferenceText(ReferenceKind.Conversation, "abcdef01-0000-4000-8000-000000000000"),
        )
        val text = "see #T-1"
        val query = referenceQueryAt(text, text.length)!!
        val (next, caret) = insertReference(text, query, text.length, "#T-142")
        assertEquals("see #T-142 ", next)
        assertEquals(next.length, caret)
    }

    @Test
    fun `quick add agrees with the TypeScript`() {
        val cases = vectors("quick-add.json").map { it.jsonObject }
        assertTrue("no quick-add vectors", cases.isNotEmpty())
        for (case in cases) {
            val line = case.str("line")
            val label = "quick add '$line' at ${case.str("now")}"
            val ctx = QuickAddContext(
                now = Instant.parse(case.str("now")),
                timeZone = case.str("timeZone"),
                selfUserId = case.str("selfUserId"),
                members = case.getValue("members").jsonArray.map {
                    QuickAddMember(it.str("userId"), it.str("name"))
                },
                labels = case.getValue("labels").jsonArray.map {
                    QuickAddLabel(it.str("id"), it.str("name"))
                },
            )
            val got = parseQuickAdd(line, ctx)
            assertEquals("$label: title", case.str("title"), got.title)
            assertEquals(
                "$label: assignee",
                case.getValue("assignee_user_id").let { if (it is JsonNull) null else it.jsonPrimitive.content },
                got.assignee?.userId,
            )
            assertEquals(
                "$label: due_at",
                case.getValue("due_at").let { if (it is JsonNull) null else it.jsonPrimitive.content },
                got.dueAt,
            )
            assertEquals("$label: due_has_time", case.getValue("due_has_time").jsonPrimitive.boolean, got.dueHasTime)
            assertEquals(
                "$label: priority",
                case.getValue("priority").let { if (it is JsonNull) null else it.jsonPrimitive.content },
                got.priority,
            )
            assertEquals(
                "$label: label ids",
                case.getValue("label_ids").jsonArray.map { it.jsonPrimitive.content },
                got.labels.map { it.id },
            )
            assertEquals(
                "$label: understood",
                case.getValue("understood").jsonArray.map {
                    it.jsonArray[0].jsonPrimitive.content to it.jsonArray[1].jsonPrimitive.content
                },
                got.understood.map { it.kind to it.text },
            )
            assertEquals(
                "$label: ignored",
                case.getValue("ignored").jsonArray.map { it.jsonPrimitive.content },
                got.ignored,
            )
        }
    }
}
