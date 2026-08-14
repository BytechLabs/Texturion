import Foundation

/// #224 / D133 — text-to-pay, the parts this phone has to agree with the other
/// three surfaces about.
///
/// A hand-port of `packages/shared/src/payments.ts`, mirrored again in Kotlin.
/// Held to the SAME cases the TypeScript produces: `packages/shared/vectors/payments.json`
/// is generated from that file and asserted here by `PaymentsLogicTests`, so a
/// rule that moves on one side and not the other is a failing build rather than
/// a wrong number on somebody's screen.
///
/// ## The one modelling decision worth reading
///
/// The stored `status` has four values and the thread shows six states. That is
/// deliberate: a REFUND and a DISPUTE happen to a request that is, and stays,
/// PAID — money changed hands and then moved back — so folding them into
/// `status` would destroy the fact the crew most needs. They are timestamps
/// beside the status, and the six-state answer is DERIVED.
///
/// ## What is deliberately NOT ported
///
/// The account's title, detail and action sentences. The server composes those
/// and every client renders them verbatim, which is what stops three clients
/// paraphrasing one sentence until one of them says nothing at all. The
/// `payoutReadiness` DERIVATION is ported, because which of five states an
/// account is in decides whether a control appears at all, and that answer has
/// to survive a response this build has never seen (see `PayoutAccount`).

// MARK: - The six states

/// What the thread actually shows. Derived — never stored.
enum PaymentRequestState: String, Sendable, CaseIterable {
    case requested
    case paid
    case refunded
    case disputed
    case cancelled
    case expired
}

/// The fields the derivation needs. Every client's row is a superset, so this
/// is a struct of the four rather than a protocol over the wire model — a test
/// vector has no message id and no expiry, and should not have to invent them.
struct PaymentRequestFacts: Sendable {
    /// The stored status, mirroring the SQL CHECK: requested|paid|cancelled|expired.
    let status: String
    var paidAt: String?
    var refundedAt: String?
    var disputedAt: String?

    init(
        status: String,
        paidAt: String? = nil,
        refundedAt: String? = nil,
        disputedAt: String? = nil
    ) {
        self.status = status
        self.paidAt = paidAt
        self.refundedAt = refundedAt
        self.disputedAt = disputedAt
    }
}

/// The six-state answer, in the order that matters.
///
/// ORDER IS THE DESIGN, and both of the interesting cases are ones a
/// reimplementation gets wrong by writing the obvious switch:
///
/// A disputed payment that was ALSO refunded reads as DISPUTED, because a
/// chargeback is the thing somebody has to act on and a refund is not.
///
/// A cancelled request that was paid anyway reads as PAID, because the money is
/// real, and telling a crew otherwise is how a customer gets chased for a bill
/// they have already settled.
///
/// A non-empty timestamp is the test, not merely a non-nil one: the wire sends
/// `null` for an absent instant, but a client cache that round-tripped one
/// through an empty string must not be read as "this was disputed".
func paymentRequestState(_ row: PaymentRequestFacts) -> PaymentRequestState {
    if isStamped(row.disputedAt) { return .disputed }
    if isStamped(row.refundedAt) { return .refunded }
    if isStamped(row.paidAt) || row.status == "paid" { return .paid }
    if row.status == "cancelled" { return .cancelled }
    if row.status == "expired" { return .expired }
    return .requested
}

/// Uniquely named rather than a generic `isPresent`: a `private` top-level
/// function still occupies the module's namespace, so a second helper with a
/// common name somewhere else in Features/ is an "invalid redeclaration" that
/// only CI's iOS job can see.
private func isStamped(_ instant: String?) -> Bool {
    guard let instant = instant else { return false }
    return !instant.isEmpty
}

/// One word for the state, as the crew reads it in the thread.
func paymentRequestLabel(_ state: PaymentRequestState) -> String {
    switch state {
    case .requested: "Waiting"
    case .paid: "Paid"
    case .refunded: "Refunded"
    case .disputed: "Disputed"
    case .cancelled: "Cancelled"
    case .expired: "Expired"
    }
}

