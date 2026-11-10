import Foundation

/// One piece of the conversation sheet, in the order the action list draws it.
enum ConversationSheetBlock: Equatable {
    /// Plain rows that share a card: one card per run inside one group (#710).
    case rows([RecordAction])
    /// The status pills. They are how this sheet draws `close` and `reopen`.
    case status
    /// The snooze and chase ladders. They are how this sheet draws `snooze`,
    /// `unsnooze` and `follow-up`.
    case deferral
}

/// #712: the conversation sheet's layout, derived from the conversation's one
/// action list. Nothing is chosen here: the order, the groups and who may see what
/// all come from `conversationActions`, so this sheet and the inbox row's menu list
/// the same actions in the same order. This function only decides which actions
/// need a richer control than a row (status, deferral) and where a card breaks.
///
/// Everyday actions, then deferral, then alerts, then the gallery, with the
/// destructive ones last in a card of their own (#710). Android's
/// `conversationSheetBlocks` twin.
func conversationSheetBlocks(_ actions: [RecordAction]) -> [ConversationSheetBlock] {
    var blocks: [ConversationSheetBlock] = []
    var run: [RecordAction] = []
    func flush() {
        if !run.isEmpty { blocks.append(.rows(run)) }
        run = []
    }
    var group: ActionGroup?
    for action in actions.visible {
        if let current = group, action.group != current { flush() }
        group = action.group
        switch action.id {
        case ConversationActionId.close, ConversationActionId.reopen:
            flush()
            if !blocks.contains(.status) { blocks.append(.status) }
        case ConversationActionId.snooze, ConversationActionId.unsnooze:
            flush()
            if !blocks.contains(.deferral) { blocks.append(.deferral) }
        case ConversationActionId.followUp:
            // Drawn inside the deferral card, beside the snooze ladder.
            break
        default:
            run.append(action)
        }
    }
    flush()
    return blocks
}
