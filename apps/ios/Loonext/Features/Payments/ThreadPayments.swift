import SwiftUI

/**
 #224 — what this thread is owed, what it was paid, and how to ask for more.

 ## Why a strip beside the composer rather than a bubble in the transcript

 The same reasoning #233 settled for scheduled sends. A payment request is not a
 message: the message that carried it is already in the transcript, in the
 customer's own thread, exactly as they received it. What is NOT in the
 transcript is the STATE — whether it was paid, refunded, or has expired — and
 that state changes without anybody in the workspace doing anything. A bubble
 would have to mutate after the fact, which is the one thing a transcript must
 never do.

 ## What it shows, and what it hides

 Only requests that are still live or were settled recently. A thread with two
 years of paid deposits would otherwise grow a permanent wall of history above
 the composer, and history is what the timeline is for. *Applying: Zen of
 Clarity — the pane is absent entirely on almost every thread.*

 ## The ask is ABSENT, never disabled

 Same rule as #520's on-my-way button: a control that is present and inert costs
 every reader the moment it takes to work out why it does nothing, on every
 thread, forever. A workspace that has not connected Stripe sees nothing here —
 the setup lives in Settings, where the owner is, and a tech cannot action it
 anyway. *Applying: Zen of Clarity, and Prioritize Intent.*

 Mirrors apps/web/src/components/thread/payment-strip.tsx and
 ask-for-payment.tsx, rendered from the same place their web twins are: above
 the composer input, below the transcript.
 */
@MainActor
struct ThreadPaymentsPane: View {
    let api: ApiClient
    let companyId: String
    let conversationId: String
    /// This viewer's role in THIS workspace, for the capability gates below.
    let role: String?
    /// #106: 'text' or 'note' on this conversation's number.
    let viewerLevel: String
    /// The name the preview puts first in the SMS. Nil while the company view
    /// is still loading — the composer stands in a neutral word rather than
    /// showing a text that starts with a colon.
    let businessName: String?
    /// #607: `ThreadController.paymentChangedTick`, which moves when the
    /// database says a payment on this thread was paid, refunded or disputed.
    ///
    /// A number rather than the event, and taken from the controller rather than
    /// read off the socket here, because the thread has exactly ONE realtime
    /// subscription — `ThreadView` opens it and routes it into the controller.
    /// A second subscription in this pane would be a second style of listening
    /// on one screen, and the two would drift the first time an event was
    /// renamed.
    let paymentChangedTick: Int
    /// Called after a request has actually gone out.
    ///
    /// The ask SENDS A TEXT, so the transcript above has a message it does not
    /// know about yet. A `message.created` broadcast will say so too, and on a
    /// healthy socket it arrives first — but a crew watching a thread they just
    /// billed from must not be left wondering whether it went, on the strength
    /// of a frame that may not come. Web invalidates its message query for the
    /// same reason.
    let onSent: @MainActor () -> Void

    @Environment(\.appLocale) private var appLocale

    @State private var model: ThreadPaymentsModel?
    @State private var asking = false

    /// A notes-only viewer sees none of this — the same `!noteOnly` gate the web
    /// composer puts on both halves.
    ///
    /// Not merely a courtesy: the API refuses both for them anyway. But the
    /// reason to hide it is the product one. A note goes to the crew; a bill
    /// goes to the customer, and somebody who cannot text this customer has no
    /// business being shown what that customer owes.
    private var canSeeStrip: Bool { viewerLevel == "text" }

    /// #315: a view-only observer may READ this thread and change nothing in it.
    /// Both asking and calling an ask off are send-class actions, so they get
    /// the rows and neither control.
    private var canAct: Bool { canSeeStrip && role != MemberRole.readOnly }

