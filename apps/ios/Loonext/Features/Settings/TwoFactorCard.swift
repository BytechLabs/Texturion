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
                title: "Turn off two-factor authentication?",
                message: "Your account goes back to a password alone. If this workspace "
                    + "requires two-factor, you will be asked to set it up again the next "
                    + "time you open the app.",
                confirmLabel: "Turn it off",
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
            title: "Two-factor authentication",
            description: "A code from an app, on top of your password. It is what stops a "
                + "stolen password becoming somebody texting your customers as you."
        ) {
            VStack(alignment: .leading, spacing: 10) {
                if mfa.isEnrolled {
                    Text("Authenticator app is on")
                        .font(.golos(13))
                        .foregroundStyle(BrandColor.ink)
                    if mfa.codesRemaining > 0 {
                        ReadOnlyLine(
                            "\(mfa.codesRemaining) recovery "
                                + (mfa.codesRemaining == 1 ? "code" : "codes") + " left."
                        )
                    } else {
                        // Nought left is a lockout waiting for a lost phone,
                        // so it reads as something to fix, not a statistic.
                        StatusPill(label: "No recovery codes left", tone: .warn)
                    }
                    HStack(spacing: 10) {
                        Button("New recovery codes") { issueCodes() }
                            .buttonStyle(.bordered)
                            .disabled(busy)
                        Button("Turn off") { confirmingOff = true }
                            .font(.golos(13))
                            .foregroundStyle(BrandColor.muted600)
                            .disabled(busy)
                    }
                } else {
                    ReadOnlyLine(
                        "You will add Loonext to an authenticator app — Google "
                            + "Authenticator, 1Password, whatever you already use — and enter "
                            + "the six-digit code it shows. We will give you backup codes for "
                            + "the day you lose the phone."
                    )
                    Button("Set up two-factor") { beginEnrolment() }
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
            title: "Add Loonext to your authenticator",
            message: "Tap below to hand it to your authenticator app, or copy the key in by "
                + "hand. Then enter the six-digit code it shows.",
            confirmLabel: "Turn it on",
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
                        Link("Open my authenticator app", destination: url)
                            .font(.golos(13, weight: .semibold))
                            .foregroundStyle(BrandColor.olive)
                    }
                    ReadOnlyLine("Or enter this key by hand:")
                    Text(secret)
                        .font(.system(.footnote, design: .monospaced))
                        .foregroundStyle(BrandColor.ink)
                        .textSelection(.enabled)
                    Button("Copy key") { UIPasteboard.general.string = secret }
                        .font(.golos(13))
                        .foregroundStyle(BrandColor.olive)
                    TextField("Six-digit code", text: $code)
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
            title: "Save your recovery codes",
            message: "This is the only time you will see these. If you lose your phone, one "
                + "of these codes is how you get back in — without them, getting back into "
                + "your business line takes us weeks.",
            confirmLabel: "I've saved them",
            // The friction is the feature: this is the step people skip and
            // then need six months later.
            confirmEnabled: savedCodes,
            dismissLabel: "",
            onConfirm: {
                step = nil
                savedCodes = false
                refreshKey += 1
                scope.showMessage("Two-factor authentication is on.")
            },
            onDismiss: {},
            extra: {
                VStack(alignment: .leading, spacing: 6) {
                    ForEach(codes, id: \.self) { entry in
                        Text(entry)
                            .font(.system(.footnote, design: .monospaced))
                            .foregroundStyle(BrandColor.ink)
                    }
                    Button(savedCodes ? "Copied" : "Copy all codes") {
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
        Task {
            do {
                let token = try await scope.repo.freshAccessToken()
                let enrolment = try await authClient.enrollTotp(
                    accessToken: token,
                    friendlyName: "Loonext on iPhone"
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
                actionError = "That code didn't match. Check your app and try the next one."
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
                scope.showMessage("Two-factor authentication is off.")
            } catch {
                actionError = error.userMessage
            }
            busy = false
        }
    }
}
