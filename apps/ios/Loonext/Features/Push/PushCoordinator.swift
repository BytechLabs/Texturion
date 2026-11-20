import FirebaseCore
import FirebaseMessaging
import Foundation
import os
import UIKit
import UserNotifications

private let coordinatorLog = Logger(subsystem: "com.loonext.ios", category: "push")

struct OnCallPushAction: Equatable, Sendable {
    static let identifier = "ACKNOWLEDGE_ON_CALL"

    let alertId: String
    let companyId: String
    let userId: String

    init?(data: [String: String]) {
        guard let alertId = data["alert_id"], UUID(uuidString: alertId) != nil,
              let companyId = data["action_company_id"], UUID(uuidString: companyId) != nil,
              let userId = data["action_user_id"], UUID(uuidString: userId) != nil
        else { return nil }
        self.alertId = alertId
        self.companyId = companyId
        self.userId = userId
    }
}

/// The push entry point: UNUserNotificationCenter delegate (foreground
/// presentation + tap routing) and FCM MessagingDelegate (token rotation),
/// with the guarded-Firebase rule everywhere — no GoogleService-Info.plist
/// means every path is a quiet no-op, never a crash.
///
/// BOUNDARY (#161): `kind:'call'` BACKGROUND wake is NOT handled here — a
/// normal alert push can't wake the app to ring; that is VoIP/PushKit
/// territory and ships with the calls pass. What this stack does for calls is
/// the honest fallback: the system shows the server's alert push
/// ("Incoming call" + `/calls?call=…` deep link), a FOREGROUND call push is
/// handed to `PushHooks.callWakeHandler` when #161 has installed one, and a
/// tap routes to `.calls(sessionId:)` so the shell can open the calls surface
/// (which then decides about POST /v1/calls/live/{id}/ring-me).
///
/// Wiring (applied — LoonextApp / ShellView / RootViewModel):
/// 1. `@UIApplicationDelegateAdaptor(PushAppDelegate.self)` on LoonextApp.
/// 2. `PushCoordinator.shared.activate(api: graph.api)` once the graph exists.
/// 3. On shell-ready:   `await PushCoordinator.shared.ensureRegistrar(api:).register()`
///    plus `PushHooks.router = { route in … }`.
/// 4. On sign out (BEFORE clearing the session):
///    `await PushCoordinator.shared.ensureRegistrar(api:).unregister()`.
/// 5. From the shell's counts reload: `PushCoordinator.setAppBadge(unreadConversations)`.
@MainActor
final class PushCoordinator: NSObject {
    static let shared = PushCoordinator()

    private(set) var registrar: PushRegistrar?
    weak var actionGraph: AppGraph?

    private override init() {
        super.init()
    }

    /// Idempotent wiring: install the notification-center delegate, configure
    /// Firebase when the plist is bundled, and hold the registrar. Safe to
    /// call again (workspace switches reuse the same registrar).
    func activate(api: ApiClient) {
        _ = ensureRegistrar(api: api)
        UNUserNotificationCenter.current().delegate = self
        if PushAvailability.configureIfNeeded() {
            Messaging.messaging().delegate = self
        }
    }

    private func acknowledge(_ action: OnCallPushAction) async -> Bool {
        guard let api = actionGraph?.api else { return false }
        do {
            _ = try await MessagingRepository(api: api).acknowledgeAlert(
                companyId: action.companyId,
                alertId: action.alertId,
                expectedUserId: action.userId
            )
            return true
        } catch is CancellationError {
            return false
        } catch {
            coordinatorLog.warning("On-call acknowledgement did not complete")
            return false
        }
    }

    /// The registrar, creating it on first use — lets surfaces like the prefs
    /// card work even if `activate` hasn't run yet.
    func ensureRegistrar(api: ApiClient) -> PushRegistrar {
        if let registrar { return registrar }
        let created = PushRegistrar(api: api)
        registrar = created
        return created
    }

    /// App icon badge = unread conversations (the web's document-title unread
    /// prefix equivalent). The shell calls this from its counts reload.
    static func setAppBadge(_ count: Int) {
        Task {
            do {
                try await UNUserNotificationCenter.current().setBadgeCount(count)
            } catch {
                coordinatorLog.info("Badge update failed: \(String(describing: error))")
            }
        }
    }

    static func clearConversationNotifications(_ conversationId: String) {
        Task { await clearNotifications(tags: conversationNotificationTags(conversationId)) }
    }

    static func clearRingNotification(_ sessionId: String) {
        Task { await removeRingNotification(sessionId) }
    }

    @discardableResult
    static func removeRingNotification(_ sessionId: String) async -> Bool {
        await clearNotifications(tags: ["call:\(sessionId)"])
    }

    @discardableResult
    private static func clearNotifications(tags: Set<String>) async -> Bool {
        let center = UNUserNotificationCenter.current()
        let delivered = await center.deliveredNotifications()
        let matching = delivered.compactMap { notification -> String? in
            let push = parsePush(pushData(fromUserInfo: notification.request.content.userInfo))
            return tags.contains(push.tag) ? notification.request.identifier : nil
        }
        guard !matching.isEmpty else { return false }
        center.removeDeliveredNotifications(withIdentifiers: matching)
        return true
    }
}

// MARK: - UNUserNotificationCenterDelegate

