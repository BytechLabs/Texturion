package com.loonext.android.features.thread

import com.loonext.android.core.i18n.AppStrings
import com.loonext.android.core.model.Message
import com.loonext.android.core.model.MessageDirection
import com.loonext.android.core.model.MessageStatus
import com.loonext.android.core.model.MessageLocale
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNull
import org.junit.Test

/** #725: an automated text says which automation sent it, in both languages. */
class MessageAutomationTest {
    private val fr = MessageLocale.FR_CA

    private fun text(
        automated: Boolean = false,
        automation: String? = null,
        sentBy: String? = "owner",
        direction: String = MessageDirection.OUTBOUND,
    ) = Message(
        id = "m1",
        conversation_id = "c1",
        direction = direction,
        body = "hi",
        status = MessageStatus.SENT,
        sent_by_user_id = sentBy,
        created_at = "2026-11-10T15:00:00Z",
        automated = automated,
        automation = automation,
    )

    @Test
    fun `every automation has its own name in both languages`() {
        val english = MESSAGE_AUTOMATIONS.map { messageAutomationName(it) }
        val french = MESSAGE_AUTOMATIONS.map { messageAutomationName(it, fr) }
        assertEquals(7, MESSAGE_AUTOMATIONS.size)
        english.forEach { assertNotEquals(null, it) }
        french.forEach { assertNotEquals(null, it) }
        assertEquals(english.size, english.toSet().size)
        assertEquals(french.size, french.toSet().size)
        MESSAGE_AUTOMATIONS.indices.forEach { assertNotEquals(english[it], french[it]) }
    }

    @Test
    fun `names match the web catalogue`() {
        assertEquals("Away reply", messageAutomationName("away_reply"))
        assertEquals("Missed-call text", messageAutomationName("missed_call_text"))
        assertEquals("Réponse d’absence", messageAutomationName("away_reply", fr))
        assertNull(messageAutomationName("something_new"))
        assertNull(messageAutomationName(null))
    }

    @Test
    fun `the label reads Sent automatically with the automation, or without it`() {
        assertEquals("Sent automatically · Away reply", sentAutomaticallyLabel("away_reply"))
        assertEquals("Sent automatically", sentAutomaticallyLabel(null))
        assertEquals("Sent automatically", sentAutomaticallyLabel("something_new"))
        assertEquals(
            "Envoyé automatiquement · Rappel de tâche",
            sentAutomaticallyLabel("reminder", fr),
        )
    }

    @Test
    fun `an automated text is not credited to the owner it was sent in the name of`() {
        val names = mapOf("owner" to "Sam Ortiz")
        assertEquals("Sam Ortiz", messageSenderLabel(text(), names))
        assertEquals(
            "Sent automatically · Away reply",
            messageSenderLabel(text(automated = true, automation = "away_reply"), names),
        )
        assertEquals(
            "Sent automatically",
            messageSenderLabel(text(automated = true), names),
        )
        assertNull(messageSenderLabel(text(sentBy = null), names))
    }

    @Test
    fun `the automation keys exist in both catalogues`() {
        val keys = AppStrings.en.keys.filter { it.startsWith("thread.automation") } +
            listOf("thread.sentAutomatically", "thread.sentAutomaticallyBy")
        keys.forEach { key ->
            assertEquals(key, true, AppStrings.frCA.containsKey(key))
        }
        assertEquals(9, keys.size)
    }
}
