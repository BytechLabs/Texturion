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

    @State private var confirming = false
    @State private var leaving = false
    @State private var error: String?

    var body: some View {
        SettingsCard(
            title: "Leave this workspace",
            description: "End your own access to this workspace. You can do this yourself — "
                + "you don't need to ask an owner."
        ) {
            ReadOnlyLine("Your access ends straight away, on every device you're signed in on.")
            ReadOnlyLine(
                "Anything you were working on goes back to the team, so nothing is left "
                    + "pointing at someone who has gone."
            )
            ReadOnlyLine(
                "Messages you sent stay on the record under your name. Leaving doesn't "
                    + "erase your work, and isn't meant to."
            )
            ReadOnlyLine("To come back, someone in the workspace has to invite you again.")
            InlineError(error)
            Spacer().frame(height: 10)
            Button("Leave workspace") { confirming = true }
                .buttonStyle(.bordered)
                .disabled(leaving)
        }
        .alert("Leave \(company.name)?", isPresented: $confirming) {
            Button("Stay", role: .cancel) {}
            Button(leaving ? "Leaving…" : "Leave workspace") { leave() }
                .disabled(leaving)
        } message: {
            Text(
                "Your access ends now and your open work goes back to the team. "
                    + "To come back, someone will need to invite you again."
            )
        }
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
