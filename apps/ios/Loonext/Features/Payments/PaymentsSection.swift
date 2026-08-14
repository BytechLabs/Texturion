import SwiftUI

/**
 #224 — "Getting paid", the owner's side of text-to-pay.

 ## Evaluation

 This screen has exactly one job: say where the business stands, and offer the
 one thing that moves them forward. There are five states and each has a
 different next action, so the temptation is a status grid. A grid would be
 wrong — the reader is a plumber who wants to know whether they can take a card,
 not an operator auditing a Stripe account.

 ## The decisions

 - **One sentence, one button.** The state copy is composed on the SERVER, so
   web, Android and iOS say the same thing and none of them can drift into
   paraphrase. *Applying: Chunking — three or four items is the ceiling, and a
   status page that lists nine booleans is nine.*

 - **No progress bar.** Onboarding progress belongs to Stripe, which owns the
   flow and is the only thing that knows how far through it somebody is. A bar
   we invented would either start at 0% — which tells somebody who has already
   done work that they have done none — or would be a number we made up. The
   honest equivalent is what is OUTSTANDING, listed below. *Applying: the Goal
   Gradient Effect, honoured by naming the remaining steps rather than faking a
   fraction.*

 - **Outstanding requirements in plain words.** Stripe answers with
   `individual.verification.document`. A person reads "Photo ID for the business
   owner". *Applying: Outcomes Over Features.*

 - **Loss aversion is deliberately ABSENT.** There is no "you are losing
   payments" framing here. The business has not lost anything; they have not
   started. Manufacturing a loss to drive a bank-details form would be the one
   place in this product where that lever would be dishonest.

 - **The Stripe dashboard link is the refund path**, and it is the only place
   refunds are offered. We deliberately do not build a thin copy of a back
   office that already exists and stays compliant.

 Mirrors apps/web/src/components/settings/payments-card.tsx and the Android
 PaymentsCard.kt.
 */
@MainActor
struct PaymentsSectionView: View {
    let scope: SettingsScope

    @Environment(\.appLocale) private var appLocale

    @State private var state: LoadState<PayoutAccount> = .loading
    @State private var refreshKey = 0
    @State private var opening = false
    @State private var actionError: String?

    private var payments: PaymentsApi { PaymentsApi(api: scope.graph.api) }

    var body: some View {
        Group {
            switch state {
            case .loading:
                CenteredLoading()
                    .frame(height: 200)
            case .failed(let message):
                CenteredError(message: message) { refreshKey += 1 }
                    .frame(height: 200)
            case .ready(let account):
                accountCard(account)
                // Not a second card and not a footnote on the button: this is
                // the answer to "where does the money actually go", which is the
                // question an owner has before they hand over a bank account.
                // It is the same promise on every client, so it is written once
                // per client and not per state.
                if account.resolvedReadiness == .ready {
                    settledFacts(account)
                }
            }
        }
        .task(id: "\(scope.companyId)|\(refreshKey)") { await load() }
    }

    // MARK: - The card

    @ViewBuilder
    private func accountCard(_ account: PayoutAccount) -> some View {
        SettingsCard(
            title: AppStrings.translate(appLocale, "payments.settingsTitle"),
            description: account.title
        ) {
            VStack(alignment: .leading, spacing: 0) {
                Text(account.detail)
                    .font(.golos(13))
                    .foregroundStyle(BrandColor.muted600)
                    .fixedSize(horizontal: false, vertical: true)
                    .frame(maxWidth: .infinity, alignment: .leading)

                if !account.requirements_due.isEmpty {
                    requirements(account.requirements_due)
                }

                if let label = account.action {
                    Button(
                        opening
                            ? AppStrings.translate(appLocale, "payments.opening")
                            : label
                    ) { open(account) }
                        .buttonStyle(.borderedProminent)
                        .tint(BrandColor.olive)
                        .disabled(opening)
                        .padding(.top, 14)
                    // Said BEFORE the tap, not after it. Every one of these
                    // buttons leaves the app for Stripe's own pages, which is
                    // required — App Store rules treat a webview wrapped around
                    // an external payment page as a violation — and a reader who
                    // is not told is a reader who thinks the app crashed.
                    Text(
                        AppStrings.translate(appLocale, "payments.opensStripeInBrowser")
                    )
                        .font(.golos(11.5))
                        .foregroundStyle(BrandColor.muted500)
                        .padding(.top, 6)
                }

                InlineError(actionError)

                // `role == owner` asked directly rather than through a
                // `SettingsRoleGate` helper: every gate in there answers a
                // question about a DIFFERENT action, and borrowing one because
                // it happens to be owner-only today is how a gate silently
                // changes meaning when that action's rule moves.
                if scope.role != MemberRole.owner,
                   account.resolvedReadiness == .notConnected {
                    // Honest, and specific about WHICH role. Connecting the
                    // account binds a legal entity and a bank account, so the
                    // server holds it to the owner alone — an admin or a
                    // bookkeeper pressing the button above would collect a 403
                    // and no explanation.
                    ReadOnlyLine(
                        AppStrings.translate(appLocale, "payments.onlyOwnerConnectsStripe")
                    )
                    .padding(.top, 10)
                }
            }
        }
    }

