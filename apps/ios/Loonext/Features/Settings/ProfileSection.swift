import SwiftUI

/// Profile & account (#163): your display name (PATCH /v1/me), the theme
/// choice, who you're signed in as, and the two GoTrue account operations —
/// change email (double-confirm) and change/set password (with the
/// reauthentication-nonce retry when the session is stale).
@MainActor
struct ProfileSectionView: View {
    let scope: SettingsScope
    let onSignOut: @MainActor () -> Void

    @Environment(\.appLocale) private var appLocale

    var body: some View {
        DisplayNameCard(scope: scope)
        ThemeCard(prefs: scope.graph.prefs)
        AccountCard(scope: scope)
        // #314: directly under the password, because it is the same question —
        // how somebody proves they are you.
        TwoFactorCard(scope: scope)
        SettingsCard(title: AppStrings.translate(appLocale, "settingsMore.signOut")) {
            // Destructive (red) — the founder-feedback sign-out styling (#186).
            Button(
                AppStrings.translate(appLocale, "settingsMore.signOutThisDevice"),
                role: .destructive
            ) { onSignOut() }
                .buttonStyle(.bordered)
                .tint(BrandColor.destructive)
        }
        // #346: last — leaving is not one of the everyday account settings.
        DeleteAccountCard(scope: scope, onDeleted: onSignOut)
    }
}

// MARK: - Display name

private struct DisplayNameCard: View {
    let scope: SettingsScope

    @State private var name: String
    @State private var saving = false
    @State private var error: String?

    @Environment(\.appLocale) private var appLocale

    init(scope: SettingsScope) {
        self.scope = scope
        _name = State(initialValue: scope.me.display_name)
    }

    private var trimmed: String { name.trimmingCharacters(in: .whitespacesAndNewlines) }
    private var dirty: Bool { trimmed != scope.me.display_name }
    private var valid: Bool { (1 ... 80).contains(trimmed.count) }

    var body: some View {
        SettingsCard(
            title: AppStrings.translate(appLocale, "settingsMore.yourName"),
            description: AppStrings.translate(appLocale, "settingsMore.yourNameDesc")
        ) {
            TextField(
                AppStrings.translate(appLocale, "settingsMore.yourName"),
                text: $name
            )
                .textFieldStyle(.roundedBorder)
            if dirty && !valid {
                Text(AppStrings.translate(appLocale, "settingsMore.nameLength"))
                    .font(.footnote)
                    .foregroundStyle(BrandColor.destructive)
                    .padding(.top, 4)
            }
            InlineError(error)
            if dirty {
                Button(
                    AppStrings.translate(
                        appLocale, saving ? "common.saving" : "common.save"
                    )
                ) { save() }
                    .buttonStyle(.borderedProminent)
                    .tint(BrandColor.olive)
                    .disabled(!valid || saving)
                    .padding(.top, 10)
            }
        }
    }

    private func save() {
        error = nil
        saving = true
        let value = trimmed
        Task {
            do {
                try await scope.graph.meApi.updateDisplayName(value)
                scope.showMessage(AppStrings.translate(appLocale, "settingsMore.nameSaved"))
            } catch {
                self.error = error.userMessage
            }
            saving = false
        }
    }
}

// MARK: - Theme

private struct ThemeCard: View {
    @Bindable var prefs: AppPrefs

    @Environment(\.appLocale) private var appLocale

    var body: some View {
        SettingsCard(title: AppStrings.translate(appLocale, "settingsMore.theme")) {
            // Styled segmented control (ink pill), matching Android/web (#186).
            ThemeSegmentedControl(theme: $prefs.theme)
        }
    }
}

// MARK: - Account (email + password via GoTrue)

private struct AccountCard: View {
    let scope: SettingsScope

    @Environment(\.appLocale) private var appLocale

    private var email: String? {
        let value = scope.graph.sessionStore.current()?.email
        return (value?.isEmpty == false) ? value : nil
    }

    var body: some View {
        SettingsCard(
            title: AppStrings.translate(appLocale, "settingsMore.account"),
            description: email.map {
                AppStrings.translate(
                    appLocale, "settingsMore.signedInAs", ["email": $0]
                )
            }
        ) {
            ChangeEmailBlock(scope: scope)
            Spacer().frame(height: 16)
            ChangePasswordBlock(scope: scope)
        }
    }
}

private struct ChangeEmailBlock: View {
    let scope: SettingsScope

    @State private var editing = false
    @State private var newEmail = ""
    @State private var saving = false
    @State private var error: String?

    @Environment(\.appLocale) private var appLocale

