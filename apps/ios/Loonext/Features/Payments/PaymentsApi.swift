import Foundation

/// #224 — the wire models and the six calls behind text-to-pay.
///
/// Shapes verified field-by-field against `apps/api/src/routes/payments.ts` and
/// `apps/web/src/lib/api/payments.ts`. The KEY-MAPPING RULE of Core/Model holds
/// here too: stored property names ARE the wire names, snake_case, no
/// `CodingKeys` — which is what makes that field-by-field check possible at all.

// MARK: - The connected account

/// GET /v1/payments/account.
///
/// `title`, `detail` and `action` are composed BY THE SERVER and rendered
/// verbatim on all three clients. That is the whole reason they are on the wire
/// rather than in each client's copy deck: five states times three clients is
/// fifteen chances to paraphrase, and the one that paraphrases badly is the one
/// telling an owner why they cannot take a card.
struct PayoutAccount: Codable, Sendable {
    @Default<DefaultFalse> var connected: Bool
    /// The server's word for the readiness. Read through `resolvedReadiness`,
    /// never directly — see there.
    @Default<DefaultEmptyString> var readiness: String
    @Default<DefaultEmptyString> var title: String
    @Default<DefaultEmptyString> var detail: String
    /// #228 — the key travels beside the sentence, and the key wins.
    ///
    /// The server picks WHICH of the five states is true; the reader's own
    /// language decides the words. It cannot decide them itself —
    /// `profiles.locale`'s null means "ask the device", and only this client
    /// knows what the device says.
    ///
    /// The sentence is the fallback for a Worker that predates the keys, which
    /// is the expand half of an expand-and-contract rather than defensive
    /// padding. Both shapes are on the wire at once, on purpose.
    var title_key: String?
    var detail_key: String?
    /// Nil for `pending_verification`, which is the one state with nothing to do.
    var action: String?
    /// Null both when the state has nothing to press and when the Worker is old.
    var action_key: String?
    var country: String?
    /// Stripe's `default_currency` for the account — what the business is
    /// actually paid in, which is not necessarily what WE bill them in.
    var currency: String?
    @Default<DefaultFalse> var charges_enabled: Bool
    @Default<DefaultFalse> var payouts_enabled: Bool
    @Default<DefaultFalse> var details_submitted: Bool
    var disabled_reason: String?
    @Default<DefaultEmptyList<String>> var requirements_due: [String]
    var requirements_deadline: String?

    /// Explicit rather than memberwise, so a preview or a test can build one
    /// from the two fields it cares about. A `@Default`-wrapped property has no
    /// default in the synthesised initialiser, so every construction site would
    /// otherwise have to name all thirteen — and this file cannot be compiled on
    /// the box it was written on.
    init(
        connected: Bool = false,
        readiness: String = PayoutReadiness.notConnected.rawValue,
        title: String = "",
        detail: String = "",
        action: String? = nil,
        country: String? = nil,
        currency: String? = nil,
        charges_enabled: Bool = false,
        payouts_enabled: Bool = false,
        details_submitted: Bool = false,
        disabled_reason: String? = nil,
        requirements_due: [String] = [],
        requirements_deadline: String? = nil
    ) {
        self.connected = connected
        self.readiness = readiness
        self.title = title
        self.detail = detail
        self.action = action
        self.country = country
        self.currency = currency
        self.charges_enabled = charges_enabled
        self.payouts_enabled = payouts_enabled
        self.details_submitted = details_submitted
        self.disabled_reason = disabled_reason
        self.requirements_due = requirements_due
        self.requirements_deadline = requirements_deadline
    }

    var facts: PayoutAccountFacts {
        PayoutAccountFacts(
            connected: connected,
            chargesEnabled: charges_enabled,
            detailsSubmitted: details_submitted,
            disabledReason: disabled_reason
        )
    }

    /// Which of the five states this account is in.
    ///
    /// THE SERVER'S WORD WINS, and the ported derivation is the fallback for a
    /// value this build has never heard of. That is not belt-and-braces: Stripe
    /// gains account states, the API gains readiness values with it, and the
    /// phones ship on their own cadence behind an App Store review. An
    /// unrecognised string decoded to nil and treated as "not ready" would be
    /// tolerable; decoded to nil and treated as ready would offer a crew a
    /// control the server then refuses. Deriving from `charges_enabled` — the
    /// field the server's own `assertCanCharge` keys on — answers correctly for
    /// a state that did not exist when this build shipped.
    var resolvedReadiness: PayoutReadiness {
        PayoutReadiness(rawValue: readiness) ?? payoutReadiness(facts)
    }

    /// What this business is PAID in, which decides how the amount is written.
    ///
    /// Falls back to USD for an absent or unrecognised value, matching
    /// `billingCurrencyOf` on the server. It must never refuse to render a
    /// figure because a field was missing from an older response.
    var payoutCurrency: BillingCurrency {
        // Bound the long way rather than with the shorthand: `currency` is a
        // stored property read through `self`, and nothing on the machine this
        // was written on compiles Swift.
        guard let currency = currency else { return .usd }
        return BillingCurrency(
            rawValue: currency.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        ) ?? .usd
    }
}

