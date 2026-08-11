import SwiftUI

/// US 10DLC registration (#163): brand + campaign status with honest dates,
/// rejection reason + resubmit (POST /v1/registration/submit), and the
/// sole-proprietor SMS OTP verify/resend step. The full wizard form stays on
/// the web — this surface tracks and unblocks.
@MainActor
struct RegistrationBlock: View {
    let scope: SettingsScope
    let company: CompanyView
    let registration: RegistrationDetailPair
    let onChanged: @MainActor () -> Void

    @State private var submitting = false
    @State private var error: String?
    /// #352: which field the rejection notice asked the form to focus.
    @State private var focusField: String?

    @Environment(\.appLocale) private var appLocale

    private var canManage: Bool { SettingsRoleGate.canManageNumbers(scope.role) }

    var body: some View {
        // CA without US texting has nothing to register yet — but turning it on
        // is an owner decision we can take right here, the way the web does.
        if company.country == "CA" && !company.us_texting_enabled {
            // #328: signed in, so the currency is this workspace's own —
            // `billedIn` reads the stored column and falls back to the country
            // only when `billing_currency` was redacted for this reader.
            EnableUsCard(
                scope: scope,
                currency: company.billedIn,
                onChanged: onChanged
            )
        } else {
            SettingsCard(
                title: AppStrings.translate(appLocale, "settingsMore.textingRegistration"),
                description: AppStrings.translate(
                    appLocale, "settingsMore.textingRegistrationDesc"
                )
            ) {
                let brand = registration.brand
                let campaign = registration.campaign
                if brand == nil && campaign == nil {
                    Text(
                        AppStrings.translate(appLocale, "settingsMore.registrationNotStarted")
                    )
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                } else {
                    RegistrationRow(
                        label: AppStrings.translate(
                            appLocale, "settingsMore.businessIdentity"
                        ),
                        detail: brand
                    )
                    Spacer().frame(height: 8)
                    RegistrationRow(
                        label: AppStrings.translate(
                            appLocale, "settingsMore.messagingCampaign"
                        ),
                        detail: campaign
                    )

                    let rejected = [brand, campaign]
                        .compactMap { $0 }
                        .first { $0.status == RegistrationStatus.rejected }
                    if let rejected {
                        Spacer().frame(height: 8)
                        // #352: the carrier's token translated into what
                        // happened and the one thing to change, with a jump to
                        // the field it concerns. G7 has required plain language
                        // here since before launch; the raw reason shipped.
                        RejectionNotice(
                            domain: .registration,
                            reason: rejected.rejection_reason,
                            submissionCount: rejected.submission_count,
                            onGoToField: { focusField = $0 }
                        )
                    }

                    // Draft and rejected rows are both editable, and both are
                    // dead ends without this: a rejection you cannot act on, or
                    // a draft that never goes out. Resubmitting without an edit
                    // stays possible.
                    if canManage,
                       registrationEditable(brand) || registrationEditable(campaign) {
                        InlineError(error)
                        RegistrationFixForm(
                            scope: scope,
                            country: company.country,
                            brand: brand,
                            campaign: campaign,
                            submitLabel: AppStrings.translate(
                                appLocale,
                                rejected != nil
                                    ? "settingsMore.resubmitRegistration"
                                    : "settingsMore.submitRegistration"
                            ),
                            onSubmitted: onChanged,
                            focusField: $focusField
                        )
                        if rejected != nil {
                            Button(
                                AppStrings.translate(
                                    appLocale,
                                    submitting
                                        ? "settingsMore.resubmitting"
                                        : "settingsMore.resubmitNoChanges"
                                )
                            ) { resubmit() }
                                .buttonStyle(.bordered)
                                .disabled(submitting)
                                .padding(.top, 8)
                        }
                    }

                    // Sole-proprietor brands verify ownership with an SMS PIN to
                    // the registered mobile — the one in-app unblock the registry
                    // needs.
                    if canManage, let brand, brand.sole_proprietor,
                       brand.status != RegistrationStatus.approved,
                       brand.status != RegistrationStatus.draft,
                       brand.status != RegistrationStatus.rejected {
                        Spacer().frame(height: 10)
                        SolePropOtpRow(scope: scope, onChanged: onChanged)
                    }

                    if !canManage {
                        Spacer().frame(height: 6)
                        ReadOnlyLine(
                            AppStrings.translate(
                                appLocale, "settingsMore.onlyAdminsRegistration"
                            )
                        )
                    }
                }
            }
        }
    }

