import SwiftUI

/// #496/#314 — the two-factor wall, and the way through it.
///
/// #496 is the reason it exists at all: "I am able to login without any 2fa
/// codes even though 2fa is enabled." GoTrue signs a password login in at
/// `aal1` and expects the APPLICATION to ask for the code; nothing in it
/// refuses the session on its own, and before this nothing on any client
/// asked. So "two-factor is on" meant a factor existed and a password still
/// opened everything.
///
/// One screen with two states rather than two screens, because the question is
/// one question — "prove your second factor" — and the answer only differs in
/// whether they have one yet:
///
///   * ENROLLED (#496) — enter the code from the app. The common case.
///   * NOT ENROLLED (#314) — the WORKSPACE requires a factor and this person
///     has none, so the first step is getting one. Never shipped to the phones
///     when #314 landed, which meant an iOS user in an enforcing workspace met
///     a bare "Couldn't load your workspace." — a lockout with no explanation
///     and no route out.
///
/// The design constraint is not friction, it is LOCKOUT: an authenticator
/// lives on a phone, and this IS the phone. Somebody who lost or replaced it
/// must see the way out without hunting, so the recovery path is on screen
/// rather than behind a menu — and it says plainly what it costs, because
/// burning a code REMOVES the factor rather than letting them past it once.
@MainActor
struct MfaGateView: View {
    let graph: AppGraph
    /// True when the WORKSPACE demands a factor this person does not have.
    let enrolmentRequired: Bool
    let onSatisfied: () -> Void
    let onSignOut: () -> Void

    private enum Step: Equatable {
        case loading
        /// Has a factor: ask for the six digits.
        case challenge
        /// Has none and the workspace insists: get one first.
        case enrol(factorId: String, uri: String, secret: String)
        /// The authenticator is gone. Burning a code turns the factor OFF.
        case recovery
    }

    @State private var step: Step = .loading
    @State private var code = ""
    @State private var busy = false
    @State private var error: String?
    @Environment(\.openURL) private var openURL
    @Environment(\.appLocale) private var appLocale

    private var repo: SettingsRepository {
        SettingsRepository(api: graph.api, sessionStore: graph.sessionStore)
    }

