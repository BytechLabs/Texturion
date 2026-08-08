import SwiftUI

/// #537 — the code the server wants before a business changes hands.
///
/// TWO screens run these actions on this phone: the ownership card on Team, and the
/// #515 prompt on the settings index — which is the ONLY one the named backup can
/// reach, since they routinely have no `team.manage`. So the rule lives here rather
/// than in either of them: a gate the recovery valve did not have is a recovery valve
/// that does not work.

/// A handover the server refused until it has seen proof.
///
/// `attempt` is the action itself, held whole so the retry is the same handover to the
/// same person — rebuilding it would be a chance to hand the business to somebody
/// other than the one named in the first attempt. `action` is the server's own name
/// for it, because a code is scoped to one action: a code minted for an offer cannot
/// complete a takeover.
///
/// Identifiable because both screens present it as a sheet.
struct HandoverProof: Identifiable {
    let action: String
    let label: String
    var kind: HandoverConfirmation.Kind = .email
    let attempt: @MainActor (String?) async throws -> Void

    var id: String { "\(action):\(kind.rawValue)" }

    func with(kind: HandoverConfirmation.Kind) -> HandoverProof {
        HandoverProof(action: action, label: label, kind: kind, attempt: attempt)
    }
}

/// What came back from one attempt.
enum HandoverOutcome {
    /// It went through.
    case done

    /// The server named a proof it wants. `refused` is true only when a code was
    /// actually sent and came back rejected, which is the one case the dialog says
    /// something about.
    case needsCode(kind: HandoverConfirmation.Kind, refused: Bool)

    /// Refused for some other reason, which the person needs to read as itself.
    case failed(message: String)
}

/// Run one attempt and say what to do next.
///
/// Only the two refusals that NAME a proof divert to the dialog. Every other refusal
/// comes back as `.failed` — so "a transfer is already in flight" is never dressed up
/// as a code that could not have helped.
///
/// The email is requested here, on the way to opening the dialog, rather than left to
/// a button: a dialog whose only working control is "send it again" has wasted
/// somebody's time. `alreadyOpen` keeps a rejected code from quietly minting a new one
/// behind the person still looking at the old one.
@MainActor
func attemptHandover(
    scope: SettingsScope,
    proof: HandoverProof,
    code: String?,
    alreadyOpen: Bool
) async -> HandoverOutcome {
    do {
        try await proof.attempt(code)
        return .done
    } catch {
        guard let kind = HandoverConfirmation.kind(of: (error as? ApiError)?.code) else {
            return .failed(message: error.userMessage)
        }
        if !alreadyOpen, kind == .email {
            // Best effort. A send that fails must not replace the demand with a
            // network error — the dialog still has a working "send it again".
            try? await scope.repo.requestHandoverCode(scope.companyId, action: proof.action)
        }
        return .needsCode(kind: kind, refused: code != nil)
    }
}

/// The confirmation in front of a handover.
///
/// ## Evaluation
///
/// The server will not move a business without proof it is really the owner asking.
/// Two mechanisms answer that — an authenticator, or a code emailed to the account —
/// and without this the refusal was a dead end on a phone: the action failed with a
/// message about a code there was nowhere to type.
///
/// ## What binds it
///
/// *Zen of Clarity* — one field, one sentence, and the sentence differs by mechanism.
/// "Enter your code" is useless to somebody who does not know which code.
///
/// *Smart Defaults* — a number pad, the one-time-code content type so iOS offers the
/// code straight from the notification banner, and the email is already sent by the
/// time this is on screen.
///
/// *Ethical Friction, deliberately* — this IS the friction and it belongs here, so
/// everything else works to make the legitimate path quick: no typed confirmation, no
/// second checkbox, no countdown.
///
/// Built on `ConfirmSheet` so it inherits the pending state, the inline error and the
/// keyboard behaviour the rest of Settings already has.
@MainActor
struct HandoverProofSheet: View {
    let kind: HandoverConfirmation.Kind
    let pending: Bool
    let rejected: Bool
    let onConfirm: @MainActor (String) -> Void
    let onResend: @MainActor () -> Void
    let onDismiss: @MainActor () -> Void

    @State private var code = ""

    var body: some View {
        ConfirmSheet(
            title: HandoverConfirmation.title,
            message: HandoverConfirmation.whereToLook(kind),
            confirmLabel: HandoverConfirmation.submit,
            pending: pending,
            error: rejected ? HandoverConfirmation.rejected : nil,
            confirmEnabled: HandoverConfirmation.isCode(code),
            onConfirm: { onConfirm(code) },
            onDismiss: onDismiss
        ) {
            VStack(alignment: .leading, spacing: 10) {
                TextField(HandoverConfirmation.field, text: $code)
                    .textFieldStyle(.roundedBorder)
                    .font(.golos(15))
                    .keyboardType(.numberPad)
                    // So iOS offers the code straight off the notification banner,
                    // and never autocapitalises or autocorrects six digits.
                    .textContentType(.oneTimeCode)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .disabled(pending)
                    .accessibilityLabel(HandoverConfirmation.field)
                // Only on the email path. There is nothing to resend to somebody
                // whose app is generating the codes, and the button would imply
                // otherwise.
                if kind == .email {
                    Button(HandoverConfirmation.resend) { onResend() }
                        .font(.golos(13))
                        .foregroundStyle(BrandColor.muted600)
                        .disabled(pending)
                }
            }
            .padding(.top, 10)
        }
        // A second demand starts empty. Digits left over from a refused attempt read
        // as though the app were retrying by itself.
        .onChange(of: kind) { _, _ in code = "" }
    }
}
