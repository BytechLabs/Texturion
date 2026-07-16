import FirebaseCore
import FirebaseMessaging
import Foundation
import os
import UIKit
import UserNotifications

private let coordinatorLog = Logger(subsystem: "com.loonext.ios", category: "push")

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
/// Wiring (the integrator applies — see #162's report):
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
        let push = parsePush(pushData(
            fromUserInfo: content.userInfo,
            fallbackTitle: content.title,
            fallbackBody: content.body
        ))
        return await MainActor.run {
            if push.isCall {
                if let handler = PushHooks.callWakeHandler {
                    handler(push)
                    return []
                }
                return [.banner, .sound, .list]
            }
            if let conversation = conversationId(fromNormalizedUrl: push.url),
               conversation == PushHooks.viewedConversationId {
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
        let content = response.notification.request.content
        let push = parsePush(pushData(
            fromUserInfo: content.userInfo,
            fallbackTitle: content.title,
            fallbackBody: content.body
        ))
        await MainActor.run {
            guard let route = parsePushRoute(url: push.url) else { return }
            PushHooks.route(route)
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
        UNUserNotificationCenter.current().delegate = PushCoordinator.shared
        if PushAvailability.configureIfNeeded() {
            Messaging.messaging().delegate = PushCoordinator.shared
        }
        return true
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