    var body: some View {
        Group {
            // Nothing drawn at all when there is nothing to draw. No skeleton
            // and no empty state: reserving space on every thread for something
            // almost every thread does not have is a permanent cost paid for a
            // rare event.
            if canSeeStrip, let model, !model.visibleRequests.isEmpty || showsAsk(model) {
                VStack(spacing: 4) {
                    ForEach(model.visibleRequests) { request in
                        PaymentStripRow(
                            request: request,
                            canCancel: canAct && paymentRequestCancellable(request.facts),
                            busy: model.cancelling == request.id
                        ) {
                            model.cancel(request)
                        }
                    }
                    if showsAsk(model) {
                        askButton
                    }
                }
                .padding(.horizontal, 12)
                .padding(.bottom, 4)
            }
        }
        .task(id: "\(companyId)|\(conversationId)") {
            let created = ThreadPaymentsModel(
                payments: PaymentsApi(api: api),
                companyId: companyId,
                conversationId: conversationId,
                role: role
            )
            model = created
            await created.load()
        }
        // #215: a frame missed while this thread was backgrounded self-heals on
        // return. This used to read "there is no realtime event for a payment,
        // so coming back to the app is the moment the strip is most likely to be
        // stale" — #607 gave it one, and the second half of that sentence is
        // still true anyway: a payment is settled by a webhook we did not
        // initiate, and a suspended app holds no socket to hear the broadcast on.
        .resyncOnForeground {
            Task { await model?.reloadRequests() }
        }
        // #607: and now it does not wait for the foreground either — the
        // database announces a payment the moment the card clears, and this is
        // where the strip hears it.
        //
        // ONE REFETCH OF THE LIST, not a patch of one row. The broadcast names
        // the request, but there is no route that reads a single one, and the
        // list is the shape this pane already renders — so the cheapest correct
        // move is the read it does on load. It also keeps the API the only
        // authority on what a row says: a payload-driven patch would have this
        // client writing "Paid" onto a row from a hint.
        //
        // `reloadRequests` ASSIGNS the fetched page, so the rows stay on screen
        // and change in place. Re-keying the `.task` above would have been the
        // shorter diff and the wrong one: it rebuilds the model, which empties
        // `requests`, so the strip would blank for the length of a round trip —
        // on the single event this whole change exists to make instant.
        .onChange(of: paymentChangedTick) { _, tick in
            // A tick of zero is a RESET, not an event: opening a different
            // thread builds a fresh controller whose counter starts at zero, and
            // that drop is a change like any other. The `.task` above has just
            // read this thread's list, so acting on it would be a second read of
            // what is already on screen.
            guard tick > 0 else { return }
            Task { await model?.reloadRequests() }
        }
        .sheet(isPresented: $asking) {
            if let model, let account = model.account {
                // Hoisted into a local with an explicit type rather than written
                // inline. A `@MainActor` function type is implicitly `@Sendable`
                // and an `async` closure literal needs its contextual type to
                // pick that up — the same trap ThreadView documents at length,
                // and one that only CI's iOS job can see.
                let send: @MainActor (Int, String, String) async -> String? = {
                    cents, description, key in
                    let refusal = await model.create(
                        amountCents: cents,
                        description: description,
                        idempotencyKey: key
                    )
                    // Only on a real send. A refusal added no message, and
                    // refetching the thread on every rejected amount would make
                    // a validation error look like something happening.
                    if refusal == nil { onSent() }
                    return refusal
                }
                AskForPaymentSheet(
                    businessName: businessName,
                    currency: account.payoutCurrency,
                    onSend: send,
                    onDismiss: { asking = false }
                )
            }
        }
    }

    /// The ask, present only when a tap on it would actually work.
    private func showsAsk(_ model: ThreadPaymentsModel) -> Bool {
        canAct && model.canCharge
    }

    private var askButton: some View {
        Button {
            asking = true
        } label: {
            HStack(spacing: 6) {
                Image(systemName: "dollarsign.circle")
                    .font(.scaled(13))
                Text(AppStrings.translate(appLocale, "payments.askAction"))
                    .font(.golos(12.5, weight: .semibold))
                Spacer(minLength: 0)
            }
            .foregroundStyle(BrandColor.muted600)
            .padding(.horizontal, 10)
            .padding(.vertical, 7)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }
}

// MARK: - State

/// One thread's payment state.
///
/// An observable object rather than `@State` on the view, because two surfaces
/// read it — the strip and the ask — and a send has to move both: the new
/// request appears on the strip, and the amount that was refused has to come
/// back with the server's own words rather than a generic failure.
@MainActor
@Observable
final class ThreadPaymentsModel {
    private let payments: PaymentsApi
    private let companyId: String
    private let conversationId: String
    private let role: String?