/// POST /v1/payments/account/onboarding — the hosted flow, one link per tap.
///
/// The refreshed account rides back with the URL so a screen that has just
/// created the Stripe account does not have to re-read it to stop saying "not
/// set up yet" while the browser is opening.
struct PayoutOnboarding: Codable, Sendable {
    let url: String
    var account: PayoutAccount?
}

// MARK: - One request

/// A row of `payment_requests`, as GET/POST return it.
struct PaymentRequest: Codable, Sendable, Identifiable {
    let id: String
    let conversation_id: String
    let contact_id: String
    /// Nil for the instant between the row existing and the text going out.
    var message_id: String?
    let amount_cents: Int
    /// "usd" | "cad" — the CONNECTED account's currency, not the workspace's
    /// billing currency. A Canadian business settles in CAD whatever we invoice
    /// them in.
    let currency: String
    let description: String
    /// The stored status: requested | paid | cancelled | expired.
    let status: String
    /// The server's six-state answer. Read through `resolvedState`.
    @Default<DefaultEmptyString> var state: String
    var paid_at: String?
    var refunded_at: String?
    var amount_refunded_cents: Int?
    var disputed_at: String?
    var cancelled_at: String?
    @Default<DefaultEmptyString> var expires_at: String
    @Default<DefaultEmptyString> var created_at: String
    var created_by: String?

    var facts: PaymentRequestFacts {
        PaymentRequestFacts(
            status: status,
            paidAt: paid_at,
            refundedAt: refunded_at,
            disputedAt: disputed_at
        )
    }

    /// The state this row is really in.
    ///
    /// Same rule as `PayoutAccount.resolvedReadiness`, and it earns its keep for
    /// a second reason here: `paymentRequestState` reads four fields this row
    /// already carries, so a client rendering from its own cache after the
    /// server has moved on still says the right word. The server's answer is
    /// preferred because it is the one the customer's payment page agrees with.
    var resolvedState: PaymentRequestState {
        PaymentRequestState(rawValue: state) ?? paymentRequestState(facts)
    }

    /// What this amount is written in. USD for an unrecognised value, matching
    /// the server — never a refusal to draw the row.
    var billingCurrency: BillingCurrency {
        BillingCurrency(rawValue: currency.lowercased()) ?? .usd
    }

    /// The amount, through the money formatter rather than typed (#522).
    var amountLabel: String {
        formatMoneyIn(amount_cents, billingCurrency, audience: billingCurrency)
    }
}

/// GET /v1/conversations/:id/payment-requests.
struct PaymentRequestPage: Codable, Sendable {
    let payment_requests: [PaymentRequest]
}

// MARK: - The calls

/// The six /v1 calls behind text-to-pay.
///
/// A repository of its own rather than methods on `SettingsRepository` and
/// `MessagingRepository`, because the capability spans both and splitting it
/// across two would mean the account read and the request send could drift apart
/// — which is exactly the shape of the bug the shared file above exists to stop.
struct PaymentsApi: Sendable {
    let api: ApiClient

    /// GET /v1/payments/account — refreshed from Stripe on the server.
    ///
    /// BEHIND `billing.manage` SERVER-SIDE. Callers must check the capability
    /// before asking — `canReadPayoutAccount` below is the one place that
    /// question is asked, and its comment records why the answer costs the tech
    /// in the driveway the ask entirely.
    func account(companyId: String) async throws -> PayoutAccount {
        try await api.get("/v1/payments/account", companyId: companyId)
    }

    /// POST /v1/payments/account/onboarding — start or resume setting up.
    /// Owner-only server-side; it binds a legal entity and a bank account.
    func startOnboarding(companyId: String) async throws -> PayoutOnboarding {
        try await api.post("/v1/payments/account/onboarding", companyId: companyId)
    }

    /// GET /v1/payments/account/dashboard — a login link to their own Stripe.
    ///
    /// THE REFUND PATH, and deliberately the only one: we do not build a thin
    /// copy of a back office that already exists and stays compliant (see
    /// docs/TEXT-TO-PAY.md). Opened in the REAL browser like every other hosted
    /// Stripe page — App Store rules treat a webview around one as a violation.
    func dashboardLink(companyId: String) async throws -> HostedUrl {
        try await api.get("/v1/payments/account/dashboard", companyId: companyId)
    }

    func requests(companyId: String, conversationId: String) async throws -> PaymentRequestPage {
        try await api.get(
            "/v1/conversations/\(conversationId)/payment-requests",
            companyId: companyId
        )
    }

    /// POST /v1/conversations/:id/payment-requests — ask, and send.
    ///
    /// THE KEY IS REQUIRED, and it is the same contract every other send path
    /// carries: the route refuses a request without an `Idempotency-Key`, and
    /// that header is what makes a retry after a lost response safe. Callers
    /// mint one per INTENT and reuse it across retries of that intent — a fresh
    /// key on a retry would send the customer a second bill.
    func createRequest(
        companyId: String,
        conversationId: String,
        amountCents: Int,
        description: String,
        idempotencyKey: String
    ) async throws -> PaymentRequest {
        try await api.post(
            "/v1/conversations/\(conversationId)/payment-requests",
            body: JSONValue.object([
                // Cents, as an integer, named so. A float amount in dollars is
                // how a payment feature ships a rounding bug that only shows up
                // on some amounts.
                "amount_cents": .number(Double(amountCents)),
                "description": .string(description),
            ]),
            companyId: companyId,
            idempotencyKey: idempotencyKey
        )
    }

