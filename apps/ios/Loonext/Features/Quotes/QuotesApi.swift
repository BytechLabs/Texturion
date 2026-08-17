import Foundation

/// #287 — a quote is a thing, not a paragraph typed into a text.
///
/// The wire shapes and the four calls behind it, verified field-by-field
/// against `apps/api/src/routes/quotes.ts` and `apps/web/src/lib/api/quotes.ts`.
/// The KEY-MAPPING RULE holds here as everywhere: stored property names ARE the
/// wire names, snake_case, no `CodingKeys`.

// MARK: - The statuses

/// The six answers to "where is this quote", as the SQL CHECK spells them.
enum QuoteStatus {
    static let draft = "draft"
    static let sent = "sent"
    static let viewed = "viewed"
    static let accepted = "accepted"
    static let declined = "declined"
    static let expired = "expired"

    /// Catalogue keys, one per status. Named the same on all three clients.
    static let keys: [String: String] = [
        draft: "quotes.statusDraft",
        sent: "quotes.statusSent",
        viewed: "quotes.statusViewed",
        accepted: "quotes.statusAccepted",
        declined: "quotes.statusDeclined",
        expired: "quotes.statusExpired",
    ]
}

/// The one rule a client cannot take from the server: which status to SHOW.
///
/// ## Why it is derived here as well as there
///
/// Nothing ever writes `expired`. A quote whose deadline passed an hour ago
/// still says `sent` in the database, and any client rendering the stored column
/// shows a live offer on a price the business has already withdrawn — to the
/// crew member who then goes and chases it.
///
/// The server sends `effective_status` too, so this is not about trust. It is
/// about FRESHNESS: a row read at 4:59 and rendered at 5:01 carries a stale
/// derived string and a perfectly good `expires_at`. Timestamps survive a cache
/// round-trip; a derived string is only as fresh as the read that brought it.
/// Same reasoning as `PaymentRequest.resolvedState`, and the same answer.
///
/// Hand-ported from `packages/shared/src/quotes.ts`.
enum Quotes {
    /// A decision is final. Expiry cannot un-accept a quote somebody accepted,
    /// nor re-open one they declined — the deadline was for ANSWERING, and it
    /// has been answered.
    static func isDecided(_ status: String) -> Bool {
        status == QuoteStatus.accepted || status == QuoteStatus.declined
    }

    /// What to tell somebody, which is not always what the row says.
    ///
    /// `draft` never expires into anything: an unsent price is not an offer, so
    /// there is no deadline for a customer to miss. And an UNREADABLE date is
    /// not an expiry — reading it as one would silently withdraw a live offer on
    /// the strength of a bad string.
    static func effectiveStatus(
        status: String,
        expiresAt: String?,
        now: Date = Date()
    ) -> String {
        if isDecided(status) { return status }
        if status == QuoteStatus.draft { return QuoteStatus.draft }
        if status == QuoteStatus.expired { return QuoteStatus.expired }
        guard let expiry = isoDate(expiresAt) else { return status }
        return expiry <= now ? QuoteStatus.expired : status
    }

    /// Money asked for and not yet answered — the outstanding queue, and the
    /// highest-value list in the product: an unanswered quote is revenue nobody
    /// has chased.
    static func isOutstanding(
        status: String,
        expiresAt: String?,
        now: Date = Date()
    ) -> Bool {
        let shown = effectiveStatus(status: status, expiresAt: expiresAt, now: now)
        return shown == QuoteStatus.sent || shown == QuoteStatus.viewed
    }

    /// Nil rather than a throw: a bad string is a missing date, not a crash.
    ///
    /// Both formatters, because Postgres emits fractional seconds and not every
    /// timestamp on this wire carries them — accepting only one shape is how a
    /// date silently becomes "no deadline".
    static func isoDate(_ iso: String?) -> Date? {
        guard let iso, !iso.isEmpty else { return nil }
        let withFraction = ISO8601DateFormatter()
        withFraction.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let parsed = withFraction.date(from: iso) { return parsed }
        return ISO8601DateFormatter().date(from: iso)
    }
}

// MARK: - The wire

/// One quote, as it stands right now.
///
/// `effective_status` IS on the wire and is deliberately not what the UI reads —
/// see `Quotes`. `shownStatus` derives it from the timestamps instead.
struct Quote: Codable, Sendable, Identifiable {
    let id: String
    @Default<DefaultEmptyString> var conversation_id: String
    @Default<DefaultEmptyString> var contact_id: String
    @Default<DefaultZero> var amount_cents: Int
    /// The money THIS quote is in. A quote is denominated when it is written,
    /// and a workspace that later changes billing currency must not restate old
    /// prices.
    @Default<DefaultEmptyString> var currency: String
    @Default<DefaultEmptyString> var description: String
    @Default<DefaultEmptyString> var status: String
    var expires_at: String?
    var sent_at: String?
    var viewed_at: String?
    var decided_at: String?
    var created_at: String?

    func shownStatus(now: Date = Date()) -> String {
        Quotes.effectiveStatus(status: status, expiresAt: expires_at, now: now)
    }

    /// Falls back to USD for a value we do not bill in, the same fail-to-default
    /// the server's `billingCurrencyOf` makes.
    var billingCurrency: BillingCurrency {
        BillingCurrency(rawValue: currency.lowercased()) ?? .usd
    }

    /// The amount, through the money formatter rather than typed (#522).
    var amountLabel: String {
        formatMoneyIn(amount_cents, billingCurrency, audience: billingCurrency)
    }
}

struct QuotePage: Codable, Sendable {
    @Default<DefaultEmptyList<Quote>> var data: [Quote]
}

/// What `POST /v1/quotes/{id}/send` returns.
///
/// NO TOKENS. The server composes the text and dispatches it, so the accept
/// token is the customer's to receive once in a text they already have. It used
/// to return them for whoever composed the message, and no client ever did — the
/// quote read "Waiting" and the customer received nothing.
struct SentQuote: Codable, Sendable {
    let id: String
    /// The outbound message that carried it.
    var message_id: String?
}

struct QuotesApi: Sendable {
    let api: ApiClient

    func forConversation(
        companyId: String,
        conversationId: String
    ) async throws -> QuotePage {
        try await api.get(
            "/v1/quotes",
            query: ["conversation_id": conversationId],
            companyId: companyId
        )
    }

    /// Filtered SERVER-side, and that is load-bearing rather than tidy:
    /// "outstanding" folds in an expiry derived at read time, so a client
    /// filtering a full list would re-implement the rule — and the list is
    /// capped, so it would start silently dropping quotes on a busy workspace.
    func outstanding(companyId: String) async throws -> QuotePage {
        try await api.get(
            "/v1/quotes",
            query: ["status": "outstanding"],
            companyId: companyId
        )
    }

    func create(
        companyId: String,
        conversationId: String,
        amountCents: Int,
        description: String,
        expiresAt: String
    ) async throws -> Quote {
        try await api.post(
            "/v1/quotes",
            body: JSONValue.object([
                "conversation_id": .string(conversationId),
                // Cents, as an integer, named so. A float amount in dollars is
                // how a money feature ships a rounding bug that only shows up
                // on some amounts.
                "amount_cents": .number(Double(amountCents)),
                "description": .string(description),
                "expires_at": .string(expiresAt),
            ]),
            companyId: companyId
        )
    }

    /// POST /v1/quotes/:id/send — mint the tokens and text the customer.
    func send(companyId: String, quoteId: String) async throws -> SentQuote {
        try await api.post("/v1/quotes/\(quoteId)/send", companyId: companyId)
    }
}