    private(set) var account: PayoutAccount?
    private(set) var requests: [PaymentRequest] = []
    /// The id being cancelled right now, so one row's spinner is that row's.
    private(set) var cancelling: String?

    init(
        payments: PaymentsApi,
        companyId: String,
        conversationId: String,
        role: String?
    ) {
        self.payments = payments
        self.companyId = companyId
        self.conversationId = conversationId
        self.role = role
    }

    /// Live, or settled in the last week. Newest first, which is the order the
    /// list route already returns.
    var visibleRequests: [PaymentRequest] {
        requests.filter { request in
            paymentRequestWorthShowing(
                state: request.resolvedState,
                createdAt: request.created_at,
                paidAt: request.paid_at
            )
        }
    }

    /// Can this workspace actually take a card right now?
    ///
    /// `charges_enabled` via the readiness, which is the field the server's own
    /// `assertCanCharge` keys on. Nil account — never read, or the read failed —
    /// is FALSE: offering the control and having the send be refused is worse
    /// than not offering it.
    var canCharge: Bool { account?.resolvedReadiness == .ready }

    func load() async {
        await reloadAccount()
        await reloadRequests()
    }

    /// The connected account, from the shared cache.
    ///
    /// Skipped entirely for a reader without `billing.manage`. The route is
    /// gated on that capability, so asking on a plain member's behalf is a
    /// guaranteed 403 on every thread they open — a wasted round trip, and a
    /// diagnostics log full of a refusal nobody can act on.
    ///
    /// THE CONSEQUENCE IS A REAL GAP AND IT IS NOT OURS TO CLOSE HERE: the tech
    /// in the driveway holds `conversations.send`, which is all the SEND route
    /// asks for, and yet cannot learn that payments are ready — so they never
    /// see the ask. Web has the same hole by the same route. The fix is on the
    /// API's readiness gate; a client that drew the control on a hunch would
    /// walk a tech into a refusal.
    private func reloadAccount() async {
        guard canReadPayoutAccount(role: role) else { return }
        account = try? await PayoutAccountCache.shared.account(
            companyId: companyId,
            using: payments
        )
    }

    /// The thread's requests.
    ///
    /// A failed read leaves the strip as it was and says nothing. This is a
    /// secondary surface on a screen whose job is the conversation, and an error
    /// banner about a payment list would push the messages down for a fetch
    /// nobody asked for. The next foreground return retries.
    func reloadRequests() async {
        guard let page = try? await payments.requests(
            companyId: companyId,
            conversationId: conversationId
        ) else { return }
        requests = page.payment_requests
    }

    /// Ask for the money. Returns the server's refusal, or nil on success.
    ///
    /// THE SERVER'S WORDS ARE RETURNED VERBATIM. A refusal here is usually a
    /// RULE — the customer opted out, the plan lapsed, Stripe is still verifying
    /// — and "couldn't send" would read as the button being broken rather than
    /// the rule working.
    func create(
        amountCents: Int,
        description: String,
        idempotencyKey: String
    ) async -> String? {
        do {
            let created = try await payments.createRequest(
                companyId: companyId,
                conversationId: conversationId,
                amountCents: amountCents,
                description: description,
                idempotencyKey: idempotencyKey
            )
            // Prepended rather than refetched: the row is already the server's
            // answer, and the strip must show it the instant the sheet closes.
            // A refetch still happens, because the SEND also added a message to
            // the thread and this is the cheapest moment to reconcile.
            requests.insert(created, at: 0)
            await reloadRequests()
            return nil
        } catch {
            return error.userMessage
        }
    }

