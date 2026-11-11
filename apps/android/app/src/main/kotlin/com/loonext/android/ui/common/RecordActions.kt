package com.loonext.android.ui.common

import com.loonext.android.core.model.Capability
import com.loonext.android.core.model.MemberRole
import com.loonext.android.core.model.Message
import com.loonext.android.core.model.MessageDirection
import com.loonext.android.core.model.canDeleteRecords

/**
 * #712: ONE action list per record type.
 *
 * A record's actions (label, group, order, whether this viewer may do it) are
 * written once, by a builder per type below, and every surface that offers them
 * renders THAT list: the long-press menu, the row's more-actions menu and the
 * thread's actions sheet. Two menus for one record can therefore never disagree,
 * because there is only one list to disagree with.
 *
 * The Kotlin twin of `apps/web/src/lib/record-actions/types.ts` and the
 * per-record builders beside it. Ids, groups and order match the web lists.
 * What a surface cannot offer is `allowed = false`, never a second list.
 */
enum class ActionGroup {
    /** Where the record lives, and what you do to reach the person. */
    PRIMARY,

    /** What you do to the record's state. */
    STATE,

    /** What reaches you about it. */
    ALERTS,

    /** The photos and files. */
    ATTACHMENTS,

    /** Spam, block, delete: last, in the error colour. */
    DANGER,
}

/** One choice inside an action that needs one more answer (a person, a duration, a day). */
data class RecordSubAction(
    val id: String,
    /** A catalogue key; null when [label] is already the words (a member's name). */
    val labelKey: String? = null,
    val label: String? = null,
    /** Muted text at the row's end, e.g. the time a snooze preset resolves to. */
    val trailing: String? = null,
)

data class RecordAction(
    val id: String,
    /** A `recordMenu.*` catalogue key, so every surface says the same words. */
    val labelKey: String,
    val group: ActionGroup,
    /**
     * Whether this viewer may do it. A false action is never rendered, and a
     * record with none allowed opens no menu at all.
     */
    val allowed: Boolean = true,
    val destructive: Boolean = false,
    /** Non-null means a toggle: it names a STATE and shows a trailing box (#465). */
    val checked: Boolean? = null,
    val enabled: Boolean = true,
    /** Plain explanatory text, not something to press (a carrier STOP note). */
    val note: Boolean = false,
    /** Non-empty means choosing it opens these choices. */
    val submenu: List<RecordSubAction> = emptyList(),
)

/** The actions this viewer may take, in group order (stable within a group). */
fun List<RecordAction>.visible(): List<RecordAction> {
    val allowed = filter { it.allowed }
    return ActionGroup.entries.flatMap { group -> allowed.filter { it.group == group } }
}

/** Just the ids, in render order. The parity tests compare these. */
fun List<RecordAction>.visibleIds(): List<String> = visible().map { it.id }

/** What a role may do to a record, from the capability table the screens already use. */
data class RecordViewer(val canWrite: Boolean, val canDelete: Boolean) {
    companion object {
        fun of(role: String?) = RecordViewer(
            canWrite = MemberRole.has(role, Capability.CONVERSATIONS_NOTE),
            canDelete = canDeleteRecords(role),
        )
    }
}

// ---------------------------------------------------------------------------
// Conversation
// ---------------------------------------------------------------------------

object ConversationActionId {
    const val OPEN = "open"
    const val MARK_READ = "mark-read"
    const val MARK_UNREAD = "mark-unread"
    const val CATCH_UP = "catch-up"
    const val ASSIGN = "assign"
    const val REOPEN = "reopen"
    const val CLOSE = "close"
    const val PIN = "pin"
    const val NEW_TASK = "new-task"
    const val UNSNOOZE = "unsnooze"
    const val SNOOZE = "snooze"
    const val FOLLOW_UP = "follow-up"
    const val UNMUTE = "unmute"
    const val MUTE = "mute"
    const val FOLLOW = "follow"
    const val ATTACHMENTS = "attachments"
    const val SPAM = "spam"
    const val UNBLOCK = "unblock"
    const val BLOCK = "block"
    const val DELETE = "delete"
    const val OPT_IN = "opt-in"
    const val CARRIER_STOP = "carrier-stop"
    const val OPT_OUT = "opt-out"
}

