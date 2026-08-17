import AuthenticationServices
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

/// #473 — the two kinds of second factor, and the rule for naming them.
///
/// Hand-ported from `packages/shared/src/mfa-factors.ts`, which web renders
/// directly. `internal` rather than `private` so `LoonextTests` can hold the
/// port to its original — a hand-port with nothing checking it is a copy that
/// drifts, and this one's fallback branch is both the easiest to drop and the
/// most dangerous to lose.
let factorPasskey = "webauthn"
let factorAuthenticator = "totp"

/// The sentence for somebody who already holds at least one factor.
///
/// The `else` is load-bearing. An unnamed factor type must read as "two-factor
/// is on", never as nothing: telling somebody who IS protected that they are not
/// invites them to enrol a second time, or to believe the account is open.
func mfaSummaryKey(_ factorTypes: [String?]) -> String {
    let passkey = factorTypes.contains(factorPasskey)
    let authenticator = factorTypes.contains(factorAuthenticator)
    switch (passkey, authenticator) {
    case (true, true): return "settingsMore.tfaBothOn"
    case (true, false): return "settingsMore.tfaPasskeyOn"
    case (false, true): return "settingsMore.tfaAuthenticatorOn"
    case (false, false): return "settingsMore.tfaOn"
    }
}

/// Which kinds are still missing, so the card offers exactly those.
///
/// Empty for somebody holding both, and empty for somebody with none — who gets
/// the first-time pitch rather than an "add another" affordance.
func missingFactorTypes(_ factorTypes: [String?]) -> [String] {
    guard !factorTypes.isEmpty else { return [] }
    return [factorPasskey, factorAuthenticator].filter { !factorTypes.contains($0) }
}

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
    /// #473: false until the probe answers. Passkeys are offered only once this
    /// domain has actually associated this bundle — see PasskeyEnrolment.swift
    /// for why the switch is read from the web app rather than a build flag.
    @State private var passkeysAvailable = false

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
        .task {
            // #473: ask the domain whether it has associated this bundle before
            // offering a passkey. Runs once per appearance and needs no refresh
            // key — the answer changes when the web app deploys, not when this
            // card reloads.
            passkeysAvailable = await Passkeys.isDomainAssociated()
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
                    // #473: NAMES WHAT IS ON, because two kinds can be.
                    // "Two-factor is on" would leave somebody who added a
                    // passkey unable to tell whether last year's authenticator
                    // app is still there — and that answer decides what happens
                    // when they lose one of the two.
                    Text(t(mfaSummaryKey(mfa.allFactors.map(\.type))))
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
                    // #473 — THE SECOND FACTOR, which had no way in.
                    //
                    // The enrolment control lives in the other branch of this
                    // `if`, so the first factor hid the way to the second:
                    // somebody with an authenticator app could never add a
                    // passkey. Only the MISSING kind is offered, as one quiet
                    // action beside the other management controls rather than a
                    // second pitch competing with them.
                    //
                    // Applying: Chunking, and Zen of Clarity — the option that
                    // does not apply is absent rather than disabled.
                    let missing = missingFactorTypes(mfa.allFactors.map(\.type))
                    if missing.contains(factorPasskey), passkeysAvailable {
                        Button(t("settingsMore.tfaAddPasskey")) { beginPasskey() }
                            .buttonStyle(.bordered)
                            .disabled(busy)
                    }
                    if missing.contains(factorAuthenticator) {
                        Button(t("settingsMore.tfaAddAuthenticator")) { beginEnrolment() }
                            .buttonStyle(.bordered)
                            .disabled(busy)
                    }
                } else if passkeysAvailable {
                    // #473 — the passkey leads where this domain allows it.
                    //
                    // #314 shipped codes from an authenticator app and said in
                    // its own words that passkeys suit these users better. It is
                    // right, and most right here: one phone, with the
                    // authenticator on the same screen as the app asking for the
                    // six digits it shows. The app is still offered underneath,
                    // in full, because a passkey lives on THIS handset and
                    // somebody who works from two should be able to choose.
                    //
                    // Applying: Outcomes Over Features — the pitch is what it is
                    // like to use, not what it is called.
                    ReadOnlyLine(t("settingsMore.tfaPasskeyPitch"))
                    Button(t("settingsMore.tfaUsePasskey")) { beginPasskey() }
                        .buttonStyle(.borderedProminent)
                        .tint(BrandColor.olive)
                        .disabled(busy)
                    Button(t("settingsMore.tfaAddAuthenticator")) { beginEnrolment() }
                        .buttonStyle(.bordered)
                        .disabled(busy)
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
        // Read off the view alongside `factorName`, for the same reason: the
        // refusal this call can throw is shown to the reader verbatim, and it
        // is composed after an await.
        let reader = appLocale
        Task {
            do {
                let token = try await scope.repo.freshAccessToken()
                let enrolment = try await authClient.enrollTotp(
                    accessToken: token,
                    friendlyName: factorName,
                    locale: reader
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

    /// #473 — enrol a passkey: create the factor, run the platform's sheet,
    /// hand the answer back, then issue recovery codes.
    ///
    /// The codes come LAST and only on success, exactly as the authenticator
    /// path does. A passkey armed with no spare key is a lock on a business
    /// phone line whose only key is inside a phone.
    private func beginPasskey() {
        busy = true
        actionError = nil
        let factorName = t("settingsMore.tfaPasskeyFactorName")
        let failedMessage = t("settingsMore.tfaPasskeyFailed")
        let reader = appLocale
        Task {
            var enrolledFactorId: String?
            do {
                let token = try await scope.repo.freshAccessToken()
                let factorId = try await authClient.enrollWebauthn(
                    accessToken: token,
                    friendlyName: factorName,
                    locale: reader
                )
                enrolledFactorId = factorId
                let challenge = try await authClient.challengeWebauthn(
                    accessToken: token,
                    factorId: factorId,
                    rpId: Passkeys.relyingPartyId,
                    locale: reader
                )
                guard let options = Passkeys.creationOptions(
                    fromJson: challenge.creationOptionsJson
                ) else {
                    throw ApiError(
                        code: ApiErrorCode.network,
                        message: failedMessage,
                        httpStatus: 0
                    )
                }

                let authorization = try await PasskeyEnrolment().createCredential(
                    rpId: Passkeys.relyingPartyId,
                    options: options
                )
                guard let authorization else {
                    // Dismissed. Not an error — leave the card as it was, and
                    // take the half-made factor back out so it cannot sit
                    // unverified against the account forever.
                    try? await authClient.unenrollFactor(
                        accessToken: token, factorId: factorId
                    )
                    busy = false
                    return
                }
                guard
                    let registration = authorization.credential
                        as? ASAuthorizationPlatformPublicKeyCredentialRegistration,
                    let attestation = registration.rawAttestationObject,
                    let responseJson = Passkeys.registrationResponseJson(
                        credentialId: registration.credentialID,
                        clientDataJson: registration.rawClientDataJSON,
                        attestationObject: attestation
                    )
                else {
                    throw ApiError(
                        code: ApiErrorCode.network,
                        message: failedMessage,
                        httpStatus: 0
                    )
                }

                let session = try await authClient.verifyWebauthn(
                    accessToken: token,
                    factorId: factorId,
                    challengeId: challenge.challengeId,
                    rpId: Passkeys.relyingPartyId,
                    registrationResponseJson: responseJson
                )
                // The verify response is a FRESH session at aal2 — storing it is
                // what makes the workspace gate stop refusing this device.
                scope.graph.sessionStore.save(session.session)
                let issued = try await scope.repo.issueRecoveryCodes()
                savedCodes = false
                step = .codes(issued.all)
            } catch {
                actionError = error.userMessage
                if let enrolledFactorId,
                   let token = try? await scope.repo.freshAccessToken() {
                    try? await authClient.unenrollFactor(
                        accessToken: token, factorId: enrolledFactorId
                    )
                }
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
