import Observation
import SwiftUI

/// The signed-out surface's state: busy/error plus the two "email sent"
/// terminal notes. Session appearance is observed upstream (Root) — success
/// needs no callback.
@MainActor
@Observable
final class AuthViewModel {
    private(set) var busy = false
    private(set) var error: String?
    /// Signup ended with "check your email" instead of a session.
    private(set) var confirmationSent = false
    /// Password-reset email fired.
    private(set) var resetSent = false

    private let authManager: AuthManager

    init(authManager: AuthManager) {
        self.authManager = authManager
    }

    func signIn(email: String, password: String) {
        run(fallback: "Sign-in failed.") { [authManager] in
            try await authManager.signIn(
                email: email.trimmingCharacters(in: .whitespacesAndNewlines),
                password: password
            )
        }
    }

    func signUp(name: String, email: String, password: String) {
        run(fallback: "Sign-up failed.") { [authManager, weak self] in
            let signedIn = try await authManager.signUp(
                email: email.trimmingCharacters(in: .whitespacesAndNewlines),
                password: password,
                displayName: name.trimmingCharacters(in: .whitespacesAndNewlines)
            )
            if !signedIn { self?.confirmationSent = true }
        }
    }

    func sendReset(email: String) {
        run(fallback: "Couldn't send the reset email.") { [authManager, weak self] in
            try await authManager.sendPasswordReset(
                email: email.trimmingCharacters(in: .whitespacesAndNewlines)
            )
            self?.resetSent = true
        }
    }

    private func run(fallback: String, _ block: @escaping @MainActor () async throws -> Void) {
        guard !busy else { return }
        busy = true
        error = nil
        Task { [self] in
            do {
                try await block()
                self.busy = false
            } catch {
                self.busy = false
                let message = error.userMessage
                self.error = message.isEmpty ? fallback : message
            }
        }
    }
}

private enum AuthScreen {
    case login
    case signUp
    case forgot
}

/// The signed-out surface: login / signup / forgot-password, one calm column.
@MainActor
struct AuthFlow: View {
    @State private var model: AuthViewModel
    @State private var screen: AuthScreen = .login

    init(authManager: AuthManager) {
        _model = State(initialValue: AuthViewModel(authManager: authManager))
    }

    var body: some View {
        ScrollView {
            VStack(spacing: 0) {
                Wordmark()
                    .padding(.bottom, 32)
                switch screen {
                case .login:
                    LoginForm(
                        model: model,
                        onForgot: { screen = .forgot },
                        onSignUp: { screen = .signUp }
                    )
                case .signUp:
                    SignUpForm(model: model, onLogin: { screen = .login })
                case .forgot:
                    ForgotForm(model: model, onLogin: { screen = .login })
                }
            }
            .frame(maxWidth: 440)
            .padding(.horizontal, 28)
            .padding(.top, 96)
            .frame(maxWidth: .infinity)
        }
        .scrollDismissesKeyboard(.interactively)
        .background(Color(uiColor: .systemBackground))
    }
}

/// Text wordmark: 'Loonext' with the 'ext' half in petrol (no logo glyph).
private struct Wordmark: View {
    var body: some View {
        HStack(spacing: 0) {
            Text("Loon")
                .font(.system(.largeTitle, design: .default, weight: .semibold))
            Text("ext")
                .font(.system(.largeTitle, design: .default, weight: .semibold))
                .foregroundStyle(BrandColor.petrol)
        }
        .accessibilityLabel("Loonext")
    }
}

@MainActor
private struct LoginForm: View {
    let model: AuthViewModel
    let onForgot: @MainActor () -> Void
    let onSignUp: @MainActor () -> Void

    @State private var email = ""
    @State private var password = ""

