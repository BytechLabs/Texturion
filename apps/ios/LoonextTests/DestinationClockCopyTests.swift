import XCTest
@testable import Loonext

/// #225 — the composer's "what time is it there" line.
///
/// Ported 1:1 from the Android twin's DestinationClockCopyTest. Two things are
/// pinned, and both are about restraint: it appears ONLY when it is quiet
/// there, and it never claims more certainty than the rung it came from. The
/// failure mode is one app telling somebody a different hour than another,
/// which is worse than no hint at all.
final class DestinationClockCopyTests: XCTestCase {
    private func clock(
        hour: Int = 21,
        quiet: Bool = true,
        source: String = "area_code"
    ) -> DestinationClock {
        DestinationClock(
            timezone: "America/Toronto",
            source: source,
            local_hour: hour,
            quiet: quiet
        )
    }

    func testSaysNothingDuringTheDay() {
        // The whole design: silent when the answer would not change anything.
        XCTAssertNil(theirTimeLine(clock(hour: 14, quiet: false)))
    }

    func testSaysNothingWhenTheClockCouldNotBeResolved() {
        XCTAssertNil(theirTimeLine(nil))
    }

    func testGivesTheHourInPlainTwelveHourTermsWhenItIsQuiet() {
        let line = theirTimeLine(clock(hour: 21))
        XCTAssertNotNil(line)
        XCTAssertTrue(line!.contains("9pm"), line!)
        XCTAssertTrue(line!.contains("where they are"), line!)
    }

    func testHandlesMidnightAndNoonWithoutSayingZero() {
        XCTAssertTrue(theirTimeLine(clock(hour: 0))!.contains("12am"))
        // Noon is never quiet under the default window, but Texas Sundays make
        // it reachable — and "0pm" would be the giveaway nobody checked.
        XCTAssertTrue(theirTimeLine(clock(hour: 12))!.contains("12pm"))
    }

    func testNamesTheRungBecauseAnAreaCodeIsAGuessThatCanBeWrong() {
        XCTAssertEqual(clockProvenance("area_code"), "from their area code")
        XCTAssertEqual(clockProvenance("contact"), "set on their contact")
    }

    func testAdmitsItWhenTheAnswerIsReallyOurOwnClock() {
        // Letting the weakest rung read as the customer's time would be the
        // quiet lie this whole ladder exists to avoid.
        XCTAssertTrue(clockProvenance("company").contains("we don't know theirs"))
    }

    func testAbsentServerFieldsDecodeToTheQuietDefault() throws {
        // An older server sending only the timezone: everything else must read
        // as "not quiet, weakest rung" rather than inventing an alarm.
        let json = #"{"timezone":"America/Toronto"}"#
        let decoded = try JSONDecoder().decode(DestinationClock.self, from: Data(json.utf8))
        XCTAssertFalse(decoded.isQuiet)
        XCTAssertEqual(decoded.rung, "company")
        XCTAssertEqual(decoded.hour, 0)
        // And with quiet false, the line is withheld entirely.
        XCTAssertNil(theirTimeLine(decoded))
    }
}
