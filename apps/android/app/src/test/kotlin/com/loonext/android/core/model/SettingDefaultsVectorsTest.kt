package com.loonext.android.core.model

import java.io.File
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.encodeToJsonElement
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * #749: the Kotlin defaults a payload without a key decodes to must equal the
 * shared setting defaults (packages/shared/vectors/setting-defaults.json).
 * A phone that guessed a default differently showed a setting as off while
 * the server had it on.
 */
class SettingDefaultsVectorsTest {
    private val codec = Json { encodeDefaults = true; explicitNulls = true; ignoreUnknownKeys = true }

    private class Row(val table: String, val key: String, val value: JsonElement, val revenue: Boolean)

    private fun rows(): List<Row> {
        var dir: File? = File("").absoluteFile
        var text: String? = null
        while (dir != null && text == null) {
            val candidate = File(dir, "packages/shared/vectors/setting-defaults.json")
            if (candidate.exists()) text = candidate.readText()
            dir = dir.parentFile
        }
        val array = Json.parseToJsonElement(checkNotNull(text) { "setting-defaults.json not found" }).jsonArray
        return array.map {
            val o = it.jsonObject
            Row(
                o.getValue("table").jsonPrimitive.content,
                o.getValue("key").jsonPrimitive.content,
                o.getValue("value"),
                o["revenue"]?.jsonPrimitive?.booleanOrNull ?: false,
            )
        }
    }

    private fun same(a: JsonElement?, b: JsonElement?): Boolean {
        if (a is JsonPrimitive && b is JsonPrimitive && a !is JsonNull && b !is JsonNull) {
            val x = a.content.toDoubleOrNull()
            val y = b.content.toDoubleOrNull()
            if (x != null && y != null) return x == y
        }
        return a == b
    }

    private fun company(): JsonObject = codec.encodeToJsonElement(
        codec.decodeFromString<CompanyView>(
            """{"id":"c","name":"n","country":"US","us_texting_enabled":true,"requested_area_code":"212",""" +
                """"timezone":"UTC","subscription_status":"active","created_at":"x","updated_at":"x"}""",
        ),
    ).jsonObject

    private fun prefs(): JsonObject = codec.encodeToJsonElement(
        codec.decodeFromString<NotificationPrefs>("""{"email_enabled":true,"push_enabled":true}"""),
    ).jsonObject

    /** Keys the model requires on the wire, so their value here is the fixture's, not a default. */
    private val required = mapOf(
        "companies" to setOf("us_texting_enabled", "timezone"),
        "notification_prefs" to setOf("email_enabled", "push_enabled"),
    )

    /** The attributed keys the Android settings screens edit. */
    private val edited = mapOf(
        "companies" to listOf(
            "after_hours_calls", "ring_strategy", "ring_seconds", "away_enabled",
            "call_screening", "emergency_keyword_enabled", "emergency_reply_enabled",
            "overage_cap_multiplier",
        ),
        "notification_prefs" to listOf("email_enabled", "push_enabled"),
    )

    @Test
    fun `model defaults equal the shared setting defaults`() {
        val all = rows()
        assertTrue("no vector rows", all.isNotEmpty())
        val models = mapOf("companies" to company(), "notification_prefs" to prefs())
        var compared = 0
        val wrong = mutableListOf<String>()
        for ((table, encoded) in models) {
            for (row in all.filter { it.table == table }) {
                if (row.key in required.getValue(table) || row.key !in encoded) continue
                compared++
                if (!same(encoded[row.key], row.value)) {
                    wrong += "$table.${row.key}: model ${encoded[row.key]} vs vector ${row.value}"
                }
            }
        }
        println("setting defaults compared: $compared keys")
        assertTrue("compared zero keys", compared > 0)
        assertEquals("defaults differ from the vectors: $wrong", emptyList<String>(), wrong)
    }

    @Test
    fun `every attributed key a screen edits is on the model`() {
        val all = rows()
        val models = mapOf("companies" to company(), "notification_prefs" to prefs())
        for ((table, keys) in edited) {
            for (key in keys) {
                val row = all.firstOrNull { it.table == table && it.key == key }
                assertTrue("$table.$key is not in the vectors", row != null)
                assertTrue("$table.$key is not attributed in the vectors", row!!.revenue)
                assertTrue("$table.$key is missing from the Android model", key in models.getValue(table))
            }
        }
    }

    @Test
    fun `numbers compare numerically`() {
        assertTrue(same(JsonPrimitive(3), JsonPrimitive(3.0)))
        assertTrue(!same(JsonPrimitive(3), JsonPrimitive(4)))
        assertTrue(!same(JsonPrimitive(true), JsonPrimitive(false)))
    }
}
