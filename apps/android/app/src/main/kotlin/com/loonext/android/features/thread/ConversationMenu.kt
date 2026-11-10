package com.loonext.android.features.thread

import com.loonext.android.ui.common.ConversationActionId
import com.loonext.android.ui.common.RecordAction
import com.loonext.android.ui.common.visible

/** One piece of the conversation sheet, in the order the action list draws it. */
internal sealed interface SheetBlock {
    /** Plain rows that share a card: one card per run inside one group (#710). */
    data class Rows(val actions: List<RecordAction>) : SheetBlock

    /** The status pills. They are how this sheet draws `close` and `reopen`. */
    data object Status : SheetBlock

    /** The snooze and chase ladders. They are how this sheet draws `snooze`, `unsnooze` and `follow-up`. */
    data object Deferral : SheetBlock
}

/**
 * #712: the conversation sheet's layout, derived from the conversation's one action
 * list. Nothing is chosen here: the order, the groups and who may see what all come
 * from `conversationActions`, so this sheet and the inbox row's menu list the same
 * actions in the same order. This function only decides which actions need a richer
 * control than a row (status, deferral) and where a card breaks.
 *
 * Everyday actions, then deferral, then alerts, then the gallery, with the
 * destructive ones last in a card of their own (#710).
 */
internal fun conversationSheetBlocks(actions: List<RecordAction>): List<SheetBlock> {
    val blocks = mutableListOf<SheetBlock>()
    var run = mutableListOf<RecordAction>()
    fun flush() {
        if (run.isNotEmpty()) blocks += SheetBlock.Rows(run)
        run = mutableListOf()
    }
    var group: com.loonext.android.ui.common.ActionGroup? = null
    for (action in actions.visible()) {
        if (group != null && action.group != group) flush()
        group = action.group
        when (action.id) {
            ConversationActionId.CLOSE, ConversationActionId.REOPEN -> {
                flush()
                if (SheetBlock.Status !in blocks) blocks += SheetBlock.Status
            }
            ConversationActionId.SNOOZE, ConversationActionId.UNSNOOZE -> {
                flush()
                if (SheetBlock.Deferral !in blocks) blocks += SheetBlock.Deferral
            }
            // Drawn inside the deferral card, beside the snooze ladder.
            ConversationActionId.FOLLOW_UP -> Unit
            else -> run += action
        }
    }
    flush()
    return blocks
}
