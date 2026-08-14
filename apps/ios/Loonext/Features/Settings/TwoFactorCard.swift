import SwiftUI

/// Two-factor authentication (#314) — the iOS half of the web's card, on
/// Settings → Profile & account under the password.
///
/// ONE DELIBERATE DIFFERENCE FROM WEB, and it is the whole mobile design:
/// there is no QR code. A QR shown ON the phone that would have to scan it is
/// useless. Instead the app hands the `otpauth://` URI straight to whatever
/// authenticator is installed — one tap, no typing — and falls back to the
/// secret with a copy button when nothing handles it.
///
/// Everything else matches web, including the part that matters most: the
/// recovery-codes sheet cannot be dismissed until the codes have been copied.
/// Somebody who enrols and swipes that sheet away has armed a lock and thrown
/// away the spare key, and this product's lock is their business phone line.

private enum EnrolStep: Identifiable {
    case verify(factorId: String, secret: String, uri: String)
    case codes([String])

    var id: String {
        switch self {
        case .verify: "verify"
        case .codes: "codes"
        }
    }
}

@MainActor
struct TwoFactorCard: View {
    let scope: SettingsScope

    @State private var state: LoadState<MfaState> = .loading
    @State private var refreshKey = 0
    @State private var step: EnrolStep?
    @State private var code = ""
    @State private var busy = false
    @State private var actionError: String?
    @State private var savedCodes = false
    @State private var confirmingOff = false

    private let authClient = SettingsAuthClient()

    @Environment(\.appLocale) private var appLocale

    private func t(_ key: String, _ vars: [String: String] = [:]) -> String {
        AppStrings.translate(appLocale, key, vars)
    }

    var body: some View {
        Group {
            switch state {
            case .loading:
                CenteredLoading().frame(height: 120)
            case .failed(let message):
                CenteredError(message: message) { refreshKey += 1 }
                    .frame(height: 120)
            case .ready(let mfa):
                card(mfa)
            }
        }
        .task(id: "\(scope.me.user_id)|\(refreshKey)") {
            if case .ready = state {} else { state = .loading }
            do {
                state = .ready(try await scope.repo.mfa())
            } catch {
                if case .ready = state {
                    scope.showMessage(error.userMessage)
                } else {
                    state = .failed(error.userMessage)
                }
            }
        }
        .sheet(item: $step) { current in
            switch current {
            case .verify(let factorId, let secret, let uri):
                verifySheet(factorId: factorId, secret: secret, uri: uri)
            case .codes(let codes):
                codesSheet(codes)
            }
        }
        .sheet(isPresented: $confirmingOff) {
            ConfirmSheet(
                title: t("settingsMore.turnOffTwoFactorTitle"),
                message: t("settingsMore.turnOffTwoFactorBody"),
                confirmLabel: t("settingsMore.turnItOff"),
                destructive: true,
                pending: busy,
                error: actionError,
                onConfirm: { turnOff() },
                onDismiss: { confirmingOff = false }
            )
        }
    }

    // MARK: - The card

    @ViewBuilder
    private func card(_ mfa: MfaState) -> some View {
        SettingsCard(
            title: t("settingsMore.twoFactorTitle"),
            description: t("settingsMore.twoFactorDesc")
        ) {
            VStack(alignment: .leading, spacing: 10) {
                if mfa.isEnrolled {
                    Text(t("settingsMore.authenticatorOn"))
                        .font(.golos(13))
                        .foregroundStyle(BrandColor.ink)
                    if mfa.codesRemaining > 0 {
                        // Two whole sentences rather than a plural glued on
                        // mid-string: "1 recovery code left" and "{count}
                        // recovery codes left" agree in French too, which
                        // assembling "code"/"codes" around a number cannot.
                        ReadOnlyLine(
                            mfa.codesRemaining == 1
                                ? t("settingsMore.oneRecoveryCodeLeft")
                                : t(
                                    "settingsMore.recoveryCodesLeft",
                                    ["count": String(mfa.codesRemaining)]
                                )
                        )
                    } else {
                        // Nought left is a lockout waiting for a lost phone,
                        // so it reads as something to fix, not a statistic.
                        StatusPill(label: t("settingsMore.noRecoveryCodesLeft"), tone: .warn)
                    }
                    HStack(spacing: 10) {
                        Button(t("settingsMore.newRecoveryCodes")) { issueCodes() }
                            .buttonStyle(.bordered)
                            .disabled(busy)
                        Button(t("settingsMore.turnOff")) { confirmingOff = true }
                            .font(.golos(13))
                            .foregroundStyle(BrandColor.muted600)
                            .disabled(busy)
                    }
                } else {
                    ReadOnlyLine(t("settingsMore.twoFactorHow"))
                    Button(t("settingsMore.setUpTwoFactor")) { beginEnrolment() }
                        .buttonStyle(.borderedProminent)
                        .tint(BrandColor.olive)
                        .disabled(busy)
                }
                if let actionError, step == nil, !confirmingOff {
                    InlineError(actionError)
                }
            }
        }
    }

    // MARK: - Sheets

