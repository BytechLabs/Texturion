import Foundation

/// #722: whether the server's `allowed_actions` list offers an action.
///
/// A record that carries no list (an older API, a legacy call row, a surface the
/// server does not annotate) is nil, and nil keeps the screen's own check. It
/// never hides everything.
extension Optional where Wrapped == [String] {
    func allows(_ action: String) -> Bool {
        switch self {
        case .some(let list): return list.contains(action)
        case .none: return true
        }
    }
}

/// The conversation actions the server lists: the status moves plus spam and trash.
enum ConversationAllowed {
    static let close = "close"
    static let reopen = "reopen"
    static let markSpam = "mark_spam"
    static let unmarkSpam = "unmark_spam"
    static let trash = "trash"
    static let markNew = "mark_new"
    static let markOpen = "mark_open"
    static let markWaiting = "mark_waiting"

    /// The action that moves a conversation from `current` to `target`; the
    /// server names a reopen apart.
    static func statusMove(from current: String, to target: String) -> String {
        if target == ConversationStatus.closed { return close }
        if current == ConversationStatus.closed && target == ConversationStatus.open { return reopen }
        if target == ConversationStatus.new { return markNew }
        if target == ConversationStatus.waiting { return markWaiting }
        return markOpen
    }
}

extension ConversationListItem {
    /// Whether the swipe or VoiceOver close-or-reopen is one the server will accept for this row.
    var statusToggleAllowed: Bool {
        allowed_actions.allows(status == ConversationStatus.closed ? ConversationAllowed.reopen : ConversationAllowed.close)
    }
}

extension TaskItem {
    /// Whether the server will take a done flip: complete when open, reopen when done.
    var doneToggleAllowed: Bool {
        allowed_actions.allows(done ? "reopen" : "complete")
    }
}

extension TaskDetail {
    /// `TaskItem.doneToggleAllowed` for the task's own screen.
    var doneToggleAllowed: Bool {
        allowed_actions.allows(done ? "reopen" : "complete")
    }
}