    func cancel(_ request: PaymentRequest) {
        guard cancelling == nil else { return }
        cancelling = request.id
        Task {
            do {
                let updated = try await payments.cancelRequest(
                    companyId: companyId,
                    requestId: request.id
                )
                if let index = requests.firstIndex(where: { $0.id == updated.id }) {
                    requests[index] = updated
                }
            } catch {
                // The row stays exactly as it was, which is the honest picture:
                // the request is still live, because cancelling it failed.
                // Re-read so a 409 ("already paid") corrects the row rather than
                // leaving a Cancel on something that has been settled.
                await reloadRequests()
            }
            cancelling = nil
        }
    }
}

// MARK: - One row

/// Built for a glance: state, amount, what it was for — in that order, because
/// that is the order the questions get asked.
@MainActor
private struct PaymentStripRow: View {
    let request: PaymentRequest
    let canCancel: Bool
    let busy: Bool
    let onCancel: @MainActor () -> Void

    @Environment(\.appLocale) private var appLocale

    /// Three tones, because there are three things a reader has to do about a
    /// row: act on it, note it, or ignore it.
    private var needsAttention: Bool {
        request.resolvedState == .disputed || request.resolvedState == .refunded
    }

    private var isSettled: Bool { request.resolvedState == .paid }

    private var symbol: String {
        if isSettled { return "checkmark.seal" }
        if needsAttention { return "exclamationmark.triangle" }
        return "dollarsign.circle"
    }

    private var tint: Color {
        if isSettled { return BrandColor.olive }
        if needsAttention { return NoteAmber.ink }
        return BrandColor.muted500
    }

    /// State, amount, what it was for — in the order the questions get asked,
    /// and built as a `String` before it reaches `Text` so the compiler is never
    /// choosing between `LocalizedStringKey` and `StringProtocol` on a line
    /// nothing on this machine can compile.
    private var summary: String {
        "\(paymentRequestLabel(request.resolvedState)) · \(request.amountLabel)"
            + " — \(request.description)"
    }

    var body: some View {
        HStack(alignment: .top, spacing: 8) {
            Image(systemName: symbol)
                .font(.scaled(12))
                .foregroundStyle(tint)
                .padding(.top, 2)

            VStack(alignment: .leading, spacing: 2) {
                Text(summary)
                    .font(.golos(12))
                    .foregroundStyle(BrandColor.ink)
                    .lineLimit(2)

                if request.resolvedState == .refunded,
                   let refunded = request.amount_refunded_cents {
                    Text(
                        AppStrings.translate(
                            appLocale,
                            "payments.refundedBack",
                            [
                                "amount": formatMoneyIn(
                                    refunded,
                                    request.billingCurrency,
                                    audience: request.billingCurrency
                                ),
                            ]
                        )
                    )
                    .font(.golos(11))
                    .foregroundStyle(BrandColor.muted500)
                }

                if request.resolvedState == .disputed {
                    // Named rather than merely coloured. A chargeback is the one
                    // state on this strip with a deadline attached, and Stripe —
                    // not us — is the party that emailed the evidence request.
                    Text(AppStrings.translate(appLocale, "payments.disputedNote"))
                        .font(.golos(11))
                        .foregroundStyle(NoteAmber.ink)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)

            if canCancel {
                Button(action: onCancel) {
                    Image(systemName: "xmark")
                        .font(.scaled(12))
                        .foregroundStyle(BrandColor.muted500)
                }
                .buttonStyle(.plain)
                .disabled(busy)
                .opacity(busy ? 0.4 : 1)
                // Spelled out for VoiceOver, because a bare "xmark" beside four
                // similar rows names nothing. No ethical friction beyond this:
                // calling off an ask is reversible in the only sense that counts
                // — you can ask again — and the friction belongs on the ask,
                // which is what the customer actually receives.
                .accessibilityLabel(
                    AppStrings.translate(
                        appLocale,
                        "payments.cancelLabel",
                        [
                            "amount": request.amountLabel,
                            "description": request.description,
                        ]
                    )
                )
            }
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 8)
        .background(
            RoundedRectangle(cornerRadius: 10, style: .continuous)
                .fill(needsAttention ? NoteAmber.bg : BrandColor.paper)
                .overlay(
                    RoundedRectangle(cornerRadius: 10, style: .continuous)
                        .strokeBorder(
                            needsAttention ? NoteAmber.line : BrandColor.insetDeep,
                            lineWidth: 1
                        )
                )
        )
    }
}

// MARK: - The ask

/**
 "That'll be $250 for the deposit", asked in the thread.

 A sheet rather than an inline panel, because the composer on a phone is already
 the busiest sixty points on the screen and this is a whole act rather than a
 sixth way to change a draft.

 - **Never an empty form.** The description arrives pre-filled with "Deposit",
   which is the ask this feature exists for and the one most likely to be right.
   *Applying: Smart Defaults.*

 - **The preview IS the ethical friction.** Sending a bill to a customer is
   customer-visible and cannot be unsent, so the exact text that will arrive is
   shown before the button that sends it — not a summary of it, the message
   itself, composed by the same function the server composes it with. A confirm
   dialog would add a step without adding information; this adds the
   information. *Applying: Ethical Friction, at the only edge that has any.*

 - **The amount is in the account's own currency**, because that is what the
   business will actually receive.
 */
@MainActor
private struct AskForPaymentSheet: View {
    let businessName: String?
    let currency: BillingCurrency
    /// Returns the server's refusal, or nil on success.
    let onSend: @MainActor (Int, String, String) async -> String?
    let onDismiss: @MainActor () -> Void

