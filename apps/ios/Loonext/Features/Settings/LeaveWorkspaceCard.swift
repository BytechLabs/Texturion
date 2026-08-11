import SwiftUI

/// #406 — leaving a workspace yourself.
///
/// Every membership action was something done TO a member and never BY one, so
/// a tech who quit on Friday still had the customer list on Monday: the app
/// kept working until the owner remembered to open settings. The person with
/// the strongest reason to sever the connection was the only one who could not.
///
/// The phone is where this actually happens — the person leaving is a field
/// tech, not somebody at a desk.
///
/// Deliberately not dressed as destruction: nothing is deleted, everything they
/// sent stays attributed to them, and the workspace carries on. It still
/// confirms, because one tap in a truck should not end somebody's access.
struct LeaveWorkspaceCard: View {
    let scope: SettingsScope
    let company: CompanyView
    let onLeft: @MainActor () -> Void

    @Environment(\.appLocale) private var appLocale

    @State private var confirming = false
    @State private var leaving = false
    @State private var error: String?

    var body: some View {
        SettingsCard(
            title: t("settings.leaveTitle"),
            description: t("settings.leaveIntro")
        ) {
            ReadOnlyLine(t("settings.leaveAccessEnds"))
            ReadOnlyLine(t("settings.leaveWorkReturns"))
            ReadOnlyLine(t("settings.leaveHistoryStays"))
            ReadOnlyLine(t("settings.leaveComeBack"))
            InlineError(error)
            Spacer().frame(height: 10)
            Button(t("settings.leaveAction")) { confirming = true }
                .buttonStyle(.bordered)
                .disabled(leaving)
        }
        .alert(
            AppStrings.translate(
                appLocale, "settings.leaveConfirmTitle", ["workspace": company.name]
            ),
            isPresented: $confirming
        ) {
            Button(t("settings.leaveStay"), role: .cancel) {}
            Button(leaving ? t("settings.leavePending") : t("settings.leaveAction")) { leave() }
                .disabled(leaving)
        } message: {
            Text(t("settings.leaveConfirmBody"))
        }
    }

    private func t(_ key: String) -> String {
        AppStrings.translate(appLocale, key)
    }

    private func leave() {
        error = nil
        leaving = true
        Task {
            do {
                try await scope.repo.leaveWorkspace(scope.companyId)
                onLeft()
            } catch {
                self.error = error.userMessage
            }
            leaving = false
        }
    }
}