extension PushCoordinator: UNUserNotificationCenterDelegate {
    /// Foreground presentation: show the banner unless the user is already
    /// viewing that conversation (realtime shows the message there — a banner
    /// would be noise). Foreground call pushes go to the #161 wake handler
    /// when one is installed; without one the ringing alert still shows —
    /// never silently dropped.
    nonisolated func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        willPresent notification: UNNotification
    ) async -> UNNotificationPresentationOptions {
        let content = notification.request.content
        // #228: this delegate call is nonisolated and `UiLocaleStore` is
        // main-actor, so the language is fetched with one hop before parsing.
        // It only reaches the reader when the payload arrived with no words of
        // its own — the server writes the real banner, and translates it there.
        let locale = await MainActor.run { UiLocaleStore.shared.resolved }
        let push = parsePush(pushData(
            fromUserInfo: content.userInfo,
            fallbackTitle: content.title,
            fallbackBody: content.body
        ), locale)
        if push.isCallEnd {
            if let sessionId = push.callSessionId {
                await Self.removeRingNotification(sessionId)
            }
            return []
        }
        return await MainActor.run {
            if push.isCall {
                if let handler = PushHooks.callWakeHandler {
                    handler(push)
                    return []
                }
                return [.banner, .sound, .list]
            }
            if push.kind == nil || push.kind == PushKind.emergency,
               let conversation = PushHooks.viewedConversationId ?? AppRouter.shared.viewedConversationId,
               conversationNotificationTags(conversation).contains(push.tag) {
                return []
            }
            return [.banner, .sound, .list]
        }
    }

    /// Tap routing: normalize the payload url and hand the parsed route to
    /// the shell (buffered until the shell installs its router — cold start
    /// from a notification). Mirrors the Android MainActivity intent path.
    nonisolated func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        didReceive response: UNNotificationResponse
    ) async {
        let request = response.notification.request
        let content = request.content
        let data = pushData(
            fromUserInfo: content.userInfo,
            fallbackTitle: content.title,
            fallbackBody: content.body
        )
        if response.actionIdentifier == OnCallPushAction.identifier {
            if let action = OnCallPushAction(data: data), await acknowledge(action) {
                center.removeDeliveredNotifications(withIdentifiers: [request.identifier])
            }
            return
        }
        if let action = ThreadPushAction(rawValue: response.actionIdentifier) {
            let reply = (response as? UNTextInputNotificationResponse)?.userText
            if action == .reply { coordinatorLog.notice("Received notification reply") }
            if await handleThreadAction(action, data: data, reply: reply) {
                center.removeDeliveredNotifications(withIdentifiers: [request.identifier])
            } else if action == .reply {
                coordinatorLog.warning("Could not queue notification reply")
            }
            return
        }
        let locale = await MainActor.run { UiLocaleStore.shared.resolved }
        let push = parsePush(data, locale)
        await MainActor.run {
            guard !push.isCallEnd else { return }
            guard let route = parsePushRoute(url: push.url) else { return }
            PushHooks.route(route)
        }
    }

    private func handleThreadAction(_ action: ThreadPushAction, data: [String: String], reply: String?) async -> Bool {
        guard let actionGraph else { return false }
        do {
            return try await performThreadPushAction(action, data: data, replyText: reply, graph: actionGraph)
        } catch is CancellationError {
            return false
        } catch {
            coordinatorLog.warning("Thread notification action did not complete")
            return false
        }
    }
}

// MARK: - MessagingDelegate

extension PushCoordinator: MessagingDelegate {
    /// FCM rotated the registration token — re-upsert against the server
    /// (only after a first registration ever happened; the registrar decides).
    nonisolated func messaging(
        _ messaging: Messaging,
        didReceiveRegistrationToken fcmToken: String?
    ) {
        guard let fcmToken else { return }
        Task { @MainActor in
            guard let registrar = PushCoordinator.shared.registrar else {
                coordinatorLog.info("Token refresh before the push stack was activated; next start re-upserts.")
                return
            }
            await registrar.onTokenRefresh(fcmToken)
        }
    }
}

// MARK: - UIApplicationDelegate bridge

/// Minimal app delegate the integrator attaches with
/// `@UIApplicationDelegateAdaptor(PushAppDelegate.self)` in LoonextApp:
/// configures Firebase at launch (guarded), installs the notification
/// delegates early enough to catch a cold-start notification tap, and plumbs
/// the APNs device token into FirebaseMessaging (method swizzling is not
/// relied on).
@MainActor
final class PushAppDelegate: NSObject, UIApplicationDelegate {
    func application(
        _ application: UIApplication,
        didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
    ) -> Bool {
        let center = UNUserNotificationCenter.current()
        center.delegate = PushCoordinator.shared
        center.setNotificationCategories(pushActionCategories())
        if PushAvailability.configureIfNeeded() {
            Messaging.messaging().delegate = PushCoordinator.shared
        }
        return true
    }

    func application(
        _ application: UIApplication,
        didReceiveRemoteNotification userInfo: [AnyHashable: Any]
    ) async -> UIBackgroundFetchResult {
        let push = parsePush(pushData(fromUserInfo: userInfo))
        guard push.isCallEnd, let sessionId = push.callSessionId else { return .noData }
        let removed = await PushCoordinator.removeRingNotification(sessionId)
        return removed ? .newData : .noData
    }

    func application(
        _ application: UIApplication,
        didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data
    ) {
        // APNs token → FCM bridge. Without Firebase there is nothing to feed.
        guard FirebaseApp.app() != nil else { return }
        Messaging.messaging().apnsToken = deviceToken
    }

    func application(
        _ application: UIApplication,
        didFailToRegisterForRemoteNotificationsWithError error: any Error
    ) {
        // Simulators and restricted devices land here — the app is fine, the
        // feed still works; only device push is off.
        coordinatorLog.info("APNs registration failed: \(String(describing: error))")
    }
}