/// Whether this request can still be cancelled.
///
/// Paid is excluded for the obvious reason and expired for a less obvious one:
/// an expired request is already dead, and offering a Cancel on it invites a tap
/// that does nothing, which reads as a broken button rather than a settled state.
func paymentRequestCancellable(_ row: PaymentRequestFacts) -> Bool {
    paymentRequestState(row) == .requested
}

// MARK: - What may be charged

/// The floor, in cents.
///
/// Not arbitrary: Stripe refuses a charge under 50 cents in both USD and CAD,
/// and a request that mints a link the customer cannot pay is worse than a
/// refusal at the keyboard.
let paymentMinCents = 100

/// The ceiling, in cents — $25,000.
///
/// A cap exists because a typo on a phone keypad is a real event and "$450"
/// becoming "$45000" is one missed decimal. It sits well above any residential
/// trade job and below the point where a mistyped figure is plausible, which is
/// the only job a cap of this kind can do.
let paymentMaxCents = 2_500_000

/// The description ceiling — it rides in an SMS and on a card statement.
let paymentDescriptionMax = 200

/// Why an amount cannot be charged, or nil when it is fine.
///
/// `notWhole` is unreachable through this signature and is kept anyway, because
/// it is reachable through `parsePaymentAmountToCents` — somebody typing
/// "12.345" is the case it names, and the copy for it has to exist somewhere.
/// The TypeScript takes a `number` and can be handed 1000.5; Swift's `Int`
/// cannot be, which is why the vector test asserts that case against the parser
/// instead of pretending the branch is dead.
enum PaymentAmountProblem: String, Sendable {
    case tooSmall = "too_small"
    case tooLarge = "too_large"
    case notWhole = "not_whole"
}

/// Is this a chargeable amount?
///
/// Asked on the client as well as the server because the phone keypad needs the
/// answer BEFORE the request is sent — a validation that only exists on the
/// server is one the crew meets as a red toast after typing everything twice.
func paymentAmountProblem(_ cents: Int) -> PaymentAmountProblem? {
    if cents < paymentMinCents { return .tooSmall }
    if cents > paymentMaxCents { return .tooLarge }
    return nil
}

/// The sentence a crew member reads when the amount is refused.
///
/// The two bounds are rendered through the money formatter rather than typed,
/// which is the #522 rule: a typed "$25,000" is a figure in a currency nobody
/// chose, and a Canadian account settles in CAD.
/// #228: the bound is interpolated into the sentence in BOTH languages, and
/// `locale` is last and defaulted so `PaymentsLogicTests` keeps reading the
/// English it holds against Android and web.
func paymentAmountProblemCopy(
    _ problem: PaymentAmountProblem,
    _ currency: BillingCurrency,
    _ locale: String? = nil
) -> String {
    switch problem {
    case .tooSmall:
        return AppStrings.translate(
            locale,
            "payments.amountTooSmall",
            ["amount": formatMoneyIn(paymentMinCents, currency, audience: currency)]
        )
    case .tooLarge:
        return AppStrings.translate(
            locale,
            "payments.amountTooLarge",
            ["amount": formatMoneyIn(paymentMaxCents, currency, audience: currency)]
        )
    case .notWhole:
        return AppStrings.translate(locale, "payments.amountNotWhole")
    }
}