    var body: some View {
        if !editing {
            Button(AppStrings.translate(appLocale, "settingsMore.changeEmail")) {
                editing = true
            }
                .buttonStyle(.bordered)
        } else {
            VStack(alignment: .leading, spacing: 0) {
                TextField(
                    AppStrings.translate(appLocale, "settingsMore.newEmail"),
                    text: $newEmail
                )
                    .textFieldStyle(.roundedBorder)
                    .keyboardType(.emailAddress)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .disabled(saving)
                InlineError(error)
                Button(
                    AppStrings.translate(
                        appLocale,
                        saving ? "settingsMore.sending" : "settingsMore.sendConfirmLinks"
                    )
                ) { submit() }
                    .buttonStyle(.borderedProminent)
                    .tint(BrandColor.olive)
                    .disabled(saving || newEmail.isBlank)
                    .padding(.top, 8)
            }
        }
    }

    private func submit() {
        let trimmed = newEmail.trimmingCharacters(in: .whitespaces)
        guard trimmed.contains("@"), trimmed.count >= 3 else {
            error = AppStrings.translate(appLocale, "settingsMore.enterNewEmail")
            return
        }
        saving = true
        error = nil
        Task {
            do {
                let token = try await scope.repo.freshAccessToken()
                try await SettingsAuthClient().updateEmail(accessToken: token, newEmail: trimmed)
                editing = false
                newEmail = ""
                scope.showMessage(
                    AppStrings.translate(appLocale, "settingsMore.emailConfirmSent")
                )
            } catch {
                self.error = error.userMessage
            }
            saving = false
        }
    }
}

private struct ChangePasswordBlock: View {
    let scope: SettingsScope

    @State private var editing = false
    @State private var password = ""
    @State private var nonce = ""
    @State private var nonceNeeded = false
    @State private var saving = false
    @State private var error: String?

    @Environment(\.appLocale) private var appLocale

    var body: some View {
        if !editing {
            VStack(alignment: .leading, spacing: 4) {
                Button(AppStrings.translate(appLocale, "settingsMore.changePassword")) {
                    editing = true
                }
                    .buttonStyle(.bordered)
                ReadOnlyLine(
                    AppStrings.translate(appLocale, "settingsMore.passwordOauthNote")
                )
            }
        } else {
            VStack(alignment: .leading, spacing: 0) {
                SecureField(
                    AppStrings.translate(appLocale, "settingsMore.newPassword"),
                    text: $password
                )
                    .textFieldStyle(.roundedBorder)
                    .textContentType(.newPassword)
                    .disabled(saving)
                Text(AppStrings.translate(appLocale, "settingsMore.atLeast8"))
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .padding(.top, 2)
                if nonceNeeded {
                    Text(AppStrings.translate(appLocale, "settingsMore.reauthCodeNote"))
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                    .padding(.top, 8)
                    TextField(
                        AppStrings.translate(appLocale, "settingsMore.codeFromEmail"),
                        text: $nonce
                    )
                        .textFieldStyle(.roundedBorder)
                        .keyboardType(.numberPad)
                        .disabled(saving)
                        .padding(.top, 4)
                }
                InlineError(error)
                Button(
                    AppStrings.translate(
                        appLocale,
                        saving ? "common.saving" : "settingsMore.savePassword"
                    )
                ) { submit() }
                    .buttonStyle(.borderedProminent)
                    .tint(BrandColor.olive)
                    .disabled(saving || password.isEmpty || (nonceNeeded && nonce.isBlank))
                    .padding(.top, 8)
            }
        }
    }

    private func submit() {
        guard password.count >= 8 else {
            error = AppStrings.translate(appLocale, "settingsMore.passwordTooShort")
            return
        }
        saving = true
        error = nil
        let auth = SettingsAuthClient()
        Task {
            do {
                let token = try await scope.repo.freshAccessToken()
                let trimmedNonce = nonce.trimmingCharacters(in: .whitespaces)
                try await auth.updatePassword(
                    accessToken: token,
                    password: password,
                    nonce: trimmedNonce.isEmpty ? nil : trimmedNonce
                )
                editing = false
                password = ""
                nonce = ""
                nonceNeeded = false
                scope.showMessage(
                    AppStrings.translate(appLocale, "settingsMore.passwordUpdated")
                )
            } catch let cause as ApiError where cause.code == reauthenticationNeededCode && !nonceNeeded {
                // Stale session: GoTrue wants a fresh proof. Email the
                // one-time code, then retry the same change with it.
                do {
                    let token = try await scope.repo.freshAccessToken()
                    try await auth.requestReauthenticationNonce(accessToken: token)
                    nonceNeeded = true
                    error = nil
                } catch {
                    self.error = error.userMessage
                }
            } catch {
                self.error = error.userMessage
            }
            saving = false
        }
    }
}
