package com.loonext.android.ui.common

import com.loonext.android.core.i18n.AppStrings
import com.loonext.android.core.model.MemberRole
import com.loonext.android.core.model.Message
import com.loonext.android.core.model.MessageDirection
import com.loonext.android.core.model.MessageStatus
import com.loonext.android.core.model.MessageLocale
import com.loonext.android.features.thread.SheetBlock
import com.loonext.android.features.thread.conversationSheetBlocks
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * #712: one action list per record type. Every surface draws what the builder
 * returns, so these pin the list itself: its ids, its order, and who sees what.
 * The lists mirror `apps/web/src/lib/record-actions` and the per-record builders.
 */
class RecordActionsTest {
    private val roles = listOf(MemberRole.OWNER, MemberRole.MEMBER, MemberRole.READ_ONLY)

    private fun viewer(role: String) = RecordViewer.of(role)

    private fun conversation(
        role: String,
        unread: Boolean = false,
        closed: Boolean = false,
        deferred: Boolean = false,
        muted: Boolean = false,
        blocked: Boolean? = false,
        optOut: OptOutState? = OptOutState(optedOut = false, carrierEnforced = false),
        surface: ConversationSurface = ConversationSurface(
            canOpen = false, hasGallery = true, hasCatchUp = true, hasNewTask = true,
        ),
    ) = conversationActions(
        ConversationActionsInput(
            unread = unread, closed = closed, pinned = false, deferred = deferred,
            muted = muted, followed = false, spam = false, blocked = blocked, optOut = optOut,
            viewer = viewer(role), hasMembers = true, surface = surface,
        ),
    )

    @Test
    fun `an owner's conversation list is the web order, destructive last`() {
        assertEquals(
            listOf(
                "mark-unread", "catch-up", "assign", "close", "pin", "new-task", "snooze", "follow-up",
                "mute", "follow", "attachments",
                "spam", "block", "delete", "opt-out",
            ),
            conversation(MemberRole.OWNER).visibleIds(),
        )
    }

    @Test
    fun `an inbox row never offers a gallery, catch-up or opt-out it cannot know`() {
        val ids = conversation(
            MemberRole.OWNER,
            blocked = null,
            optOut = null,
            surface = ConversationSurface(canOpen = true, hasGallery = false, hasCatchUp = false, hasNewTask = false),
        ).visibleIds()
        assertEquals(
            listOf(
                "open", "mark-unread", "assign", "close", "pin", "snooze", "follow-up",
                "mute", "follow", "spam", "delete",
            ),
            ids,
        )
    }

    @Test
    fun `a member keeps the state actions but not delete, and a read-only viewer loses the writes`() {
        val member = conversation(MemberRole.MEMBER).visibleIds()
        assertFalse("delete" in member)
        assertTrue("close" in member && "spam" in member && "block" in member)

        val readOnly = conversation(MemberRole.READ_ONLY).visibleIds()
        for (write in listOf("assign", "close", "pin", "spam", "block", "delete")) {
            assertFalse("$write for read-only", write in readOnly)
        }
        // What reaches only me stays: nobody else's inbox changes when I snooze.
        assertTrue("snooze" in readOnly && "mute" in readOnly && "follow" in readOnly)
    }

    @Test
    fun `states swap their verb and a deferred thread offers only the way back`() {
        val ids = conversation(MemberRole.OWNER, unread = true, closed = true, deferred = true, muted = true).visibleIds()
        assertTrue("mark-read" in ids && "mark-unread" !in ids)
        assertTrue("reopen" in ids && "close" !in ids)
        assertTrue("unsnooze" in ids && "snooze" !in ids && "follow-up" !in ids)
        assertTrue("unmute" in ids && "mute" !in ids)
    }

    @Test
    fun `a carrier STOP is a note and never an opt-in`() {
        val ids = conversation(MemberRole.OWNER, optOut = OptOutState(optedOut = true, carrierEnforced = true)).visibleIds()
        assertTrue("carrier-stop" in ids && "opt-in" !in ids && "opt-out" !in ids)
        val ours = conversation(MemberRole.OWNER, optOut = OptOutState(optedOut = true, carrierEnforced = false)).visibleIds()
        assertTrue("opt-in" in ours && "carrier-stop" !in ours)
    }