data class OptOutState(val optedOut: Boolean, val carrierEnforced: Boolean)

/** What this surface can offer at all: an inbox row has no gallery, the thread has no "open". */
data class ConversationSurface(
    val canOpen: Boolean,
    val hasGallery: Boolean,
    val hasCatchUp: Boolean,
    /** Phones only: a task can start from the conversation sheet. */
    val hasNewTask: Boolean,
)

data class ConversationActionsInput(
    val unread: Boolean,
    val closed: Boolean,
    val pinned: Boolean,
    val deferred: Boolean,
    val muted: Boolean,
    val followed: Boolean,
    val spam: Boolean,
    /** Null where the surface does not know: neither block nor unblock is offered. */
    val blocked: Boolean?,
    /** Null where the surface does not know the contact's opt-out state. */
    val optOut: OptOutState?,
    val viewer: RecordViewer,
    val hasMembers: Boolean,
    val surface: ConversationSurface,
    val assignChoices: List<RecordSubAction> = emptyList(),
    val snoozeChoices: List<RecordSubAction> = emptyList(),
    val followUpChoices: List<RecordSubAction> = emptyList(),
    val muteChoices: List<RecordSubAction> = emptyList(),
)

/** The mute durations the server takes, in the order the web menu lists them. */
val MUTE_CHOICES: List<RecordSubAction> = listOf(
    RecordSubAction("1h", labelKey = "thread.mute1h"),
    RecordSubAction("8h", labelKey = "thread.mute8h"),
    RecordSubAction("1w", labelKey = "thread.mute1w"),
    RecordSubAction("forever", labelKey = "thread.muteForever"),
)

