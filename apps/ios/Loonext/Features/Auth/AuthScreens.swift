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
            VStack(alignment: .leading, spacing: 0) {
                Wordmark()
                    .padding(.bottom, 24)
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
            .frame(maxWidth: 440, alignment: .leading)
            .padding(.horizontal, 24)
            .padding(.top, 64)
            .frame(maxWidth: .infinity)
        }
        .scrollDismissesKeyboard(.interactively)
        .background(BrandColor.canvas.ignoresSafeArea())
        .sheet(
            isPresented: $model.captchaVisible,
            onDismiss: { model.captchaResolved(nil) }
        ) {
            CaptchaSheet { token in model.captchaResolved(token) }
        }
    }
}

/// The brand wordmark (#206, brand/README.md): 'Loonext' in Golos SemiBold
/// with the SECOND o in the accent — olive on light, lime on dark (that's
/// BrandColor.olive's adaptive pair). Always exactly the second o, always
/// text spans, never an image.
private struct Wordmark: View {
    var body: some View {
        (
            Text("Lo").foregroundStyle(BrandColor.ink)
                + Text("o").foregroundStyle(BrandColor.olive)
                + Text("next").foregroundStyle(BrandColor.ink)
        )
        .font(.golos(20, weight: .semibold))
        .kerning(-0.4)
        .accessibilityLabel("Loonext")
    }
}

/// Bricolage display heading + one muted sub-line (specs 10–12).
private struct AuthHeadline: View {
    let title: String
    let sub: String

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(title)
                .font(.display(28))
                .kerning(-0.3)
                .foregroundStyle(BrandColor.ink)
                .fixedSize(horizontal: false, vertical: true)
            Text(sub)
                .font(.golos(13))
                .foregroundStyle(BrandColor.muted600)
                .fixedSize(horizontal: false, vertical: true)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.bottom, 22)
    }
}

/// Quiet text link (olive by default) — forgot/switch-screen affordances.
private struct LinkButton: View {
    let title: String
    var tint: Color = BrandColor.olive
    let action: @MainActor () -> Void

    init(_ title: String, tint: Color = BrandColor.olive, action: @escaping @MainActor () -> Void) {
        self.title = title
        self.tint = tint
        self.action = action
    }

    var body: some View {
        Button(action: action) {
            Text(title)
                .font(.golos(12.5, weight: .semibold))
                .foregroundStyle(tint)
        }
        .buttonStyle(.plain)
    }
}

/// The lime-check "email sent" note (spec 12 sent state).
private struct SentNote: View {
    let text: String

