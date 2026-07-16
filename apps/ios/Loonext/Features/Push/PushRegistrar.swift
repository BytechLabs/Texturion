import FirebaseCore
import FirebaseMessaging
import Foundation
import os
import UIKit

private let pushLog = Logger(subsystem: "com.loonext.ios", category: "push")

/// Guarded Firebase availability. Firebase is OPTIONAL in this build:
/// `FirebaseApp.configure()` CRASHES without a GoogleService-Info.plist, so
/// every entry point checks for the resource first and treats its absence as
/// "push unavailable, app fine" (one log) — mirroring Android's
/// PushRegistrar.isFirebaseAvailable.
@MainActor
enum PushAvailability {
    private static var loggedUnavailable = false

    static var hasFirebaseConfigFile: Bool {
        Bundle.main.url(forResource: "GoogleService-Info", withExtension: "plist") != nil
    }

    /// True when Firebase is (or can be) configured in this build.
    static var isFirebaseConfigured: Bool {
        FirebaseApp.app() != nil || hasFirebaseConfigFile
    }

    /// Reuse the configured default app when present, else configure from the
    /// bundled plist. False = this build ships without Firebase config — log
    /// once and treat push as unavailable. NEVER crashes.
    @discardableResult
    static func configureIfNeeded() -> Bool {
        if FirebaseApp.app() != nil { return true }
        guard hasFirebaseConfigFile else {
            if !loggedUnavailable {
                loggedUnavailable = true
                pushLog.info("No Firebase config in this build — push unavailable, app fine.")
            }
            return false
        }
        FirebaseApp.configure()
        return true
    }
}

/// FCM device-token lifecycle against POST/DELETE /v1/device-push-tokens
/// (#151). Both platforms register an FCM registration token — iOS delivery
/// rides FCM's APNs bridge, so APNs registration feeds `Messaging.apnsToken`
/// (PushCoordinator/PushAppDelegate) and the FCM token is what the server
/// stores.
///
/// Semantics mirror Android's PushRegistrar:
/// - `register()` on every app start once a session is active (self-healing
///   re-upsert, #143) and after the user grants notification permission.
/// - a 404 from a lagging backend keeps the token locally and retries on the
///   next start; other failures just log.
/// - `unregister()` BEFORE sign-out clears the session: best-effort server
///   delete (by TOKEN — the route has no row-id path), then FCM token
///   invalidation so this phone stops receiving.
///
/// The endpoint is Bearer-only (tokens are per-USER; SPEC §6) — no
/// X-Company-Id is sent.
actor PushRegistrar {
    private let api: ApiClient

    private enum Keys {
        /// Last token successfully handed to (or queued for) the server.
        static let token = "push_device_token"
    }

    private struct RegisterBody: Encodable, Sendable {
        let platform: String
        let token: String
    }

    private struct RemoveBody: Encodable, Sendable {
        let token: String
    }

    init(api: ApiClient) {
        self.api = api
    }

    /// Fetch the current FCM token and upsert it server-side. No-op (with one
    /// log, once) when Firebase isn't configured in this build.
    func register() async {
        guard await MainActor.run(body: { PushAvailability.configureIfNeeded() }) else { return }
        // APNs registration feeds Messaging.apnsToken via PushAppDelegate;
        // FCM needs it before it can mint a registration token.
        await MainActor.run { UIApplication.shared.registerForRemoteNotifications() }
        guard let token = await fetchToken() else { return }
        await upload(token)
    }

    /// FCM rotated the token (MessagingDelegate) — re-upsert. Before any
    /// registration ever happened there is nothing to update; the first
    /// `register()` call uploads.
    func onTokenRefresh(_ token: String) async {
        guard UserDefaults.standard.string(forKey: Keys.token) != nil else {
            pushLog.info("FCM token refreshed before first registration; deferring to app start.")
            return
        }
        await upload(token)
    }

    /// Sign-out teardown: delete the server row by token, then invalidate the
    /// device token so this phone stops receiving. Call BEFORE the session is
    /// cleared (the DELETE needs the bearer); every step is best-effort.
    func unregister() async {
        let configured = await MainActor.run(body: { PushAvailability.configureIfNeeded() })
        var token = UserDefaults.standard.string(forKey: Keys.token)
        if token == nil, configured {
            token = await fetchToken()
        }
        if let token {
            do {
                let body = try JSONEncoder().encode(RemoveBody(token: token))
                _ = try await api.raw("DELETE", "/v1/device-push-tokens", body: body)
                pushLog.info("Deleted device push token registration.")
            } catch let error as ApiError
                where error.code == ApiErrorCode.notFound || error.httpStatus == 404 {
                pushLog.info("Device push token already gone server-side.")
            } catch {
                pushLog.warning("Device push token delete failed; signing out anyway.")
            }
        }
        if configured {
            await deleteFcmToken()
        }
        UserDefaults.standard.removeObject(forKey: Keys.token)
    }

    private func upload(_ token: String) async {
        do {
            let _: JSONValue = try await api.post(
                "/v1/device-push-tokens",
                body: RegisterBody(platform: "ios", token: token)
            )
            UserDefaults.standard.set(token, forKey: Keys.token)
            pushLog.info("Device push token registered.")
        } catch let error as ApiError
            where error.code == ApiErrorCode.notFound || error.httpStatus == 404 {
            // Backend not deployed yet — keep the token locally; the next
            // app-start register() retries automatically (#151 lag tolerance).
            UserDefaults.standard.set(token, forKey: Keys.token)
            pushLog.info("device-push-tokens endpoint missing (backend lag); will retry on next start.")
        } catch {
            pushLog.warning("Device push token registration failed.")
        }
    }

    private func fetchToken() async -> String? {
        do {
            return try await Messaging.messaging().token()
        } catch {
            pushLog.warning("FCM token fetch failed: \(String(describing: error))")
            return nil
        }
    }

    private func deleteFcmToken() async {
        do {
            try await Messaging.messaging().deleteToken()
        } catch {
            pushLog.warning("FCM token invalidation failed: \(String(describing: error))")
        }
    }
}
