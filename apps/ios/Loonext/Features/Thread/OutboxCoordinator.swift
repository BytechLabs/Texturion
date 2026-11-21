import Foundation
import UIKit
import UserNotifications

@MainActor
final class OutboxCoordinator {
    let store: Outbox

    private let repository: MessagingRepository
    private let sessionStore: SessionStore
    private var flushTask: Task<Void, Never>?
    private var flushAgain = false
    private var backgroundTask: UIBackgroundTaskIdentifier = .invalid

    private lazy var flusher = OutboxFlusher(
        outbox: store,
        currentLocale: { UiLocaleStore.shared.resolved },
        onBlocked: { [weak self] in self?.showNotice(for: $0) }
    ) { [weak self] row in
        guard let self else { return .unreachable("") }
        return await send(row)
    }

    init(store: Outbox, repository: MessagingRepository, sessionStore: SessionStore) {
        self.store = store
        self.repository = repository
        self.sessionStore = sessionStore
        store.pruneMedia()
    }

    var pendingIds: Set<String> {
        Set(store.all().filter { !$0.blocked }.map(\.localId))
    }

    func requestFlush() {
        guard let userId = sessionStore.current()?.userId,
              store.all().contains(where: { !$0.blocked && belongsToUser($0, userId) })
        else { return }
        if flushTask != nil {
            flushAgain = true
            return
        }

        flushTask = Task { [weak self] in
            guard let self else { return }
            _ = await flusher.flush { row in
                sessionStore.current()?.userId == userId && belongsToUser(row, userId)
            }
            let shouldRetry = flushAgain && !Task.isCancelled
            flushAgain = false
            flushTask = nil
            if shouldRetry { requestFlush() }
            if flushTask == nil { endBackgroundTask() }
        }
    }

    func flushOnBackground() {
        if flushTask == nil { requestFlush() }
        guard flushTask != nil, backgroundTask == .invalid else { return }
        backgroundTask = UIApplication.shared.beginBackgroundTask(withName: nil) { [weak self] in
            Task { @MainActor in
                self?.flushTask?.cancel()
                self?.endBackgroundTask()
            }
        }
    }

    func flushForNotificationResponse() async {
        requestFlush()
        while let flushTask {
            await flushTask.value
        }
    }

    func clear() {
        flushAgain = false
        flushTask?.cancel()
        endBackgroundTask()
        let tags = store.all().map { outboxNoticeTag($0.conversationId) }
        let center = UNUserNotificationCenter.current()
        center.removePendingNotificationRequests(withIdentifiers: tags)
        center.removeDeliveredNotifications(withIdentifiers: tags)
        store.clear()
    }

    private func belongsToUser(_ row: QueuedSend, _ userId: String) -> Bool {
        row.ownerUserId == nil || row.ownerUserId == userId
    }

    private func endBackgroundTask() {
        guard backgroundTask != .invalid else { return }
        let task = backgroundTask
        backgroundTask = .invalid
        UIApplication.shared.endBackgroundTask(task)
    }

    private func send(_ row: QueuedSend) async -> SendOutcome {
        let media = row.media.compactMap { queued in
            store.readMedia(row.localId, queued).map {
                OutboundMedia(content_type: queued.contentType, base64: $0.base64EncodedString())
            }
        }
        guard media.count == row.media.count else {
            return .refused(AppStrings.translate(UiLocaleStore.shared.resolved, "thread.outboxMediaLost"))
        }
        do {
            _ = try await repository.send(
                companyId: row.companyId,
                conversationId: row.conversationId,
                body: row.body,
                media: media.isEmpty ? nil : media,
                idempotencyKey: row.localId,
                templateId: row.templateId,
                templateEdited: row.templateEdited ?? false,
                expectedUserId: row.ownerUserId
            )
            return .sent
        } catch is CancellationError {
            return .unreachable("")
        } catch {
            let code = (error as? ApiError)?.code
            if code == ApiErrorCode.network || code == ApiErrorCode.unauthorized || code == ApiErrorCode.mfaRequired {
                return .unreachable(error.userMessage)
            }
            return .refused(error.userMessage)
        }
    }

    private func showNotice(for row: QueuedSend) {
        let viewed = PushHooks.viewedConversationId ?? AppRouter.shared.viewedConversationId
        if UIApplication.shared.applicationState == .active, viewed == row.conversationId { return }
        let tag = outboxNoticeTag(row.conversationId)
        let locale = UiLocaleStore.shared.resolved
        let content = UNMutableNotificationContent()
        content.title = AppStrings.translate(locale, "thread.outboxNotSent")
        content.body = AppStrings.translate(locale, "thread.outboxNoticeBody")
        content.sound = .default
        content.userInfo = [
            "url": AppConfig.appOrigin.appendingPathComponent("inbox")
                .appendingPathComponent(row.conversationId).absoluteString,
            "tag": tag,
        ]
        UNUserNotificationCenter.current().add(
            UNNotificationRequest(identifier: tag, content: content, trigger: nil),
            withCompletionHandler: nil
        )
    }
}