    var body: some View {
        HStack(alignment: .top, spacing: 10) {
            ZStack {
                Circle()
                    .fill(BrandColor.lime)
                    .frame(width: 22, height: 22)
                Image(systemName: "checkmark")
                    .font(.system(size: 10, weight: .bold))
                    .foregroundStyle(BrandColor.onLime)
            }
            Text(text)
                .font(.golos(12.5))
                .foregroundStyle(BrandColor.muted900)
                .fixedSize(horizontal: false, vertical: true)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(14)
        .background(BrandColor.inset, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
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
            .clipShape(Capsule())
            .disabled(model.busy)

            Button {
                model.signInWithGoogle()
            } label: {
                Text("Continue with Google")
                    .font(.golos(13.5, weight: .semibold))
                    .foregroundStyle(BrandColor.ink)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 13)
            }
            .buttonStyle(.plain)
            .background(BrandColor.paper, in: Capsule())
            .disabled(model.busy)

            HStack(spacing: 10) {
                Rectangle().fill(BrandColor.insetDeep).frame(height: 1)
                Text("or")
                    .font(.golos(11, weight: .semibold))
                    .foregroundStyle(BrandColor.muted300)
                Rectangle().fill(BrandColor.insetDeep).frame(height: 1)
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
            AuthHeadline(
                title: "The whole crew,\none business number.",
                sub: "Texts, calls, and the jobs that come from them — together in one inbox."
            )
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
            LinkButton("Forgot password?", tint: BrandColor.muted500, action: onForgot)
                .padding(.top, 6)
            LinkButton("New to Loonext? Create your account", tint: BrandColor.ink, action: onSignUp)
                .padding(.top, 10)
        }
        .frame(maxWidth: .infinity)
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
                AuthHeadline(
                    title: "Check your email",
                    sub: "Confirm your account from the email we just sent, then sign in."
                )
                SentNote(text: "Check your email to confirm your account, then sign in.")
                LinkButton("Back to sign in", action: onLogin)
            }
            .frame(maxWidth: .infinity)
        } else {
            VStack(spacing: 12) {
                AuthHeadline(
                    title: "Create your account",
                    sub: "Your business number in minutes."
                )
                SsoButtons(model: model, appleLabel: .signUp)
                AuthField("Your name", text: $name, kind: .name)
                AuthField("Email", text: $email, kind: .email)
                VStack(alignment: .leading, spacing: 5) {
                    AuthField("Password", text: $password, kind: .newPassword)
                    Text("At least 8 characters.")
                        .font(.golos(10.5))
                        .foregroundStyle(BrandColor.muted300)
                        .padding(.horizontal, 4)
                }
                ErrorLine(error: model.error)
                PrimaryButton(
                    title: model.busy ? "Creating account…" : "Create account",
                    enabled: !model.busy && !name.isBlank && !email.isBlank && password.count >= 8
                ) {
                    model.signUp(name: name, email: email, password: password)
                }
                LinkButton("Already have an account? Sign in", tint: BrandColor.ink, action: onLogin)
                    .padding(.top, 10)
            }
            .frame(maxWidth: .infinity)
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
                AuthHeadline(
                    title: "Reset your password",
                    sub: "We'll email you a reset link. It works for an hour."
                )
                SentNote(text: "If that email has an account, a reset link is on its way. Didn't get it? Check spam.")
                LinkButton("Back to sign in", action: onLogin)
            }
            .frame(maxWidth: .infinity)
        } else {
            VStack(spacing: 12) {
                AuthHeadline(
                    title: "Reset your password",
                    sub: "We'll email you a reset link. It works for an hour."
                )
                AuthField("Email", text: $email, kind: .email)
                ErrorLine(error: model.error)
                PrimaryButton(
                    title: model.busy ? "Sending…" : "Send reset link",
                    enabled: !model.busy && !email.isBlank
                ) {
                    model.sendReset(email: email)
                }
                LinkButton("Remembered it? Back to sign in", tint: BrandColor.ink, action: onLogin)
                    .padding(.top, 10)
            }
            .frame(maxWidth: .infinity)
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
        VStack(alignment: .leading, spacing: 6) {
            Text(title.uppercased())
                .font(.golos(10.5, weight: .bold))
                .kerning(1.0)
                .foregroundStyle(BrandColor.muted500)
                .padding(.horizontal, 4)
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
            .font(.golos(14))
            .foregroundStyle(BrandColor.ink)
            .padding(.horizontal, 15)
            .padding(.vertical, 13)
            .background(BrandColor.paper, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: 16, style: .continuous)
                    .strokeBorder(BrandColor.insetDeep, lineWidth: 1.5)
            )
        }
    }
}

private struct ErrorLine: View {
    let error: String?

    var body: some View {
        if let error {
            Text(error)
                .font(.golos(12))
                .foregroundStyle(BrandColor.destructive)
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.top, 2)
        }
    }
}

/// The one filled CTA per screen — the ink pill with the lime arrow circle
/// (Paper & Olive primary-button grammar, specs 10–17).
struct PrimaryButton: View {
    let title: String
    let enabled: Bool
    let action: @MainActor () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 10) {
                Text(title)
                    .font(.golos(15, weight: .semibold))
                    .foregroundStyle(BrandColor.paper)
                Spacer(minLength: 8)
                ZStack {
                    Circle()
                        .fill(BrandColor.lime)
                        .frame(width: 42, height: 42)
                    Image(systemName: "arrow.right")
                        .font(.system(size: 16, weight: .semibold))
                        .foregroundStyle(BrandColor.onLime)
                }
            }
            .padding(.leading, 22)
            .padding(.trailing, 8)
            .padding(.vertical, 8)
            .frame(maxWidth: .infinity)
            .background(BrandColor.ink, in: Capsule())
        }
        .buttonStyle(.plain)
        .disabled(!enabled)
        .opacity(enabled ? 1 : 0.45)
        .padding(.top, 8)
    }
}

// MARK: - Previews

// #180 responsive matrix — the auth column already scrolls and caps at 440;
// fixed frames prove the login form stays reachable at each ratio (nothing
// here touches the network until a button is tapped).

#Preview("Auth · tall phone") {
    AuthFlow(authManager: AppGraph().authManager)
        .frame(width: 390, height: 720)
}

#Preview("Auth · 1:1 square") {
    AuthFlow(authManager: AppGraph().authManager)
        .frame(width: 380, height: 380)
}

#Preview("Auth · iPad width") {
    AuthFlow(authManager: AppGraph().authManager)
        .frame(width: 900, height: 760)
}
