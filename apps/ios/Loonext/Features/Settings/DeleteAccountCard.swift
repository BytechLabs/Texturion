import SwiftUI

/// What has to be typed. Fixed, unambiguous, and not a name we might change.
private let confirmWord = "delete"

/// #346 — deleting your own account, from the phone.
///
/// Apple 5.1.1(v) requires this of any app that lets you create an account,
/// but the reason to build it well is that a crew member who wants to leave
/// has had no way to: closing a workspace is the owner's alone, and being
/// removed by somebody else is not the same thing.
///
/// The copy draws the line the server actually draws. Someone deleting their
/// account will assume their texts to customers go with them; they do not,
/// they cannot (that record belongs to the business, and part of it sits under
/// a legal retention floor), and discovering it afterwards would be a
/// betrayal. So it is said before the button, not after.
@MainActor
struct DeleteAccountCard: View {
    let scope: SettingsScope
    let onDeleted: @MainActor () -> Void

    @State private var expanded = false
    @State private var preview: AccountDeletionPreview?
    @State private var loading = false
    @State private var error: String?
    @State private var confirming = false
    @State private var typed = ""
    @State private var deleting = false

    private var confirmed: Bool {
        typed.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() == confirmWord
    }

    var body: some View {
        SettingsCard(
            title: "Delete your account",
            description: "Removes you from Loonext entirely. This cannot be undone."
        ) {
            if !expanded {
                Button("Delete my account") { load() }
                    .buttonStyle(.bordered)
                    .tint(BrandColor.destructive)
            } else if loading {
                Text("Checking your account…")
                    .font(.golos(12))
                    .foregroundStyle(BrandColor.muted600)
            } else if let error {
                InlineError(error)
            } else if preview?.blockedByOwnership == true {
                blockedByOwnership
            } else {
                consequences
            }
        }
        // The typed gate lives in the card, not in this alert: SwiftUI ignores
        // most modifiers on alert buttons, so a `.disabled` confirm there would
        // look gated and not be. The alert is the last plain "are you sure".
        .alert("Delete your account?", isPresented: $confirming) {
            Button("Keep my account", role: .cancel) {}
            Button("Delete my account", role: .destructive) { remove() }
        } message: {
            Text(
                "You will be signed out everywhere and will not be able to sign back in. "
                    + "Your work stays with the business, without your name on it. "
                    + "Nobody can undo this."
            )
        }
    }

    /// Specific, not generic: there is no ownership transfer yet (#332), so the
    /// way out has to be spelled out rather than discovered.
    /// "Brightside Plumbing" / "Brightside Plumbing, Rivera Roofing". Named
    /// rather than counted: the owner needs to know WHICH.
    private var ownedNames: String {
        let names = preview?.owned_workspaces.map(\.name) ?? []
        return names.isEmpty ? "a workspace" : names.joined(separator: ", ")
    }

    private var blockedByOwnership: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(
                "You own \(ownedNames). "
                    + "A workspace cannot be left without an owner, so hand it to someone else "
                    + "or close it first — then you can delete your account."
            )
            .font(.golos(13))
            .foregroundStyle(BrandColor.ink)
            Text("Closing a workspace is on the workspace settings screen.")
                .font(.golos(12))
                .foregroundStyle(BrandColor.muted600)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private var consequences: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(
                "You are signed out everywhere and cannot sign back in. Your name comes "
                    + "off the app, and notifications stop."
            )
            .font(.golos(12))
            .foregroundStyle(BrandColor.muted600)

            if let preview, preview.memberships > 0 {
                Text(leavingSentence(preview))
                    .font(.golos(12))
                    .foregroundStyle(BrandColor.muted600)
            }

            Text(
                "Texts you sent to customers, jobs you logged and notes you wrote stay with "
                    + "the business. They have to — that record is theirs, and some of it we "
                    + "are required by law to keep. They will no longer carry your name."
            )
            .font(.golos(12))
            .foregroundStyle(BrandColor.muted600)

            // #371: said here rather than after the fact, because the moment
            // this succeeds you are signed out and there is no screen left to
            // read a confirmation on.
            Text(
                "We email you a confirmation before your address is removed. It is the "
                    + "last thing you will get from us, and it is worth keeping."
            )
            .font(.golos(12))
            .foregroundStyle(BrandColor.muted600)

            // The deliberate pause. This is the one place in the product where
            // slowing someone down is the right thing to do.
            TextField("Type \(confirmWord) to confirm", text: $typed)
                .textFieldStyle(.roundedBorder)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .font(.golos(13))
                .padding(.top, 6)

            Button("Delete my account", role: .destructive) { confirming = true }
                .buttonStyle(.borderedProminent)
                .tint(BrandColor.destructive)
                .disabled(!confirmed || deleting)
                .padding(.top, 6)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func leavingSentence(_ preview: AccountDeletionPreview) -> String {
        let where_ = preview.memberships == 1
            ? "You leave your workspace"
            : "You leave all \(preview.memberships) of your workspaces"
        let work = preview.openWork > 0
            ? ", and anything you are still working on goes back to the crew so nothing is lost."
            : "."
        return where_ + work
    }

    private func load() {
        expanded = true
        loading = true
        error = nil
        Task {
            do {
                preview = try await scope.repo.accountDeletionPreview()
            } catch {
                // `self.` is load-bearing: the caught `error` shadows the
                // property of the same name.
                self.error = "Couldn't check your account. Try again in a moment."
            }
            loading = false
        }
    }

    private func remove() {
        deleting = true
        Task {
            do {
                _ = try await scope.repo.deleteAccount()
                onDeleted()
            } catch let failure {
                // `failure`, not `error` — the view already has an `error`
                // property and shadowing it here reads as a bug on every
                // future visit to this file.
                deleting = false
                typed = ""
                scope.showMessage(
                    (failure as? ApiError)?.message
                        ?? "Couldn't delete your account. Try again in a moment."
                )
            }
        }
    }
}