    @Environment(\.appLocale) private var appLocale

    @State private var amountText = ""
    /// Smart Defaults: the ask this feature was built for, editable in one tap.
    ///
    /// #228: seeded in `.onAppear` rather than here, because `@State` cannot
    /// read the environment from an initialiser and the default is a SENTENCE
    /// now — "Acompte" for a French reader. A one-frame empty field costs
    /// nothing; a new required parameter on this sheet would have to be threaded
    /// through a construction site that only CI's `Gate / iOS` can compile.
    @State private var description = ""
    @State private var sending = false
    @State private var failure: String?
    /// One key per INTENT.
    ///
    /// Kept across a FAILED attempt, because that is what makes a retry after a
    /// lost response safe — the server keys the send on it and answers the
    /// second try with the first try's result rather than billing the customer
    /// twice. Minted afresh whenever the amount or the description changes,
    /// because that is a different intent: reusing the key there would return
    /// the earlier request and quietly ignore the figure just typed.
    @State private var idempotencyKey = UUID().uuidString

    // Every optional below is bound the long way — `guard let x = x` rather than
    // the shorthand — because these are COMPUTED properties rather than locals,
    // and nothing on the machine this was written on compiles Swift. The
    // shorthand is fine; being sure it is fine costs a CI round trip.
    private var cents: Int? { parsePaymentAmountToCents(amountText) }

    private var problem: PaymentAmountProblem? {
        guard let cents = cents else { return nil }
        return paymentAmountProblem(cents)
    }

