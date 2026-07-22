import SwiftUI
import UIKit
import UserNotifications

/// Embeddable notification settings card (#163's settings screen hosts it):
/// per-user Email + Push toggles (GET/PUT /v1/notification-prefs, optimistic
/// with rollback) and this device's push permission — not-determined ('Turn
/// on' fires the system prompt), denied (deep link into system settings),
/// authorized, plus the honest 'push unavailable in this build' state when
/// Firebase isn't configured. Granting permission (or landing here already
/// granted with push on) re-upserts the device token — the #143 self-healing
/// mirror.
@MainActor
struct NotificationPrefsCard: View {
    let graph: AppGraph
    let companyId: String

    @State private var state: LoadState<NotificationPrefs> = .loading
    @State private var saveError: String?
    @State private var retryKey = 0

    private var feedApi: NotificationsFeedApi {
        NotificationsFeedApi(api: graph.api)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Text("Notifications")
                .font(.golos(15, weight: .semibold))
                .foregroundStyle(BrandColor.ink)

            switch state {
            case .loading:
                HStack {
                    Spacer()
                    ProgressView()
                    Spacer()
                }
                .padding(.vertical, 24)

            case .failed(let message):
                VStack(alignment: .leading, spacing: 4) {
                    Text(message)
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                    Button("Try again") {
                        state = .loading
                        retryKey += 1
                    }
                    .font(.subheadline)
                }
                .padding(.top, 8)

            case .ready(let prefs):
                PrefToggleRow(
                    title: "Email",
                    supporting: "An email when a new conversation starts or a customer "
                        + "texts back after a quiet spell. Never one per message.",
                    isOn: prefs.email_enabled
                ) { checked in
                    save(
                        NotificationPrefs(email_enabled: checked, push_enabled: prefs.push_enabled),
                        previous: prefs
                    )
                }
                PrefToggleRow(
                    title: "Push",
                    supporting: "Notifications on your devices for new texts and missed calls.",
                    isOn: prefs.push_enabled
                ) { checked in
                    save(
                        NotificationPrefs(email_enabled: prefs.email_enabled, push_enabled: checked),
                        previous: prefs
                    )
                }
                if let saveError {
                    Text(saveError)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .padding(.top, 4)
                }

                Divider()
                    .padding(.top, 12)
                DevicePushSection(
                    graph: graph,
                    companyId: companyId,
                    pushEnabled: prefs.push_enabled
                )
            }
        }
        .task(id: "\(companyId)#\(retryKey)") { await load() }
    }

    private func load() async {
        if case .ready = state {} else { state = .loading }
        do {
            state = .ready(try await feedApi.prefs(companyId: companyId))
        } catch {
            if Task.isCancelled { return }
            state = .failed(error.userMessage)
        }
    }

    private func save(_ next: NotificationPrefs, previous: NotificationPrefs) {
        state = .ready(next)
        saveError = nil
        Task {
            do {
                state = .ready(try await feedApi.updatePrefs(companyId: companyId, prefs: next))
            } catch {
                state = .ready(previous)
                saveError = "That didn't save. Try again."
            }
        }
    }
}

private struct PrefToggleRow: View {
    let title: String
    let supporting: String
    let isOn: Bool
    /// Non-Sendable closure formed in the card's MainActor body — it inherits
    /// that isolation, so `Binding(set:)` can take it without a type bridge.
    let onChange: (Bool) -> Void

    var body: some View {
        Toggle(isOn: Binding(get: { isOn }, set: onChange)) {
            VStack(alignment: .leading, spacing: 2) {
                Text(title)
                    .font(.golos(13.5, weight: .semibold))
                    .foregroundStyle(BrandColor.ink)
                Text(supporting)
                    .font(.golos(11.5))
                    .foregroundStyle(BrandColor.muted500)
            }
        }
        .tint(BrandColor.olive)
        .padding(.vertical, 10)
    }
}

