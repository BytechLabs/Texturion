import XCTest
@testable import Loonext

/// #224 — the text-to-pay rules this phone reimplements, held to the ones the
/// TypeScript owns.
///
/// `packages/shared/src/payments.ts` is shared by two of four clients; Kotlin
/// and Swift each carry a hand-port, so every rule below exists three times.
/// The CASES are generated from that file by
/// `scripts/generate-parity-vectors.mjs` into
/// `packages/shared/vectors/payments.json`, and CI regenerates and fails if they
/// are stale — so this file cannot quietly describe last month's rule.
///
/// The two state cases that matter are the two a reimplementation gets wrong by
/// writing the obvious switch: a request cancelled and then PAID anyway reads
/// PAID, and a request refunded AFTER a dispute reads DISPUTED.
final class PaymentsLogicTests: XCTestCase {

    // MARK: - Vectors

    private struct PaymentVector: Decodable {
        struct Row: Decodable {
            let status: String
            let paid_at: String?
            let refunded_at: String?
            let disputed_at: String?
        }

        struct Account: Decodable {
            let connected: Bool
            let charges_enabled: Bool
            let details_submitted: Bool
            let disabled_reason: String?
        }

        let kind: String
        let row: Row?
        let state: String?
        let label: String?
        let cancellable: Bool?
        /// A Double rather than an Int, because the TypeScript's `number` can be
        /// handed 1000.5 and one vector does exactly that. See the amount test.
        let cents: Double?
        let problem: String?
        let account: Account?
        let readiness: String?
    }

