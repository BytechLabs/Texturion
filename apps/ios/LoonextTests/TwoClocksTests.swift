import XCTest

@testable import Loonext

/// #539 — a time has to say whose clock it is on.
///
/// The same set the Kotlin twin asserts, plus a read of the shared TypeScript,
/// because this is the third hand-port of one rule. Both zones are always stated:
/// a helper whose answer depends on the machine it runs on is one that passes on a
/// laptop and fails in CI.
final class TwoClocksTests: XCTestCase {

    private let toronto = "America/Toronto"
    private let vancouver = "America/Vancouver"
    /// 8am in Vancouver, 11am in Toronto.
    private let at = Date(timeIntervalSince1970: 1_786_460_400)  // 2026-08-11T15:00:00Z

    /// What the product passes in: an instant rendered in a zone.
    private func wall(_ date: Date, _ zone: String) -> String {
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_US_POSIX")
        f.timeZone = TimeZone(identifier: zone)
        f.dateFormat = "EEE, h:mm a"
        return f.string(from: date)
    }

    func testNamesBothClocksWhenTheReaderIsNotWhereTheCustomerIs() {
        // THE BUG. The queued row said "8:00 AM" — the customer's clock, correctly
        // — and a Toronto dispatcher read it as their own eight o'clock.
        let line = TwoClocks.bothClocks(wall(at, vancouver), wall(at, toronto))
        XCTAssertTrue(line.contains("8:00"), line)
        XCTAssertTrue(line.contains("11:00"), line)
        XCTAssertTrue(line.contains("their time"), line)
        XCTAssertTrue(line.contains("yours"), line)
    }

    func testSaysOnePlainTimeWhenTheCustomerIsInTown() {
        // The ordinary day for most crews. A label that is noise on the ordinary
        // day is one people stop reading before the day it matters.
        let mine = wall(at, toronto)
        XCTAssertEqual(TwoClocks.bothClocks(mine, mine), mine)
        XCTAssertEqual(TwoClocks.bothClocks(mine), mine)
        XCTAssertEqual(TwoClocks.bothClocks(mine, nil), mine)
    }

    func testStaysQuietForTwoZoneIdentifiersThatAreOneClock() {
        // Toronto and New York are the same clock face; labelling that would put
        // the line on every row for nothing anybody can see.
        let theirs = wall(at, "America/New_York")
        let mine = wall(at, toronto)
        XCTAssertTrue(TwoClocks.sameClock(theirs, mine))
        XCTAssertEqual(TwoClocks.bothClocks(theirs, mine), theirs)
    }

    func testIsRightOnBothSidesOfADstBoundary() {
        // Arizona keeps one offset all year while Toronto moves, so the gap is
        // three hours in January and two in July. Any stored offset would be wrong
        // for half the year.
        let winter = Date(timeIntervalSince1970: 1_768_496_400)  // 2026-01-15T17:00Z
        let summer = Date(timeIntervalSince1970: 1_784_134_800)  // 2026-07-15T17:00Z
        for date in [winter, summer] {
            let line = TwoClocks.bothClocks(
                wall(date, "America/Phoenix"),
                wall(date, toronto)
            )
            XCTAssertTrue(line.contains("their time"), line)
        }
        // And the gap really did change, which is what makes this worth asserting.
        func time(_ s: String) -> String { String(s.split(separator: " ").dropFirst().joined(separator: " ")) }
        XCTAssertEqual(
            time(wall(winter, "America/Phoenix")),
            time(wall(summer, "America/Phoenix"))
        )
        XCTAssertNotEqual(
            time(wall(winter, toronto)),
            time(wall(summer, toronto))
        )
    }

    func testCarriesTheMinutesOfAHalfHourZone() {
        // Newfoundland is UTC-3:30, where an hours-apart number is wrong every day
        // rather than twice a year.
        let line = TwoClocks.bothClocks(wall(at, "America/St_Johns"), wall(at, toronto))
        XCTAssertTrue(line.contains(":30"), line)
    }

    func testSpeaksTheDifferenceRatherThanPunctuatingIt() {
        let spoken = TwoClocks.bothClocksSpoken(wall(at, vancouver), wall(at, toronto))
        XCTAssertTrue(spoken.contains("which is"), spoken)
        XCTAssertFalse(spoken.contains("·"), spoken)
        let mine = wall(at, toronto)
        XCTAssertEqual(TwoClocks.bothClocksSpoken(mine, mine), mine)
    }

    func testIgnoresPaddingAFormatterAddedOnOneSideOnly() {
        XCTAssertTrue(TwoClocks.sameClock(" Tue, 8:00 AM ", "Tue, 8:00 AM"))
    }

    func testDefaultsATypedTimeToTheReadersOwnClock() {
        // A native picker reads and writes the DEVICE's zone. Starting on theirs
        // would mean the value shown is not the value held.
        XCTAssertEqual(TwoClocks.defaultChoice, .yours)
        XCTAssertEqual(TwoClocks.Choice.yours.label, "Your time")
        XCTAssertEqual(TwoClocks.Choice.theirs.label, "Their time")
    }

    // ------------------------------------------------ against the original

    private func sharedSource() throws -> String {
        var dir = URL(fileURLWithPath: #filePath).deletingLastPathComponent()
        var found: URL?
        while true {
            let candidate = dir.appendingPathComponent("packages/shared/src/two-clocks.ts")
            if FileManager.default.fileExists(atPath: candidate.path) {
                found = candidate
                break
            }
            let parent = dir.deletingLastPathComponent()
            if parent.path == dir.path { break }
            dir = parent
        }
        return try String(contentsOf: try XCTUnwrap(found), encoding: .utf8)
    }

    /// The WORDS match the shared module.
    ///
    /// These are read off a customer's screen on three clients, and a phone saying
    /// "their time" where the laptop says "customer's time" reads as two products.
    func testTheWordingMatchesTheSharedModule() throws {
        let shared = try sharedSource()
        XCTAssertTrue(
            shared.contains("export const CLOCK_THERE = \"\(TwoClocks.there)\""),
            "CLOCK_THERE has drifted from the shared module"
        )
        XCTAssertTrue(
            shared.contains("export const CLOCK_HERE = \"\(TwoClocks.here)\""),
            "CLOCK_HERE has drifted from the shared module"
        )
        for choice in TwoClocks.Choice.allCases {
            XCTAssertTrue(
                shared.contains("\"\(choice.label)\""),
                "the \(choice.rawValue) label has drifted: \(choice.label)"
            )
        }
        XCTAssertTrue(
            shared.contains("CLOCK_CHOICE_DEFAULT: ClockChoice = \"yours\""),
            "the default clock choice has drifted from the shared module"
        )
    }

    /// And the separator, which is the one character a narrow row can lose.
    func testTheSeparatorMatchesTheSharedModule() throws {
        let shared = try sharedSource()
        XCTAssertTrue(
            shared.contains("${t} ${CLOCK_THERE} · ${here.trim()} ${CLOCK_HERE}"),
            "the visible separator has drifted from the shared module"
        )
        XCTAssertTrue(
            shared.contains("which is ${here.trim()}"),
            "the spoken form has drifted from the shared module"
        )
    }
}
