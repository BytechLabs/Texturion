import XCTest

@testable import Loonext

/// #238: a line with a compact time in it is drawn with "12m" and spoken with the full
/// time, the same split `TimestampFormat.spoken` makes on Android.
final class TimedTextTests: XCTestCase {
    private let toronto = TimeZone(identifier: "America/Toronto")!
    // Tue 3:00 PM EST.
    private let now = Date(timeIntervalSince1970: 1_794_340_800)
    private let twelveMinutesAgo = "2026-11-10T19:48:00Z"

    private func line(_ iso: String?) -> TimedText {
        timedText(
            locale: "en",
            now: now,
            timeZone: toronto,
            drawTime: { TimestampFormat.label($0, locale: "en", now: now, timeZone: toronto) }
        ) { time in
            "Joined \(time(iso))"
        }
    }

    func testTheDrawnLineKeepsTheCompactTime() {
        XCTAssertEqual(line(twelveMinutesAgo).visible, "Joined 12m")
    }

    func testTheSpokenLineCarriesTheSpokenTimeInTheSameSentence() {
        let spoken = TimestampFormat.spoken(
            twelveMinutesAgo, locale: "en", now: now, timeZone: toronto)
        XCTAssertEqual(line(twelveMinutesAgo).spoken, "Joined \(spoken)")
        XCTAssertTrue(line(twelveMinutesAgo).spoken.contains("Tue, Nov 10, 2026, 2:48 PM EST"))
    }

    func testABadTimestampSpeaksWhatItDraws() {
        XCTAssertEqual(line("not a date").spoken, line("not a date").visible)
    }

    func testADueLineIsDrawnByFormatDueAndSpokenInFull() {
        let due = timedDue(locale: "en") { due in "Due \(due("2099-01-05T12:00:00Z"))" }
        XCTAssertTrue(due.visible.hasPrefix("Due "))
        XCTAssertNotEqual(due.spoken, due.visible)
        XCTAssertTrue(due.spoken.contains("2099"))
    }
}
