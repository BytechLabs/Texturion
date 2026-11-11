package com.loonext.android.features.settings

import com.loonext.android.core.i18n.AppStrings
import com.loonext.android.core.model.MessageLocale
import com.loonext.android.core.model.TrashCallDetail
import com.loonext.android.core.model.TrashConversationDetail
import com.loonext.android.core.model.TrashItem
import com.loonext.android.core.model.TrashMessageDetail
import com.loonext.android.core.model.TrashVoicemailDetail
import java.time.Instant
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/** #735: the Trash row's words and arithmetic, the same as web's trash-row. */
class TrashLogicTest {
    private val en: Say = { key, vars -> AppStrings.translate(MessageLocale.EN, key, vars) }
    private val fr: Say = { key, vars -> AppStrings.translate(MessageLocale.FR_CA, key, vars) }
    private val now = Instant.parse("2026-11-10T12:00:00Z")

    private fun item(kind: String, id: String = "x1", build: (TrashItem) -> TrashItem = { it }) = build(
        TrashItem(id = id, kind = kind, deleted_at = "2026-11-09T12:00:00Z", purge_after = "2026-12-09T12:00:00Z"),
    )

    @Test
    fun `days left rounds up and never says a day when less than a day remains`() {
        assertEquals(0, trashDaysLeft("2026-11-11T11:59:59Z", now))
        assertEquals(1, trashDaysLeft("2026-11-11T12:00:00Z", now))
        assertEquals(2, trashDaysLeft("2026-11-11T12:00:01Z", now))
        assertEquals(30, trashDaysLeft("2026-12-10T12:00:00Z", now))
        assertEquals(0, trashDaysLeft("not a date", now))
        assertEquals(0, trashDaysLeft("2026-11-01T12:00:00Z", now))
    }

    @Test
    fun `days left label picks today, one and many`() {
        assertEquals("Erased within a day", trashDaysLeftLabel("2026-11-10T20:00:00Z", en, now))
        assertEquals("1 day left", trashDaysLeftLabel("2026-11-11T12:00:00Z", en, now))
        assertEquals("30 days left", trashDaysLeftLabel("2026-12-10T12:00:00Z", en, now))
        assertEquals("30 jours restants", trashDaysLeftLabel("2026-12-10T12:00:00Z", fr, now))
    }

    @Test
    fun `kind label tells a note from a message`() {
        assertEquals("Conversation", trashKindLabel(item("conversation"), en))
        assertEquals("Message", trashKindLabel(item("message") { it.copy(message = TrashMessageDetail(direction = "inbound")) }, en))
        assertEquals("Note", trashKindLabel(item("message") { it.copy(message = TrashMessageDetail(direction = "note")) }, en))
        assertEquals("Call", trashKindLabel(item("call"), en))
        assertEquals("Message vocal", trashKindLabel(item("voicemail"), fr))
    }

    @Test
    fun `who is the name, then the number, then unknown`() {
        val named = item("conversation") { it.copy(conversation = TrashConversationDetail(contact_name = " Dana ", contact_phone = "+14165550134")) }
        val numbered = item("conversation") { it.copy(conversation = TrashConversationDetail(contact_name = "  ", contact_phone = "+14165550134")) }
        val neither = item("conversation") { it.copy(conversation = TrashConversationDetail()) }
        assertEquals("Dana", trashWhoLabel(named, en))
        assertEquals("(416) 555-0134", trashWhoLabel(numbered, en))
        assertEquals("Unknown contact", trashWhoLabel(neither, en))
    }

    @Test
    fun `detail line says what is inside`() {
        assertEquals("1 message", trashDetailLabel(item("conversation") { it.copy(conversation = TrashConversationDetail(message_count = 1)) }, en))
        assertEquals("12 messages", trashDetailLabel(item("conversation") { it.copy(conversation = TrashConversationDetail(message_count = 12)) }, en))
        assertEquals("See you", trashDetailLabel(item("message") { it.copy(message = TrashMessageDetail(snippet = " See you ")) }, en))
        assertEquals("No text", trashDetailLabel(item("message") { it.copy(message = TrashMessageDetail(snippet = null)) }, en))
        assertEquals("Missed", trashDetailLabel(item("call") { it.copy(call = TrashCallDetail(outcome = "missed")) }, en))
        assertEquals(
            "Answered · Includes a voicemail",
            trashDetailLabel(item("call") { it.copy(call = TrashCallDetail(outcome = "answered", has_voicemail = true)) }, en),
        )
        assertEquals(
            "Went to voicemail",
            trashDetailLabel(item("call") { it.copy(call = TrashCallDetail(outcome = "voicemail", has_voicemail = true)) }, en),
        )
        assertEquals("42s voicemail", trashDetailLabel(item("voicemail") { it.copy(voicemail = TrashVoicemailDetail(voicemail_seconds = 42)) }, en))
        assertEquals("Voicemail", trashDetailLabel(item("voicemail") { it.copy(voicemail = TrashVoicemailDetail()) }, en))
    }

    @Test
    fun `deleted line names you, and stays silent about somebody else`() {
        val mine = item("call") { it.copy(deleted_by_user_id = "me") }
        val theirs = item("call") { it.copy(deleted_by_user_id = "other") }
        assertEquals("Deleted 3:42 PM by you", trashDeletedLine(mine, "me", "3:42 PM", en))
        assertEquals("Deleted 3:42 PM", trashDeletedLine(theirs, "me", "3:42 PM", en))
        assertEquals("Deleted 3:42 PM", trashDeletedLine(item("call"), "me", "3:42 PM", en))
    }

    @Test
    fun `a call and its voicemail are two rows`() {
        assertTrue(trashKey(item("call", "c1")) != trashKey(item("voicemail", "c1")))
    }

    @Test
    fun `every trash key is in both languages`() {
        val keys = AppStrings.en.keys.filter { it.startsWith("trash.") }
        assertTrue(keys.size > 30)
        assertEquals(keys.toSet(), AppStrings.frCA.keys.filter { it.startsWith("trash.") }.toSet())
    }
}