    private func verifySheet(factorId: String, secret: String, uri: String) -> some View {
        ConfirmSheet(
            title: t("settingsMore.addToAuthenticator"),
            message: t("settingsMore.addToAuthenticatorBody"),
            confirmLabel: t("settingsMore.turnItOn"),
            pending: busy,
            error: actionError,
            confirmEnabled: code.filter(\.isNumber).count >= 6,
            onConfirm: { verify(factorId: factorId) },
            onDismiss: {
                step = nil
                code = ""
                actionError = nil
            },
            extra: {
                VStack(alignment: .leading, spacing: 10) {
                    if let url = URL(string: uri) {
                        // The mobile answer to "scan this QR with this phone".
                        Link(t("settingsMore.openAuthenticator"), destination: url)
                            .font(.golos(13, weight: .semibold))
                            .foregroundStyle(BrandColor.olive)
                    }
                    ReadOnlyLine(t("settingsMore.orEnterKey"))
                    Text(secret)
                        .font(.system(.footnote, design: .monospaced))
                        .foregroundStyle(BrandColor.ink)
                        .textSelection(.enabled)
                    Button(t("settingsMore.copyKey")) { UIPasteboard.general.string = secret }
                        .font(.golos(13))
                        .foregroundStyle(BrandColor.olive)
                    TextField(t("settingsMore.sixDigitCode"), text: $code)
                        .keyboardType(.numberPad)
                        .textContentType(.oneTimeCode)
                        .textFieldStyle(.roundedBorder)
                }
                .padding(.top, 12)
            }
        )
    }

    private func codesSheet(_ codes: [String]) -> some View {
        ConfirmSheet(
            title: t("settingsMore.saveRecoveryCodes"),
            message: t("settingsMore.saveRecoveryCodesBody"),
            confirmLabel: t("settingsMore.savedThem"),
            // The friction is the feature: this is the step people skip and
            // then need six months later.
            confirmEnabled: savedCodes,
            dismissLabel: "",
            onConfirm: {
                step = nil
                savedCodes = false
                refreshKey += 1
                scope.showMessage(t("settingsMore.twoFactorOn"))
            },
            onDismiss: {},
            extra: {
                VStack(alignment: .leading, spacing: 6) {
                    ForEach(codes, id: \.self) { entry in
                        Text(entry)
                            .font(.system(.footnote, design: .monospaced))
                            .foregroundStyle(BrandColor.ink)
                    }
                    Button(
                        savedCodes ? t("settingsMore.copied") : t("settingsMore.copyAllCodes")
                    ) {
                        UIPasteboard.general.string = codes.joined(separator: "\n")
                        savedCodes = true
                    }
                    .buttonStyle(.bordered)
                    .padding(.top, 6)
                }
                .padding(.top, 12)
            }
        )
    }

    // MARK: - Actions

    private func beginEnrolment() {
        busy = true
        actionError = nil
        // The name this factor carries inside the reader's own authenticator
        // app, which is the one place it is ever read — so it follows the
        // reader's language, exactly as Android's twin key does. Loonext and
        // iPhone are a product and a platform and stay as they are in both.
        let factorName = t("settingsMore.tfaFactorName")
        Task {
            do {
                let token = try await scope.repo.freshAccessToken()
                let enrolment = try await authClient.enrollTotp(
                    accessToken: token,
                    friendlyName: factorName
                )
                step = .verify(
                    factorId: enrolment.factorId,
                    secret: enrolment.secret,
                    uri: enrolment.uri
                )
            } catch {
                actionError = error.userMessage
            }
            busy = false
        }
    }

    private func verify(factorId: String) {
        busy = true
        actionError = nil
        Task {
            do {
                let token = try await scope.repo.freshAccessToken()
                let challenge = try await authClient.challengeFactor(
                    accessToken: token, factorId: factorId
                )
                // The verify response is a FRESH session at aal2 — storing it
                // is what makes the workspace gate stop refusing this device.
                let next = try await authClient.verifyFactor(
                    accessToken: token,
                    factorId: factorId,
                    challengeId: challenge,
                    code: code.filter(\.isNumber)
                )
                scope.graph.sessionStore.save(next.session)
                let issued = try await scope.repo.issueRecoveryCodes()
                code = ""
                savedCodes = false
                step = .codes(issued.all)
            } catch {
                actionError = t("settingsMore.codeDidNotMatch")
            }
            busy = false
        }
    }

    private func issueCodes() {
        busy = true
        actionError = nil
        Task {
            do {
                let issued = try await scope.repo.issueRecoveryCodes()
                savedCodes = false
                step = .codes(issued.all)
            } catch {
                actionError = error.userMessage
            }
            busy = false
        }
    }

    private func turnOff() {
        busy = true
        actionError = nil
        Task {
            do {
                let token = try await scope.repo.freshAccessToken()
                if case .ready(let mfa) = state {
                    for factor in mfa.allFactors {
                        try await authClient.unenrollFactor(
                            accessToken: token, factorId: factor.id
                        )
                    }
                }
                confirmingOff = false
                refreshKey += 1
                scope.showMessage(t("settingsMore.twoFactorOff"))
            } catch {
                actionError = error.userMessage
            }
            busy = false
        }
    }
}
