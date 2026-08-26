import SwiftUI
import UserNotifications

/// #337 — the settings destination that assembles the snapshot and shows it.
///
/// Split from `DiagnosticsView` on purpose. The view takes a value and renders
/// it; this takes the app graph and produces the value. That is what lets #253's
/// support reporting build the same `DiagnosticsSnapshot` from a background path
/// with no view in sight, instead of assembling device context a second time.
///
/// The snapshot is read once, when the screen opens. A live-updating diagnostics
/// screen sounds better and is worse: the number somebody reads down a phone has
/// to still be the number on their screen when they finish the sentence.
@MainActor
struct DiagnosticsSectionView: View {
    let graph: AppGraph
    let companyId: String

    @State private var snapshot: DiagnosticsSnapshot?
    @Environment(\.appLocale) private var appLocale

    var body: some View {
        Group {
            if let snapshot {
                DiagnosticsView(snapshot: snapshot)
            } else {
                CenteredLoading()
            }
        }
        .task { snapshot = await load() }
    }

    private func load() async -> DiagnosticsSnapshot {
        let realtimeState = await graph.realtime.stateLabel(locale: appLocale)
        let notificationsAllowed = await notificationsAuthorized()
        return DiagnosticsSnapshot.current(
            realtimeState: realtimeState,
            pushRegistered: PushRegistrar.hasRegisteredToken,
            notificationsAllowed: notificationsAllowed,
            companyId: companyId
        )
    }

    /// Authorized, or anything else. Provisional and ephemeral both mean the
    /// person may not be getting alerts, which is the question being asked —
    /// the distinction between them belongs on the notifications screen, not on
    /// a line somebody reads out loud.
    private func notificationsAuthorized() async -> Bool {
        let settings = await UNUserNotificationCenter.current().notificationSettings()
        return settings.authorizationStatus == .authorized
    }
}
