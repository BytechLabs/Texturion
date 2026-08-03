import XCTest
@testable import Loonext

/// #313 — the SAME cases as `packages/shared/src/satisfaction.test.ts` and
/// `SatisfactionFormatTest.kt`.
///
/// Duplicated rather than trusted because hand-ported logic drifts silently.
/// The locale case is the one no source review would catch: `String(format:)`
/// follows the device locale, so an owner in Berlin would read "4,6" where the
/// laptop reads "4.6" — a disagreement between two screens showing the same
/// workspace, which is the exact failure the parity guards exist to prevent.
final class SatisfactionFormatTests: XCTestCase {

    func testRendersEmDashRatherThanAZeroNobodyCouldScore() {
        XCTAssertEqual(SatisfactionFormat.format(nil), "—")
        XCTAssertEqual(SatisfactionFormat.format(Double.nan), "—")
        XCTAssertEqual(SatisfactionFormat.format(Double.infinity), "—")
    }

    func testOneDecimalBecauseASecondIsNoise() {
        XCTAssertEqual(SatisfactionFormat.format(4.25), "4.3")
        XCTAssertEqual(SatisfactionFormat.format(5), "5.0")
    }

    func testFixedLocaleSoBothScreensAgree() {
        // `en_US_POSIX` is passed explicitly in `format`, so this holds whatever
        // the device is set to. Asserting the decimal SEPARATOR is the whole
        // point — a "4,6" here is a customer-visible disagreement.
        XCTAssertEqual(SatisfactionFormat.format(4.6), "4.6")
        XCTAssertFalse(SatisfactionFormat.format(4.6).contains(","))
    }

    func testAMoveSmallerThanTheThresholdIsNotADirection() {
        XCTAssertNil(SatisfactionFormat.arcDirection(0.1))
        XCTAssertNil(SatisfactionFormat.arcDirection(-0.1))
        XCTAssertNil(SatisfactionFormat.arcDirection(0))
        XCTAssertNil(SatisfactionFormat.arcDirection(nil))
    }

    func testNamesBothDirectionsIncludingTheUnflatteringOne() {
        XCTAssertEqual(SatisfactionFormat.arcDirection(0.2), "better")
        XCTAssertEqual(SatisfactionFormat.arcDirection(-0.4), "worse")
    }

    func testCountsPoorRatingsAsWorkAndGetsTheSingularRight() {
        XCTAssertEqual(SatisfactionFormat.poorRatingLine(1), "1 job needed a call back")
        XCTAssertEqual(SatisfactionFormat.poorRatingLine(3), "3 jobs needed a call back")
    }
}