    /// Walk UP to the repo root from this source file rather than counting
    /// directories. The test bundle's own resources would be a COPY of the
    /// vectors, which is a fourth place the cases live — the exact problem they
    /// exist to solve. The same loader `ParityVectorsTests` uses, kept local
    /// because it is four lines and sharing it would mean editing that suite.
    private func paymentVectors() throws -> [PaymentVector] {
        var dir = URL(fileURLWithPath: #filePath).deletingLastPathComponent()
        while dir.path != "/" {
            let candidate = dir
                .appendingPathComponent("packages/shared/vectors")
                .appendingPathComponent("payments.json")
            if FileManager.default.fileExists(atPath: candidate.path) {
                return try JSONDecoder().decode(
                    [PaymentVector].self,
                    from: Data(contentsOf: candidate)
                )
            }
            dir = dir.deletingLastPathComponent()
        }
        XCTFail("payments vectors not found; run node scripts/generate-parity-vectors.mjs")
        return []
    }

    private func facts(_ row: PaymentVector.Row) -> PaymentRequestFacts {
        PaymentRequestFacts(
            status: row.status,
            paidAt: row.paid_at,
            refundedAt: row.refunded_at,
            disputedAt: row.disputed_at
        )
    }

    func testTheSixStatesAgreeWithTheTypeScript() throws {
        let cases = try paymentVectors().filter { $0.kind == "state" }
        // Guard the guard. A filter that matched nothing would make every
        // assertion below unreachable and the test green — which is how a check
        // spends months proving nothing.
        XCTAssertGreaterThanOrEqual(cases.count, 10, "state vectors missing")
        for testCase in cases {
            // Unwrapped up front rather than compared as optionals. Swift will
            // promote a `Bool` to a `Bool?` to satisfy `XCTAssertEqual`, and it
            // is exactly the sort of inference this file cannot verify — nothing
            // on this machine compiles Swift.
            guard let row = testCase.row,
                  let expectedState = testCase.state,
                  let expectedLabel = testCase.label,
                  let expectedCancellable = testCase.cancellable
            else {
                XCTFail("incomplete state vector")
                continue
            }
            let label = "\(row.status)"
                + (row.paid_at != nil ? "+paid" : "")
                + (row.refunded_at != nil ? "+refunded" : "")
                + (row.disputed_at != nil ? "+disputed" : "")
            let state = paymentRequestState(facts(row))
            XCTAssertEqual(state.rawValue, expectedState, "state for \(label)")
            XCTAssertEqual(paymentRequestLabel(state), expectedLabel, "label for \(label)")
            XCTAssertEqual(
                paymentRequestCancellable(facts(row)),
                expectedCancellable,
                "cancellable for \(label)"
            )
        }
    }

    /// The two orderings that decide the whole derivation, named so a failure
    /// says WHICH rule broke rather than which line of a JSON file.
    func testMoneyThatMovedOutranksTheStoredStatus() {
        // Cancelled, then paid anyway. The money is real, and telling a crew
        // otherwise is how a customer is chased for a bill they settled.
        XCTAssertEqual(
            paymentRequestState(
                PaymentRequestFacts(status: "cancelled", paidAt: "2026-08-01T00:00:00Z")
            ),
            .paid
        )
        // Disputed AND refunded. A chargeback is the thing somebody has to act
        // on; a refund is not.
        XCTAssertEqual(
            paymentRequestState(
                PaymentRequestFacts(
                    status: "paid",
                    paidAt: "2026-08-01T00:00:00Z",
                    refundedAt: "2026-08-03T00:00:00Z",
                    disputedAt: "2026-08-02T00:00:00Z"
                )
            ),
            .disputed
        )
    }

    /// An empty string is not a timestamp.
    ///
    /// The wire sends `null` for an absent instant, so this never fires against
    /// the API — it fires against a client cache that round-tripped a nil
    /// through `""`, which would otherwise read as "this was disputed" and put a
    /// chargeback warning on a request nobody has paid.
    func testAnEmptyTimestampIsNotAStamp() {
        XCTAssertEqual(
            paymentRequestState(
                PaymentRequestFacts(
                    status: "requested",
                    paidAt: "",
                    refundedAt: "",
                    disputedAt: ""
                )
            ),
            .requested
        )
    }

    func testTheAmountBoundsAgreeWithTheTypeScript() throws {
        let cases = try paymentVectors().filter { $0.kind == "amount" }
        XCTAssertGreaterThanOrEqual(cases.count, 10, "amount vectors missing")
        var wholeChecked = 0
        var fractional = 0
        for testCase in cases {
            guard let cents = testCase.cents else {
                XCTFail("amount vector with no cents")
                continue
            }
            guard let whole = Int(exactly: cents) else {
                // `paymentAmountProblem` takes an `Int` here, so `not_whole` is
                // unreachable through this signature — Swift's type system is
                // the check the TypeScript has to make at runtime. Asserted
                // rather than skipped, so the vector still says what it means,
                // and the reachable path to that state is covered by the parser
                // test below.
                XCTAssertEqual(
                    testCase.problem ?? "",
                    PaymentAmountProblem.notWhole.rawValue,
                    "a fractional cent count should be not_whole (\(cents))"
                )
                fractional += 1
                continue
            }
            XCTAssertEqual(
                paymentAmountProblem(whole)?.rawValue,
                testCase.problem,
                "problem for \(whole) cents"
            )
            wholeChecked += 1
        }
        // Both branches were actually walked. A vector file that lost its
        // fractional case would otherwise make the `guard` above decorative.
        XCTAssertGreaterThan(wholeChecked, 5, "no whole-cent vectors were checked")
        XCTAssertGreaterThan(fractional, 0, "no fractional vector — the guard proved nothing")
    }

    func testTheBoundsThemselvesAreTheSharedOnes() {
        // The floor is Stripe's 50-cent refusal with headroom; the ceiling is
        // the missed-decimal cap. Named here so a change to either fails with
        // the reason rather than as twelve confusing vector mismatches.
        XCTAssertEqual(paymentMinCents, 100)
        XCTAssertEqual(paymentMaxCents, 2_500_000)
        XCTAssertEqual(paymentDescriptionMax, 200)
        XCTAssertNil(paymentAmountProblem(paymentMinCents))
        XCTAssertNil(paymentAmountProblem(paymentMaxCents))
        XCTAssertEqual(paymentAmountProblem(paymentMinCents - 1), .tooSmall)
        XCTAssertEqual(paymentAmountProblem(paymentMaxCents + 1), .tooLarge)
    }

    func testReadinessAgreesWithTheTypeScript() throws {
        let cases = try paymentVectors().filter { $0.kind == "readiness" }
        XCTAssertGreaterThanOrEqual(cases.count, 6, "readiness vectors missing")
        for testCase in cases {
            guard let expected = testCase.readiness else {
                XCTFail("readiness vector with no answer")
                continue
            }
            let account = testCase.account.map { account in
                PayoutAccountFacts(
                    connected: account.connected,
                    chargesEnabled: account.charges_enabled,
                    detailsSubmitted: account.details_submitted,
                    disabledReason: account.disabled_reason
                )
            }
            XCTAssertEqual(
                payoutReadiness(account).rawValue,
                expected,
                "readiness for connected=\(account?.connected as Any) "
                    + "charges=\(account?.chargesEnabled as Any)"
            )
        }
    }

    /// `charges_enabled` is the only field that decides whether a send may
    /// happen — it is what the server's own `assertCanCharge` keys on. A
    /// restricted account that Stripe is nonetheless still letting charge is
    /// READY, and reading it as restricted would hide a control that works.
    func testChargesEnabledWinsOverADisabledReason() {
        XCTAssertEqual(
            payoutReadiness(
                PayoutAccountFacts(
                    connected: true,
                    chargesEnabled: true,
                    detailsSubmitted: true,
                    disabledReason: "requirements.pending_verification"
                )
            ),
            .ready
        )
    }

    // MARK: - Parsing an amount somebody typed

    func testAnAmountBecomesCentsWithoutEverBecomingADouble() {
        XCTAssertEqual(parsePaymentAmountToCents("250"), 25_000)
        XCTAssertEqual(parsePaymentAmountToCents("250.00"), 25_000)
        // "250.5" is two hundred and fifty dollars FIFTY, not five cents.
        XCTAssertEqual(parsePaymentAmountToCents("250.5"), 25_050)
        XCTAssertEqual(parsePaymentAmountToCents("0.99"), 99)
        // The case the whole integer-arithmetic argument is about: 19.99 as a
        // binary double is 19.98999…, so `Double * 100` rounds by luck.
        XCTAssertEqual(parsePaymentAmountToCents("19.99"), 1999)
        XCTAssertEqual(parsePaymentAmountToCents("1234.56"), 123_456)
        // A whole cent count, every time, for every hundredth in a dollar.
        for hundredth in 0..<100 {
            let typed = String(format: "10.%02d", hundredth)
            XCTAssertEqual(
                parsePaymentAmountToCents(typed),
                1000 + hundredth,
                "\(typed) should be \(1000 + hundredth) cents"
            )
        }
    }

    func testDecorationSomebodyTypesOnAPhoneIsForgiven() {
        XCTAssertEqual(parsePaymentAmountToCents("$250"), 25_000)
        XCTAssertEqual(parsePaymentAmountToCents(" 1,250.00 "), 125_000)
        XCTAssertEqual(parsePaymentAmountToCents("$1,250.5"), 125_050)
    }

    func testAnythingThatIsNotANumberIsRefused() {
        // The reachable route to `not_whole`: more than two decimal places.
        XCTAssertNil(parsePaymentAmountToCents("12.345"))
        XCTAssertNil(parsePaymentAmountToCents(""))
        XCTAssertNil(parsePaymentAmountToCents("   "))
        XCTAssertNil(parsePaymentAmountToCents("abc"))
        XCTAssertNil(parsePaymentAmountToCents("250abc"))
        XCTAssertNil(parsePaymentAmountToCents("2.5.0"))
        XCTAssertNil(parsePaymentAmountToCents("-250"))
        XCTAssertNil(parsePaymentAmountToCents("."))
        XCTAssertNil(parsePaymentAmountToCents("1e3"))
        // A paste, not a keypad. Forty nines does not fit an `Int` at all.
        XCTAssertNil(parsePaymentAmountToCents(String(repeating: "9", count: 40)))
        // And the one that DOES fit and then overflows on the ×100: eighteen
        // nines parses fine and is a hundred times too big for an Int64. Written
        // out because a guard that has only ever been walked past is a guard
        // nobody has proven — an overflow is a crash in Swift, not a nil.
        XCTAssertNotNil(Int(String(repeating: "9", count: 18)))
        XCTAssertNil(parsePaymentAmountToCents(String(repeating: "9", count: 18)))
    }

    /// A trailing dot is a real keystroke on the way to typing cents, and the
    /// shared regex allows zero digits after the point. Refusing it mid-type
    /// would blank the preview between "250." and "250.5".
    func testAHalfTypedDecimalIsStillAnAmount() {
        XCTAssertEqual(parsePaymentAmountToCents("250."), 25_000)
    }

    // MARK: - Requirements, in words

    func testAKnownStripeRequirementReadsAsASentence() {
        XCTAssertEqual(
            payoutRequirementCopy("individual.verification.document"),
            "Photo ID for the business owner"
        )
        XCTAssertEqual(payoutRequirementCopy("external_account"), "Your bank account details")
        XCTAssertEqual(payoutRequirementCopy("tos_acceptance.date"), "Accepting Stripe's terms")
    }

    /// Stripe adds requirement keys without telling anybody. An outstanding
    /// requirement nobody can see is the state where an owner concludes the
    /// product is broken, so an ugly sentence beats a silent one.
    func testAnUnknownRequirementIsStillShown() {
        XCTAssertEqual(
            payoutRequirementCopy("individual.political_exposure"),
            "Political exposure"
        )
        XCTAssertEqual(payoutRequirementCopy("company.owners_provided"), "Owners provided")
        XCTAssertEqual(
            payoutRequirementCopy("representative.first_name"),
            "First name"
        )
        // No prefix to strip, and nothing to look up.
        XCTAssertEqual(payoutRequirementCopy("some_new_thing"), "Some new thing")
        // Never empty, whatever arrives.
        XCTAssertEqual(payoutRequirementCopy(""), "")
    }

    // MARK: - The text the customer receives

    func testThePreviewIsTheMessageThatActuallyGoesOut() {
        let text = paymentRequestSms(
            businessName: "  Ridgeline Plumbing ",
            amountCents: 25_000,
            currency: .usd,
            description: " Deposit ",
            url: "https://app.loonext.com/pay/abc123",
            locale: MessageLocale.en
        )
        XCTAssertEqual(
            text,
            "Ridgeline Plumbing: $250 for Deposit.\n"
                + "Pay securely here:\nhttps://app.loonext.com/pay/abc123"
        )
    }

    /// The shape is the anti-phishing decision, so it is asserted as a shape and
    /// not only as a string: the name first, the amount before the link, and the
    /// link alone on the last line so every phone linkifies all of it.
    func testTheShapeIsTheAntiPhishingDecision() {
        let text = paymentRequestSms(
            businessName: "Ridgeline Plumbing",
            amountCents: 125_000,
            currency: .cad,
            description: "Final payment",
            url: "https://app.loonext.com/pay/abc123",
            locale: MessageLocale.en
        )
        XCTAssertTrue(text.hasPrefix("Ridgeline Plumbing:"))
        let lines = text.split(separator: "\n", omittingEmptySubsequences: false)
        XCTAssertEqual(lines.count, 3)
        XCTAssertEqual(String(lines[2]), "https://app.loonext.com/pay/abc123")
        // The amount is readable without opening anything, and it is GROUPED —
        // "$1250" for a bill of one thousand two hundred and fifty dollars is
        // the figure web prints as "$1,250".
        XCTAssertTrue(lines[0].contains("$1,250"), "amount in \(lines[0])")
    }

    /// #522 — the money in this feature goes through the formatter, and the
    /// formatter now groups. This is the assertion that would have failed before
    /// `formatMonthlyCents` learned to: the ceiling of this feature is $25,000,
    /// which is the first amount in the product big enough for it to matter.
    func testMoneyIsGroupedTheWayWebGroupsIt() {
        XCTAssertEqual(formatMoneyIn(2_500_000, .usd, audience: .usd), "$25,000")
        XCTAssertEqual(formatMoneyIn(125_000, .cad, audience: .cad), "$1,250")
        XCTAssertEqual(formatMoneyIn(125_050, .cad, audience: .cad), "$1,250.50")
        // Unchanged for everything that was already right.
        XCTAssertEqual(formatMoneyIn(2900, .usd, audience: .usd), "$29")
        XCTAssertEqual(formatMoneyIn(750, .usd, audience: .usd), "$7.50")
        XCTAssertEqual(formatMoneyIn(5, .usd, audience: .usd), "$0.05")
        // A foreign price still says which money it is.
        XCTAssertEqual(formatMoneyIn(2_500_000, .usd, audience: .cad), "US$25,000")
    }

    /// The refusal copy names the bound in the reader's own money, rather than
    /// carrying a typed figure that would be wrong for a Canadian account.
    func testTheAmountRefusalNamesTheBoundInTheAccountsCurrency() {
        XCTAssertEqual(
            paymentAmountProblemCopy(.tooSmall, .usd),
            "The smallest payment we can take is $1."
        )
        XCTAssertEqual(
            paymentAmountProblemCopy(.tooLarge, .cad),
            "The largest payment we can take by text is $25,000."
        )
        XCTAssertEqual(
            paymentAmountProblemCopy(.notWhole, .usd),
            "Enter an amount in dollars and cents."
        )
    }

    // MARK: - What the strip shows

    func testALiveRequestIsAlwaysShown() {
        // Even one created two years ago: it is still owed, and the whole point
        // of the strip is that somebody is waiting for that money.
        XCTAssertTrue(
            paymentRequestWorthShowing(
                state: .requested,
                createdAt: "2024-01-01T00:00:00Z",
                paidAt: nil,
                now: Date(timeIntervalSince1970: 1_800_000_000)
            )
        )
    }

    func testASettledRequestFallsOffAfterAWeek() {
        let now = Date(timeIntervalSince1970: 1_800_000_000)
        let sixDaysAgo = ISO8601DateFormatter().string(
            from: now.addingTimeInterval(-6 * 24 * 60 * 60)
        )
        let eightDaysAgo = ISO8601DateFormatter().string(
            from: now.addingTimeInterval(-8 * 24 * 60 * 60)
        )
        XCTAssertTrue(
            paymentRequestWorthShowing(
                state: .paid,
                createdAt: eightDaysAgo,
                // The PAID instant is what dates a paid row, not the created
                // one: a request sent a month ago and settled yesterday is
                // exactly the row somebody is still talking about.
                paidAt: sixDaysAgo,
                now: now
            )
        )
        XCTAssertFalse(
            paymentRequestWorthShowing(
                state: .paid,
                createdAt: eightDaysAgo,
                paidAt: eightDaysAgo,
                now: now
            )
        )
        // A cancelled row has no paid instant, so the created one dates it.
        XCTAssertFalse(
            paymentRequestWorthShowing(
                state: .cancelled,
                createdAt: eightDaysAgo,
                paidAt: nil,
                now: now
            )
        )
        XCTAssertTrue(
            paymentRequestWorthShowing(
                state: .cancelled,
                createdAt: sixDaysAgo,
                paidAt: nil,
                now: now
            )
        )
    }

    /// An undateable settled row is hidden, and that is the correct failure: a
    /// live row has already returned true above, so anything reaching the date
    /// arithmetic is settled — and showing one we cannot date would leave it
    /// above the composer forever, which is the exact pile-up this filter
    /// exists to prevent.
    func testASettledRowWeCannotDateIsHidden() {
        XCTAssertFalse(
            paymentRequestWorthShowing(
                state: .paid,
                createdAt: "not a date",
                paidAt: nil
            )
        )
    }

    // MARK: - Decoding, and the two fields the clients derive for themselves

    /// The server sends `state` and `readiness` as strings and both clients
    /// derive them too. The server's word wins; the derivation is what keeps a
    /// build that predates a new server value from reading it as "ready".
    func testAnUnrecognisedServerWordFallsBackToTheDerivation() throws {
        let json = """
        {
          "id": "r1", "conversation_id": "c1", "contact_id": "k1",
          "amount_cents": 25000, "currency": "cad", "description": "Deposit",
          "status": "paid", "state": "settled_somehow",
          "paid_at": "2026-08-01T00:00:00Z", "refunded_at": null,
          "amount_refunded_cents": null, "disputed_at": null,
          "cancelled_at": null, "expires_at": "2026-08-15T00:00:00Z",
          "created_at": "2026-08-01T00:00:00Z", "created_by": null
        }
        """
        let request = try JSONDecoder().decode(PaymentRequest.self, from: Data(json.utf8))
        XCTAssertEqual(request.resolvedState, .paid)
        XCTAssertEqual(request.billingCurrency, .cad)
        XCTAssertEqual(request.amountLabel, "$250")

        let account = PayoutAccount(
            connected: true,
            readiness: "some_new_stripe_state",
            charges_enabled: true,
            details_submitted: true
        )
        // A state this build has never heard of must never read as ready by
        // accident, and must never hide a control that works. Deriving from
        // `charges_enabled` answers both.
        XCTAssertEqual(account.resolvedReadiness, .ready)
        XCTAssertEqual(
            PayoutAccount(connected: true, readiness: "some_new_stripe_state")
                .resolvedReadiness,
            .onboardingIncomplete
        )
    }

    /// A currency this build does not know falls back to USD rather than
    /// refusing to draw the row — the same call `billingCurrencyOf` makes on the
    /// server. A blank strip is a worse answer than a figure with a familiar
    /// sign on it.
    func testAnUnknownCurrencyStillRenders() throws {
        let json = """
        {
          "id": "r1", "conversation_id": "c1", "contact_id": "k1",
          "amount_cents": 25000, "currency": "gbp", "description": "Deposit",
          "status": "requested", "state": "requested",
          "expires_at": "2026-08-15T00:00:00Z", "created_at": "2026-08-01T00:00:00Z"
        }
        """
        let request = try JSONDecoder().decode(PaymentRequest.self, from: Data(json.utf8))
        XCTAssertEqual(request.billingCurrency, .usd)
        XCTAssertEqual(request.amountLabel, "$250")
        XCTAssertTrue(paymentRequestCancellable(request.facts))
    }

    /// The readiness read is gated on `billing.manage` server-side, so the
    /// client asks the same question before spending a request that would 403.
    ///
    /// The bookkeeper is the case that makes this a capability rather than a
    /// rank: they hold billing and nothing else, and reaching the Stripe
    /// dashboard to issue a refund is the whole reason the role exists.
    func testOnlyAReaderWhoMayAskTheAccountRouteAsksIt() {
        XCTAssertTrue(canReadPayoutAccount(role: MemberRole.owner))
        XCTAssertTrue(canReadPayoutAccount(role: MemberRole.admin))
        XCTAssertTrue(canReadPayoutAccount(role: MemberRole.bookkeeper))
        // THE case, and the one this test was written to pin while it was still
        // broken. A plain member holds `conversations.send` — everything the
        // SEND route asks for — so gating the readiness read on `billing.manage`
        // alone made the ask invisible to the tech in the driveway the feature
        // was written for, on every thread, permanently. The API route now takes
        // either capability and sends this reader a narrower object; this side
        // has to agree, or the phone still skips the call and still draws
        // nothing.
        XCTAssertTrue(canReadPayoutAccount(role: MemberRole.member))
        // The observer holds neither. Not asked rather than asked-and-refused:
        // a guaranteed 403 per thread open, for the role that opens the most.
        XCTAssertFalse(canReadPayoutAccount(role: MemberRole.readOnly))
        XCTAssertFalse(canReadPayoutAccount(role: nil))
    }
}
