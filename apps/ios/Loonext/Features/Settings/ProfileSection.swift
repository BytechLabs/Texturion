import SwiftUI

/// Profile & account (#163): your display name (PATCH /v1/me), the theme
/// choice, who you're signed in as, and the two GoTrue account operations —
/// change email (double-confirm) and change/set password (with the
/// reauthentication-nonce retry when the session is stale).
@MainActor
struct ProfileSectionView: View {
    let scope: SettingsScope
    let onSignOut: @MainActor () -> Void

    var body: some View {
        DisplayNameCard(scope: scope)
        ThemeCard(prefs: scope.graph.prefs)
        AccountCard(scope: scope)
        SettingsCard(title: "Sign out") {
            Button("Sign out on this device") { onSignOut() }
                .buttonStyle(.bordered)
        }
    }
}

// MARK: - Display name

private struct DisplayNameCard: View {
    let scope: SettingsScope

    @State private var name: String
    @State private var saving = false
    @State private var error: String?

    init(scope: SettingsScope) {
        self.scope = scope
        _name = State(initialValue: scope.me.display_name)
    }

    private var trimmed: String { name.trimmingCharacters(in: .whitespacesAndNewlines) }
    private var dirty: Bool { trimmed != scope.me.display_name }
    private var valid: Bool { (1 ... 80).contains(trimmed.count) }

    var body: some View {
        SettingsCard(
            title: "Your name",
            description: "Shown to teammates on messages, notes, tasks, and the members list."
        ) {
            TextField("Your name", text: $name)
                .textFieldStyle(.roundedBorder)
            if dirty && !valid {
                Text("1 to 80 characters.")
                    .font(.footnote)
                    .foregroundStyle(BrandColor.destructive)
                    .padding(.top, 4)
            }
            InlineError(error)
            if dirty {
                Button(saving ? "Saving…" : "Save") { save() }
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
                scope.showMessage("Name saved.")
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

    var body: some View {
        SettingsCard(title: "Theme") {
            Picker("Theme", selection: $prefs.theme) {
                Text("System").tag(AppPrefs.Theme.system)
                Text("Light").tag(AppPrefs.Theme.light)
                Text("Dark").tag(AppPrefs.Theme.dark)
            }
            .pickerStyle(.segmented)
            .labelsHidden()
        }
    }
}

// MARK: - Account (email + password via GoTrue)

private struct AccountCard: View {
    let scope: SettingsScope

    private var email: String? {
        let value = scope.graph.sessionStore.current()?.email
        return (value?.isEmpty == false) ? value : nil
    }

    var body: some View {
        SettingsCard(
            title: "Account",
            description: email.map { "Signed in as \($0)." }
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

    var body: some View {
        if !editing {
            Button("Change email") { editing = true }
                .buttonStyle(.bordered)
        } else {
            VStack(alignment: .leading, spacing: 0) {
                TextField("New email", text: $newEmail)
                    .textFieldStyle(.roundedBorder)
                    .keyboardType(.emailAddress)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .disabled(saving)
                InlineError(error)
                Button(saving ? "Sending…" : "Send confirmation links") { submit() }
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
            error = "Enter your new email address."
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
                    "Check both inboxes — confirmation links went to your old "
                        + "and new address. Nothing changes until you confirm."
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

    var body: some View {
        if !editing {
            VStack(alignment: .leading, spacing: 4) {
                Button("Change or set password") { editing = true }
                    .buttonStyle(.bordered)
                ReadOnlyLine(
                    "If you signed up with Google or Apple, this sets a password you can "
                        + "also sign in with."
                )
            }
        } else {
            VStack(alignment: .leading, spacing: 0) {
                SecureField("New password", text: $password)
                    .textFieldStyle(.roundedBorder)
                    .textContentType(.newPassword)
                    .disabled(saving)
                Text("At least 8 characters.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .padding(.top, 2)
                if nonceNeeded {
                    Text(
                        "To confirm it's you, we emailed you a one-time code. Enter it here "
                            + "and save again."
                    )
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                    .padding(.top, 8)
                    TextField("Code from the email", text: $nonce)
                        .textFieldStyle(.roundedBorder)
                        .keyboardType(.numberPad)
                        .disabled(saving)
                        .padding(.top, 4)
                }
                InlineError(error)
                Button(saving ? "Saving…" : "Save password") { submit() }
                    .buttonStyle(.borderedProminent)
                    .tint(BrandColor.olive)
                    .disabled(saving || password.isEmpty || (nonceNeeded && nonce.isBlank))
                    .padding(.top, 8)
            }
        }
    }

    private func submit() {
        guard password.count >= 8 else {
            error = "Use at least 8 characters."
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
                scope.showMessage("Password updated.")
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
