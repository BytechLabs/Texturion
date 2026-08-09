import SwiftUI

/// #537 — the code the server wants before a business changes hands.
///
/// THREE screens run these actions on this phone: the ownership card on Team, the #515
/// prompt on the settings index — which is the ONLY one the named backup can reach,
/// since they routinely have no `team.manage` — and releasing a number from Numbers. So
/// the rule lives here rather than in any of them: a gate the recovery valve did not
/// have is a recovery valve that does not work.
///
/// The count matters, and this sentence said TWO for as long as there were three. That
/// is how the third one was overlooked when the funnel started reading the kind off the
/// proof it is handed (#581/#7): `NumbersSection` rebuilds its proof on every press
/// rather than handing back the held one, so it had to be taught to carry the kind
/// forward, and nothing in this header pointed at it.

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
/// Only the refusals that NAME a proof divert to the dialog — there are three of them
/// now. Every other refusal comes back as `.failed` — so "a transfer is already in
/// flight" is never dressed up as a code that could not have helped.
///
/// The email is requested here, on the way to opening the dialog, rather than left to
/// a button: a dialog whose only working control is "send it again" has wasted
/// somebody's time. `alreadyOpen` keeps a rejected code from quietly minting a new one
/// behind the person still looking at the old one.
///
/// Not every code is ours to check, which is the #581/#7 part. One of the demands wants
/// a factor proved in the last five minutes, and it asks for it in word-for-word the
/// same sentence as the workspace-wide wall — so nothing the person reads distinguishes
/// them, and neither can this function by looking at the copy. It asks the shared rule
/// instead, the same one web and Android ask.
@MainActor
func attemptHandover(
    scope: SettingsScope,
    proof: HandoverProof,
    code: String?,
    alreadyOpen: Bool,
    /// #593: the identity client, injectable so one test can drive this end to end.
    ///
    /// Defaulted and trailing, so all three screens call this exactly as before and the
    /// production path is untouched. It exists because the property that matters here —
    /// that digits which are not ours to check never reach our own server — was pinned
    /// only by a check that reads this file's text, on the one platform with no local
    /// compiler.
    auth: SettingsAuthClient = SettingsAuthClient()
) async -> HandoverOutcome {
    if let code, !HandoverConfirmation.codeGoesToOurApi(proof.kind) {
        return await handoverProveThenRetry(
            scope: scope, proof: proof, kind: proof.kind, code: code, auth: auth
        )
    }

    do {
        try await proof.attempt(code)
        return .done
    } catch {
        guard let kind = HandoverConfirmation.kind(of: (error as? ApiError)?.code) else {
            return .failed(message: error.userMessage)
        }
        // #593 parity with Android: the refusal NAMES the demand, and that name outranks
        // whatever we arrived holding. A screen that rebuilds its request for each attempt
        // gets here still carrying the default one — so if the digits in hand turn out to
        // have never been ours to check, prove them now instead of posting them a second
        // time. Posting them a second time is the forever loop, and the person is told
        // their own correct code is wrong.
        if let code, !HandoverConfirmation.codeGoesToOurApi(kind) {
            return await handoverProveThenRetry(
                scope: scope, proof: proof, kind: kind, code: code, auth: auth
            )
        }
        if !alreadyOpen, kind == .email {
            // Best effort. A send that fails must not replace the demand with a
            // network error — the dialog still has a working "send it again".
            try? await scope.repo.requestHandoverCode(scope.companyId, action: proof.action)
        }
        return .needsCode(kind: kind, refused: code != nil)
    }
}

/// Prove the factor here, then run the action again carrying NO code. #593.
///
/// One function reached from both questions above, rather than the same six lines twice.
/// `kind` is carried in rather than assumed, so the sheet that stays up on a failure is
/// still the sheet the server asked for.
///
/// The retry carries nothing on purpose: what the server refused was not a missing code
/// but the AGE of the last proof on this session. Nothing on that route reads a code, so
/// digits sent at it come back with the identical refusal every time — to every CORRECT
/// code, forever.
@MainActor
private func handoverProveThenRetry(
    scope: SettingsScope,
    proof: HandoverProof,
    kind: HandoverConfirmation.Kind,
    code: String,
    auth: SettingsAuthClient
) async -> HandoverOutcome {
    do {
        try await handoverReproveFactor(scope: scope, code: code, auth: auth)
    } catch {
        // The same answer as a code our own server refused: the sheet stays up and says
        // so once. Telling a wrong code apart from an expired one helps whoever is
        // guessing more than it helps the owner, who types the next one either way.
        return .needsCode(kind: kind, refused: true)
    }
    do {
        try await proof.attempt(nil)
        return .done
    } catch {
        guard let again = HandoverConfirmation.kind(of: (error as? ApiError)?.code) else {
            return .failed(message: error.userMessage)
        }
        return .needsCode(kind: again, refused: true)
    }
}

/// Prove this person's authenticator factor against Supabase, here on the phone.
///
/// The same three calls in the same order as `Features/Auth/MfaGate.swift` makes to get
/// past the workspace wall, and for the same reason at the end: verifying hands back a
/// FRESH session, and STORING it is what stamps the new proof time into the token the
/// next request presents. Without the save the app hands over the old token and the
/// server answers with the identical refusal.
///
/// Throws when the code is wrong, when Supabase cannot be reached, or when this account
/// has no factor to challenge. The caller says the one thing worth saying about any of
/// them and leaves the sheet up.
@MainActor
private func handoverReproveFactor(
    scope: SettingsScope,
    code: String,
    auth: SettingsAuthClient
) async throws {
    let token = try await scope.repo.freshAccessToken()
    // GET /v1/mfa lists VERIFIED factors only, so the first one is a real one. Nothing
    // typed into the sheet can satisfy a demand for a factor this account does not
    // have, which is why finding none throws rather than asking again.
    guard let factorId = try await scope.repo.mfa().allFactors.first?.id else {
        throw ApiError(
            code: ApiErrorCode.unauthorized,
            message: "We couldn't find an authenticator on this account.",
            httpStatus: 401
        )
    }
    let challengeId = try await auth.challengeFactor(accessToken: token, factorId: factorId)
    let session = try await auth.verifyFactor(
        accessToken: token,
        factorId: factorId,
        challengeId: challengeId,
        // The field is a number pad, but a code arriving from a paste or off the
        // notification banner brings its spacing with it.
        code: code.filter(\.isNumber)
    )
    scope.graph.sessionStore.save(session.session)
}

/// The confirmation in front of a handover.
///
/// ## Evaluation
///
/// The server will not move a business without proof it is really the owner asking.
/// Three demands answer that — an authenticator, that same authenticator again because
/// the last time was too long ago, or a code emailed to the account —
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
        // ...and so does a second attempt, which is the case that sentence was written
        // for and this did not cover: a refusal does not change the KIND, so nothing
        // fired and the rejected digits stayed put with Confirm still enabled. An
        // authenticator code has rotated by then, so pressing it again was certain to
        // fail — and on the emailed path it spent another of the five attempts doing so.
        .onChange(of: rejected) { _, nowRejected in if nowRejected { code = "" } }
    }
}
