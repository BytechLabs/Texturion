package com.loonext.android.features.settings

import com.loonext.android.core.model.SettingChoice
import com.loonext.android.core.model.SettingChoices
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class SettingChoiceNoteTest {
    private val voicemail = SettingChoice(
        key = "after_hours_calls",
        value = JsonPrimitive("voicemail"),
        default_value = JsonPrimitive("ring_everyone"),
        chosen_by = "Dana Whitcomb",
        chosen_at = "2026-08-08T15:31:13Z",
    )

    @Test
    fun `a named actor gets the dated line`() {
        val text = settingChoiceText(voicemail, JsonPrimitive("voicemail"), "Ring everyone", "en")!!
        assertTrue(text, text.startsWith("Dana Whitcomb chose this on "))
        assertTrue(text, text.endsWith(". The default is Ring everyone."))
        assertTrue(text, "2026" in text)
    }

    @Test
    fun `french uses the french sentence`() {
        val text = settingChoiceText(voicemail, JsonPrimitive("voicemail"), "Tout le monde", "fr-CA")!!
        assertTrue(text, text.startsWith("Dana Whitcomb a fait ce choix le "))
        assertTrue(text, text.endsWith(". Par défaut : Tout le monde."))
    }

    @Test
    fun `an unknown actor gets the undated line`() {
        val unknown = voicemail.copy(chosen_by = null, chosen_at = null)
        assertEquals(
            "Changed from the default, which is Ring everyone.",
            settingChoiceText(unknown, JsonPrimitive("voicemail"), "Ring everyone", "en"),
        )
        assertEquals(
            "Différent du réglage par défaut : Tout le monde.",
            settingChoiceText(unknown, JsonPrimitive("voicemail"), "Tout le monde", "fr-CA"),
        )
        val noDate = voicemail.copy(chosen_at = null)
        assertTrue(settingChoiceText(noDate, JsonPrimitive("voicemail"), "x", "en")!!.startsWith("Changed from"))
    }

    @Test
    fun `silent at the default, with no row, or when the list is stale`() {
        assertNull(settingChoiceText(null, JsonPrimitive("ring_everyone"), "x", "en"))
        assertNull(settingChoiceText(voicemail, JsonPrimitive("ring_everyone"), "x", "en"))
        assertNull(settingChoiceText(voicemail, JsonPrimitive("on_call_only"), "x", "en"))
    }

    @Test
    fun `a number default compares numerically`() {
        val ring = SettingChoice("ring_seconds", JsonPrimitive(30), JsonPrimitive(45), "Sam", "2026-08-08T15:31:13Z")
        assertNull(settingChoiceText(ring, JsonPrimitive(45), "45 seconds", "en"))
        assertTrue(settingChoiceText(ring, JsonPrimitive(30.0), "45 seconds", "en") != null)
    }

    @Test
    fun `the endpoint json decodes`() {
        val json = Json { ignoreUnknownKeys = true; explicitNulls = false; coerceInputValues = true }
        val parsed = json.decodeFromString<SettingChoices>(
            """{"data":[
              {"key":"after_hours_calls","value":"voicemail","default_value":"ring_everyone","chosen_by":"Dana Whitcomb","chosen_at":"2026-08-08T03:31:13Z"},
              {"key":"away_enabled","value":true,"default_value":false,"chosen_by":null,"chosen_at":null},
              {"key":"overage_cap_multiplier","value":null,"default_value":3,"chosen_by":null,"chosen_at":null}
            ]}""",
        )
        assertEquals(3, parsed.data.size)
        assertEquals("Dana Whitcomb", parsed.data[0].chosen_by)
        assertNull(parsed.data[1].chosen_by)
        assertEquals(JsonPrimitive(true), parsed.data[1].value)
        assertEquals(JsonNull, parsed.data[2].value)
        assertEquals(JsonPrimitive(3), parsed.data[2].default_value)
    }
}
