import Foundation
import UserNotifications

enum ThreadPushAction: String, Sendable {
    case reply = "REPLY_TO_THREAD"
    case markRead = "MARK_THREAD_READ"
    case callBack = "CALL_MISSED_CALLER"
    case text = "TEXT_MISSED_CALLER"
}

struct ThreadPushScope: Sendable {
    let companyId: String
    let userId: String
    let conversationId: String

    init?(data: [String: String]) {
        guard let companyId = data["action_company_id"], UUID(uuidString: companyId) != nil,
              let userId = data["action_user_id"], UUID(uuidString: userId) != nil,
              let conversationId = data["action_conversation_id"], UUID(uuidString: conversationId) != nil
        else { return nil }
        self.companyId = companyId
        self.userId = userId
        self.conversationId = conversationId
    }
}

@MainActor
func pushActionCategories() -> Set<UNNotificationCategory> {
    var categories: Set<UNNotificationCategory> = []
    for (locale, suffix) in [("en", ""), ("fr-CA", "_FR")] {
        let acknowledge = UNNotificationAction(
            identifier: OnCallPushAction.identifier,
            title: AppStrings.translate(locale, "domain.onCallBannerClaim"),
            options: [.authenticationRequired]
        )
        let reply = UNTextInputNotificationAction(
            identifier: ThreadPushAction.reply.rawValue,
            title: AppStrings.translate(locale, "shell.pushReply"),
            options: [.authenticationRequired],
            textInputButtonTitle: AppStrings.translate(locale, "thread.sendText"),
            textInputPlaceholder: ""
        )
        let markRead = UNNotificationAction(
            identifier: ThreadPushAction.markRead.rawValue,
            title: AppStrings.translate(locale, "recordMenu.markRead"),
            options: [.authenticationRequired]
        )
        let callBack = UNNotificationAction(
            identifier: ThreadPushAction.callBack.rawValue,
            title: AppStrings.translate(locale, "recordMenu.callBack"),
            options: [.authenticationRequired, .foreground]
        )
        let text = UNNotificationAction(
            identifier: ThreadPushAction.text.rawValue,
            title: AppStrings.translate(locale, "contactsTasks.textAction"),
            options: [.authenticationRequired, .foreground]
        )
        categories.insert(UNNotificationCategory(
            identifier: "MESSAGE" + suffix, actions: [reply, markRead], intentIdentifiers: []
        ))
        categories.insert(UNNotificationCategory(
            identifier: "MESSAGE_READ_ONLY" + suffix, actions: [markRead], intentIdentifiers: []
        ))
        categories.insert(UNNotificationCategory(
            identifier: "MISSED_CALL" + suffix, actions: [callBack, text], intentIdentifiers: []
        ))
        categories.insert(UNNotificationCategory(
            identifier: "ON_CALL_ALERT" + suffix, actions: [acknowledge], intentIdentifiers: []
        ))
        categories.insert(UNNotificationCategory(
            identifier: "ON_CALL_MISSED_CALL" + suffix, actions: [acknowledge, callBack, text], intentIdentifiers: []
        ))
    }
    return categories
}

@MainActor
func performThreadPushAction(
    _ action: ThreadPushAction,
    data: [String: String],
    replyText: String?,
    graph: AppGraph
) async throws -> Bool {
    guard let scope = ThreadPushScope(data: data),
          graph.sessionStore.current()?.userId == scope.userId else { return false }

    switch action {
    case .reply:
        guard data["thread_action"] == "message", data["can_reply"] == "true",
              let messageId = data["action_message_id"], UUID(uuidString: messageId) != nil,
              let body = replyText?.trimmingCharacters(in: .whitespacesAndNewlines),
              !body.isEmpty else { return false }
        let key = "push-reply-\(messageId)-\(scope.userId)"
        if !graph.outbox.store.all().contains(where: { $0.localId == key }) {
            graph.outbox.store.put(QueuedSend(
                localId: key,
                companyId: scope.companyId,
                conversationId: scope.conversationId,
                body: body,
                createdAt: ISO8601DateFormatter().string(from: Date()),
                ownerUserId: scope.userId
            ))
        }
        graph.outbox.flushOnBackground()
        return true
    case .markRead:
        guard data["thread_action"] == "message" else { return false }
        try await MessagingRepository(api: graph.api).markRead(
            companyId: scope.companyId,
            conversationId: scope.conversationId,
            expectedUserId: scope.userId
        )
        PushCoordinator.clearConversationNotifications(scope.conversationId)
        return true
    case .callBack:
        guard data["thread_action"] == "missed_call", let number = data["action_callback_number"],
              number.range(of: #"^[+][1-9][0-9]{6,14}$"#, options: .regularExpression) != nil
        else { return false }
        PushHooks.route(.callback(number: number, companyId: scope.companyId, userId: scope.userId))
        return true
    case .text:
        guard data["thread_action"] == "missed_call" else { return false }
        PushHooks.route(.thread(conversationId: scope.conversationId))
        return true
    }
}