    private func resubmit() {
        submitting = true
        error = nil
        Task {
            do {
                _ = try await scope.repo.submitRegistration(scope.companyId)
                scope.showMessage(
                    AppStrings.translate(appLocale, "settingsMore.registrationResubmitted")
                )
                onChanged()
            } catch {
                self.error = error.userMessage
            }
            submitting = false
        }
    }
}

private struct RegistrationRow: View {
    let label: String
    let detail: RegistrationDetail?

    @Environment(\.appLocale) private var appLocale

    /// " 3 days ago", or nothing when there is no timestamp.
    private func ago(_ iso: String?) -> String {
        iso.map {
            AppStrings.translate(
                appLocale, "settingsMore.agoSuffix", ["ago": relativeTime($0)]
            )
        } ?? ""
    }

    private var line: String {
        guard let detail else {
            return AppStrings.translate(appLocale, "settingsMore.regNotStarted")
        }
        switch detail.status {
        case RegistrationStatus.approved:
            return AppStrings.translate(appLocale, "settingsMore.regApproved")
                + ago(detail.approved_at)
        case RegistrationStatus.rejected:
            return AppStrings.translate(appLocale, "settingsMore.regRejected")
                + ago(detail.rejected_at)
        case RegistrationStatus.submitted, RegistrationStatus.pending:
            return AppStrings.translate(appLocale, "settingsMore.regInReview")
                + (detail.submitted_at.map {
                    AppStrings.translate(
                        appLocale,
                        "settingsMore.submittedSuffix",
                        ["ago": relativeTime($0)]
                    )
                } ?? "")
        default:
            return AppStrings.translate(appLocale, "settingsMore.regDraftLine")
        }
    }

    var body: some View {
        HStack(spacing: 8) {
            VStack(alignment: .leading, spacing: 2) {
                Text(label)
                    .font(.body)
                Text(line)
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }
            Spacer()
            pill
        }
    }

    @ViewBuilder
    private var pill: some View {
        switch detail?.status {
        case nil:
            StatusPill(
                label: AppStrings.translate(appLocale, "settingsMore.regNotStarted"),
                tone: .neutral
            )
        case RegistrationStatus.approved:
            StatusPill(
                label: AppStrings.translate(appLocale, "settingsMore.regApproved"),
                tone: .positive
            )
        case RegistrationStatus.rejected:
            StatusPill(
                label: AppStrings.translate(appLocale, "settingsMore.regRejected"),
                tone: .bad
            )
        case RegistrationStatus.submitted, RegistrationStatus.pending:
            StatusPill(
                label: AppStrings.translate(appLocale, "settingsMore.regInReview"),
                tone: .warn
            )
        default:
            StatusPill(
                label: AppStrings.translate(appLocale, "settingsMore.regDraft"),
                tone: .neutral
            )
        }
    }
}

private struct SolePropOtpRow: View {
    let scope: SettingsScope
    let onChanged: @MainActor () -> Void

    @State private var code = ""
    @State private var verifying = false
    @State private var resending = false
    @State private var error: String?

    @Environment(\.appLocale) private var appLocale

    var body: some View {
        Text(AppStrings.translate(appLocale, "settingsMore.solePropPin"))
        .font(.footnote)
        .foregroundStyle(.secondary)
        HStack(spacing: 8) {
            TextField(
                AppStrings.translate(appLocale, "settingsMore.sixDigitPin"),
                text: Binding(
                    get: { code },
                    set: { next in
                        if next.count <= 6 && next.allSatisfy(\.isNumber) {
                            code = next
                        }
                    }
                )
            )
            .textFieldStyle(.roundedBorder)
            .keyboardType(.numberPad)
            .disabled(verifying || resending)
            Button(
                AppStrings.translate(
                    appLocale,
                    verifying ? "settingsMore.checking" : "settingsMore.verify"
                )
            ) { verify() }
                .buttonStyle(.borderedProminent)
                .tint(BrandColor.olive)
                .disabled(verifying || resending || code.count != 6)
        }
        .padding(.top, 6)
        Button(
            AppStrings.translate(
                appLocale,
                resending ? "settingsMore.sending" : "settingsMore.resendPin"
            )
        ) { resend() }
            .buttonStyle(.bordered)
            .disabled(verifying || resending)
            .padding(.top, 6)
        InlineError(error)
    }

