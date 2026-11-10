package com.loonext.android.core.time

import java.io.File
import java.time.Instant
import java.time.ZoneId
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/** #720: the Kotlin port against the cases the TypeScript owns. */
class TimestampShapeVectorsTest {
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
    fun `bucket and minutes agree with the TypeScript`() {
        val cases = vectors("timestamp-shape.json").map { it.jsonObject }
        assertTrue("no timestamp-shape vectors", cases.isNotEmpty())
        for (case in cases) {
            val at = Instant.parse(case.getValue("at").jsonPrimitive.content)
            val now = Instant.parse(case.getValue("now").jsonPrimitive.content)
            val zone = ZoneId.of(case.getValue("zone").jsonPrimitive.content)
            val label = "at=$at now=$now zone=$zone"
            val shape = timestampShape(at.toEpochMilli(), now.toEpochMilli(), zone)
            assertEquals("bucket for $label", case.getValue("bucket").jsonPrimitive.content, shape.bucket.wire)
            assertEquals("minutes for $label", case.getValue("minutes").jsonPrimitive.int, shape.minutes)
        }
    }
}
