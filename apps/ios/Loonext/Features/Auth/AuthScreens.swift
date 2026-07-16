import AuthenticationServices
import Observation
import SwiftUI

/// One password-path attempt, kept whole so the SAME call can be retried
/// with a fresh single-use captcha token (#166).
enum PasswordAuthAction: Equatable {
    case signIn(email: String, password: String)
    case signUp(name: String, email: String, password: String)
    case reset(email: String)
}

/// The signed-out surface's state: busy/error, the two "email sent" terminal
/// notes, and the #166 captcha-retry machine. Session appearance is observed
/// upstream (Root) — success needs no callback.
///
/// Captcha machine: every password path first runs WITHOUT a token; when
/// Supabase answers with its captcha gate, the attempt parks in
/// `pendingAction`, the Turnstile bridge sheet opens, and the token it mints
/// retries the SAME call. Tokens are single-use — a rejected retry never
/// loops; the next tap re-mints from scratch.
@MainActor
@Observable
final class AuthViewModel {
    private(set) var busy = false
    private(set) var error: String?
    /// Signup ended with "check your email" instead of a session.
    private(set) var confirmationSent = false
    /// Password-reset email fired.
    private(set) var resetSent = false

    /// Turnstile bridge sheet visibility (settable: the sheet binding writes
    /// false on swipe-down; onDismiss then routes a nil token here).
    var captchaVisible = false

    /// The attempt waiting on a captcha token.
    private var pendingAction: PasswordAuthAction?

    /// Raw SIWA nonce for the in-flight Apple request — its SHA-256 hex rides
    /// in the request; the raw value goes to Supabase for the exchange.
    private var appleRawNonce = ""

    private let authManager: AuthManager

    init(authManager: AuthManager) {
        self.authManager = authManager
    }

    // MARK: - Password paths (captcha-aware)

    func signIn(email: String, password: String) {
        start(.signIn(email: normalized(email), password: password))
    }

    func signUp(name: String, email: String, password: String) {
        start(.signUp(
            name: name.trimmingCharacters(in: .whitespacesAndNewlines),
            email: normalized(email),
            password: password
        ))
    }

    func sendReset(email: String) {
        start(.reset(email: normalized(email)))
    }

    /// Token from the captcha sheet (nil = canceled). The presenter's
    /// onDismiss ALSO routes nil here — `pendingAction` makes that idempotent.
    func captchaResolved(_ token: String?) {
        captchaVisible = false
        guard let action = pendingAction else { return }
        pendingAction = nil
        guard let token else {
            busy = false // user closed the check — calm, no error line
            return
        }
        perform(action, captchaToken: token)
    }

    private func start(_ action: PasswordAuthAction) {
        guard !busy else { return }
        perform(action, captchaToken: nil)
    }

    private func perform(_ action: PasswordAuthAction, captchaToken: String?) {
        busy = true
        error = nil
        Task { [self] in
            do {
                try await execute(action, captchaToken: captchaToken)
                busy = false
            } catch let failure where SupabaseAuth.isCaptchaRejection(failure) {
                if captchaToken == nil {
                    // Supabase wants a captcha: mint one on the bridge page,
                    // then retry the SAME call. busy stays true — the sheet
                    // owns the screen until it resolves.
                    pendingAction = action
                    captchaVisible = true
                } else {
                    // The minted token was rejected (expired or consumed —
                    // they're single-use). The next tap re-mints from scratch.
                    busy = false
                    error = "That security check didn't go through. Please try again."
                }
            } catch let failure {
                busy = false
                let message = failure.userMessage
                error = message.isEmpty ? fallbackMessage(for: action) : message
            }
        }
    }

    private func execute(_ action: PasswordAuthAction, captchaToken: String?) async throws {
        switch action {
        case .signIn(let email, let password):
            try await authManager.signIn(
                email: email,
                password: password,
                captchaToken: captchaToken
            )
        case .signUp(let name, let email, let password):
            let signedIn = try await authManager.signUp(
                email: email,
                password: password,
                displayName: name,
                captchaToken: captchaToken
            )
            if !signedIn { confirmationSent = true }
        case .reset(let email):
            try await authManager.sendPasswordReset(email: email, captchaToken: captchaToken)
            resetSent = true
        }
    }

    private func fallbackMessage(for action: PasswordAuthAction) -> String {
        switch action {
        case .signIn: "Sign-in failed."
        case .signUp: "Sign-up failed."
        case .reset: "Couldn't send the reset email."
        }
    }

    private func normalized(_ email: String) -> String {
        email.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    // MARK: - Providers (#166)

    func signInWithGoogle() {
        guard !busy else { return }
        busy = true
        error = nil
        Task { [self] in
            do {
                // false = the user closed the sheet (calm no-op); on success
                // the session appears in the store and Root routes away.
                _ = try await authManager.signInWithGoogle()
                busy = false
            } catch let failure {
                busy = false
                error = failure.userMessage
            }
        }
    }

    /// SignInWithAppleButton.onRequest — mint a fresh nonce per attempt.
    func prepareAppleRequest(_ request: ASAuthorizationAppleIDRequest) {
        appleRawNonce = SiwaNonce.random()
        AppleSignIn.configure(request, rawNonce: appleRawNonce)
    }

    /// SignInWithAppleButton.onCompletion.
    func completeApple(_ result: Result<ASAuthorization, Error>) {
        let credential: AppleSignIn.Credential?
        do {
            credential = try AppleSignIn.credential(from: result)
        } catch let failure {
            error = failure.userMessage
            return
        }
        guard let credential else { return } // user canceled — silent no-op
        let rawNonce = appleRawNonce
        busy = true
        error = nil
        Task { [self] in
            do {
                try await authManager.signInWithApple(
                    idToken: credential.idToken,
                    rawNonce: rawNonce,
                    fullName: credential.fullName
                )
                busy = false
            } catch let failure {
                busy = false
                error = failure.userMessage
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
        .sheet(
            isPresented: $model.captchaVisible,
            onDismiss: { model.captchaResolved(nil) }
        ) {
            CaptchaSheet { token in model.captchaResolved(token) }
        }
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

/// SSO stacked above the email form (mirrors the web login §1.7): Apple's
/// required native button first, then Google, then a quiet "or" rule.
@MainActor
private struct SsoButtons: View {
    let model: AuthViewModel
    let appleLabel: SignInWithAppleButton.Label

    @Environment(\.colorScheme) private var colorScheme

    var body: some View {
        VStack(spacing: 10) {
            SignInWithAppleButton(appleLabel) { request in
                model.prepareAppleRequest(request)
            } onCompletion: { result in
                model.completeApple(result)
            }
            .signInWithAppleButtonStyle(colorScheme == .dark ? .white : .black)
            .frame(height: 46)
            .clipShape(RoundedRectangle(cornerRadius: 12))
            .disabled(model.busy)

            Button {
                model.signInWithGoogle()
            } label: {
                Text("Continue with Google")
                    .font(.body.weight(.medium))
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 12)
            }
            .buttonStyle(.plain)
            .background(.quaternary.opacity(0.5), in: RoundedRectangle(cornerRadius: 12))
            .disabled(model.busy)

            HStack(spacing: 10) {
                Rectangle().fill(.quaternary).frame(height: 1)
                Text("or")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                Rectangle().fill(.quaternary).frame(height: 1)
            }
            .padding(.vertical, 4)
        }
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
            SsoButtons(model: model, appleLabel: .signIn)
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
                SsoButtons(model: model, appleLabel: .signUp)
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