fun conversationActions(input: ConversationActionsInput): List<RecordAction> {
    val viewer = input.viewer
    val surface = input.surface
    return listOf(
        RecordAction(ConversationActionId.OPEN, "recordMenu.open", ActionGroup.PRIMARY, allowed = surface.canOpen),

        if (input.unread) {
            RecordAction(ConversationActionId.MARK_READ, "recordMenu.markRead", ActionGroup.STATE)
        } else {
            RecordAction(ConversationActionId.MARK_UNREAD, "recordMenu.markUnread", ActionGroup.STATE)
        },
        RecordAction(
            ConversationActionId.CATCH_UP, "recordMenu.catchUp", ActionGroup.STATE,
            allowed = surface.hasCatchUp,
        ),
        RecordAction(
            ConversationActionId.ASSIGN, "recordMenu.assign", ActionGroup.STATE,
            allowed = viewer.canWrite && input.hasMembers,
            submenu = input.assignChoices,
        ),
        if (input.closed) {
            RecordAction(ConversationActionId.REOPEN, "recordMenu.reopen", ActionGroup.STATE, allowed = viewer.canWrite)
        } else {
            RecordAction(ConversationActionId.CLOSE, "recordMenu.close", ActionGroup.STATE, allowed = viewer.canWrite)
        },
        RecordAction(
            ConversationActionId.PIN, "recordMenu.pin", ActionGroup.STATE,
            allowed = viewer.canWrite, checked = input.pinned,
        ),
        RecordAction(
            ConversationActionId.NEW_TASK, "recordMenu.newTask", ActionGroup.STATE,
            allowed = surface.hasNewTask,
        ),
        if (input.deferred) {
            RecordAction(ConversationActionId.UNSNOOZE, "recordMenu.unsnooze", ActionGroup.STATE)
        } else {
            RecordAction(
                ConversationActionId.SNOOZE, "recordMenu.snooze", ActionGroup.STATE,
                submenu = input.snoozeChoices,
            )
        },
        RecordAction(
            ConversationActionId.FOLLOW_UP, "recordMenu.followUp", ActionGroup.STATE,
            allowed = !input.deferred,
            submenu = input.followUpChoices,
        ),

        if (input.muted) {
            RecordAction(ConversationActionId.UNMUTE, "recordMenu.unmute", ActionGroup.ALERTS)
        } else {
            RecordAction(
                ConversationActionId.MUTE, "recordMenu.mute", ActionGroup.ALERTS,
                submenu = input.muteChoices,
            )
        },
        RecordAction(
            ConversationActionId.FOLLOW, "recordMenu.follow", ActionGroup.ALERTS,
            checked = input.followed,
        ),

        RecordAction(
            ConversationActionId.ATTACHMENTS, "recordMenu.attachments", ActionGroup.ATTACHMENTS,
            allowed = surface.hasGallery,
        ),

        RecordAction(
            ConversationActionId.SPAM, "recordMenu.spam", ActionGroup.DANGER,
            allowed = viewer.canWrite, checked = input.spam,
        ),
        if (input.blocked == true) {
            RecordAction(ConversationActionId.UNBLOCK, "recordMenu.unblock", ActionGroup.DANGER, allowed = viewer.canWrite)
        } else {
            RecordAction(
                ConversationActionId.BLOCK, "recordMenu.block", ActionGroup.DANGER,
                allowed = viewer.canWrite && input.blocked != null,
            )
        },
        RecordAction(
            ConversationActionId.DELETE, "recordMenu.deleteConversation", ActionGroup.DANGER,
            allowed = viewer.canDelete, destructive = true,
        ),
        RecordAction(
            ConversationActionId.OPT_IN, "recordMenu.optIn", ActionGroup.DANGER,
            allowed = input.optOut?.let { it.optedOut && !it.carrierEnforced } == true,
        ),
        RecordAction(
            ConversationActionId.CARRIER_STOP, "recordMenu.carrierStop", ActionGroup.DANGER,
            allowed = input.optOut?.let { it.optedOut && it.carrierEnforced } == true,
            note = true,
        ),
        RecordAction(
            ConversationActionId.OPT_OUT, "recordMenu.optOut", ActionGroup.DANGER,
            allowed = input.optOut?.optedOut == false,
        ),
    )
}

// ---------------------------------------------------------------------------
// Message
// ---------------------------------------------------------------------------

object MessageActionId {
    const val COPY_TEXT = "copy-text"
    const val RETRY = "retry"
    const val DONE = "done"
    const val MAKE_TASK = "make-task"
    const val PIN = "pin"
    const val DELETE = "delete"
}

fun messageActions(message: Message, viewer: RecordViewer): List<RecordAction> {
    val note = message.direction == MessageDirection.NOTE
    return listOf(
        RecordAction(
            MessageActionId.COPY_TEXT, "recordMenu.copyText", ActionGroup.PRIMARY,
            allowed = message.body.isNotBlank(),
        ),
        RecordAction(
            MessageActionId.RETRY, "recordMenu.retry", ActionGroup.PRIMARY,
            allowed = message.retryable,
        ),
        // Phones only: the web bubble keeps "done" as its own check at the edge.
        RecordAction(
            MessageActionId.DONE, "recordMenu.done", ActionGroup.STATE,
            checked = message.done_at != null,
        ),
        RecordAction(
            MessageActionId.MAKE_TASK, "recordMenu.makeTask", ActionGroup.STATE,
            // A promoted message cannot be promoted twice, and a note is not a customer's ask.
            allowed = !message.has_task && message.promoted_task == null && !note,
        ),
        RecordAction(
            MessageActionId.PIN, "recordMenu.pin", ActionGroup.STATE,
            checked = message.pinned_at != null,
        ),
        RecordAction(
            MessageActionId.DELETE,
            if (note) "recordMenu.deleteNote" else "recordMenu.deleteMessage",
            ActionGroup.DANGER,
            allowed = viewer.canDelete, destructive = true,
        ),
    )
}

