import XCTest

@testable import Loonext

/// #246 — how a duplicate pair is named to somebody deciding whether to merge.
///
/// The label is the whole basis of that decision: get it wrong and a crew
/// merges two customers who are not the same person, which is the one mistake
/// here that costs more than doing nothing.
///
/// Mirrors `DuplicateLabelTest.kt` on Android and the web card's `describe`,
/// because this string is hand-ported three ways and a silent divergence would
/// show a different customer on each client.
final class DuplicateLabelTests: XCTestCase {
    func testNamesThePersonAndTheNumberTogether() {
        XCTAssertEqual(
            "Mike ((415) 555-0501)",
            describeContact("Mike", "+14155550501")
        )
    }

    func testFallsBackToTheNumberWhenARecordHasNoName() {
        // A phantom contact from a typo usually has nothing else to show, and
        // an empty parenthesis would read as a bug.
        XCTAssertEqual("(415) 555-0501", describeContact(nil, "+14155550501"))
        XCTAssertEqual("(415) 555-0501", describeContact("   ", "+14155550501"))
    }

    func testShowsANumberItCannotFormatRatherThanHidingIt() {
        // An unparseable number is still the only thing distinguishing the two
        // records. Dropping it would leave the pair unidentifiable.
        XCTAssertEqual("+442071838750", describeContact(nil, "+442071838750"))
    }
}
