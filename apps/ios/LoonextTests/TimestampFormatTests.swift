import XCTest

@testable import Loonext

/// #720: the labels, in both languages, pinned to a zone and a "now".
final class TimestampFormatTests: XCTestCase {
    private let toronto = TimeZone(identifier: "America/Toronto")!
    // Tue 3:00 PM EST.
    private let now = Date(timeIntervalSince1970: 1_794_340_800)

    private func short(_ at: String, _ locale: String = "en") -> String {
        TimestampFormat.label(at, style: .short, locale: locale, now: now, timeZone: toronto)
    }

    private func long(_ at: String, _ locale: String = "en") -> String {
        TimestampFormat.label(at, style: .long, locale: locale, now: now, timeZone: toronto)
    }

    func testNowIs20261110T200000Z() throws {
        let expected = try XCTUnwrap(ISO8601DateFormatter().date(from: "2026-11-10T20:00:00Z"))
        XCTAssertEqual(now, expected)
    }

    func testShortLabelsFollowTheBuckets() {
        XCTAssertEqual(short("2026-11-10T19:59:40Z"), "now")
        XCTAssertEqual(short("2026-11-10T19:48:00Z"), "12m")
        XCTAssertEqual(short("2026-11-10T18:42:00Z"), "1:42 PM")
        XCTAssertEqual(short("2026-11-09T20:42:00Z"), "Yesterday")
        XCTAssertEqual(short("2026-11-11T20:42:00Z"), "Tomorrow")
        XCTAssertEqual(short("2026-11-07T20:42:00Z"), "Sat")
        XCTAssertEqual(short("2026-09-09T19:42:00Z"), "Sep 9")
        XCTAssertEqual(short("2025-09-09T19:42:00Z"), "Sep 9, 2025")
    }

    func testLongLabelsAddTheTime() {
        XCTAssertEqual(long("2026-11-09T20:42:00Z"), "Yesterday 3:42 PM")
        XCTAssertEqual(long("2026-11-11T20:42:00Z"), "Tomorrow 3:42 PM")
        XCTAssertEqual(long("2026-11-07T20:42:00Z"), "Sat 3:42 PM")
        XCTAssertEqual(long("2026-09-09T19:42:00Z"), "Sep 9, 3:42 PM")
        XCTAssertEqual(long("2025-09-09T19:42:00Z"), "Sep 9, 2025, 3:42 PM")
    }

    func testFrenchWords() {
        XCTAssertEqual(short("2026-11-10T19:59:40Z", "fr-CA"), "maintenant")
        XCTAssertEqual(short("2026-11-09T20:42:00Z", "fr-CA"), "Hier")
        XCTAssertEqual(short("2026-11-11T20:42:00Z", "fr-CA"), "Demain")
    }

    func testExactNamesTheWeekdayDateTimeAndZone() {
        XCTAssertEqual(
            TimestampFormat.exact("2026-11-10T20:42:00Z", locale: "en", timeZone: toronto),
            "Tue, Nov 10, 2026, 3:42 PM EST"
        )
        XCTAssertEqual(
            TimestampFormat.exact("2026-09-09T19:42:00Z", locale: "en", timeZone: toronto),
            "Wed, Sep 9, 2026, 3:42 PM EDT"
        )
    }

    func testSpokenIsTheLabelThenTheExactTime() {
        XCTAssertEqual(
            TimestampFormat.spoken(
                "2026-11-09T20:42:00Z", locale: "en", now: now, timeZone: toronto),
            "Yesterday 3:42 PM, Mon, Nov 9, 2026, 3:42 PM EST"
        )
    }

    func testABadTimestampIsBlank() {
        XCTAssertEqual(short("not a date"), "")
        XCTAssertEqual(TimestampFormat.exact(nil, locale: "en", timeZone: toronto), "")
    }
}
