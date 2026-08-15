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

    /// Any repo file, walked up to from this test's own location.
    ///
    /// `sharedSource()` below hardcodes one path; #228 needs a second, so the
    /// walk is factored out rather than copied.
    private func repoFile(_ relative: String) throws -> String {
        var dir = URL(fileURLWithPath: #filePath).deletingLastPathComponent()
        while true {
            let candidate = dir.appendingPathComponent(relative)
            if FileManager.default.fileExists(atPath: candidate.path) {
                return try String(contentsOf: candidate, encoding: .utf8)
            }
            let parent = dir.deletingLastPathComponent()
            if parent.path == dir.path { break }
            dir = parent
        }
        XCTFail("\(relative) is not reachable from \(#filePath)")
        return ""
    }

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

    /// The area-code explanation matches the shared module, word for word.
    ///
    /// This is the sentence that answers the founder's "why are we deriving time from
    /// customers area codes even?", and a phone that words it differently from the
    /// laptop reads as two products disagreeing about their own rules. Asserted
    /// against the shared text rather than against another copy of itself — that is
    /// the mistake that let two Customise labels drift on #540.
    func testTheAreaCodeExplanationMatchesTheSharedModule() throws {
        // #228: the SENTENCE lives in the web catalogue now; the shared
        // module names a key. `sharedSource()` stays for the tests around
        // this one, which read rules rather than copy.
        let raw = try repoFile("apps/web/src/i18n/sections/domain.ts")
        guard let start = raw.range(of: "export const domainEn"),
              let end = raw.range(of: "export const domainFr")
        else {
            return XCTFail("domain.ts no longer has both language blocks")
        }
        let shared = String(raw[start.upperBound ..< end.lowerBound])
        XCTAssertTrue(
            shared.contains(TwoClocks.areaCodeNote),
            "areaCodeNote has drifted: \(TwoClocks.areaCodeNote)"
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

/// #539 — turning "8:30 their time" into a moment on iOS.
///
/// `Calendar.date(from:)` is doing the work, and "the platform probably does the
/// right thing" is not a claim worth shipping on the two mornings a year it
/// matters. These assert the PROPERTY that matters — never earlier than what was
/// asked for — rather than a specific minute past the gap, which is Foundation's
/// business and not worth pinning to a constant nobody here can observe.
final class ReinterpretClockTests: XCTestCase {

    private let toronto = TimeZone(identifier: "America/Toronto")!
    private let vancouver = TimeZone(identifier: "America/Vancouver")!

    private func components(_ at: Date, _ zone: TimeZone) -> DateComponents {
        var cal = Calendar(identifier: .gregorian)
        cal.timeZone = zone
        return cal.dateComponents([.year, .month, .day, .hour, .minute], from: at)
    }

    private func instant(_ iso: String) -> Date {
        let f = ISO8601DateFormatter()
        return f.date(from: iso)!
    }

    func testTheSameDigitsBecomeADifferentMoment() {
        // THE WHOLE POINT. 8:30 in Toronto is a different instant from 8:30 in
        // Vancouver; if these matched, the switch would be decorative.
        let shown = instant("2026-08-11T12:30:00Z")  // 8:30 AM Toronto
        let asTheirs = TwoClocks.reinterpret(shown, from: toronto, to: vancouver)
        XCTAssertNotEqual(shown, asTheirs)
        // And the digits survived: 8:30 on THEIR clock.
        let there = components(asTheirs, vancouver)
        XCTAssertEqual(there.hour, 8)
        XCTAssertEqual(there.minute, 30)
    }

    func testTheSameZoneIsTheSameMoment() {
        let shown = instant("2026-08-11T12:30:00Z")
        XCTAssertEqual(TwoClocks.reinterpret(shown, from: toronto, to: toronto), shown)
    }

    func testAHalfHourZoneKeepsItsMinutes() {
        // Newfoundland is UTC-3:30, where an hours-apart number is wrong every day.
        let stJohns = TimeZone(identifier: "America/St_Johns")!
        let shown = instant("2026-08-11T12:30:00Z")
        let asTheirs = TwoClocks.reinterpret(shown, from: toronto, to: stJohns)
        let there = components(asTheirs, stJohns)
        XCTAssertEqual(there.hour, 8)
        XCTAssertEqual(there.minute, 30)
    }

    func testAskingForATimeThatNeverHappenedNeverGoesEarlier() {
        // 2:30am does not exist on 2026-03-08 in Toronto — the clocks jump 2 to 3.
        // Whatever Foundation picks, it must not be BEFORE what was asked for: an
        // hour early is a text at 1:30am that the sender never authorised.
        var cal = Calendar(identifier: .gregorian)
        cal.timeZone = vancouver
        // 2:30 on the Vancouver morning that also skips it.
        let shown = cal.date(from: DateComponents(
            year: 2026, month: 3, day: 8, hour: 6, minute: 30
        ))!
        let landed = TwoClocks.reinterpret(shown, from: vancouver, to: toronto)
        let there = components(landed, toronto)
        XCTAssertGreaterThanOrEqual(
            there.hour!, 3,
            "a send asked for at a time that never happened must not go earlier"
        )
    }

    func testARepeatedHourTakesTheEarlierOfTheTwo() {
        // 1:30am happens twice on 2026-11-01 in Toronto. The later one would send an
        // hour after the sender expected.
        var cal = Calendar(identifier: .gregorian)
        cal.timeZone = vancouver
        let shown = cal.date(from: DateComponents(
            year: 2026, month: 11, day: 1, hour: 1, minute: 30
        ))!
        let landed = TwoClocks.reinterpret(shown, from: vancouver, to: toronto)
        // EDT is UTC-4, so the first 1:30 is 05:30Z; the second is 06:30Z.
        XCTAssertEqual(landed, instant("2026-11-01T05:30:00Z"))
    }
}
