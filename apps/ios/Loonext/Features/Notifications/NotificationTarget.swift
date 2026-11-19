import Foundation

/// Where a tapped notification goes (#718).
enum NotificationTarget: Equatable {
    case webhooks
    /// A task assignment is about the task, so it opens the task.
    case task(taskId: String)
    case thread(conversationId: String, messageId: String?)
}

func notificationTarget(_ item: NotificationItem) -> NotificationTarget? {
    if item.type == NotificationType.webhookDisabled { return .webhooks }
    if item.type == "task_assigned", let taskId = item.task_id {
        return .task(taskId: taskId)
    }
    guard let conversationId = item.conversation_id else { return nil }
    return .thread(conversationId: conversationId, messageId: item.message_id)
}