    private func verify() {
        verifying = true
        error = nil
        Task {
            do {
                _ = try await scope.repo.verifyRegistrationOtp(scope.companyId, code: code)
                scope.showMessage(
                    AppStrings.translate(appLocale, "settingsMore.otpVerified")
                )
                onChanged()
            } catch {
                self.error = error.userMessage
            }
            verifying = false
        }
    }

    private func resend() {
        resending = true
        error = nil
        Task {
            do {
                try await scope.repo.resendRegistrationOtp(scope.companyId)
                scope.showMessage(AppStrings.translate(appLocale, "settingsMore.newPinSent"))
            } catch {
                self.error = error.userMessage
            }
            resending = false
        }
    }
}


/// A Canadian workspace turning US texting on: a one-time carrier
/// registration, owner only. Everyone else gets the honest read-only line.
///
/// THE FEE IS NOT $29 HERE. This card renders only while `country == "CA"` and
/// US texting is off, and #328 bills every CA workspace in CAD — so all three
/// sentences below used to quote a US price to a reader whose card is charged
/// CA$39, on the screen that takes their consent to that exact charge. The
/// figure now comes from the price book through the workspace's own currency,
/// and the sentences live in `enableUsTextingCopy` so a test can read them
/// without rendering SwiftUI.
///
/// # The pause is disclosed here and never enforced here (#525)
///
/// `POST /v1/registration/enable-us` charges the fee and submits the
/// registration without looking at `paused_at`, deliberately: nothing in the
/// registration path — submission, the carrier review, campaign creation,
/// number assignment — is blocked by a pause, so the money buys a thing that
/// really happens, and the weeks-long carrier wait is cheapest during a quiet
/// winter. What the pause DOES block is sending, so approval alone changes
/// nothing until they resume. This card says that and keeps the button.
///
/// A CONTROL THAT CHARGES IS USUALLY OFFERED ONLY ON A READ THAT SAID "NOT
/// PAUSED" — `mayBuyAddOns` is that rule, and it fails closed. It is the wrong
/// rule here and is deliberately not used: the module toggles it guards are
/// refused by their own route while paused, so offering them would be offering
/// a purchase that fails, whereas this one succeeds. Failing closed here would
/// invent a refusal the API does not make.
@MainActor
private struct EnableUsCard: View {
    let scope: SettingsScope
    /// What this workspace's card is charged in. No default, deliberately —
    /// see `enableUsTextingCopy`.
    let currency: BillingCurrency
    let onChanged: @MainActor () -> Void

    @State private var confirming = false
    @State private var pending = false
    @State private var error: String?
    /// #525 — what the REQUEST for the pause has done so far.
    ///
    /// `PauseFetch` and not `PauseRead`: the fourth case, `unaskable`, is a fact
    /// about the READER that only `pauseReadFor` may produce. Stored here it
    /// would let this card claim it cannot ask while an ordinary first-frame
    /// request is still in flight — the hole `PauseFetch` exists to close on the
    /// billing screen, one file over.
    @State private var pauseFetch: PauseFetch = .loading

    @Environment(\.appLocale) private var appLocale

    /// The one reader this card has a button for.
    private var canEnable: Bool { SettingsRoleGate.canEnableUsTexting(scope.role) }

    /// What this card KNOWS about the pause.
    ///
    /// The role passed to `pauseReadFor` is owner rather than `billing.manage`,
    /// and it is narrower on purpose. An owner holds both capabilities, so the
    /// request never 403s; a bookkeeper holds `billing.manage` and has no button
    /// on this card, so an answer fetched for them would be a round trip to
    /// Stripe that nothing renders.
    private var pauseKnown: PauseRead {
        pauseReadFor(canManageBilling: canEnable, fetch: pauseFetch)
    }

    /// A screen may not state a fact it has not read.
    ///
    /// `PauseRead.answer` is nil for `loading`, `failed` and `unaskable` alike,
    /// and `pauseIsActive(nil)` is false — so an unfinished or failed read gets
    /// the copy that has always shipped rather than a paragraph about a pause
    /// nobody has confirmed. That direction is the safe one here BECAUSE the
    /// button is not gated: the worst an unread pause costs is a disclosure the
    /// customer does not see on this screen, and the approval mail and push both
    /// branch on the same fact server-side, where it is always known.
    private var cardCopy: EnableUsTextingCopy {
        enableUsTextingCopy(currency, paused: pauseIsActive(pauseKnown.answer))
    }