// ---------------------------------------------------------------------------
// Call
// ---------------------------------------------------------------------------

object CallActionId {
    const val CALL_BACK = "call-back"
    const val TEXT = "text"
    const val COPY_NUMBER = "copy-number"
    const val CONTACT = "contact"
    const val ADD_CONTACT = "add-contact"
    const val TASK = "task"
    const val DETAILS = "details"
    const val DELETE_VOICEMAIL = "delete-voicemail"
    const val DELETE_CALL = "delete-call"
}

data class CallActionsInput(
    val hasConversation: Boolean,
    val hasContact: Boolean,
    val callerE164: String?,
    val hasVoicemail: Boolean,
    val canDelete: Boolean,
    /** D64: an answered call in a conversation can become a task. */
    val canMakeTask: Boolean = false,
    /** The call's own page; false where that page is already open. */
    val canOpenDetails: Boolean = false,
)

fun callActions(input: CallActionsInput): List<RecordAction> = listOf(
    RecordAction(
        CallActionId.CALL_BACK, "recordMenu.callBack", ActionGroup.PRIMARY,
        allowed = input.hasConversation || input.hasContact || !input.callerE164.isNullOrBlank(),
    ),
    RecordAction(
        CallActionId.TEXT, "recordMenu.text", ActionGroup.PRIMARY,
        allowed = input.hasConversation || !input.callerE164.isNullOrBlank(),
    ),
    RecordAction(
        CallActionId.COPY_NUMBER, "recordMenu.copyNumber", ActionGroup.PRIMARY,
        allowed = !input.callerE164.isNullOrBlank(),
    ),
    RecordAction(
        CallActionId.CONTACT, "shell.callActionContact", ActionGroup.PRIMARY,
        allowed = input.hasContact,
    ),
    RecordAction(
        CallActionId.ADD_CONTACT, "shell.callActionAddContact", ActionGroup.PRIMARY,
        allowed = !input.hasContact && !input.callerE164.isNullOrBlank(),
    ),
    RecordAction(
        CallActionId.TASK, "shell.callActionTask", ActionGroup.PRIMARY,
        allowed = input.canMakeTask,
    ),
    RecordAction(
        CallActionId.DETAILS, "shell.callActionDetails", ActionGroup.PRIMARY,
        allowed = input.canOpenDetails,
    ),
    RecordAction(
        CallActionId.DELETE_VOICEMAIL, "recordMenu.deleteVoicemail", ActionGroup.DANGER,
        allowed = input.canDelete && input.hasVoicemail, destructive = true,
    ),
    RecordAction(
        CallActionId.DELETE_CALL, "recordMenu.deleteCall", ActionGroup.DANGER,
        allowed = input.canDelete, destructive = true,
    ),
)

// ---------------------------------------------------------------------------
// Task
// ---------------------------------------------------------------------------

object TaskActionId {
    const val OPEN = "open"
    const val COPY_LINK = "copy-link"
    const val DONE = "done"
    const val DUE = "due"
    const val DELETE = "delete"
}

/** The three relative moves web offers: a day earlier, a day later, a week later. */
val TASK_DUE_MOVES: List<RecordSubAction> = listOf(
    RecordSubAction("-1", labelKey = "recordMenu.dueDayEarlier"),
    RecordSubAction("1", labelKey = "recordMenu.dueDayLater"),
    RecordSubAction("7", labelKey = "recordMenu.dueWeekLater"),
)

data class TaskActionsInput(
    val done: Boolean,
    /**
     * Access to the conversation the task came from (#107). Completion is derived
     * from the source message, so without it the server refuses, and offering the
     * item would be a dead item.
     */
    val hasAccess: Boolean,
    val canDelete: Boolean,
    /** False on the task's own screen, where it is already open. */
    val canOpen: Boolean,
    val canCopyLink: Boolean,
)