    var body: some View {
        VStack(spacing: 0) {
            Spacer(minLength: 0)
            content
            Spacer(minLength: 0)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .padding(.horizontal, 26)
        .background(BrandColor.canvas.ignoresSafeArea())
        .task(id: enrolmentRequired) { await prepare() }
    }

    @ViewBuilder
    private var content: some View {
        switch step {
        case .loading:
            ProgressView().tint(BrandColor.olive)
        default:
            form
        }
    }

    private var form: some View {
        VStack(alignment: .leading, spacing: 0) {
            Text(title)
                .font(.golos(24, weight: .semibold))
                .foregroundStyle(BrandColor.ink)
            Text(blurb)
                .font(.golos(13))
                .foregroundStyle(BrandColor.muted600)
                .fixedSize(horizontal: false, vertical: true)
                .padding(.top, 6)

            if case .enrol(_, let uri, let secret) = step {
                Button {
                    // The mobile answer to "scan this QR with this phone": a
                    // code shown ON the device that would have to scan it is
                    // useless, so the URI is handed to whatever authenticator
                    // is installed instead.
                    guard let url = URL(string: uri) else {
                        error = AppStrings.translate(
                            appLocale, "shell.mfaNoAuthenticatorApp"
                        )
                        return
                    }
                    openURL(url)
                } label: {
                    Text(AppStrings.translate(appLocale, "shell.mfaOpenAuthenticator"))
                        .font(.golos(13, weight: .semibold))
                        .foregroundStyle(BrandColor.olive)
                }
                .buttonStyle(.plain)
                .padding(.top, 14)
                Text(secret)
                    .font(.golos(12).monospaced())
                    .foregroundStyle(BrandColor.muted600)
                    .textSelection(.enabled)
                    .padding(.top, 4)
            }

            codeField
                .padding(.top, 20)

            if let error {
                Text(error)
                    .font(.golos(12))
                    .foregroundStyle(BrandColor.destructive)
                    .padding(.top, 6)
            }

            PrimaryButton(
                title: AppStrings.translate(appLocale, primaryActionKey),
                enabled: !busy && !code.trimmingCharacters(in: .whitespaces).isEmpty
            ) {
                Task { await submit() }
            }
            .padding(.top, 18)

            // Only offered to somebody who HAS a factor: recovery codes are
            // issued at enrolment, so a person who has not enrolled has none.
            if !isEnrolStep {
                Button {
                    step = step == .recovery ? .challenge : .recovery
                    code = ""
                    error = nil
                } label: {
                    Text(
                        AppStrings.translate(
                            appLocale,
                            step == .recovery
                                ? "shell.mfaHaveItAfterAll"
                                : "shell.mfaNoAuthenticator"
                        )
                    )
                    .font(.golos(12.5, weight: .semibold))
                    .foregroundStyle(BrandColor.olive)
                }
                .buttonStyle(.plain)
                .padding(.top, 16)
            }

            // Sign-out stays reachable on every gate in this app (#207): a
            // person who can satisfy neither path must still be able to get out.
            Button(action: onSignOut) {
                Text(AppStrings.translate(appLocale, "shell.signOut"))
                    .font(.golos(12.5, weight: .semibold))
                    .foregroundStyle(BrandColor.muted600)
            }
            .buttonStyle(.plain)
            .padding(.top, 12)
        }
    }

    private var codeField: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(
                AppStrings.translate(
                    appLocale,
                    step == .recovery
                        ? "shell.mfaRecoveryCodeLabel"
                        : "shell.mfaSixDigitLabel"
                )
                .uppercased()
            )
            .font(.golos(10.5, weight: .bold))
            .kerning(1.0)
            .foregroundStyle(BrandColor.muted500)
            .padding(.horizontal, 4)
            Group {
                if step == .recovery {
                    TextField("ABCDE-FGHJK", text: $code)
                        .textInputAutocapitalization(.characters)
                        .autocorrectionDisabled()
                } else {
                    TextField("123456", text: $code)
                        // The OS offers the code straight from the SMS/keychain
                        // prompt with this, so the common path is one tap.
                        .textContentType(.oneTimeCode)
                        .keyboardType(.numberPad)
                }
            }
            .font(.golos(14))
            .foregroundStyle(BrandColor.ink)
            .disabled(busy)
            .padding(.horizontal, 15)
            .padding(.vertical, 13)
            .background(BrandColor.paper, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: 16, style: .continuous)
                    .strokeBorder(BrandColor.insetDeep, lineWidth: 1.5)
            )
        }
    }

    // MARK: - Copy

    private var isEnrolStep: Bool {
        if case .enrol = step { return true }
        return false
    }

    private var title: String {
        if isEnrolStep {
            return AppStrings.translate(appLocale, "shell.mfaEnrolTitle")
        }
        return AppStrings.translate(
            appLocale,
            step == .recovery ? "shell.mfaRecoveryTitle" : "shell.mfaChallengeTitle"
        )
    }

    private var blurb: String {
        if isEnrolStep {
            return AppStrings.translate(appLocale, "shell.mfaEnrolBody")
        }
        return AppStrings.translate(
            appLocale,
            step == .recovery ? "shell.mfaRecoveryBody" : "shell.mfaChallengeBody"
        )
    }

    /// The one filled button, which says three different things.
    private var primaryActionKey: String {
        if busy { return "shell.mfaChecking" }
        return step == .recovery ? "shell.mfaUseThisCode" : "shell.mfaContinue"
    }

    // MARK: - Work

    private func prepare() async {
        guard enrolmentRequired else {
            step = .challenge
            return
        }
        do {
            let token = try await repo.freshAccessToken()
            let enrolment = try await SettingsAuthClient().enrollTotp(
                accessToken: token,
                friendlyName: "Loonext"
            )
            step = .enrol(
                factorId: enrolment.factorId,
                uri: enrolment.uri,
                secret: enrolment.secret
            )
        } catch {
            self.error = AppStrings.translate(appLocale, "shell.mfaSetupFailed")
            step = .challenge
        }
    }

    private func submit() async {
        guard !busy else { return }
        busy = true
        error = nil
        defer { busy = false }

        if step == .recovery {
            do {
                _ = try await repo.recoverWithCode(code.trimmingCharacters(in: .whitespaces))
                // The factor is gone, so this session no longer needs lifting.
                // Settings will show two-factor as off, which is the honest
                // state and the prompt to set it up again.
                code = ""
                onSatisfied()
            } catch {
                self.error = AppStrings.translate(appLocale, "shell.mfaCodeInvalid")
            }
            return
        }

        do {
            let token = try await repo.freshAccessToken()
            var enrolling = false
            let factorId: String
            if case .enrol(let id, _, _) = step {
                factorId = id
                enrolling = true
            } else if let id = try await repo.mfa().allFactors.first?.id {
                factorId = id
            } else {
                self.error = AppStrings.translate(appLocale, "shell.mfaNoFactorFound")
                return
            }

            let client = SettingsAuthClient()
            let challengeId = try await client.challengeFactor(
                accessToken: token,
                factorId: factorId
            )
            // The verify response is a FRESH session at aal2. Storing it is the
            // whole point — without that the app keeps presenting the old aal1
            // token and the gate never opens.
            let session = try await client.verifyFactor(
                accessToken: token,
                factorId: factorId,
                challengeId: challengeId,
                code: code.filter(\.isNumber)
            )
            graph.sessionStore.save(session.session)
            // Codes are issued only after the factor is verified: a set handed
            // out before the app is proven working would be recovery for a lock
            // that was never fitted.
            if enrolling { _ = try? await repo.issueRecoveryCodes() }
            code = ""
            onSatisfied()
        } catch {
            // One message for every failure mode: telling a wrong code apart
            // from an expired one helps an attacker more than the person
            // holding the phone, who tries the next one either way.
            self.error = AppStrings.translate(appLocale, "shell.mfaCodeMismatch")
        }
    }
}
