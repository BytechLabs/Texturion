package com.loonext.android.core.model

/**
 * #722: whether the server's `allowed_actions` list offers [action].
 *
 * A record that carries no list (an older API, a legacy call row, a surface the
 * server does not annotate) is null, and null keeps the screen's own check. It
 * never hides everything.
 */
fun List<String>?.allows(action: String): Boolean = this?.contains(action) ?: true

/** Whether the server will take a done flip on this task: complete when open, reopen when done. */
fun Task.doneToggleAllowed(): Boolean = allowed_actions.allows(if (done) "reopen" else "complete")

/** [Task.doneToggleAllowed] for the task's own screen. */
fun TaskDetail.doneToggleAllowed(): Boolean = allowed_actions.allows(if (done) "reopen" else "complete")

/** The conversation actions the server lists: the status moves plus spam and trash. */
object ConversationAllowed {
    const val CLOSE = "close"
    const val REOPEN = "reopen"
    const val MARK_SPAM = "mark_spam"
    const val UNMARK_SPAM = "unmark_spam"
    const val TRASH = "trash"
    const val MARK_NEW = "mark_new"
    const val MARK_OPEN = "mark_open"
    const val MARK_WAITING = "mark_waiting"

    /** The action that moves a conversation from [current] to [target]; the server names a reopen apart. */
    fun statusMove(current: String, target: String): String = when {
        target == ConversationStatus.CLOSED -> CLOSE
        current == ConversationStatus.CLOSED && target == ConversationStatus.OPEN -> REOPEN
        target == ConversationStatus.NEW -> MARK_NEW
        target == ConversationStatus.WAITING -> MARK_WAITING
        else -> MARK_OPEN
    }
}

/** Whether the swipe or TalkBack close-or-reopen is one the server will accept for this row. */
fun ConversationListItem.statusToggleAllowed(): Boolean = allowed_actions.allows(
    if (status == ConversationStatus.CLOSED) ConversationAllowed.REOPEN else ConversationAllowed.CLOSE,
)
