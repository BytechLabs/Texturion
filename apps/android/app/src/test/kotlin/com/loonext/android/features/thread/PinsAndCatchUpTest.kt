package com.loonext.android.features.thread

import com.loonext.android.core.i18n.AppStrings
import com.loonext.android.core.model.Message
import com.loonext.android.core.model.MessageDirection
import com.loonext.android.core.model.MessageLocale
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** #716: the pin stack's order, and when the catch-up hint shows and comes back. */
class PinsAndCatchUpTest {

    private fun message(
        id: String,
        at: String = "2026-11-01T10:00:00Z",
        direction: String = MessageDirection.INBOUND,
        by: String? = null,
        pinnedAt: String? = null,
    ) = Message(
        id = id,
        conversation_id = "c1",
        direction = direction,
        body = "hello $id",
        sent_by_user_id = by,
        pinned_at = pinnedAt,
        created_at = at,
    )

    @Test
    fun `the newest pin leads the stack`() {
        val pins = pinsNewestFirst(
            listOf(
                message("a", pinnedAt = "2026-11-01T10:00:00Z"),
                message("b", pinnedAt = "2026-11-03T10:00:00Z"),
                message("c", pinnedAt = "2026-11-02T10:00:00Z"),
                message("d"),
            ),
        )
        assertEquals(listOf("b", "c", "a"), pins.map { it.id })
    }

    @Test
    fun `the hint follows the offer rule`() {
        assertTrue(catchUpHintShown(true, false, "m1", null))
        assertFalse(catchUpHintShown(false, false, "m1", null))
    }

    @Test
    fun `an answered hint stays hidden until a newer message from someone else`() {
        assertFalse(catchUpHintShown(true, false, "m1", "m1"))
        assertTrue(catchUpHintShown(true, false, "m2", "m1"))
    }

    @Test
    fun `a recap on screen hides the hint`() {
        assertFalse(catchUpHintShown(true, true, "m1", null))
    }

    @Test
    fun `a thread with nothing from anyone else offers no hint`() {
        assertFalse(catchUpHintShown(true, false, null, null))
    }

    @Test
    fun `my own reply is not news`() {
        val messages = listOf(
            message("in1", at = "2026-11-01T10:00:00Z"),
            message("mine", at = "2026-11-01T11:00:00Z", direction = MessageDirection.OUTBOUND, by = "me"),
        )
        assertEquals("in1", newestNotMineId(messages, "me"))
    }

    @Test
    fun `a teammate's reply and a customer's text both count, notes do not`() {
        val messages = listOf(
            message("in1", at = "2026-11-01T10:00:00Z"),
            message("mate", at = "2026-11-01T11:00:00Z", direction = MessageDirection.OUTBOUND, by = "other"),
            message("note", at = "2026-11-01T12:00:00Z", direction = "note", by = "other"),
        )
        assertEquals("mate", newestNotMineId(messages, "me"))
        assertNull(newestNotMineId(emptyList(), "me"))
    }

    @Test
    fun `the new strings exist in both languages`() {
        for (locale in listOf("en", MessageLocale.FR_CA)) {
            for (key in listOf("thread.catchUpHint", "thread.catchUpRecap", "thread.notNow")) {
                val text = AppStrings.translate(locale, key, emptyMap())
                assertTrue("$locale $key", text.isNotBlank() && text != key)
            }
            val more = AppStrings.translate(locale, "thread.morePinnedAria", mapOf("count" to "2"))
            assertTrue("$locale $more", more.contains("2") && !more.contains("{count}"))
        }
        assertEquals("Rattraper cette conversation ?", AppStrings.translate(MessageLocale.FR_CA, "thread.catchUpHint", emptyMap()))
        assertEquals("2 autres épinglés", AppStrings.translate(MessageLocale.FR_CA, "thread.morePinnedAria", mapOf("count" to "2")))
    }

    @Test
    fun `Catch me up is in the menu only when the thread offers it`() {
        assertTrue(ConversationMenuItem.CATCH_UP in conversationMenuGroups(canDelete = true, canCatchUp = true).flatten())
        assertFalse(ConversationMenuItem.CATCH_UP in conversationMenuGroups(canDelete = true).flatten())
    }
}