/// Per-device push permission state (UNUserNotificationCenter model).
private enum DevicePushState: Equatable {
    case checking
    /// No Firebase config in this build — honest copy, feed still works.
    case unavailable
    /// authorized / provisional / ephemeral.
    case on
    /// notDetermined — a real system prompt is still available.
    case off
    /// denied — recovery lives in system settings.
    case blocked
}

@MainActor
private struct DevicePushSection: View {
    let graph: AppGraph
    let companyId: String
    let pushEnabled: Bool

    @Environment(\.scenePhase) private var scenePhase
    @Environment(\.openURL) private var openURL
    @State private var pushState: DevicePushState = .checking
    @State private var requesting = false

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Push on this device")
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(.secondary)
                .padding(.top, 12)

            switch pushState {
            case .checking:
                ProgressView()
                    .controlSize(.small)

            case .unavailable:
                Text("Push isn't available in this build yet. Everything still shows up in the app.")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)

            case .on:
                statusRow(
                    text: "This device gets a notification when a customer texts or calls.",
                    action: "System settings",
                    solid: false,
                    onAction: openSystemSettings
                )

            case .off:
                statusRow(
                    text: "Get a notification on this device when a customer texts or calls, "
                        + "even with Loonext closed.",
                    action: requesting ? "Turning on…" : "Turn on",
                    solid: true,
                    onAction: turnOn
                )

            case .blocked:
                statusRow(
                    text: "Notifications are turned off for Loonext in system settings. "
                        + "Turn them on there to get pinged.",
                    action: "Open settings",
                    solid: false,
                    onAction: openSystemSettings
                )
            }
        }
        .task(id: companyId) { await refreshState() }
        // Re-read permission state whenever we come back from the system
        // prompt or the Settings app.
        .onChange(of: scenePhase) { _, phase in
            if phase == .active {
                Task { await refreshState() }
            }
        }
        // #143 self-heal: any time this device is allowed to push and the user
        // wants push, re-upsert the token (server may have pruned a dead row).
        .task(id: selfHealKey) {
            if pushState == .on && pushEnabled {
                await PushCoordinator.shared.ensureRegistrar(api: graph.api).register()
            }
        }
    }

    private var selfHealKey: String {
        "\(String(describing: pushState))|\(pushEnabled)|\(companyId)"
    }

    private func refreshState() async {
        guard PushAvailability.isFirebaseConfigured else {
            pushState = .unavailable
            return
        }
        let settings = await UNUserNotificationCenter.current().notificationSettings()
        switch settings.authorizationStatus {
        case .authorized, .provisional, .ephemeral:
            pushState = .on
        case .denied:
            pushState = .blocked
        case .notDetermined:
            pushState = .off
        @unknown default:
            // A status added after this build — settings-link recovery is the
            // honest arm (never a dead 'Turn on').
            pushState = .blocked
        }
    }

    private func turnOn() {
        guard !requesting else { return }
        requesting = true
        Task {
            defer { requesting = false }
            let granted = (try? await UNUserNotificationCenter.current()
                .requestAuthorization(options: [.alert, .badge, .sound])) ?? false
            if granted {
                await PushCoordinator.shared.ensureRegistrar(api: graph.api).register()
            }
            await refreshState()
        }
    }

    private func openSystemSettings() {
        if let url = URL(string: UIApplication.openNotificationSettingsURLString) {
            openURL(url)
        }
    }

    @ViewBuilder
    private func statusRow(
        text: String,
        action: String,
        solid: Bool,
        onAction: @escaping @MainActor () -> Void
    ) -> some View {
        HStack(alignment: .center, spacing: 12) {
            Text(text)
                .font(.subheadline)
                .foregroundStyle(.secondary)
            Spacer(minLength: 0)
            if solid {
                Button(action, action: onAction)
                    .buttonStyle(.borderedProminent)
                    .tint(BrandColor.olive)
                    .disabled(requesting)
            } else {
                Button(action, action: onAction)
                    .font(.subheadline)
            }
        }
        .padding(.vertical, 4)
    }
}