    /// POST /v1/payment-requests/:id/cancel.
    ///
    /// Not a DELETE: the request happened, the customer received a text about
    /// it, and erasing the record would leave the crew unable to explain a text
    /// the customer still has on their phone.
    func cancelRequest(companyId: String, requestId: String) async throws -> PaymentRequest {
        try await api.post("/v1/payment-requests/\(requestId)/cancel", companyId: companyId)
    }
}

// MARK: - Not asking Stripe once per thread

/// May this reader ask for the connected account at all?
///
/// EITHER capability, matching `requireAnyCapability` on the route. Asked BEFORE
/// the call rather than after it, because the alternative is a guaranteed 403 on
/// every thread open — a wasted round trip and a diagnostics log full of a
/// refusal nobody can act on.
///
/// The two reasons are genuinely different people. `billing.manage` is the
/// bookkeeper opening the settings screen and needing everything on it.
/// `conversations.send` is the tech in the driveway, whose composer needs one
/// fact: may an "Ask for payment" control appear at all. The server sends that
/// reader a NARROWER object — no outstanding requirements, no disabled reason,
/// no action — because those are statements about the owner's identity documents
/// and the business's standing with a payment processor, and a tech needs
/// neither to send a bill.
///
/// This gate was `billing.manage` alone for one revision, and it made the whole
/// feature invisible to the role it was written for: a member holds send and not
/// billing, so the readiness read 403'd and the ask never drew. On every thread,
/// permanently. Recorded here because the shape recurs — a control's VISIBILITY
/// gate must never be tighter than the action behind it.
///
/// A free function rather than a `static` on the actor below, so there is no
/// question about isolation at the call sites — it reads a constant table and
/// needs no `await`.
func canReadPayoutAccount(role: String?) -> Bool {
    MemberRole.has(role, Capability.billingManage)
        || MemberRole.has(role, Capability.conversationsSend)
}

/// The connected account, cached for the session with a short life.
///
/// WHY A CACHE AT ALL. `GET /v1/payments/account` refreshes from Stripe on every
/// read — the API says so, and accepts the cost because it is "one API call on a
/// rare screen". On a phone it stopped being a rare screen the moment the thread
/// had to know whether to draw the ask: a crew working through an inbox opens
/// thirty threads in a morning, and thirty Stripe round trips to answer a
/// question whose answer changes about once per business is a cost nobody
/// decided to pay. Web gets the same saving free from react-query's cache; this
/// is that idea with the same short life.
///
/// FIVE MINUTES, and the number is bounded on both sides. Long enough that a
/// morning's threads share one answer; short enough that a change made somewhere
/// this app cannot see — another device, or Stripe restricting the account —
/// reaches the thread inside a coffee break. The one change made HERE, an owner
/// starting Stripe onboarding, does not wait for it at all: that screen calls
/// `invalidate` on the way out.
actor PayoutAccountCache {
    static let shared = PayoutAccountCache()

    /// How long a read stays good.
    static let ttl: TimeInterval = 300

    /// A named struct rather than a tuple. A tuple cannot be declared Sendable,
    /// and this box only ever lives inside the actor — but the type that cannot
    /// state its own concurrency contract is the one that becomes a compile
    /// error the day somebody hands it out, and iOS compiles only in CI.
    private struct CachedAccount {
        let account: PayoutAccount
        let readAt: Date
    }

    private var entries: [String: CachedAccount] = [:]
    /// Single-flight, keyed per workspace: two threads opening at once must not
    /// become two Stripe reads. The same shape `ApiClient.refreshNow` uses for
    /// token refresh, for the same reason.
    private var inFlight: [String: Task<PayoutAccount, Error>] = [:]

    /// The account, from cache when it is fresh enough.
    func account(
        companyId: String,
        using payments: PaymentsApi,
        force: Bool = false
    ) async throws -> PayoutAccount {
        if !force,
           let entry = entries[companyId],
           Date().timeIntervalSince(entry.readAt) < Self.ttl {
            return entry.account
        }
        if let running = inFlight[companyId] {
            return try await running.value
        }
        let task = Task { try await payments.account(companyId: companyId) }
        inFlight[companyId] = task
        defer { inFlight[companyId] = nil }
        let account = try await task.value
        entries[companyId] = CachedAccount(account: account, readAt: Date())
        return account
    }

    /// Drop what we hold, after something that changes the answer.
    ///
    /// Called when Stripe onboarding is started, because that call can CREATE
    /// the account — so every thread's five-minute-old "not connected" is wrong
    /// the instant it returns.
    func invalidate(companyId: String) {
        entries[companyId] = nil
    }
}