/// "250", "250.50", "$1,250.5" → cents. Anything else → nil.
///
/// CENTS AS AN INTEGER, ALL THE WAY THROUGH. `Double(cleaned) * 100` is the
/// obvious spelling and it is wrong: 19.99 as a binary double is 19.989999…, so
/// multiplying and rounding is a coin flip nobody should be taking with
/// somebody else's bill. The whole part and the fraction are parsed separately
/// and combined with integer arithmetic, which cannot round at all.
///
/// Deliberately strict about the SHAPE and forgiving about decoration: a person
/// typing on a phone adds a dollar sign or a comma without thinking, and
/// refusing that would be pedantry. What is refused is anything that is not a
/// number — a silently misread amount is the one error this feature cannot
/// afford.
///
/// Mirrors `parseAmountToCents` in apps/web/src/components/thread/ask-for-payment.tsx.
func parsePaymentAmountToCents(_ input: String) -> Int? {
    let cleaned = input.filter { character in
        character != "$" && character != "," && !character.isWhitespace
    }
    if cleaned.isEmpty { return nil }
    // Anchored, so "12abc" is refused rather than partially matched. Built per
    // call rather than hoisted to a constant: an `NSRegularExpression` global is
    // not Sendable under Swift 6 strict concurrency, which is the same reason
    // SettingsLogic builds its patterns inline.
    guard cleaned.range(
        of: "^[0-9]+(\\.[0-9]{0,2})?$",
        options: .regularExpression
    ) != nil else { return nil }

    let parts = cleaned.split(separator: ".", omittingEmptySubsequences: false)
    guard let whole = Int(parts[0]) else { return nil }
    var fraction = parts.count > 1 ? String(parts[1]) : ""
    // "250.5" is two hundred and fifty dollars FIFTY, not five cents, and "250."
    // is a real keystroke on the way to typing cents. Padding to two digits
    // rather than parsing-then-scaling keeps that reading explicit; the regex
    // above has already capped the fraction at two digits, so this only ever
    // adds.
    while fraction.count < 2 { fraction += "0" }
    guard let cents = Int(fraction) else { return nil }
    // A keypad cannot reach this, but a paste can. `multipliedReportingOverflow`
    // rather than `*`: an overflow is a crash in Swift, and the honest answer to
    // an unreadable amount is nil.
    let (dollars, overflowed) = whole.multipliedReportingOverflow(by: 100)
    if overflowed { return nil }
    let (total, addOverflowed) = dollars.addingReportingOverflow(cents)
    if addOverflowed { return nil }
    return total
}

// MARK: - The text the customer receives

/// The SMS, composed exactly as the server composes it.
///
/// This is what makes the composer's preview the message that actually goes out
/// rather than an approximation of it. The shape is fixed and short for three
/// reasons that are all the same reason — this is an SMS somebody reads on a
/// lock screen:
///
///   THE BUSINESS NAME IS FIRST. A payment link from an unnamed sender is a
///   phishing text, and the customer is right to think so.
///   THE AMOUNT IS SECOND. Nobody should have to open a link to find out what
///   they are being asked for.
///   THE LINK IS LAST, on its own line, so every phone linkifies the whole of it.
///
/// No "click here", no urgency, no shortened domain: all three are what a
/// carrier's spam filter and a homeowner's instinct are both looking for.
func paymentRequestSms(
    businessName: String,
    amountCents: Int,
    currency: BillingCurrency,
    description: String,
    url: String
) -> String {
    let amount = formatMoneyIn(amountCents, currency, audience: currency)
    let trimmedName = businessName.trimmingCharacters(in: .whitespacesAndNewlines)
    let trimmedDescription = description.trimmingCharacters(in: .whitespacesAndNewlines)
    return "\(trimmedName): \(amount) for \(trimmedDescription).\n"
        + "Pay securely here:\n\(url)"
}

/// What the composer's preview puts where the real link will go.
///
/// A STAND-IN OF THE SAME SHAPE, not an empty space and not the real URL — the
/// token does not exist until the server mints one. It is the same length as a
/// live link, so the preview does not quietly under-state how long the text is
/// on a feature that bills by segment.
let paymentPreviewUrl = "https://app.loonext.com/pay/…"

// MARK: - Whether a workspace can take money at all

/// Why a workspace cannot send a payment request yet.
///
/// "Not ready" is not one state, it is five, and each one has a different next
/// action — which is the issue's first acceptance criterion.
enum PayoutReadiness: String, Sendable, CaseIterable {
    case notConnected = "not_connected"
    case onboardingIncomplete = "onboarding_incomplete"
    case pendingVerification = "pending_verification"
    case restricted
    case ready
}

/// The facts the derivation reads. Nil means "no account at all".
struct PayoutAccountFacts: Sendable {
    let connected: Bool
    let chargesEnabled: Bool
    let detailsSubmitted: Bool
    /// `= nil` so the memberwise initialiser carries a default — a caller
    /// describing an account that Stripe has NOT restricted should not have to
    /// say so, and most of them are.
    var disabledReason: String? = nil
}