    var body: some View {
        VStack(spacing: 12) {
            AuthField("Email", text: $email, kind: .email)
            AuthField("Password", text: $password, kind: .password)
            ErrorLine(error: model.error)
            PrimaryButton(
                title: model.busy ? "Signing in…" : "Sign in",
                enabled: !model.busy && !email.isBlank && !password.isBlank
            ) {
                model.signIn(email: email, password: password)
            }
            Button("Forgot password?", action: onForgot)
                .font(.subheadline)
            Button("New to Loonext? Create an account", action: onSignUp)
                .font(.subheadline)
        }
    }
}

@MainActor
private struct SignUpForm: View {
    let model: AuthViewModel
    let onLogin: @MainActor () -> Void

    @State private var name = ""
    @State private var email = ""
    @State private var password = ""

    var body: some View {
        if model.confirmationSent {
            VStack(spacing: 16) {
                Text("Check your email to confirm your account, then sign in.")
                    .font(.body)
                    .multilineTextAlignment(.center)
                Button("Back to sign in", action: onLogin)
                    .font(.subheadline)
            }
        } else {
            VStack(spacing: 12) {
                AuthField("Your name", text: $name, kind: .name)
                AuthField("Email", text: $email, kind: .email)
                AuthField("Password (8+ characters)", text: $password, kind: .newPassword)
                ErrorLine(error: model.error)
                PrimaryButton(
                    title: model.busy ? "Creating account…" : "Create account",
                    enabled: !model.busy && !name.isBlank && !email.isBlank && password.count >= 8
                ) {
                    model.signUp(name: name, email: email, password: password)
                }
                Button("Already have an account? Sign in", action: onLogin)
                    .font(.subheadline)
            }
        }
    }
}

@MainActor
private struct ForgotForm: View {
    let model: AuthViewModel
    let onLogin: @MainActor () -> Void

    @State private var email = ""

    var body: some View {
        if model.resetSent {
            VStack(spacing: 16) {
                Text("If that email has an account, a reset link is on its way.")
                    .font(.body)
                    .multilineTextAlignment(.center)
                Button("Back to sign in", action: onLogin)
                    .font(.subheadline)
            }
        } else {
            VStack(spacing: 12) {
                AuthField("Email", text: $email, kind: .email)
                ErrorLine(error: model.error)
                PrimaryButton(
                    title: model.busy ? "Sending…" : "Send reset link",
                    enabled: !model.busy && !email.isBlank
                ) {
                    model.sendReset(email: email)
                }
                Button("Back to sign in", action: onLogin)
                    .font(.subheadline)
            }
        }
    }
}

// MARK: - Form pieces

private enum AuthFieldKind {
    case name
    case email
    case password
    case newPassword
}

private struct AuthField: View {
    let title: String
    @Binding var text: String
    let kind: AuthFieldKind

    init(_ title: String, text: Binding<String>, kind: AuthFieldKind) {
        self.title = title
        self._text = text
        self.kind = kind
    }

    var body: some View {
        Group {
            switch kind {
            case .name:
                TextField(title, text: $text)
                    .textContentType(.name)
            case .email:
                TextField(title, text: $text)
                    .textContentType(.emailAddress)
                    .keyboardType(.emailAddress)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
            case .password:
                SecureField(title, text: $text)
                    .textContentType(.password)
            case .newPassword:
                SecureField(title, text: $text)
                    .textContentType(.newPassword)
            }
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 12)
        .background(.quaternary.opacity(0.5), in: RoundedRectangle(cornerRadius: 12))
    }
}

private struct ErrorLine: View {
    let error: String?

    var body: some View {
        if let error {
            Text(error)
                .font(.footnote)
                .foregroundStyle(BrandColor.destructive)
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.top, 2)
        }
    }
}

/// The one filled CTA per screen — Liquid Glass prominent, petrol tint.
struct PrimaryButton: View {
    let title: String
    let enabled: Bool
    let action: @MainActor () -> Void

    var body: some View {
        Button(action: action) {
            Text(title)
                .font(.body.weight(.semibold))
                .frame(maxWidth: .infinity)
                .padding(.vertical, 6)
        }
        .buttonStyle(.glassProminent)
        .tint(BrandColor.petrol)
        .disabled(!enabled)
        .padding(.top, 8)
    }
}
