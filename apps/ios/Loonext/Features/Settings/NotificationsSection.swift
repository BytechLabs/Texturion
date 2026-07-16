import SwiftUI

/// Notifications (#163): per-user Email + Push toggles over GET/PUT
/// /v1/notification-prefs (optimistic with rollback), and the one exception
/// stated plainly: billing and registration emails always reach owners and
/// admins.
///
/// NOTE (#162 swap): the iOS push pass hasn't landed yet (no Features/Push,
/// no APNs registration), so this ships the twin's prefs card without the
/// device-permission block and says so honestly. When #162's
/// NotificationPrefsCard lands, host it here in place of PrefsCard and delete
/// the "isn't wired up" line.
@MainActor
struct NotificationsSectionView: View {
    let scope: SettingsScope

    var body: some View {
        PrefsCard(scope: scope)
        Text(
            "Billing, usage, and registration emails always go to owners and admins — "
                + "they can't be turned off."
        )
        .font(.footnote)
        .foregroundStyle(.secondary)
        .padding(.horizontal, 20)
        .padding(.vertical, 10)
    }
}

private struct PrefsCard: View {
    let scope: SettingsScope

    @State private var state: LoadState<NotificationPrefs> = .loading
    @State private var saveError: String?
    @State private var retryKey = 0

    var body: some View {
        SettingsCard(title: "Notifications") {
            switch state {
            case .loading:
                ProgressView()
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 24)
            case .failed(let message):
                Text(message)
                    .font(.callout)
                    .foregroundStyle(.secondary)
                Button("Try again") { retryKey += 1 }
                    .buttonStyle(.bordered)
                    .padding(.top, 8)
            case .ready(let prefs):
                LabeledToggleRow(
                    label: "Email",
                    supporting: "An email when a new conversation starts or a customer "
                        + "texts back after a quiet spell. Never one per message.",
                    isOn: prefs.email_enabled
                ) { checked in
                    save(email: checked, push: prefs.push_enabled, previous: prefs)
                }
                LabeledToggleRow(
                    label: "Push",
                    supporting: "Notifications on your devices for new texts and missed calls.",
                    isOn: prefs.push_enabled
                ) { checked in
                    save(email: prefs.email_enabled, push: checked, previous: prefs)
                }
                InlineError(saveError)
                Spacer().frame(height: 12)
                Divider()
                Text("Push on this device")
                    .font(.subheadline.weight(.medium))
                    .foregroundStyle(.secondary)
                    .padding(.top, 12)
                    .padding(.bottom, 4)
                Text("Push isn't wired up on this device yet in this build. Everything still shows up in the app.")
                    .font(.callout)
                    .foregroundStyle(.secondary)
            }
        }
        .task(id: "\(scope.companyId)|\(retryKey)") {
            if case .ready = state {} else { state = .loading }
            do {
                state = .ready(try await scope.repo.notificationPrefs(scope.companyId))
            } catch {
                state = .failed(error.userMessage)
            }
        }
    }

    /// Optimistic flip with rollback on failure (twin parity).
    private func save(email: Bool, push: Bool, previous: NotificationPrefs) {
        state = .ready(NotificationPrefs(email_enabled: email, push_enabled: push))
        saveError = nil
        Task {
            do {
                state = .ready(
                    try await scope.repo.updateNotificationPrefs(
                        scope.companyId,
                        emailEnabled: email,
                        pushEnabled: push
                    )
                )
            } catch {
                state = .ready(previous)
                saveError = "That didn't save. Try again."
            }
        }
    }
}
