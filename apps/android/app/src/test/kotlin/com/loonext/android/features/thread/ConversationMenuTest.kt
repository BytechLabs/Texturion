package com.loonext.android.features.thread

import com.loonext.android.core.i18n.AppStrings
import com.loonext.android.core.model.MessageLocale
import com.loonext.android.ui.common.TrashSnackbarVisuals
import com.loonext.android.ui.common.snackbarActionLabels
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** #710: the menu's grouping, and the hints and notice labels it leans on. */
class ConversationMenuTest {
    private val flat get() = conversationMenuGroups(canDelete = true).flatten()

    @Test
    fun groupsFollowTheWebOrderWithDestructiveLast() {
        assertEquals(
            listOf(
                listOf(ConversationMenuItem.ASSIGN, ConversationMenuItem.PINNED, ConversationMenuItem.NEW_TASK),
                listOf(ConversationMenuItem.SNOOZE),
                listOf(ConversationMenuItem.MUTE, ConversationMenuItem.FOLLOW),
                listOf(ConversationMenuItem.ATTACHMENTS),
                listOf(
                    ConversationMenuItem.SPAM,
                    ConversationMenuItem.BLOCK,
                    ConversationMenuItem.DELETE,
                    ConversationMenuItem.OPT_OUT,
                ),
            ),
            conversationMenuGroups(canDelete = true),
        )
    }

    @Test
    fun deleteComesRightBeforeOptOutNeverInTheMiddle() {
        val last = conversationMenuGroups(canDelete = true).last()
        assertEquals(ConversationMenuItem.DELETE, last[last.size - 2])
        assertEquals(ConversationMenuItem.OPT_OUT, last.last())
    }

    @Test
    fun withoutRecordsDeleteTheRowIsGone() {
        assertFalse(ConversationMenuItem.DELETE in conversationMenuGroups(canDelete = false).flatten())
    }

    @Test
    fun everyRowAppearsExactlyOnce() {
        assertEquals(ConversationMenuItem.entries.toSet(), flat.toSet())
        assertEquals(ConversationMenuItem.entries.size, flat.size)
    }

    @Test
    fun hintsAndTrashLabelExistInBothLanguages() {
        for (locale in listOf("en", MessageLocale.FR_CA)) {
            for (key in listOf("thread.snoozeHint", "thread.muteHint", "trash.viewTrash")) {
                val text = AppStrings.translate(locale, key, emptyMap())
                assertTrue("$locale $key", text.isNotBlank() && text != key)
            }
        }
        assertEquals("View Trash", AppStrings.translate("en", "trash.viewTrash", emptyMap()))
        assertEquals("Voir la corbeille", AppStrings.translate(MessageLocale.FR_CA, "trash.viewTrash", emptyMap()))
    }

    @Test
    fun aDeleteNoticeCarriesUndoThenViewTrash() {
        val visuals = TrashSnackbarVisuals("Conversation moved to Trash", "Undo", "View Trash")
        assertEquals(listOf("Undo", "View Trash"), snackbarActionLabels(visuals))
    }
}
