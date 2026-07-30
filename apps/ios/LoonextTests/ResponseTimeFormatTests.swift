import XCTest
@testable import Loonext

/// #239 — the SAME table as `packages/shared/src/response-time.test.ts` and
/// `ResponseTimeFormatTest.kt`.
///
/// The point of duplicating the cases rather than trusting the port is that
/// hand-ported logic drifts silently. Two of these exist because the first TS
/// implementation got them wrong: a rounded remainder can reach a whole unit of
/// the next size up, and without carrying it, 3,599 seconds printed "60 min" and
/// 86,399 printed "23 hr 60 min".
final class ResponseTimeFormatTests: XCTestCase {

    private let cases: [(Double, String)] = [
        (0, "0 sec"),
        (5, "5 sec"),
        (59, "59 sec"),
        (60, "1 min"),
        (90, "2 min"),
        (240, "4 min"),
        (3599, "1 hr"),
        (3600, "1 hr"),
        (5400, "1 hr 30 min"),
        (10800, "3 hr"),
        (86399, "1 day"),
        (86400, "1 day"),
        (172800, "2 days"),
    ]

    func testSaysTheLargestUnitThatStillTellsTheTruth() {
        for (seconds, expected) in cases {
            XCTAssertEqual(ResponseTimeFormat.format(seconds), expected, "\(seconds)")
        }
    }

    func testRefusesToInventAZeroWhenThereIsNoMedian() {
        XCTAssertEqual(ResponseTimeFormat.format(nil), "—")
        XCTAssertEqual(ResponseTimeFormat.format(Double.nan), "—")
        XCTAssertEqual(ResponseTimeFormat.format(Double.infinity), "—")
    }

    func testDrawsNoArcForAChangeUnderAMinute() {
        for seconds in [0.0, 30.0, -30.0, 59.0, -59.0] {
            XCTAssertNil(ResponseTimeFormat.arcDirection(seconds), "\(seconds)")
        }
    }

    func testNamesTheDirectionHonestlyIncludingTheWrongOne() {
        XCTAssertEqual(ResponseTimeFormat.arcDirection(600), "faster")
        XCTAssertEqual(ResponseTimeFormat.arcDirection(-600), "slower")
        XCTAssertNil(ResponseTimeFormat.arcDirection(nil))
    }
}
