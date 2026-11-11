package com.loonext.android.ui.common

import com.loonext.android.core.model.MemberRole
import com.loonext.android.core.model.allows
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * #722: a record's `allowed_actions` hides what the server would refuse, and a
 * record without the list keeps the screen's own checks.
 */
class AllowedActionsGatingTest {
    private fun conversationIds(allowed: List<String>?, closed: Boolean = false) = conversationActions(
        ConversationActionsInput(
            unread = false, closed = closed, pinned = false, deferred = false, muted = false,
            followed = false, spam = false, blocked = false,
            optOut = OptOutState(optedOut = false, carrierEnforced = false),
            viewer = RecordViewer.of(MemberRole.OWNER), hasMembers = true,
            surface = ConversationSurface(canOpen = false, hasGallery = true, hasCatchUp = true, hasNewTask = true),
            allowedActions = allowed,
        ),
    ).visibleIds()

    @Test
    fun `a null list allows everything and an empty one allows nothing`() {
        assertTrue(null.allows("anything"))
        assertTrue(listOf("close").allows("close"))
        assertFalse(emptyList<String>().allows("close"))
    }

    @Test
    fun `a conversation list without the field keeps the owner's actions`() {
        val ids = conversationIds(null)
        assertTrue("close" in ids && "spam" in ids && "delete" in ids)
    }

    @Test
    fun `a conversation list drops the close, spam and delete the server did not list`() {
        val ids = conversationIds(listOf("mark_open"))
        assertFalse("close" in ids)
        assertFalse("spam" in ids)
        assertFalse("delete" in ids)
    }

    @Test
    fun `a closed conversation offers reopen only when the server lists it`() {
        assertTrue("reopen" in conversationIds(listOf("reopen"), closed = true))
        assertFalse("reopen" in conversationIds(emptyList(), closed = true))
    }

    @Test
    fun `a task done and delete follow the list`() {
        fun ids(allowed: List<String>?, done: Boolean) = taskActions(
            TaskActionsInput(
                done = done, hasAccess = true, canDelete = true, canOpen = false, canCopyLink = false,
                allowedActions = allowed,
            ),
        ).visibleIds()
        assertEquals(listOf("done", "due", "delete"), ids(null, done = false))
        assertEquals(listOf("due"), ids(emptyList(), done = false))
        assertEquals(listOf("done", "due"), ids(listOf("reopen"), done = true))
    }

    @Test
    fun `a call back follows the list`() {
        fun ids(allowed: List<String>?) = callActions(
            CallActionsInput(
                hasConversation = true, hasContact = false, callerE164 = "+14155550188",
                hasVoicemail = false, canDelete = false, allowedActions = allowed,
            ),
        ).visibleIds()
        assertTrue("call-back" in ids(null))
        assertTrue("call-back" in ids(listOf("call_back")))
        assertFalse("call-back" in ids(emptyList()))
    }

    @Test
    fun `a scheduled text offers cancel only when the server lists it`() {
        assertEquals(listOf("open", "cancel"), scheduledActions(allowedActions = null).visibleIds())
        assertEquals(listOf("open", "cancel"), scheduledActions(allowedActions = listOf("edit", "cancel")).visibleIds())
        assertEquals(listOf("open"), scheduledActions(allowedActions = listOf("edit")).visibleIds())
    }
}
