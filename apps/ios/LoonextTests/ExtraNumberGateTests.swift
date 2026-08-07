import XCTest
@testable import Loonext

/// #464 / #522 — who may buy an extra number, and in whose money.
///
/// Vectors ported 1:1 from packages/shared/src/extra-numbers.test.ts and the
/// Android twin `ExtraNumberGateTest`. A client that disagrees with the server
/// here either hides a purchase the server would allow, or offers one it would
/// refuse and turns a tap into an error.
///
/// This file exists because iOS was the ONE client #464 never reached. It kept
/// the original rule — `!(country == "US" && us_texting_enabled)` — which is the
/// exact condition that issue was filed about: `us_texting_enabled` is the 10DLC
/// gate and is never true for a Canadian workspace, so it refused every Canadian
/// customer and told them an extra number "is a US number". Three clients were
/// fixed and nothing failed for the fourth, because nothing tested it.
final class ExtraNumberGateTests: XCTestCase {

    func testCanadianWorkspaceMayBuyOneWithNoRegistrationToWaitOn() {
        // The #464 case, and the whole reason this file exists.
        XCTAssertNil(
            extraNumberBlockedReason(
                country: "CA",
                usTextingEnabled: false,
                billingCurrency: "usd"
            )
        )
    }

    func testUsWorkspaceWaitsForCarrierApproval() {
        let reason = extraNumberBlockedReason(
            country: "US",
            usTextingEnabled: false,
            billingCurrency: "usd"
        )
        XCTAssertTrue(
            reason?.contains("US texting") == true,
            "should name the gate, got: \(reason ?? "nil")"
        )
    }

    func testApprovedUsWorkspaceMayBuyOne() {
        XCTAssertNil(
            extraNumberBlockedReason(
                country: "US",
                usTextingEnabled: true,
                billingCurrency: "usd"
            )
        )
    }

    func testAnUnorderableCountryIsRefused() {
        // The gate guards a CHARGE, so an unrecognised country fails closed.
        let reason = extraNumberBlockedReason(
            country: "GB",
            usTextingEnabled: true,
            billingCurrency: "usd"
        )
        XCTAssertTrue(
            reason?.contains("US and Canadian") == true,
            "should say which countries work, got: \(reason ?? "nil")"
        )
    }

    func testEveryRefusalExplainsItself() {
        // The string is the only thing the customer is told, so a blocked case
        // that says nothing is worse than no gate at all.
        let blocked: [(String, Bool, String)] = [
            ("US", false, "usd"),
            ("GB", true, "usd"),
            ("CA", false, "cad"),
        ]
        for (country, enabled, currency) in blocked {
            let reason = extraNumberBlockedReason(
                country: country,
                usTextingEnabled: enabled,
                billingCurrency: currency
            )
            XCTAssertTrue(
                (reason?.count ?? 0) > 20,
                "\(country)/\(currency) must explain itself"
            )
        }
    }

    // MARK: - #522, the currency the price is filed in

    func testWorkspaceBilledInAnotherCurrencyIsRefusedWithAReason() {
        let reason = extraNumberBlockedReason(
            country: "CA",
            usTextingEnabled: false,
            billingCurrency: "cad"
        )
        XCTAssertTrue(
            reason?.contains("US dollars") == true,
            "should name the currency, got: \(reason ?? "nil")"
        )
        XCTAssertTrue(
            reason?.contains("support") == true,
            "should name a way forward, got: \(reason ?? "nil")"
        )
    }

    func testAMissingCurrencyReadsAsUsdAndRefusesNobody() {
        // The direction that matters: a response predating the column must not
        // cost somebody a purchase the server would allow. Mirrors
        // `billingCurrencyOf` on the server.
        XCTAssertNil(
            extraNumberBlockedReason(
                country: "CA",
                usTextingEnabled: false,
                billingCurrency: nil
            )
        )
        XCTAssertNil(
            extraNumberBlockedReason(
                country: "CA",
                usTextingEnabled: false,
                billingCurrency: "  USD  "
            )
        )
    }

    func testItKeysOnTheChargedCurrencyNeverTheCountry() {
        // The distinction the whole issue turned on. A Canadian workspace is not
        // a CAD workspace — `billing_currency` is, written from what Stripe
        // actually charged.
        XCTAssertNotNil(
            extraNumberBlockedReason(
                country: "US",
                usTextingEnabled: true,
                billingCurrency: "cad"
            )
        )
    }

    // MARK: - #522, the price this card prints

    func testTheExtraNumberPriceNamesItsCurrencyToACanadianReader() {
        // The bare "$5" this card used to print means CA$5 to a Canadian reader,
        // for a line their card takes US$5 for — on the one card whose whole
        // purpose is consent to the charge.
        XCTAssertEqual(extraNumberMonthly("starter", audience: .cad), "US$5/mo")
        XCTAssertEqual(extraNumberMonthly("pro", audience: .cad), "US$4/mo")
    }

    func testItDropsThePrefixForAUsdReader() {
        // "US$5" to somebody already billed in USD reads as though we expect
        // them to be confused about their own money.
        XCTAssertEqual(extraNumberMonthly("starter", audience: .usd), "$5/mo")
        XCTAssertEqual(extraNumberMonthly("pro", audience: .usd), "$4/mo")
    }

    func testNoPlanMeansNoFigureRatherThanStarters() {
        // A workspace with no plan is not a Starter workspace, and quoting it
        // Starter's price would name a figure for a purchase that cannot happen.
        XCTAssertNil(extraNumberMonthly(nil, audience: .usd))
        XCTAssertNil(extraNumberMonthly("enterprise", audience: .usd))
    }

    func testTheFiguresMatchTheSharedPriceBook() {
        // EXTRA_NUMBER_MONTHLY_CENTS — $5 Starter, $4 Pro (#80).
        XCTAssertEqual(extraNumberMonthlyCents("starter"), 500)
        XCTAssertEqual(extraNumberMonthlyCents("pro"), 400)
        XCTAssertEqual(extraNumberCurrency, .usd)
    }
}