    @Test
    fun `the thread sheet draws every action of the list exactly once, in the list's order`() {
        for (role in roles) {
            val actions = conversation(role)
            val drawn = conversationSheetBlocks(actions).flatMap { block ->
                when (block) {
                    is SheetBlock.Rows -> block.actions.map { it.id }
                    SheetBlock.Status -> listOf("close", "reopen").filter { it in actions.visibleIds() }
                    SheetBlock.Deferral ->
                        listOf("snooze", "unsnooze", "follow-up").filter { it in actions.visibleIds() }
                }
            }
            assertEquals("role $role", actions.visibleIds(), drawn)
        }
    }

    @Test
    fun `the thread sheet breaks a card at every group and keeps destructive rows last`() {
        val blocks = conversationSheetBlocks(conversation(MemberRole.OWNER))
        val last = blocks.last() as SheetBlock.Rows
        assertEquals(listOf("spam", "block", "delete", "opt-out"), last.actions.map { it.id })
        assertTrue(blocks.first() is SheetBlock.Rows)
    }

    @Test
    fun `a record with nothing allowed has no menu`() {
        val nothing = listOf(
            RecordAction("x", "recordMenu.open", ActionGroup.PRIMARY, allowed = false),
            RecordAction("y", "recordMenu.deleteTask", ActionGroup.DANGER, allowed = false),
        )
        assertTrue(nothing.visible().isEmpty())
        assertTrue(
            callActions(
                CallActionsInput(
                    hasConversation = false, hasContact = false, callerE164 = null,
                    hasVoicemail = false, canDelete = false,
                ),
            ).visible().isEmpty(),
        )
    }

    private fun message(
        direction: String = MessageDirection.OUTBOUND,
        status: String? = MessageStatus.DELIVERED,
        body: String = "hello",
        promoted: Boolean = false,
    ) = Message(
        id = "m1", conversation_id = "c1", direction = direction, body = body, status = status,
        telnyx_message_id = "t1", created_at = "2026-07-15T00:00:00Z", has_task = promoted,
    )

    @Test
    fun `a message offers copy, done, make a task and pin, with delete last for owners only`() {
        assertEquals(
            listOf("copy-text", "done", "make-task", "pin", "delete"),
            messageActions(message(), viewer(MemberRole.OWNER)).visibleIds(),
        )
        assertEquals(
            listOf("copy-text", "done", "make-task", "pin"),
            messageActions(message(), viewer(MemberRole.MEMBER)).visibleIds(),
        )
        assertEquals(
            listOf("copy-text", "done", "make-task", "pin"),
            messageActions(message(), viewer(MemberRole.READ_ONLY)).visibleIds(),
        )
    }

    @Test
    fun `a failed send offers retry, a note cannot be promoted, and an empty body has nothing to copy`() {
        val failed = message(status = MessageStatus.FAILED).copy(telnyx_message_id = null, error_code = "internal")
        assertEquals("retry", messageActions(failed, viewer(MemberRole.OWNER)).visibleIds()[1])
        val note = message(direction = MessageDirection.NOTE, status = null)
        val ids = messageActions(note, viewer(MemberRole.OWNER)).visibleIds()
        assertFalse("make-task" in ids)
        assertTrue(messageActions(note, viewer(MemberRole.OWNER)).last().labelKey == "recordMenu.deleteNote")
        assertFalse("copy-text" in messageActions(message(body = " "), viewer(MemberRole.OWNER)).visibleIds())
        assertFalse("make-task" in messageActions(message(promoted = true), viewer(MemberRole.OWNER)).visibleIds())
    }

    @Test
    fun `a call offers call back, text, copy and the two deletes last`() {
        fun list(role: String, voicemail: Boolean) = callActions(
            CallActionsInput(
                hasConversation = true, hasContact = true, callerE164 = "+14165550100",
                hasVoicemail = voicemail, canDelete = viewer(role).canDelete,
            ),
        ).visibleIds()
        assertEquals(
            listOf("call-back", "text", "copy-number", "delete-voicemail", "delete-call"),
            list(MemberRole.OWNER, voicemail = true),
        )
        assertEquals(listOf("call-back", "text", "copy-number", "delete-call"), list(MemberRole.OWNER, voicemail = false))
        assertEquals(listOf("call-back", "text", "copy-number"), list(MemberRole.MEMBER, voicemail = true))
        assertEquals(listOf("call-back", "text", "copy-number"), list(MemberRole.READ_ONLY, voicemail = true))
    }

    private fun task(role: String, canOpen: Boolean, hasAccess: Boolean = true) = taskActions(
        TaskActionsInput(
            done = false, hasAccess = hasAccess, canDelete = viewer(role).canDelete,
            canOpen = canOpen, canCopyLink = true,
        ),
    ).visibleIds()

