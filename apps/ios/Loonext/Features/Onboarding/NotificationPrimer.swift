import SwiftUI
import UserNotifications

/**
 #286 — the notification ask, with a reason in front of it.

 `PushRegistrar.register()` used to call `requestAuthorization` on every app
 start once a session existed, which in practice meant the system prompt landed
 four seconds into a first launch with nothing said about it. iOS gives an app
 ONE prompt: after a refusal, `requestAuthorization` returns immediately and
 forever without showing anything, and the only way back is the Settings app.

 So the ask is now the second thing that happens, not the first: the app says
 what it will and will not buzz about, and the person taps a button that fires
 the real prompt.

 *Applying: Ethical Friction, inverted — the deliberate pause protects the
 user's attention rather than their data, and it protects our one prompt too.*
 */

/**
 The system prompt, and whether there is any point offering it.

 Both callers — the standalone primer below and the joining orientation's last
 screen — hold one of these rather than reaching for UNUserNotificationCenter
 themselves, so "already answered" is read in exactly one place.
 */
@MainActor
@Observable
final class NotificationAsk {
    /// Nothing has been decided on this device yet, so the prompt would show.
    private(set) var askable = false

    /// Their own "not now". Ours to record, unlike the system's answer, and
    /// what keeps the primer from asking on every launch afterwards.
    private static let declinedKey = "notification_primer_declined"

    func refresh() async {
        let settings = await UNUserNotificationCenter.current().notificationSettings()
        let undecided = settings.authorizationStatus == .notDetermined
        askable = undecided && !UserDefaults.standard.bool(forKey: Self.declinedKey)
    }

    /**
     Fire the OS prompt. A no-op where it cannot help — already granted, already
     refused — so a caller can wire one button and let this decide.

     Registration follows either way: a refusal still leaves a token worth
     having for badges and silent delivery, and the prefs card is where the
     refusal is explained.
     */
    func request() async {
        guard askable else { return }
        _ = try? await UNUserNotificationCenter.current()
            .requestAuthorization(options: [.alert, .badge, .sound])
        askable = false
    }

    /// A deliberate "not now". Asking again on every launch is how an app gets
    /// deleted; the settings notifications card is the way back.
    func decline() {
        UserDefaults.standard.set(true, forKey: Self.declinedKey)
        askable = false
    }
}

/**
 The standalone version, for everybody the joining orientation is not for — the
 owner who just finished setup, and anybody already here when this shipped.

 One screen rather than four: they are not new to the workspace, only to this
 question. It names what the alerts are and what they are not, because "allow
 notifications?" with no object is a question about spam.
 */
struct NotificationPrimerSheet: View {
    let ask: NotificationAsk
    let onDone: () -> Void

    @Environment(\.appLocale) private var appLocale

    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            Image(systemName: "bell.badge")
                .font(.title2)
                .foregroundStyle(Color.accentColor)
                .frame(width: 44, height: 44)
                .background(Color.accentColor.opacity(0.12), in: Circle())
            VStack(alignment: .leading, spacing: 8) {
                Text(AppStrings.translate(appLocale, "shell.primerTitle"))
                    .font(.title2.weight(.semibold))
                Text(AppStrings.translate(appLocale, "shell.primerBody"))
                    .font(.body)
                    .foregroundStyle(.secondary)
            }
            Spacer(minLength: 0)
            HStack {
                Button(AppStrings.translate(appLocale, "shell.notificationsNotNow")) {
                    ask.decline()
                    onDone()
                }
                .buttonStyle(.plain)
                .foregroundStyle(.secondary)
                Spacer()
                Button(AppStrings.translate(appLocale, "shell.notificationsTurnOn")) {
                    Task {
                        await ask.request()
                        onDone()
                    }
                }
                .buttonStyle(.borderedProminent)
            }
        }
        .padding(24)
        .presentationDetents([.height(300)])
    }
}
