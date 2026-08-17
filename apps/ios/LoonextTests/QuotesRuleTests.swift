import XCTest
@testable import Loonext

/// #287 — the derived quote status, on the third client.
///
/// ## Why the rule is ported at all
///
/// Nothing ever writes `expired`. A quote whose deadline passed an hour ago
/// still says `sent` in the database, so a client rendering the stored column
/// shows a live offer on a price the business has already withdrawn — to the
/// crew member who then goes and chases it.
///
/// The server sends `effective_status` too, so this is not about trust. It is
/// about FRESHNESS: a row read at 4:59 and rendered at 5:01 carries a stale
/// derived string and a perfectly good `expires_at`. Timestamps survive a cache
/// round-trip; a derived string is only as fresh as the read that brought it.
///
/// These mirror `QuotesRuleTest.kt` case for case, because the two ports are the
/// same rule and a difference between them is the bug worth catching.
final class QuotesRuleTests: XCTestCase {

    private let now = Date(timeIntervalSince1970: 1_770_000_000)
    private var past: String { iso(now.addingTimeInterval(-3600)) }
    private var future: String { iso(now.addingTimeInterval(3600)) }

    private func iso(_ date: Date) -> String {
        ISO8601DateFormatter().string(from: date)
    }

    func testASentQuotePastItsDeadlineReadsAsExpired() {
        XCTAssertEqual(
            Quotes.effectiveStatus(status: QuoteStatus.sent, expiresAt: past, now: now),
            QuoteStatus.expired
        )
        XCTAssertEqual(
            Quotes.effectiveStatus(status: QuoteStatus.sent, expiresAt: future, now: now),
            QuoteStatus.sent
        )
    }

    func testADecisionIsFinalAndADeadlineCannotUndoIt() {
        // The branch that matters most. Expiry must not un-accept a quote
        // somebody accepted, nor re-open one they declined — the deadline was
        // for ANSWERING, and it has been answered.
        XCTAssertEqual(
            Quotes.effectiveStatus(status: QuoteStatus.accepted, expiresAt: past, now: now),
            QuoteStatus.accepted
        )
        XCTAssertEqual(
            Quotes.effectiveStatus(status: QuoteStatus.declined, expiresAt: past, now: now),
            QuoteStatus.declined
        )
    }

    func testADraftNeverExpiresBecauseAnUnsentPriceIsNotAnOffer() {
        XCTAssertEqual(
            Quotes.effectiveStatus(status: QuoteStatus.draft, expiresAt: past, now: now),
            QuoteStatus.draft
        )
    }

    func testAnUnreadableDateIsNotAnExpiry() {
        // Fail toward the LIVE offer. Reading a bad string as a deadline would
        // silently withdraw a price the business is still honouring, and the
        // crew would never learn why the customer stopped hearing about it.
        for bad in ["not a date", "", nil] as [String?] {
            XCTAssertEqual(
                Quotes.effectiveStatus(status: QuoteStatus.sent, expiresAt: bad, now: now),
                QuoteStatus.sent,
                "expiresAt=\(bad ?? "nil")"
            )
        }
    }

    func testFractionalSecondsParseToo() {
        // Postgres emits them and not every timestamp on this wire carries
        // them. Accepting only one shape is how a real deadline silently
        // becomes "no deadline" — which fails OPEN, so it would never be
        // noticed from the outside.
        let withFraction = ISO8601DateFormatter()
        withFraction.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        XCTAssertEqual(
            Quotes.effectiveStatus(
                status: QuoteStatus.sent,
                expiresAt: withFraction.string(from: now.addingTimeInterval(-3600)),
                now: now
            ),
            QuoteStatus.expired
        )
    }

    func testOutstandingIsAskedAndUnansweredAndNothingElse() {
        XCTAssertTrue(
            Quotes.isOutstanding(status: QuoteStatus.sent, expiresAt: future, now: now)
        )
        XCTAssertTrue(
            Quotes.isOutstanding(status: QuoteStatus.viewed, expiresAt: future, now: now)
        )
        // Lapsed is not outstanding: nobody is waiting on an answer to a price
        // that is no longer offered.
        XCTAssertFalse(
            Quotes.isOutstanding(status: QuoteStatus.sent, expiresAt: past, now: now)
        )
        for settled in [QuoteStatus.draft, QuoteStatus.accepted, QuoteStatus.declined] {
            XCTAssertFalse(
                Quotes.isOutstanding(status: settled, expiresAt: future, now: now),
                settled
            )
        }
    }

    func testEveryStatusHasAKeyAndEveryKeyHasWords() {
        let statuses = [
            QuoteStatus.draft, QuoteStatus.sent, QuoteStatus.viewed,
            QuoteStatus.accepted, QuoteStatus.declined, QuoteStatus.expired,
        ]
        XCTAssertEqual(Set(QuoteStatus.keys.keys), Set(statuses))

        // The catalogue fails OPEN: a missing key renders as the key, so a
        // status whose words went missing would show `quotes.statusViewed` to
        // somebody deciding whether to chase a customer.
        for locale in ["en", "fr-CA"] {
            for status in statuses {
                let key = QuoteStatus.keys[status] ?? ""
                let words = AppStrings.translate(locale, key)
                XCTAssertNotEqual(words, key, "\(key) has no words in \(locale)")
                XCTAssertFalse(words.isEmpty, "\(key) is empty in \(locale)")
            }
        }
    }
}
