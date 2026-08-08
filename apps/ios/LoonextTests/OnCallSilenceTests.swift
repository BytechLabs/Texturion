import XCTest

@testable import Loonext

/// #538 (audit) — going quiet while you are the one on call.
///
/// The same set the Kotlin twin asserts, plus a read of the shared TypeScript. The
/// wording matters as much as the logic: this sentence is the only thing standing
/// between somebody's quiet evening and a customer who texted and got nothing back.
final class OnCallSilenceTests: XCTestCase {

    private let me = "u-me"
    private let somebody = "u-else"

    private func at(_ iso: String) -> Date {
        let f = ISO8601DateFormatter()
        return f.date(from: iso)!
    }

    /// Inside the shifts below.
    private var now: Date { at("2026-08-11T18:00:00Z") }

    private func shift(_ user: String, _ from: String, _ until: String) -> OnCallSilence.Shift {
        OnCallSilence.Shift(userId: user, startsAt: from, endsAt: until)
    }

    func testIsTrueInsideMyOwnShift() {
        XCTAssertTrue(
            OnCallSilence.isOnCallNow(
                [shift(me, "2026-08-11T12:00:00Z", "2026-08-12T00:00:00Z")],
                userId: me,
                now: now
            )
        )
    }

    func testIsFalseForSomebodyElsesShift() {
        // The warning is about the person holding the phone, not about the workspace
        // having a rota at all.
        XCTAssertFalse(
            OnCallSilence.isOnCallNow(
                [shift(somebody, "2026-08-11T12:00:00Z", "2026-08-12T00:00:00Z")],
                userId: me,
                now: now
            )
        )
    }

    func testIsFalseBeforeItStartsAndAfterItEnds() {
        XCTAssertFalse(
            OnCallSilence.isOnCallNow(
                [shift(me, "2026-08-11T19:00:00Z", "2026-08-12T00:00:00Z")],
                userId: me,
                now: now
            )
        )
        XCTAssertFalse(
            OnCallSilence.isOnCallNow(
                [shift(me, "2026-08-11T06:00:00Z", "2026-08-11T12:00:00Z")],
                userId: me,
                now: now
            )
        )
    }

    func testTreatsTheEndAsExclusiveSoBackToBackShiftsDoNotOverlap() {
        // Two people handing over at six o'clock must not both count as on call for
        // that instant, or the handover minute warns the wrong person.
        let handover = at("2026-08-11T18:00:00Z")
        XCTAssertFalse(
            OnCallSilence.isOnCallNow(
                [shift(me, "2026-08-11T12:00:00Z", "2026-08-11T18:00:00Z")],
                userId: me,
                now: handover
            )
        )
        XCTAssertTrue(
            OnCallSilence.isOnCallNow(
                [shift(me, "2026-08-11T18:00:00Z", "2026-08-12T00:00:00Z")],
                userId: me,
                now: handover
            )
        )
    }

    func testIgnoresAShiftWithAnUnreadableStamp() {
        // A warning that fires wrongly is one people learn to dismiss, which costs
        // more than the one it was meant to prevent.
        XCTAssertFalse(
            OnCallSilence.isOnCallNow(
                [shift(me, "not a date", "also not")],
                userId: me,
                now: now
            )
        )
    }

    func testIsFalseWithNoShiftsAtAll() {
        XCTAssertFalse(OnCallSilence.isOnCallNow([], userId: me, now: now))
    }

    func testWarnsWhenSomebodyOnCallSwitchesAChannelOff() {
        let warning = OnCallSilence.warning(onCall: true, turningOff: true, channel: "push")!
        XCTAssertTrue(warning.contains("on call right now"), warning)
        // Says what is actually lost — the pages reach nothing — and that nobody else
        // finds out, which is the part that makes it a customer problem.
        XCTAssertTrue(warning.contains("go nowhere"), warning)
        XCTAssertTrue(warning.contains("no one else is told"), warning)
        // And offers the way out rather than only the objection.
        XCTAssertTrue(warning.contains("Hand the shift over"), warning)
    }

    func testNamesTheChannelBeingSwitchedOff() {
        XCTAssertTrue(
            OnCallSilence.warning(onCall: true, turningOff: true, channel: "push")!
                .contains("Push alerts")
        )
        XCTAssertTrue(
            OnCallSilence.warning(onCall: true, turningOff: true, channel: "email")!
                .contains("Emails")
        )
    }

    func testSaysNothingWhenNotOnCallOrSwitchingSomethingOn() {
        // Turning notifications back on is the good outcome. A dialog there would be
        // punishing the fix.
        XCTAssertNil(OnCallSilence.warning(onCall: false, turningOff: true, channel: "push"))
        XCTAssertNil(OnCallSilence.warning(onCall: true, turningOff: false, channel: "push"))
    }

    // ------------------------------------------------ against the original

    /// The shared source, with carriage returns stripped — this tree is CRLF.
    private func sharedSource() throws -> String {
        var dir = URL(fileURLWithPath: #filePath).deletingLastPathComponent()
        var found: URL?
        while true {
            let candidate = dir.appendingPathComponent(
                "packages/shared/src/on-call-notifications.ts"
            )
            if FileManager.default.fileExists(atPath: candidate.path) {
                found = candidate
                break
            }
            let parent = dir.deletingLastPathComponent()
            if parent.path == dir.path { break }
            dir = parent
        }
        let text = try String(contentsOf: try XCTUnwrap(found), encoding: .utf8)
        return text.replacingOccurrences(of: "\r", with: "")
    }

    /// The whole sentence matches the shared module, reconstructed.
    ///
    /// Both sides are reduced to their letters — concatenation syntax stripped, the
    /// channel name blanked, whitespace collapsed — and compared whole. A reworded
    /// warning on any client fails; a rewrapped one does not. The Kotlin twin's first
    /// version compared source fragments and failed on a line break.
    func testTheWarningMatchesTheSharedModule() throws {
        let shared = try sharedSource()
        let start = try XCTUnwrap(shared.range(of: "`You're on call right now."))
        let end = try XCTUnwrap(
            shared.range(of: "`\n  );", range: start.upperBound..<shared.endIndex)
        )
        func bare(_ text: String) -> String {
            var out = text
            for token in ["`", "+", "${what}", "Push alerts", "Emails"] {
                out = out.replacingOccurrences(of: token, with: "")
            }
            return out
                .replacingOccurrences(
                    of: "\\s+",
                    with: " ",
                    options: .regularExpression
                )
                .trimmingCharacters(in: .whitespacesAndNewlines)
        }
        XCTAssertEqual(
            bare(String(shared[start.lowerBound..<end.lowerBound])),
            bare(OnCallSilence.warning(onCall: true, turningOff: true, channel: "push")!),
            "the warning has drifted from the shared module"
        )
    }

    /// And the two button labels, which are the decision a thumb reads.
    func testTheButtonLabelsMatchTheSharedModule() throws {
        let shared = try sharedSource()
        XCTAssertTrue(
            shared.contains("\"\(OnCallSilence.confirm)\""),
            "the confirm label has drifted: \(OnCallSilence.confirm)"
        )
        XCTAssertTrue(
            shared.contains("\"\(OnCallSilence.cancel)\""),
            "the cancel label has drifted: \(OnCallSilence.cancel)"
        )
    }
}
