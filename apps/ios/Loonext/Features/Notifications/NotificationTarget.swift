import Foundation

/// Where a tapped notification goes (#718).
enum NotificationTarget: Equatable {
    /// A task assignment is about the task, so it opens the task.
    case task(taskId: String)
    /// Everything else opens its thread, at the message it names when it names one.
    case thread(conversationId: String, messageId: String?)
}

func notificationTarget(_ item: NotificationItem) -> NotificationTarget? {
    if item.type == "task_assigned", let taskId = item.task_id {
        return .task(taskId: taskId)
    }
    guard let conversationId = item.conversation_id else { return nil }
    return .thread(conversationId: conversationId, messageId: item.message_id)
}
