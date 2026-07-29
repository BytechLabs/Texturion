import XCTest
@testable import Loonext

/// #241 — the same table `packages/shared/src/carrier-failure.test.ts` asserts,
/// against the Swift hand-port.
///
/// A drift here means this app offers a retry button that web withholds — for
/// a block only the customer can lift. That would not show up as a crash,
/// which is exactly why the port gets its own test, and why it matters that
/// iOS compiles only in CI.
final class CarrierFailureTests: XCTestCase {
    func testClassifiesTheOptOutWhichIsTheOneWithALegalMeaning() {
        XCTAssertEqual(classifySendFailure("40300"), .optOut)
    }

    func testCollapsesCodesWeTreatIdentically() {
        for code in ["40001", "40012", "40310", "40004", "40006", "40008"] {
            XCTAssertEqual(classifySendFailure(code), .unreachable, code)
        }
        for code in ["40011", "40016", "40018", "40318"] {
            XCTAssertEqual(classifySendFailure(code), .rateLimited, code)
        }
    }

    func testIsUnknownForACodeWeHaveNotClassified() {
        XCTAssertEqual(classifySendFailure("99999"), .unknown)
        XCTAssertEqual(classifySendFailure(""), .unknown)
        XCTAssertEqual(classifySendFailure(nil), .unknown)
    }

    func testNeverGuessesOptOut() {
        // A wrongly-inferred opt-out takes somebody's number out of service and
        // nobody here can put it back — only the customer can.
        for code in ["99999", "40999", "abc", " ", "4030", "403000"] {
            XCTAssertNotEqual(classifySendFailure(code), .optOut, code)
        }
    }

    func testPrefersTheServersClassificationAndFallsBackToTheCode() {
        XCTAssertEqual(failureReasonOf("spam_blocked", "40300"), .spamBlocked)
        // Rows written before the column existed live on phones for months.
        XCTAssertEqual(failureReasonOf(nil, "40300"), .optOut)
        XCTAssertEqual(failureReasonOf(nil, "40011"), .rateLimited)
    }

    func testIgnoresAServerValueItDoesNotRecogniseRatherThanCrashing() {
        XCTAssertEqual(failureReasonOf("something_new", "40300"), .optOut)
        XCTAssertEqual(failureReasonOf("something_new", nil), .unknown)
    }

    func testNeverOffersARetryForAnOptOutAndOffersOneOtherwise() {
        XCTAssertFalse(isRetryableFailure(.optOut))
        for reason: CarrierFailureReason in [
            .unreachable, .contentBlocked, .spamBlocked, .rateLimited,
            .expired, .notProvisioned, .unknown,
        ] {
            XCTAssertTrue(isRetryableFailure(reason), reason.rawValue)
        }
    }
}
