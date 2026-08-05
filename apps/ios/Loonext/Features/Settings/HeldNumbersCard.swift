import SwiftUI

/// #523 — the numbers this workspace holds that its plan does not cover, why,
/// and both ways to end it.
///
/// # What this card is for
///
/// `POST /v1/billing/checkout` counts neither numbers nor seats, and coming back
/// is never refused (#277) — so a Pro workspace holding two numbers can press
/// "Come back on Starter" and land on a plan that includes one. What happens
/// after the money moves now respects the plan they bought: the API brings back
/// what the allowance covers, oldest first, and leaves the rest `suspended`.
/// Nothing is released and nothing is destroyed.
///
/// That is only defensible if the owner can SEE it. A held number is half-alive
/// in a way that is hard to guess at: it keeps receiving texts and calls the
/// workspace cannot answer, so their customers find out before they do. The mail
/// and the push say it once, at the moment it happens; this card is the place it
/// stays said, with the two priced routes out of it attached.
///
/// # Where it sits, and why
///
/// Directly under the plan card. The sentence it makes is continuous with that
/// one — "your plan covers 1 number" then "and you have more than that" — and
/// the upgrade route it names is the control on the card an inch above, which is
/// the one place a plan change is offered in every state this screen has
/// (in-app, or the browser portal under the #163 kill-switch). A second upgrade
/// button here would be a copy of that control to keep in step with it.
///
/// # It never draws for a workspace that has left
///
/// A cancelled workspace's numbers are suspended for a different reason and have
/// a different answer — the 30-day hold, and the win-back inside the Subscription
/// card. `heldNumbersState` refuses to draw anything unless the server said
/// `over_plan_allowance`, rather than inferring it here from two fields.
///
/// # A failed read draws nothing
///
/// Same as the add-ons card and the missed-while-off note above it: this is one
/// card on somebody else's screen, and a billing page showing a broken box reads
/// as the billing itself being broken. The numbers screen still says the line is
/// on hold, so nothing about the state disappears with it.
@MainActor
struct HeldNumbersCard: View {
    let scope: SettingsScope
    let company: CompanyView
    /// #277 — what this screen knows about the pause, read once by the plan
    /// card above and handed down whole.
    ///
    /// THE READ AND NOT A `Bool`. A paused workspace cannot be sold anything
    /// (`POST …/reinstate` answers `workspace_paused` by design), and neither
    /// may one whose read has not landed — "not paused" and "not read yet" are
    /// different screens, and only the first of them may show a price.
    let read: PauseRead
    /// Refresh the company view: reinstating changes the numbers list the rest
    /// of settings renders from.
    let onRefreshCompany: @MainActor () -> Void

    @State private var held: HeldNumbers?
    @State private var refreshKey = 0
    @State private var confirming: HeldNumber?
    /// One key per INTENT — minted when the sheet opens, reused across retries
    /// of that same sheet, regenerated the next time one opens. The route keys
    /// its Stripe write on it, so a retry after a lost response cannot charge
    /// twice. Same shape as the number picker's.
    @State private var idempotencyKey = ""
    @State private var pending = false
    @State private var dialogError: String?

    private var canManage: Bool { SettingsRoleGate.canManageBilling(scope.role) }

    /// Whether there is an answer to be had at all.
    ///
    /// The whole `/v1/billing` router is behind `billing.manage`, so asking on a
    /// tech's behalf would 403 on every visit. `subscription_status == active`
    /// is the same condition the route uses to call a hold `over_plan_allowance`
    /// — anything else is the grace window, which this card does not speak
    /// about — and a workspace with no plan has never had an allowance to
    /// exceed.
    private var askable: Bool {
        canManage && company.plan != nil && company.subscriptionActive
    }

    var body: some View {
        Group {
            if let held,
               let state = heldNumbersState(
                   held,
                   read: read,
                   billingWritesEnabled: company.billing_writes_enabled,
                   audience: company.billedIn
               ) {
                card(answer: held, copy: state.copy, offer: state.offer)
            }
        }
        .task(id: "\(scope.companyId)|\(refreshKey)|\(askable)") {
            guard askable else {
                // Not "keep the last answer": a change of workspace or of
                // subscription state makes the held answer describe something
                // that is no longer on screen.
                held = nil
                return
            }
            do {
                held = try await scope.repo.heldNumbers(scope.companyId)
            } catch {
                // A cancelled task is not a failed read — `.task(id:)` cancels
                // the outgoing request whenever the screen goes away, and
                // dropping the answer we already have would blank the card
                // while a fresher one is on its way.
                guard !Task.isCancelled else { return }
                held = nil
            }
        }
    }