/// The readiness answer, derived from Stripe's mirror.
///
/// `chargesEnabled` is the only field that decides whether a send may happen —
/// it is what the server's own `assertCanCharge` keys on. The others exist to
/// say WHY it is false, and the order below is the order a business moves
/// through them.
func payoutReadiness(_ account: PayoutAccountFacts?) -> PayoutReadiness {
    guard let account = account, account.connected else { return .notConnected }
    if account.chargesEnabled { return .ready }
    if isStamped(account.disabledReason) { return .restricted }
    if !account.detailsSubmitted { return .onboardingIncomplete }
    return .pendingVerification
}

/// A Stripe requirement identifier, in plain words.
///
/// Stripe returns things like `individual.verification.document` and
/// `external_account`. Showing those to a plumber is showing them a stack trace.
///
/// AN UNKNOWN IDENTIFIER FALLS BACK TO A READABLE VERSION OF ITSELF rather than
/// being dropped. Stripe adds requirement keys without telling anybody, and an
/// outstanding requirement nobody can see is the state where an owner concludes
/// the product is broken — so an ugly sentence beats a silent one.
///
/// The prefix strip is spelled out rather than written as `^(individual|company|
/// representative)\.`, because a regex here would be a third place this rule is
/// written and the operation is a `hasPrefix` in every language that has one.
func payoutRequirementCopy(_ requirement: String, _ locale: String? = nil) -> String {
    if let known = payoutRequirementKeys[requirement] {
        return AppStrings.translate(locale, known)
    }
    var cleaned = requirement
    for prefix in ["individual.", "company.", "representative."] where cleaned.hasPrefix(prefix) {
        cleaned = String(cleaned.dropFirst(prefix.count))
        break
    }
    let spaced = String(cleaned.map { ($0 == "." || $0 == "_") ? " " : $0 })
        .trimmingCharacters(in: .whitespacesAndNewlines)
    guard let first = spaced.first else { return spaced }
    return String(first).uppercased() + String(spaced.dropFirst())
}

/// The identifiers we have seen, each pointing at the sentence an owner reads.
///
/// Kept beside the function rather than inside it so the port can be compared
/// against the TypeScript table line by line — the failure mode is one entry
/// quietly missing, which reads as correct because the fallback still produces
/// a sentence.
///
/// #228: the values are CATALOGUE KEYS now rather than English, and the key
/// names are Android's `payments.req…` set verbatim. Stripe's own identifiers
/// stay untranslated on the left, because that is what Stripe sends.
private let payoutRequirementKeys: [String: String] = [
    "external_account": "payments.reqBankAccount",
    "business_profile.url": "payments.reqWebsite",
    "business_profile.mcc": "payments.reqWorkKind",
    "individual.verification.document": "payments.reqOwnerId",
    "individual.verification.additional_document": "payments.reqOwnerIdSecond",
    "individual.id_number": "payments.reqOwnerSin",
    "individual.address.line1": "payments.reqOwnerAddress",
    "individual.dob.day": "payments.reqOwnerDob",
    "company.tax_id": "payments.reqBusinessNumber",
    "company.verification.document": "payments.reqBusinessDocument",
    "tos_acceptance.date": "payments.reqTos",
    "representative.verification.document": "payments.reqSignatoryId",
]

// MARK: - What the thread strip shows

/// How long a settled request stays on the strip.
///
/// The week is the window in which somebody is still talking about that money.
/// After it, the request is history and the timeline holds it.
let paymentStripWindowSeconds: TimeInterval = 7 * 24 * 60 * 60

/// Live, or settled within the last week.
///
/// An UNPARSEABLE settled-at hides the row, and that is the correct failure
/// rather than a shrug: a `requested` row has already returned true above, so
/// anything reaching the date arithmetic is paid, cancelled or expired — and the
/// whole job of this filter is to stop settled rows piling up above the composer
/// forever. Showing one we cannot date would do exactly that, permanently.
///
/// Mirrors `isWorthShowing` in apps/web/src/components/thread/payment-strip.tsx.
func paymentRequestWorthShowing(
    state: PaymentRequestState,
    createdAt: String,
    paidAt: String?,
    now: Date = Date()
) -> Bool {
    if state == .requested { return true }
    let settledAt = isStamped(paidAt) ? paidAt : createdAt
    guard let settled = parseWireTimestamp(settledAt) else { return false }
    return now.timeIntervalSince(settled) < paymentStripWindowSeconds
}