    private var trimmedDescription: String {
        description.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    /// A workspace whose company view has not landed yet still gets a readable
    /// preview, rather than a text that begins with a colon.
    private var senderName: String {
        guard let businessName = businessName, !businessName.isBlank else {
            return AppStrings.translate(appLocale, "payments.yourBusiness")
        }
        return businessName
    }

    private var chargeable: Int? {
        guard let cents = cents, problem == nil, !trimmedDescription.isEmpty else {
            return nil
        }
        return cents
    }

    /// The message itself, not a description of it.
    private var preview: String? {
        guard let chargeable = chargeable else { return nil }
        return paymentRequestSms(
            businessName: senderName,
            amountCents: chargeable,
            currency: currency,
            description: trimmedDescription,
            url: paymentPreviewUrl
        )
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Text(AppStrings.translate(appLocale, "payments.askAction"))
                .font(.golos(17, weight: .semibold))
                .foregroundStyle(BrandColor.ink)

            ScrollView {
                VStack(alignment: .leading, spacing: 0) {
                    Text(AppStrings.translate(appLocale, "payments.amountLabel"))
                        .font(.golos(12, weight: .semibold))
                        .foregroundStyle(BrandColor.muted600)
                        .padding(.top, 14)
                    HStack(spacing: 8) {
                        // What they will actually receive, not a bare dollar
                        // sign: a Canadian account settles in CAD.
                        Text(currency == .cad ? "CA$" : "US$")
                            .font(.golos(14, weight: .semibold))
                            .foregroundStyle(BrandColor.muted600)
                        TextField("250.00", text: $amountText)
                            .textFieldStyle(.roundedBorder)
                            // The phone keyboard a number belongs on, and the
                            // one this is typed on nine times out of ten.
                            .keyboardType(.decimalPad)
                    }
                    .padding(.top, 4)

                    Text(AppStrings.translate(appLocale, "payments.descriptionLabel"))
                        .font(.golos(12, weight: .semibold))
                        .foregroundStyle(BrandColor.muted600)
                        .padding(.top, 14)
                    TextField(
                        AppStrings.translate(appLocale, "payments.deposit"),
                        text: $description
                    )
                        .textFieldStyle(.roundedBorder)
                        .padding(.top, 4)

                    if let problem = problem {
                        InlineError(
                            paymentAmountProblemCopy(problem, currency, appLocale)
                        )
                    }
                    if let preview = preview {
                        PreviewBubble(
                            label: AppStrings.translate(
                                appLocale, "payments.previewLabel"
                            ),
                            text: preview
                        )
                    }

                    InlineError(failure)

                    Text(AppStrings.translate(appLocale, "payments.goesOutAsText"))
                    .font(.golos(11.5))
                    .foregroundStyle(BrandColor.muted500)
                    .fixedSize(horizontal: false, vertical: true)
                    .padding(.top, 12)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            }

            HStack {
                Button(AppStrings.translate(appLocale, "common.cancel")) { onDismiss() }
                    .buttonStyle(.bordered)
                    .disabled(sending)
                Spacer()
                Button(sendLabel) { send() }
                    .buttonStyle(.borderedProminent)
                    .tint(BrandColor.olive)
                    .disabled(chargeable == nil || sending)
            }
            .padding(.top, 16)
        }
        .padding(20)
        .presentationDetents([.large])
        .presentationDragIndicator(.visible)
        // A send in flight must not be swiped away: the request would still go,
        // and the crew would be left unsure whether it had.
        .interactiveDismissDisabled(sending)
        // #228: the Smart Default, in the reader's language. Guarded on empty so
        // a re-appearance never overwrites what somebody has typed.
        .onAppear {
            if description.isEmpty {
                description = AppStrings.translate(
                    appLocale, "payments.deposit"
                )
            }
        }
        // A changed figure is a different ask. See `idempotencyKey`.
        .onChange(of: amountText) { _, _ in idempotencyKey = UUID().uuidString }
        .onChange(of: description) { _, next in
            // ONE handler for both jobs, deliberately: the clamp assigns back to
            // `description`, so a second `.onChange` on the same value would run
            // again on that assignment. Cheap here, and the shape that stops
            // being cheap the moment somebody adds work to either half.
            //
            // The column and the SMS both cap the description; refusing the
            // 201st keystroke is kinder than a server refusal after the whole
            // thing has been typed.
            if next.count > paymentDescriptionMax {
                description = String(next.prefix(paymentDescriptionMax))
            }
            idempotencyKey = UUID().uuidString
        }
    }

    /// The button says the amount, so the last thing read before the tap is the
    /// figure the customer will be charged.
    private var sendLabel: String {
        if sending { return AppStrings.translate(appLocale, "payments.sending") }
        guard let chargeable = chargeable else {
            return AppStrings.translate(appLocale, "payments.askAction")
        }
        return AppStrings.translate(
            appLocale,
            "payments.askFor",
            ["amount": formatMoneyIn(chargeable, currency, audience: currency)]
        )
    }

    private func send() {
        guard let chargeable = chargeable, !sending else { return }
        sending = true
        failure = nil
        Task {
            let refusal = await onSend(chargeable, trimmedDescription, idempotencyKey)
            if refusal == nil {
                onDismiss()
            } else {
                failure = refusal
            }
            sending = false
        }
    }
}
