package com.loonext.android.features.settings

import com.loonext.android.core.i18n.AppStrings
import com.loonext.android.core.model.CompanyView
import com.loonext.android.core.model.MessageLocale
import kotlinx.serialization.json.Json
import com.loonext.android.core.oncall.OnCall
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** #689: the Automatic texts section's pure logic. */
class AutoTextsTest {
    private val json = Json { ignoreUnknownKeys = true; coerceInputValues = true }
    private val en = MessageLocale.EN
    private val fr = MessageLocale.FR_CA

    private val minimal = """
        {"id":"c1","name":"Northside Plumbing","country":"US","us_texting_enabled":true,
         "requested_area_code":"415","timezone":"America/Toronto",
         "subscription_status":"active","created_at":"2026-01-01T00:00:00Z",
         "updated_at":"2026-01-01T00:00:00Z"
         EXTRA}
    """.trimIndent()

    private fun decode(extra: String = ""): CompanyView =
        json.decodeFromString(CompanyView.serializer(), minimal.replace("EXTRA", extra))

    @Test
    fun `absent keys decode to the server defaults, never false or zero`() {
        val c = decode()
        assertTrue(c.hold_scheduled_on_reply)
        assertTrue(c.hold_reminders_on_reply)
        assertTrue(c.hold_rating_ask_on_reply)
        assertTrue(c.hold_reminders_unverified_calendar)
        assertTrue(c.rating_ask_enabled)
        assertEquals(4, c.rating_ask_delay_hours)
        assertEquals(24, c.rating_ask_expiry_hours)
        assertEquals(30, c.rating_ask_cooldown_days)
        assertEquals(24, c.scheduled_text_expiry_hours)
        assertEquals(2, c.reminder_expiry_hours)
        assertEquals(180, c.auto_reply_cooldown_minutes)
    }

    @Test
    fun `present keys win over the defaults`() {
        val c = decode(""","hold_scheduled_on_reply":false,"rating_ask_delay_hours":0,"auto_reply_cooldown_minutes":60""")
        assertFalse(c.hold_scheduled_on_reply)
        assertEquals(0, c.rating_ask_delay_hours)
        assertEquals(60, c.auto_reply_cooldown_minutes)
    }

    @Test
    fun `defaults stated on screen equal the model defaults`() {
        val c = decode()
        for (f in AutoTexts.ratingGroup + AutoTexts.waitGroup) {
            assertEquals(f.key, f.default, f.read(c))
            assertTrue("${f.key} default is a preset", f.default in f.choices)
        }
        for (f in AutoTexts.holdGroup + AutoTexts.ratingEnabled) assertTrue(f.read(c))
    }

    @Test
    fun `choices include the current value when it is not a preset`() {
        val f = AutoTexts.ratingDelay
        assertEquals(listOf(0, 1, 2, 4, 8, 12, 24, 48), AutoTexts.choicesWithCurrent(f, 4))
        assertEquals(listOf(0, 1, 2, 3, 4, 8, 12, 24, 48), AutoTexts.choicesWithCurrent(f, 3))
        assertEquals(listOf(0, 1, 2, 4, 8, 12, 24, 48, 100), AutoTexts.choicesWithCurrent(f, 100))
    }

    @Test
    fun `durations read in plain words`() {
        val h = AutoTexts.Unit.Hours
        assertEquals("Right away", AutoTexts.durationLabel(0, h, en))
        assertEquals("1 hour", AutoTexts.durationLabel(1, h, en))
        assertEquals("4 hours", AutoTexts.durationLabel(4, h, en))
        assertEquals("1 day", AutoTexts.durationLabel(24, h, en))
        assertEquals("30 days", AutoTexts.durationLabel(720, h, en))
        assertEquals("30 days", AutoTexts.durationLabel(30, AutoTexts.Unit.Days, en))
        assertEquals("30 minutes", AutoTexts.durationLabel(30, AutoTexts.Unit.Minutes, en))
        assertEquals("3 hours", AutoTexts.durationLabel(180, AutoTexts.Unit.Minutes, en))
        assertEquals("1 day", AutoTexts.durationLabel(1440, AutoTexts.Unit.Minutes, en))
        assertEquals("90 minutes", AutoTexts.durationLabel(90, AutoTexts.Unit.Minutes, en))
    }

    @Test
    fun `french durations take the right plural`() {
        val h = AutoTexts.Unit.Hours
        assertEquals("Tout de suite", AutoTexts.durationLabel(0, h, fr))
        assertEquals("1 heure", AutoTexts.durationLabel(1, h, fr))
        assertEquals("4 heures", AutoTexts.durationLabel(4, h, fr))
        assertEquals("1 jour", AutoTexts.durationLabel(1440, AutoTexts.Unit.Minutes, fr))
        assertEquals("3 jours", AutoTexts.durationLabel(72, h, fr))
        assertEquals("1 minute", AutoTexts.durationLabel(1, AutoTexts.Unit.Minutes, fr))
        assertEquals("30 minutes", AutoTexts.durationLabel(30, AutoTexts.Unit.Minutes, fr))
    }

    @Test
    fun `every control names its own default`() {
        assertEquals("Default: 4 hours", AutoTexts.defaultCaption(AutoTexts.ratingDelay, en))
        assertEquals("Par défaut : 3 heures", AutoTexts.defaultCaption(AutoTexts.replyCooldown, fr))
        assertEquals("Default: on", AutoTexts.defaultCaption(en))
        assertEquals("Par défaut : activé", AutoTexts.defaultCaption(fr))
        assertEquals(
            "On: it waits for you. Default: on",
            AutoTexts.switchCaption(AutoTexts.holdScheduled, true, en),
        )
        assertEquals(
            "Désactivé : il part quand même. Par défaut : activé",
            AutoTexts.switchCaption(AutoTexts.holdScheduled, false, fr),
        )
    }

    @Test
    fun `a patch carries only the field that changed`() {
        assertEquals(
            """{"hold_reminders_on_reply":false}""",
            AutoTexts.patch(AutoTexts.holdReminders, false).toString(),
        )
        assertEquals(
            """{"rating_ask_cooldown_days":60}""",
            AutoTexts.patch(AutoTexts.ratingCooldown, 60).toString(),
        )
    }

    @Test
    fun `the section is admin-only`() {
        assertFalse(visibleSettingsSections("member").contains(SettingsSection.AutomaticTexts))
        assertFalse(visibleSettingsSections("bookkeeper").contains(SettingsSection.AutomaticTexts))
        assertTrue(visibleSettingsSections("admin").contains(SettingsSection.AutomaticTexts))
        assertTrue(visibleSettingsSections("owner").contains(SettingsSection.AutomaticTexts))
    }

    @Test
    fun `scheduled texts is a notification category right after tasks`() {
        val keys = OnCall.CATEGORY_KEYS.keys.toList()
        assertEquals(keys.indexOf("tasks") + 1, keys.indexOf("scheduled_texts"))
        for (locale in listOf(en, fr)) {
            val label = OnCall.categoryLabels(locale)["scheduled_texts"]
            assertTrue(label != null && label != "domain.categoryScheduledTexts")
        }
        assertEquals(
            "Textos planifiés retenus ou non envoyés",
            AppStrings.translate(fr, "domain.categoryScheduledTexts"),
        )
    }
}