    @Test
    fun `a task offers open, copy link, done, a due move and delete last`() {
        assertEquals(
            listOf("open", "copy-link", "done", "due", "delete"),
            task(MemberRole.OWNER, canOpen = true),
        )
        assertEquals(listOf("open", "copy-link", "done", "due"), task(MemberRole.MEMBER, canOpen = true))
        assertEquals(listOf("copy-link", "done", "due"), task(MemberRole.READ_ONLY, canOpen = false))
    }

    @Test
    fun `without access to its conversation a task offers no done and no due move`() {
        assertEquals(listOf("copy-link", "delete"), task(MemberRole.OWNER, canOpen = false, hasAccess = false))
        assertEquals(listOf("copy-link"), task(MemberRole.MEMBER, canOpen = false, hasAccess = false))
    }

    private fun contact(role: String, optedOut: Boolean = false, carrier: Boolean = false, blocked: Boolean? = false) =
        contactActions(
            ContactActionsInput(
                canOpen = true, optedOut = optedOut, carrierEnforced = carrier, blocked = blocked,
                canBlock = viewer(role).canWrite, canDelete = viewer(role).canDelete,
            ),
        ).visibleIds()

    @Test
    fun `a contact offers open, text, call, copy, then block, opt out and delete last`() {
        assertEquals(
            listOf("open", "text", "call", "copy-number", "block", "opt-out", "delete"),
            contact(MemberRole.OWNER),
        )
        assertEquals(
            listOf("open", "text", "call", "copy-number", "block", "opt-out"),
            contact(MemberRole.MEMBER),
        )
        assertEquals(listOf("open", "text", "call", "copy-number", "opt-out"), contact(MemberRole.READ_ONLY))
    }

    @Test
    fun `a contact opted out by a carrier STOP can only be told, never re-opted in`() {
        assertEquals(
            listOf("open", "text", "call", "copy-number", "block", "carrier-stop", "delete"),
            contact(MemberRole.OWNER, optedOut = true, carrier = true),
        )
        assertEquals(
            listOf("open", "text", "call", "copy-number", "block", "opt-in", "delete"),
            contact(MemberRole.OWNER, optedOut = true, carrier = false),
        )
        assertFalse("block" in contact(MemberRole.OWNER, blocked = null) || "unblock" in contact(MemberRole.OWNER, blocked = null))
    }

    @Test
    fun `a scheduled text offers open then cancel in the destructive group`() {
        assertEquals(listOf("open", "cancel"), scheduledActions().visibleIds())
        assertTrue(scheduledActions().last().destructive)
    }

    @Test
    fun `every label key in every list exists in both languages`() {
        val everything = conversation(MemberRole.OWNER, optOut = OptOutState(true, true)) +
            conversation(MemberRole.OWNER) +
            messageActions(message(), viewer(MemberRole.OWNER)) +
            messageActions(message(direction = MessageDirection.NOTE, status = null), viewer(MemberRole.OWNER)) +
            callActions(CallActionsInput(true, true, "+1", true, true)) +
            taskActions(TaskActionsInput(false, true, true, true, true)) +
            contactActions(ContactActionsInput(true, false, false, false, true, true)) +
            scheduledActions()
        val keys = everything.map { it.labelKey } +
            everything.flatMap { it.submenu }.mapNotNull { it.labelKey } +
            MUTE_CHOICES.mapNotNull { it.labelKey } +
            TASK_DUE_MOVES.mapNotNull { it.labelKey }
        for (locale in listOf("en", MessageLocale.FR_CA)) {
            for (key in keys.toSet()) {
                val text = AppStrings.translate(locale, key)
                assertTrue("$locale $key", text.isNotBlank() && text != key)
            }
        }
    }

    @Test
    fun `the group order is primary, state, alerts, attachments, danger`() {
        assertEquals(
            listOf(
                ActionGroup.PRIMARY, ActionGroup.STATE, ActionGroup.ALERTS,
                ActionGroup.ATTACHMENTS, ActionGroup.DANGER,
            ),
            ActionGroup.entries,
        )
        val shuffled = listOf(
            RecordAction("d", "recordMenu.open", ActionGroup.DANGER),
            RecordAction("p", "recordMenu.open", ActionGroup.PRIMARY),
            RecordAction("s", "recordMenu.open", ActionGroup.STATE),
        )
        assertEquals(listOf("p", "s", "d"), shuffled.visibleIds())
    }
}