fun taskActions(input: TaskActionsInput): List<RecordAction> = listOf(
    RecordAction(TaskActionId.OPEN, "recordMenu.open", ActionGroup.PRIMARY, allowed = input.canOpen),
    RecordAction(TaskActionId.COPY_LINK, "recordMenu.copyLink", ActionGroup.PRIMARY, allowed = input.canCopyLink),
    RecordAction(
        TaskActionId.DONE, "recordMenu.done", ActionGroup.STATE,
        allowed = input.hasAccess, checked = input.done,
    ),
    RecordAction(
        TaskActionId.DUE, "recordMenu.moveDue", ActionGroup.STATE,
        allowed = input.hasAccess, submenu = TASK_DUE_MOVES,
    ),
    RecordAction(
        TaskActionId.DELETE, "recordMenu.deleteTask", ActionGroup.DANGER,
        allowed = input.canDelete, destructive = true,
    ),
)

// ---------------------------------------------------------------------------
// Contact
// ---------------------------------------------------------------------------

object ContactActionId {
    const val OPEN = "open"
    const val TEXT = "text"
    const val CALL = "call"
    const val COPY_NUMBER = "copy-number"
    const val UNBLOCK = "unblock"
    const val BLOCK = "block"
    const val OPT_IN = "opt-in"
    const val CARRIER_STOP = "carrier-stop"
    const val OPT_OUT = "opt-out"
    const val DELETE = "delete"
}

data class ContactActionsInput(
    val canOpen: Boolean,
    val optedOut: Boolean,
    val carrierEnforced: Boolean,
    /** Null where the surface does not know: neither block nor unblock is offered. */
    val blocked: Boolean?,
    val canBlock: Boolean,
    val canDelete: Boolean,
)

fun contactActions(input: ContactActionsInput): List<RecordAction> = listOf(
    RecordAction(ContactActionId.OPEN, "recordMenu.open", ActionGroup.PRIMARY, allowed = input.canOpen),
    RecordAction(ContactActionId.TEXT, "recordMenu.text", ActionGroup.PRIMARY),
    RecordAction(ContactActionId.CALL, "recordMenu.call", ActionGroup.PRIMARY),
    RecordAction(ContactActionId.COPY_NUMBER, "recordMenu.copyNumber", ActionGroup.PRIMARY),
    if (input.blocked == true) {
        RecordAction(ContactActionId.UNBLOCK, "recordMenu.unblock", ActionGroup.DANGER, allowed = input.canBlock)
    } else {
        RecordAction(
            ContactActionId.BLOCK, "recordMenu.block", ActionGroup.DANGER,
            allowed = input.canBlock && input.blocked != null,
        )
    },
    RecordAction(
        ContactActionId.OPT_IN, "recordMenu.optIn", ActionGroup.DANGER,
        allowed = input.optedOut && !input.carrierEnforced,
    ),
    RecordAction(
        ContactActionId.CARRIER_STOP, "recordMenu.carrierStop", ActionGroup.DANGER,
        allowed = input.optedOut && input.carrierEnforced, note = true,
    ),
    RecordAction(
        ContactActionId.OPT_OUT, "recordMenu.optOut", ActionGroup.DANGER,
        allowed = !input.optedOut,
    ),
    RecordAction(
        ContactActionId.DELETE, "recordMenu.deleteContact", ActionGroup.DANGER,
        allowed = input.canDelete, destructive = true,
    ),
)

// ---------------------------------------------------------------------------
// Scheduled text
// ---------------------------------------------------------------------------

object ScheduledActionId {
    const val OPEN = "open"
    const val CANCEL = "cancel"
}

fun scheduledActions(cancelling: Boolean = false): List<RecordAction> = listOf(
    RecordAction(ScheduledActionId.OPEN, "recordMenu.openConversation", ActionGroup.PRIMARY),
    RecordAction(
        ScheduledActionId.CANCEL, "recordMenu.cancelScheduled", ActionGroup.DANGER,
        destructive = true, enabled = !cancelling,
    ),
)
