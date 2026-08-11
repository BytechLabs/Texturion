import SwiftUI

/// #515 — "if a user is asked to be a backup owner, that confirmation prompt is
/// in settings/team that they dont have access to."
///
/// Every ownership control lived on the Team screen, and Team needs
/// `team.manage`. The named backup routinely has none of it — an owner may name
/// ANY active teammate, because a succession plan that only works for admins is
/// not a succession plan — so on this phone the person the whole mechanism
/// exists for had no path at all: no Team row in the settings index, no settings
/// deep link, and no URL bar to type around it with. The recovery valve was
/// unreachable by exactly the people it was built for.
///
/// So the prompt comes to the settings INDEX, which every role opens — it is
/// literally the bookkeeper's entire app. It costs them no new permission:
/// GET /v1/company/ownership is mounted at `workspace.access` and decides every
/// button server-side, and this card asks the shared rule
/// (`viewerHandoverPrompt`) whether there is anything here for the reader. When
/// there is not — which is almost always, for almost everybody — it draws
/// nothing.
///
/// Strictly first-person. A handover between two OTHER people is real news, but
/// it is news for the Team card and the crew-wide email, not for a row on
/// somebody's settings index.
@MainActor
struct OwnershipPrompt: View {
    let scope: SettingsScope
    let onChanged: @MainActor () -> Void

    @State private var state: Ownership?
    @State private var reloadKey = 0
    @State private var busy = false
    @State private var confirmingClaim = false
    @State private var actionError: String?
    @State private var proof: HandoverProof?
    @State private var codeRejected = false

    @Environment(\.appLocale) private var appLocale

    var body: some View {
        Group {
            if let current = state, let kind = viewerHandoverPrompt(current) {
                card(current, kind: kind)
            }
        }
        // Quiet on failure: this card is an extra on somebody else's screen,
        // and a flaky read of it must not turn the settings index into an
        // error state.
        .task(id: "\(scope.companyId)|\(reloadKey)") {
            state = try? await scope.repo.ownership(scope.companyId)
        }
    }

