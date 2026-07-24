import Foundation

/// Where a search-result hit navigates (#186 item 2). Pure + `Equatable` so the
/// founder-critical routing — a TASK hit opens the TASK (not its conversation),
/// a conversation/message hit opens the THREAD carrying the matched message as
/// the scroll/flash target — is unit-testable and can't silently regress.
enum SearchResultRoute: Equatable, Sendable {
    /// Open the thread; `highlightMessageId` scrolls to + flashes that message.
    case thread(conversationId: String, highlightMessageId: String?)
    /// Open the task's detail surface.
    case task(taskId: String)
}

/// The pure routing decisions the inbox search results dispatch. The Android
/// `onOpenThread(id, matched_message_id)` / `onOpenTask(task.id)` twin.
enum InboxSearchRouting {
    /// A TASK hit opens the TASK — NOT `hit.conversation_id` (the pre-#186 bug).
    static func route(forTask hit: SearchTaskHit) -> SearchResultRoute {
        .task(taskId: hit.id)
    }

    /// A conversation/message hit opens the thread scrolled to + flashing the
    /// matched message.
    static func route(forConversation hit: SearchConversationHit) -> SearchResultRoute {
        .thread(conversationId: hit.id, highlightMessageId: hit.matched_message_id)
    }

    /// An attachment hit opens its owning thread (no message highlight).
    static func route(forAttachment conversationId: String) -> SearchResultRoute {
        .thread(conversationId: conversationId, highlightMessageId: nil)
    }
}
