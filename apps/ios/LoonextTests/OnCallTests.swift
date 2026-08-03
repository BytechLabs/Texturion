import XCTest
@testable import Loonext

/// #244 — the same cases as `on-call.test.ts` and `OnCallTest.kt`.
///
/// The two that matter are silent: a backdated shift claims hours nobody was
/// holding, and a weekend booked eight days out leaves tonight uncovered by the
/// very action taken to cover it. Neither produces an error — they produce a
/// phone that does not ring.
final class OnCallTests: XCTestCase {

    /// Toronto in August: UTC-4.
    private let toronto = -240

    private func at(_ iso: String) -> Date {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime]
        return formatter.date(from: iso)!
    }

    /// The local wall clock a UTC instant lands on, for readable assertions.
    private func local(_ iso: String) -> String {
        let parser = DateFormatter()
        parser.locale = Locale(identifier: "en_US_POSIX")
        parser.timeZone = TimeZone(identifier: "UTC")
        parser.dateFormat = "yyyy-MM-dd'T'HH:mm:ss.SSS'Z'"
        let instant = parser.date(from: iso)!

        let printer = DateFormatter()
        printer.locale = Locale(identifier: "en_US_POSIX")
        printer.timeZone = TimeZone(identifier: "UTC")
        printer.dateFormat = "yyyy-MM-dd'T'HH:mm"
        return printer.string(
            from: instant.addingTimeInterval(Double(toronto) * 60)
        )
    }

    func testTonightIsSixToEightInTheCrewsOwnClock() {
        let window = OnCall.window(
            "tonight",
            now: at("2026-08-05T18:00:00Z"),
            offsetMinutes: toronto
        )

        XCTAssertEqual(local(window.startsAt), "2026-08-05T18:00")
        XCTAssertEqual(local(window.endsAt), "2026-08-06T08:00")
    }

    func testSetAfterSixItStartsNowRatherThanRetroactively() {
        // A shift backdated to 6pm would claim responsibility for hours nobody
        // was holding — including a call that already woke the whole crew.
        let window = OnCall.window(
            "tonight",
            now: at("2026-08-06T01:00:00Z"),
            offsetMinutes: toronto
        )

        XCTAssertEqual(local(window.startsAt), "2026-08-05T21:00")
        XCTAssertEqual(local(window.endsAt), "2026-08-06T08:00")
    }

    func testWeekendSetOnTheWeekendMeansThisOne() {
        let window = OnCall.window(
            "weekend",
            now: at("2026-08-08T13:00:00Z"),
            offsetMinutes: toronto
        )

        XCTAssertEqual(local(window.startsAt), "2026-08-07T18:00")
        XCTAssertEqual(local(window.endsAt), "2026-08-10T08:00")
    }

    func testMidweekThisWeekendIsTheComingFriday() {
        let window = OnCall.window(
            "weekend",
            now: at("2026-08-05T18:00:00Z"),
            offsetMinutes: toronto
        )

        XCTAssertEqual(local(window.startsAt), "2026-08-07T18:00")
        XCTAssertEqual(local(window.endsAt), "2026-08-10T08:00")
    }

    func testEveryWindowEndsAfterItStartsInEveryTimezoneWeSellTo() {
        // The API refuses a backwards window with a 422, so a preset producing
        // one is a button that never works — in one timezone only, which is how
        // it would reach a customer.
        let parser = DateFormatter()
        parser.locale = Locale(identifier: "en_US_POSIX")
        parser.timeZone = TimeZone(identifier: "UTC")
        parser.dateFormat = "yyyy-MM-dd'T'HH:mm:ss.SSS'Z'"

        for offset in [-480, -420, -360, -300, -240, -210, -180] {
            for preset in ["tonight", "weekend", "week"] {
                for day in 3...9 {
                    let now = at("2026-08-0\(day)T13:00:00Z")
                    let window = OnCall.window(
                        preset,
                        now: now,
                        offsetMinutes: offset
                    )
                    let starts = parser.date(from: window.startsAt)!
                    let ends = parser.date(from: window.endsAt)!
                    XCTAssertGreaterThan(
                        ends,
                        starts,
                        "\(preset) at offset \(offset) on the \(day)th"
                    )
                }
            }
        }
    }
}