    // PaperCard + the index's own 18/15 padding and micro-label caption, NOT
    // `SettingsCard`: that one carries its own 16pt horizontal inset for the
    // section screens, and inside the index's 18pt column it would sit visibly
    // narrower than every card around it.
    private func card(_ current: Ownership, kind: String) -> some View {
        PaperCard {
            VStack(alignment: .leading, spacing: 8) {
                SectionHeader(
                    label: AppStrings.translate(appLocale, "settingsMore.ownershipCaption")
                )
                Text(handoverPromptHeadline(kind))
                    .font(.golos(13, weight: .semibold))
                    .foregroundStyle(BrandColor.ink)
                ReadOnlyLine(
                    handoverPromptDetail(
                        kind,
                        ripensAt: current.pending?.ripens_at ?? "",
                        expiresAt: current.pending?.expires_at ?? ""
                    )
                )
                HStack(spacing: 10) {
                    if kind == HandoverPrompt.acceptOffer
                        || kind == HandoverPrompt.completeClaim {
                        Button(
                            AppStrings.translate(
                                appLocale,
                                kind == HandoverPrompt.acceptOffer
                                    ? "settingsMore.acceptOwnership"
                                    : "settingsMore.completeTakeover"
                            )
                        ) { accept() }
                            .buttonStyle(.borderedProminent)
                            .tint(BrandColor.olive)
                            .disabled(busy)
                    }
                    if kind == HandoverPrompt.backupStanding {
                        Button(AppStrings.translate(appLocale, "settingsMore.askTakeOver")) {
                            confirmingClaim = true
                        }
                            .buttonStyle(.bordered)
                            .disabled(busy)
                    }
                    if let cancelLabel = handoverPromptCancelLabel(kind), current.canCancel {
                        Button(cancelLabel) { cancel() }
                            .buttonStyle(.bordered)
                            .disabled(busy)
                    }
                }
                .padding(.top, 2)
            }
            .padding(.horizontal, 18)
            .padding(.vertical, 15)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        // Ethical friction, and the only place this card has any: asking to
        // take over is the one action that STARTS something. Accepting does not
        // get a second sheet — by then the owner has already been told and has
        // already had their week.
        //
        // ONE sheet, two faces (#537). When the server asks for a code the CONTENT
        // changes and the sheet itself is never dismissed and re-presented — a swap of
        // two sheets at the same level is where SwiftUI drops the second one, and this
        // file cannot be run on the machine it was written on.
        .sheet(isPresented: sheetUp) {
            if let pending = proof {
                HandoverProofSheet(
                    kind: pending.kind,
                    pending: busy,
                    rejected: codeRejected,
                    onConfirm: { code in attempt(pending, code: code) },
                    onResend: { resendCode(pending) },
                    onDismiss: { dismissSheet() }
                )
            } else {
                ConfirmSheet(
                    title: AppStrings.translate(appLocale, "settingsMore.claimTitle"),
                    message: AppStrings.translate(appLocale, "settingsMore.claimBody"),
                    confirmLabel: AppStrings.translate(appLocale, "settingsMore.askTakeOver"),
                    pending: busy,
                    error: actionError,
                    onConfirm: { claim() },
                    onDismiss: { confirmingClaim = false }
                )
            }
        }
    }

    /// Is a sheet up, whichever face it is wearing?
    ///
    /// One binding rather than two presentations: accepting an offer has no
    /// confirmation of its own, so a code demand has to be able to raise the sheet by
    /// itself — and when the claim confirmation is already up, a code demand must
    /// change its face rather than fight it for the screen.
    private var sheetUp: Binding<Bool> {
        Binding(
            get: { confirmingClaim || proof != nil },
            set: { up in if !up { dismissSheet() } }
        )
    }

    /// Swiped away rather than answered: the whole handover is off, not just the code.
    private func dismissSheet() {
        confirmingClaim = false
        proof = nil
        codeRejected = false
    }

    // MARK: - Actions

    // The closure is explicitly @MainActor rather than left to inference: it
    // captures `scope`, which is main-actor state, and this file cannot be
    // compiled on the machine it was written on (no Xcode here), so nothing is
    // left for the concurrency checker to decide.
    private func run(
        _ done: String,
        _ work: @escaping @MainActor () async throws -> Ownership
    ) {
        busy = true
        actionError = nil
        Task {
            do {
                state = try await work()
                confirmingClaim = false
                scope.showMessage(done)
                // Reload the hub around us: accepting rewrites the workspace's
                // owner, and the identity card above this one is showing it.
                // The caller's own ROLE moves too, and that lives in `me` —
                // one resync behind, which is why the toast says what changed
                // rather than leaving the screen to imply it.
                onChanged()
            } catch {
                actionError = error.userMessage
                if !confirmingClaim { scope.showMessage(error.userMessage) }
            }
            busy = false
            reloadKey += 1
        }
    }

    /// The two actions here that move a business, both of which the server refuses
    /// until it has seen a code (#537).
    ///
    /// This card matters MORE than the one on Team for this: the named backup often
    /// cannot open Team at all, so completing a takeover from here is the only path
    /// they have. Cancelling stays ungated — stopping a handover is the safe
    /// direction, and a code standing between somebody and "no" would be a trap.
    private func attempt(_ pending: HandoverProof, code: String?) {
        busy = true
        actionError = nil
        Task {
            let outcome = await attemptHandover(
                scope: scope, proof: pending, code: code, alreadyOpen: proof != nil
            )
            switch outcome {
            case .done:
                proof = nil
                codeRejected = false
                confirmingClaim = false
                scope.showMessage(pending.label)
                onChanged()

            case let .needsCode(kind, refused):
                codeRejected = refused
                actionError = nil
                proof = pending.with(kind: kind)

            case let .failed(message):
                // The proof sheet renders `rejected` and nothing else, so a refusal for
                // some OTHER reason — "a transfer is already in flight" — used to sit
                // behind it saying absolutely nothing. Drop the sheet first, then report
                // where it can actually be read.
                //
                // This became reachable with #581/#7: before, a stale-factor retry was
                // refused before the route ran, so the only answer it could ever get was
                // another demand for proof. Now the retry carries a fresh proof and
                // reaches the route, where the ordinary refusals live.
                proof = nil
                codeRejected = false
                actionError = message
                if !confirmingClaim { scope.showMessage(message) }
            }
            busy = false
            reloadKey += 1
        }
    }

    private func resendCode(_ pending: HandoverProof) {
        Task {
            try? await scope.repo.requestHandoverCode(
                scope.companyId, action: pending.action
            )
            // Said either way. Whether an address exists is not ours to leak.
            scope.showMessage(AppStrings.translate(appLocale, "settingsMore.codeSent"))
        }
    }

    private func accept() {
        let companyId = scope.companyId
        let repo = scope.repo
        attempt(
            HandoverProof(
                action: "accept",
                label: AppStrings.translate(appLocale, "settingsMore.nowOwn")
            ) { code in
                state = try await repo.acceptOwnership(companyId, code: code)
            },
            code: nil
        )
    }

    private func cancel() {
        run(AppStrings.translate(appLocale, "settingsMore.handoverStopped")) {
            try await scope.repo.cancelOwnershipTransfer(scope.companyId)
        }
    }

    private func claim() {
        let companyId = scope.companyId
        let repo = scope.repo
        attempt(
            HandoverProof(
                action: "claim",
                label: AppStrings.translate(appLocale, "settingsMore.claimAsked")
            ) { code in
                state = try await repo.claimOwnership(companyId, code: code)
            },
            code: nil
        )
    }
}
