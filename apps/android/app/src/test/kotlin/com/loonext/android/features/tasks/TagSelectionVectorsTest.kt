package com.loonext.android.features.tasks

import java.io.File
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/** #713: the Kotlin port against the cases the TypeScript owns. */
class TagSelectionVectorsTest {
    private fun vectors(name: String): JsonArray {
        var dir: File? = File("").absoluteFile
        while (dir != null) {
            val candidate = File(dir, "packages/shared/vectors/$name")
            if (candidate.exists()) return Json.parseToJsonElement(candidate.readText()).jsonArray
            dir = dir.parentFile
        }
        throw AssertionError("vectors/$name not found walking up from ${File("").absolutePath}")
    }

    @Test
    fun `state and action agree with the TypeScript`() {
        val cases = vectors("tag-selection.json").map { it.jsonObject }
        assertTrue("no tag-selection vectors", cases.isNotEmpty())
        for (case in cases) {
            val raw = case.getValue("items")
            val items = if (raw is JsonNull) {
                null
            } else {
                raw.jsonArray.map { row -> row.jsonArray.map { it.jsonPrimitive.content } }
            }
            val tagId = case.getValue("tagId").jsonPrimitive.content
            val label = "items=$items tag=$tagId"
            val state = tagSelectionState(items, tagId)
            assertEquals("state for $label", case.getValue("state").jsonPrimitive.content, state.name.lowercase())
            assertEquals("action for $label", case.getValue("action").jsonPrimitive.content, tagToggleAction(state))
        }
    }
}
