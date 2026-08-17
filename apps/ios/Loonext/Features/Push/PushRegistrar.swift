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

    /// #337 — has a device token been handed to the server?
    ///
    /// Exposed for the diagnostics surface, which needs to answer "is this phone
    /// registered for push" without reaching for the key string a second time.
    /// Push authorization never being requested was a real iOS bug here, and it
    /// is invisible from the outside.
    static var hasRegisteredToken: Bool {
        UserDefaults.standard.string(forKey: Keys.token) != nil
    }

    fileprivate enum Keys {
        /// Last token successfully handed to (or queued for) the server.
        static let token = "push_device_token"
    }

    /// Not private: the omit-vs-null decision on `locale` is only provable
    /// against the encoded bytes, and `PushRegistrationBodyTests` needs the
    /// type to produce them.
    struct RegisterBody: Encodable, Sendable {
        let platform: String
        let token: String
        /// #228 — the language THIS PHONE is set to, reported so a push can be
        /// written in it. A notification is composed on the server, hours after
        /// anyone opened the app, and the registration row is the only place
        /// the device's own language can be read from at that point; without it
        /// a French reader whose workspace runs in English is buzzed in English.
        ///
        /// Sent exactly as iOS reports it (`fr-CA`, `en-US`) and NOT normalised
        /// here — the server owns that rule so three hand-ports cannot come to
        /// three answers about what `fr` means.
        ///
        /// Optional, so Swift's synthesised encoding omits it rather than
        /// sending null: an absent field leaves whatever an earlier
        /// registration reported alone, which is what a phone that has no
        /// preferred language should do.
        let locale: String?
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
        // #286: this used to ask for notification permission first, which
        // meant the system prompt landed four seconds into a first launch with
        // nothing said about it — and iOS gives an app exactly one. The ask
        // now belongs to NotificationAsk, behind a screen that says what the
        // alerts are; registering without it is still worth doing, because an
        // APNs token carries badges and silent delivery either way.
        //
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
            // Read fresh on every upsert rather than captured once: iOS
            // restarts the app when the phone's language changes, so this is
            // always the current answer, and re-registering is how a phone that
            // switched to French tells the server so.
            let _: JSONValue = try await api.post(
                "/v1/device-push-tokens",
                body: RegisterBody(platform: "ios", token: token, locale: UiLocale.deviceTag())
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