    var body: some View {
        SettingsCard(
            title: AppStrings.translate(appLocale, "settingsMore.usTexting"),
            description: AppStrings.translate(appLocale, "settingsMore.usTextingDesc")
        ) {
            // ABOVE the button, because it is the answer to the question a
            // paused owner has before pressing anything — "is this even open to
            // me right now" — and an answer that arrives after the press is an
            // answer they never got.
            if let pausedNote = cardCopy.pausedNote {
                PausedStartNote(note: pausedNote)
            }
            if canEnable {
                Button(cardCopy.buttonLabel) { confirming = true }
                    .buttonStyle(.borderedProminent)
            } else {
                ReadOnlyLine(cardCopy.readOnlyLine)
            }
        }
        .sheet(isPresented: $confirming) {
            ConfirmSheet(
                title: AppStrings.translate(appLocale, "settingsMore.enableUsConfirmTitle"),
                message: cardCopy.confirmMessage,
                confirmLabel: AppStrings.translate(
                    appLocale,
                    pending ? "settingsMore.starting" : "settingsMore.enableUs"
                ),
                pending: pending,
                error: error,
                confirmEnabled: !pending,
                dismissLabel: AppStrings.translate(appLocale, "settingsMore.notNow"),
                onConfirm: { enable() },
                onDismiss: {
                    guard !pending else { return }
                    confirming = false
                    error = nil
                },
                // The extra terms a paused buyer agrees to, in the sheet where
                // the agreement happens rather than on the card they scrolled
                // past. Empty for everybody else, so this draws nothing.
                extra: {
                    ForEach(cardCopy.pausedTerms, id: \.self) { term in
                        PausedTermRow(text: term)
                    }
                }
            )
        }
        .task(id: scope.companyId) {
            guard canEnable else { return }
            // THE FAILURE IS RECORDED RATHER THAN SWALLOWED, the same way the
            // plan card records it: `GET /v1/billing/pause` throws instead of
            // degrading to a null, and a `try?` on this line would turn "we
            // could not check" into "not paused" — which is exactly the
            // sentence that must not be invented.
            do {
                let fresh = try await scope.repo.pauseOffer(scope.companyId)
                pauseFetch = .ready(fresh)
            } catch {
                // A cancelled task is not a failed read: `.task(id:)` cancels
                // the outgoing request when the workspace changes or the screen
                // goes away, and a fresher answer is already on its way.
                guard !Task.isCancelled else { return }
                pauseFetch = .failed
            }
        }
    }

    private func enable() {
        pending = true
        error = nil
        Task {
            do {
                _ = try await scope.repo.enableUsTexting(scope.companyId)
                confirming = false
                // The receipt branches on the same read the consent sentence did,
                // so the last thing they see cannot contradict what they agreed
                // to a second earlier.
                scope.showMessage(cardCopy.startedMessage)
                onChanged()
            } catch {
                self.error = error.userMessage
            }
            pending = false
        }
    }
}

/// #525 — the paused workspace's invitation, above the button.
///
/// Its own view rather than a `ReachNote`, because that primitive is one muted
/// line and this is a heading with a paragraph under it. The heading carries the
/// answer ("yes, you can start this now"); somebody who reads nothing else on
/// the card has still been told the thing that decides whether they press.
private struct PausedStartNote: View {
    let note: UsRegistrationPausedNote

    var body: some View {
        VStack(alignment: .leading, spacing: 3) {
            Text(note.heading)
                .font(.golos(13, weight: .semibold))
                .foregroundStyle(BrandColor.ink)
            Text(note.detail)
                .font(.golos(12))
                .foregroundStyle(BrandColor.muted600)
        }
        .fixedSize(horizontal: false, vertical: true)
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, 12)
        .padding(.vertical, 10)
        .background(
            BrandColor.inset,
            in: RoundedRectangle(cornerRadius: 10, style: .continuous)
        )
        .padding(.bottom, 12)
    }
}

/// One of the three things a paused buyer is agreeing to.
///
/// The bullet hangs outside the text rather than being glued to the front of it,
/// so a line that wraps stays a single readable block instead of running back
/// under its own marker.
private struct PausedTermRow: View {
    let text: String

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 8) {
            Text("•")
                .font(.golos(13))
                .foregroundStyle(BrandColor.muted600)
            Text(text)
                .font(.golos(13))
                .foregroundStyle(BrandColor.muted600)
                .fixedSize(horizontal: false, vertical: true)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.top, 8)
    }
}
