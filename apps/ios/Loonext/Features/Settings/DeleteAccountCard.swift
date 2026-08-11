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

    @Environment(\.appLocale) private var appLocale

    private var confirmed: Bool {
        typed.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() == confirmWord
    }

    private func t(_ key: String) -> String {
        AppStrings.translate(appLocale, key)
    }

    var body: some View {
        SettingsCard(
            title: t("settings.deleteTitle"),
            description: t("settings.deleteIntro")
        ) {
            if !expanded {
                Button(t("settings.deleteAction")) { load() }
                    .buttonStyle(.bordered)
                    .tint(BrandColor.destructive)
            } else if loading {
                Text(t("settings.deleteChecking"))
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
        .alert(t("settings.deleteConfirmTitle"), isPresented: $confirming) {
            Button(t("settings.deleteKeep"), role: .cancel) {}
            Button(t("settings.deleteAction"), role: .destructive) { remove() }
        } message: {
            Text(t("settings.deleteConfirmBody"))
        }
    }

    /// Specific, not generic: there is no ownership transfer yet (#332), so the
    /// way out has to be spelled out rather than discovered.
    /// "Brightside Plumbing" / "Brightside Plumbing, Rivera Roofing". Named
    /// rather than counted: the owner needs to know WHICH.
    private var ownedNames: String {
        let names = preview?.owned_workspaces.map(\.name) ?? []
        return names.isEmpty
            ? t("settings.deleteOwnedFallback")
            : names.joined(separator: ", ")
    }

    private var blockedByOwnership: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(AppStrings.translate(
                appLocale, "settings.deleteBlockedByOwnership", ["workspaces": ownedNames]
            ))
            .font(.golos(13))
            .foregroundStyle(BrandColor.ink)
            Text(t("settings.deleteClosingIsElsewhere"))
                .font(.golos(12))
                .foregroundStyle(BrandColor.muted600)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private var consequences: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(t("settings.deleteSignedOut"))
                .font(.golos(12))
                .foregroundStyle(BrandColor.muted600)

            if let preview, preview.memberships > 0 {
                Text(leavingSentence(preview))
                    .font(.golos(12))
                    .foregroundStyle(BrandColor.muted600)
            }

            Text(t("settings.deleteRecordStays"))
                .font(.golos(12))
                .foregroundStyle(BrandColor.muted600)

            // #371: said here rather than after the fact, because the moment
            // this succeeds you are signed out and there is no screen left to
            // read a confirmation on.
            Text(t("settings.deleteConfirmationEmail"))
                .font(.golos(12))
                .foregroundStyle(BrandColor.muted600)

            // The deliberate pause. This is the one place in the product where
            // slowing someone down is the right thing to do.
            TextField(
                AppStrings.translate(
                    appLocale, "settings.deleteTypeToConfirm", ["word": confirmWord]
                ),
                text: $typed
            )
                .textFieldStyle(.roundedBorder)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .font(.golos(13))
                .padding(.top, 6)

            Button(t("settings.deleteAction"), role: .destructive) { confirming = true }
                .buttonStyle(.borderedProminent)
                .tint(BrandColor.destructive)
                .disabled(!confirmed || deleting)
                .padding(.top, 6)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    /// Four whole sentences rather than a stem and a tail.
    ///
    /// The English reads as one sentence with a clause bolted on, and it cannot
    /// be translated that way: French agrees the verb with the count and puts
    /// the clause somewhere else. A shared stem would have printed half a
    /// sentence in one language and half in the other. Same split as Android's.
    private func leavingSentence(_ preview: AccountDeletionPreview) -> String {
        let openWork = preview.openWork > 0
        if preview.memberships == 1 {
            return t(
                openWork ? "settings.deleteLeaveOneOpenWork" : "settings.deleteLeaveOne"
            )
        }
        return AppStrings.translate(
            appLocale,
            openWork ? "settings.deleteLeaveManyOpenWork" : "settings.deleteLeaveMany",
            ["count": "\(preview.memberships)"]
        )
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
                self.error = t("settings.deletePreviewFailed")
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
                    (failure as? ApiError)?.message ?? t("settings.deleteFailed")
                )
            }
        }
    }
}
