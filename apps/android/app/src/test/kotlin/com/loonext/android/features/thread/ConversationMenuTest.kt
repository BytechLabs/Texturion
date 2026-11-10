package com.loonext.android.features.thread

import com.loonext.android.core.i18n.AppStrings
import com.loonext.android.core.model.MemberRole
import com.loonext.android.core.model.MessageLocale
import com.loonext.android.ui.common.ConversationActionsInput
import com.loonext.android.ui.common.ConversationSurface
import com.loonext.android.ui.common.OptOutState
import com.loonext.android.ui.common.RecordViewer
import com.loonext.android.ui.common.conversationActions
import com.loonext.android.ui.common.TrashSnackbarVisuals
import com.loonext.android.ui.common.snackbarActionLabels
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** #710 and #712: the sheet's layout, derived from the conversation's one action list. */
class ConversationMenuTest {
    private fun actions(role: String = MemberRole.OWNER, catchUp: Boolean = false) = conversationActions(
        ConversationActionsInput(
            unread = false, closed = false, pinned = false, deferred = false, muted = false,
            followed = false, spam = false, blocked = false,
            optOut = OptOutState(optedOut = false, carrierEnforced = false),
            viewer = RecordViewer.of(role), hasMembers = true,
            surface = ConversationSurface(canOpen = false, hasGallery = true, hasCatchUp = catchUp, hasNewTask = true),
        ),
    )

    private fun cards(role: String = MemberRole.OWNER, catchUp: Boolean = false): List<List<String>> =
        conversationSheetBlocks(actions(role, catchUp)).map { block ->
            when (block) {
                is SheetBlock.Rows -> block.actions.map { it.id }
                SheetBlock.Status -> listOf("status")
                SheetBlock.Deferral -> listOf("deferral")
            }
        }

    @Test
    fun cardsFollowTheWebOrderWithDestructiveLast() {
        assertEquals(
            listOf(
                listOf("mark-unread", "assign"),
                listOf("status"),
                listOf("pin", "new-task"),
                listOf("deferral"),
                listOf("mute", "follow"),
                listOf("attachments"),
                listOf("spam", "block", "delete", "opt-out"),
            ),
            cards(),
        )
    }

    @Test
    fun deleteComesRightBeforeOptOutNeverInTheMiddle() {
        val last = cards().last()
        assertEquals("delete", last[last.size - 2])
        assertEquals("opt-out", last.last())
    }

    @Test
    fun withoutRecordsDeleteTheRowIsGone() {
        assertFalse("delete" in cards(MemberRole.MEMBER).flatten())
    }

    @Test
    fun aReadOnlyViewerGetsNoStatusPillsAndNoWriteRows() {
        val flat = cards(MemberRole.READ_ONLY).flatten()
        assertFalse("status" in flat)
        assertFalse("assign" in flat || "pin" in flat || "spam" in flat)
    }

    @Test
    fun everyRowAppearsExactlyOnce() {
        val flat = cards().flatten()
        assertEquals(flat.toSet().size, flat.size)
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