    /// What Stripe is still waiting for, in words an owner can act on.
    private func requirements(_ due: [String]) -> some View {
        VStack(alignment: .leading, spacing: 3) {
            Text(AppStrings.translate(appLocale, "payments.stripeNeeds"))
                .font(.golos(12.5, weight: .semibold))
                .foregroundStyle(BrandColor.overdueAmber)
            ForEach(due, id: \.self) { requirement in
                Text("· " + payoutRequirementCopy(requirement, appLocale))
                    .font(.golos(12.5))
                    .foregroundStyle(BrandColor.overdueAmber)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, 12)
        .padding(.vertical, 9)
        .background(
            BrandColor.amberBg,
            in: RoundedRectangle(cornerRadius: 10, style: .continuous)
        )
        .padding(.top, 12)
    }

    /// The two facts a connected workspace actually asks about, and the promise
    /// underneath them. Only drawn when payments are live: a payouts row on an
    /// account that cannot charge yet answers a question nobody has reached.
    private func settledFacts(_ account: PayoutAccount) -> some View {
        SettingsCard(title: AppStrings.translate(appLocale, "payments.whereMoneyGoes")) {
            VStack(alignment: .leading, spacing: 8) {
                Fact(
                    label: AppStrings.translate(appLocale, "payments.payouts"),
                    value: account.payouts_enabled
                        ? AppStrings.translate(appLocale, "payments.payoutsOn")
                        : AppStrings.translate(appLocale, "payments.payoutsOff")
                )
                Fact(
                    label: AppStrings.translate(appLocale, "payments.chargedIn"),
                    value: account.payoutCurrency.rawValue.uppercased()
                )
                Text(AppStrings.translate(appLocale, "payments.stripeDashboardNote"))
                .font(.golos(12))
                .foregroundStyle(BrandColor.muted600)
                .fixedSize(horizontal: false, vertical: true)
                .padding(.top, 2)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    // MARK: - Load and act

    private func load() async {
        if case .ready = state {} else { state = .loading }
        do {
            // FORCED past the cache. The thread composer is allowed a
            // five-minute-old answer; the screen whose entire job is to report
            // this state is not — somebody who has just finished Stripe's flow
            // and come back must not be told they have not started.
            state = .ready(
                try await PayoutAccountCache.shared.account(
                    companyId: scope.companyId,
                    using: payments,
                    force: true
                )
            )
        } catch {
            if case .ready = state {
                scope.showMessage(error.userMessage)
            } else {
                state = .failed(error.userMessage)
            }
        }
    }

    /// One button, two destinations.
    ///
    /// Which one is decided by the READINESS rather than by the label, because
    /// the label is the server's sentence and a client branching on somebody
    /// else's copy is a client that breaks when the copy is improved.
    private func open(_ account: PayoutAccount) {
        opening = true
        actionError = nil
        let needsOnboarding = account.resolvedReadiness == .notConnected
            || account.resolvedReadiness == .onboardingIncomplete
        Task {
            do {
                if needsOnboarding {
                    let started = try await payments.startOnboarding(companyId: scope.companyId)
                    // The account may have been CREATED by that call, so what
                    // this screen holds is now stale everywhere — including the
                    // thread composer, which would otherwise wait out the cache's
                    // TTL before offering the ask.
                    await PayoutAccountCache.shared.invalidate(companyId: scope.companyId)
                    // The echo, rendered immediately: a first-time owner watching
                    // "Not set up yet" while Safari opens has no way to tell a
                    // created account from a button that did nothing.
                    if let created = started.account {
                        state = .ready(created)
                    }
                    openExternal(started.url)
                    // And then a real re-read, because the echo is only what
                    // Stripe knew BEFORE the owner filled anything in. The flow
                    // happens in the browser; this screen has to report what
                    // Stripe says when they come back.
                    refreshKey += 1
                } else {
                    let hosted = try await payments.dashboardLink(companyId: scope.companyId)
                    openExternal(hosted.url)
                }
            } catch {
                actionError = error.userMessage
            }
            opening = false
        }
    }
}

/// A label and its answer, stacked. Small enough to be a local type rather than
/// a shared one: the two facts it prints exist on exactly this screen.
private struct Fact: View {
    let label: String
    let value: String

    var body: some View {
        VStack(alignment: .leading, spacing: 1) {
            Text(label.uppercased())
                .font(.golos(10.5, weight: .bold))
                .kerning(0.8)
                .foregroundStyle(BrandColor.muted500)
            Text(value)
                .font(.golos(13.5))
                .foregroundStyle(BrandColor.ink)
                .fixedSize(horizontal: false, vertical: true)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}