    @ViewBuilder
    private func card(
        answer: HeldNumbers,
        copy: HeldNumbersCopy,
        offer: HeldNumbersOffer
    ) -> some View {
        SettingsCard(title: copy.title, description: copy.lead) {
            // Reassurance BEFORE anything that can be pressed. The reader's
            // first question is whether the number on the side of their van is
            // gone, and a price quoted before that is answered reads as a
            // ransom rather than as an option.
            Text(copy.kept)
                .font(.golos(12.5))
                .foregroundStyle(BrandColor.muted600)
                .fixedSize(horizontal: false, vertical: true)

            ForEach(answer.held) { row in
                heldRow(row, offer: offer)
                    .padding(.top, 10)
            }

            if let routes = copy.routes {
                Text(routes)
                    .font(.golos(12))
                    .foregroundStyle(BrandColor.muted600)
                    .fixedSize(horizontal: false, vertical: true)
                    .padding(.top, 12)
            }
            if copy.offerHelp {
                // The same control the cancellation answer uses for the same
                // job, so "get to a person" looks like one thing in this app
                // rather than two.
                NavigationLink("Get in touch", value: SettingsSection.help)
                    .buttonStyle(.bordered)
                    .padding(.top, 10)
            }
        }
        .sheet(item: $confirming) { row in
            confirmSheet(row, offer: offer)
        }
    }

    /// One held number: what it is, that it is held, and — only where there is
    /// something to buy — the button that ends it.
    ///
    /// ONE BUTTON PER ROW, because each is its own purchase with its own
    /// consent. The route raises the quantity by exactly one; a workspace
    /// holding three buys them back one at a time and can stop after any of
    /// them.
    @ViewBuilder
    private func heldRow(_ row: HeldNumber, offer: HeldNumbersOffer) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 8) {
                Text(rowLabel(row))
                    .font(.golos(14, weight: .semibold))
                    .foregroundStyle(BrandColor.ink)
                StatusPill(label: "On hold", tone: .warn)
                Spacer()
            }
            if case .buy(let price) = offer {
                // The price is ON the control that charges it. A button whose
                // cost is a paragraph away is a button somebody presses without
                // having read the cost.
                Button("Bring it back · \(price)") {
                    dialogError = nil
                    idempotencyKey = UUID().uuidString
                    confirming = row
                }
                .font(.golos(13, weight: .semibold))
                .buttonStyle(.bordered)
                .disabled(pending)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, 14)
        .padding(.vertical, 12)
        .background(
            BrandColor.inset,
            in: RoundedRectangle(cornerRadius: 14, style: .continuous)
        )
    }

    @ViewBuilder
    private func confirmSheet(_ row: HeldNumber, offer: HeldNumbersOffer) -> some View {
        // The price comes from the same offer the button was drawn from, so the
        // sheet cannot quote a figure the control did not. A sheet reached with
        // no price to state would be taking consent for an unnamed charge, so
        // it closes instead.
        if case .buy(let price) = offer {
            let copy = reinstateNumberCopy(number: rowLabel(row), price: price)
            ConfirmSheet(
                title: copy.title,
                message: copy.message,
                confirmLabel: copy.confirmLabel,
                pending: pending,
                error: dialogError,
                onConfirm: { reinstate(row) },
                onDismiss: {
                    if !pending { confirming = nil }
                }
            )
        }
    }

    /// A suspended row has always been active, so it has a number. The fallback
    /// is the same words the number card uses for a row that has not got one
    /// yet, rather than an empty string where a phone number should be.
    private func rowLabel(_ row: HeldNumber) -> String {
        let formatted = formatPhone(row.number_e164)
        return formatted.isEmpty ? "Your number" : formatted
    }

    /// Buy the capacity, then say what actually happened.
    ///
    /// THE RESPONSE DECIDES THE SENTENCE, not the request. There are three
    /// outcomes and `reinstateOutcomeMessage` keeps them apart — including the
    /// one where the charge landed and the number did not come back, which must
    /// never be answered with an invitation to press the button again.
    private func reinstate(_ row: HeldNumber) {
        guard !pending else { return }
        pending = true
        dialogError = nil
        let key = idempotencyKey
        let label = rowLabel(row)
        Task {
            do {
                let result = try await scope.repo.reinstateHeldNumber(
                    scope.companyId,
                    numberId: row.id,
                    idempotencyKey: key
                )
                confirming = nil
                scope.showMessage(reinstateOutcomeMessage(result, number: label))
                refreshKey += 1
                onRefreshCompany()
            } catch {
                // Shown in the sheet rather than as a toast behind it: every
                // refusal on this route happens BEFORE any money moves, and its
                // sentence is written for the customer ("Starter tops out at 2
                // numbers", "Your plan is paused"). It is shown as it arrives.
                dialogError = error.userMessage
            }
            pending = false
        }
    }
}
