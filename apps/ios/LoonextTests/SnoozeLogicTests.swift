import XCTest

@testable import Loonext

/// #293 — the presets, and the rule that decides which are offered.
///
/// Mirrors packages/shared/src/snooze.test.ts and SnoozeLogicTest.kt case for
/// case. Swift does not compile on the machine this was written on, so this
/// file is the only thing standing between a wrong calendar assumption and a
/// thread that comes back at the wrong time on one device — which is worse than
/// no snooze at all.
///
/// A FIXED calendar and zone throughout: the presets resolve in the device's
/// own zone, so a test that used the machine's would pass or fail depending on
/// where CI runs.
final class SnoozeLogicTests: XCTestCase {
    private var calendar: Calendar = {
        var cal = Calendar(identifier: .gregorian)
        cal.timeZone = TimeZone(identifier: "America/Toronto")!
        cal.locale = Locale(identifier: "en_US")
        return cal
    }()

    /// 2026-08-05 is a Wednesday.
    private func at(_ hour: Int, _ minute: Int = 0, day: Int = 5) -> Date {
        var parts = DateComponents()
        parts.year = 2026
        parts.month = 8
        parts.day = day
        parts.hour = hour
        parts.minute = minute
        return calendar.date(from: parts)!
    }

    // MARK: - The ladder

    func testOffersTheWholeLadderFirstThingInTheMorning() {
        let presets = snoozePresets(now: at(7), calendar: calendar)
        XCTAssertEqual(
            presets.map(\.id),
            [.laterToday, .thisEvening, .tomorrow, .nextWeek]
        )
        XCTAssertEqual(
            presets.map(\.label),
            ["This afternoon", "This evening", "Tomorrow morning", "Next week"]
        )
    }

    func testResolvesEachPresetToTheRightHourOfTheRightDay() {
        let byID = Dictionary(
            uniqueKeysWithValues: snoozePresets(now: at(7), calendar: calendar).map {
                ($0.id, $0.at)
            }
        )
        XCTAssertEqual(byID[.laterToday], at(15))
        XCTAssertEqual(byID[.thisEvening], at(18))
        XCTAssertEqual(byID[.tomorrow], at(8, day: 6))
        // Wednesday the 5th → Monday the 10th.
        XCTAssertEqual(byID[.nextWeek], at(8, day: 10))
    }

    func testDropsAPresetOnceItIsBehindUsRatherThanGreyingItOut() {
        XCTAssertEqual(
            snoozePresets(now: at(16), calendar: calendar).map(\.id),
            [.thisEvening, .tomorrow, .nextWeek]
        )
        XCTAssertEqual(
            snoozePresets(now: at(19), calendar: calendar).map(\.id),
            [.tomorrow, .nextWeek]
        )
    }

    func testDropsAPresetThatIsAheadButUselesslyClose() {
        // 14:55 — "This afternoon" is five minutes away, so the thread would
        // blink out and come straight back.
        XCTAssertFalse(
            snoozePresets(now: at(14, 55), calendar: calendar)
                .contains { $0.id == .laterToday }
        )
        // The boundary is the lead time, not the hour.
        let justEnough = at(15).addingTimeInterval(-SnoozeTiming.minLead - 60)
        XCTAssertTrue(
            snoozePresets(now: justEnough, calendar: calendar)
                .contains { $0.id == .laterToday }
        )
    }

    func testNeverReturnsAPresetInThePastAtAnyHourOfAnyDay() {
        for day in 1...14 {
            for hour in 0..<24 {
                let now = at(hour, 30, day: day)
                for preset in snoozePresets(now: now, calendar: calendar) {
                    XCTAssertGreaterThan(
                        preset.at, now,
                        "day=\(day) hour=\(hour) offered \(preset.id) in the past"
                    )
                }
            }
        }
    }

    func testTheChaseLadderIsADifferentLadderEveryRungAMorning() {
        // Deferring your own next action and waiting on somebody else's answer
        // run on different clocks. One ladder for both would put three useless
        // options in front of whichever job you were doing.
        let presets = followUpPresets(now: at(9), calendar: calendar)
        XCTAssertEqual(presets.map(\.id), [.threeDays, .nextWeek, .twoWeeks])
        XCTAssertEqual(
            presets.map(\.label), ["In 3 days", "Next week", "In 2 weeks"])
        // Wednesday the 5th → the 8th, Monday the 10th, the 19th, all at 08:00.
        XCTAssertEqual(
            presets.map(\.at),
            [at(8, day: 8), at(8, day: 10), at(8, day: 19)]
        )
    }

    func testTheChaseLadderNeverOffersARungInThePast() {
        for day in 1...14 {
            for hour in 0..<24 {
                let now = at(hour, 30, day: day)
                for preset in followUpPresets(now: now, calendar: calendar) {
                    XCTAssertGreaterThan(
                        preset.at, now,
                        "day=\(day) hour=\(hour) offered \(preset.id) in the past"
                    )
                }
            }
        }
    }

    func testNextMondayIsNextWeeksNeverToday() {
        // Calendar's weekday numbering is 1 = Sunday, which is NOT java.time's
        // or JavaScript's — this is the assertion that the conversion is right
        // rather than merely plausible.
        XCTAssertEqual(daysUntilNextMonday(at(9, day: 3), calendar: calendar), 7)  // Mon
        XCTAssertEqual(daysUntilNextMonday(at(9, day: 5), calendar: calendar), 5)  // Wed
        XCTAssertEqual(daysUntilNextMonday(at(9, day: 8), calendar: calendar), 2)  // Sat
        XCTAssertEqual(daysUntilNextMonday(at(9, day: 9), calendar: calendar), 1)  // Sun
    }

    // MARK: - The gates

    func testACustomTargetMustBeAheadAndInsideTheCap() {
        let now = at(9)
        XCTAssertFalse(isSnoozeTargetValid(now.addingTimeInterval(-1), now: now))
        XCTAssertFalse(isSnoozeTargetValid(now, now: now))
        XCTAssertTrue(isSnoozeTargetValid(now.addingTimeInterval(1), now: now))
        let cap = SnoozeTiming.maxDays * 86_400
        XCTAssertTrue(isSnoozeTargetValid(now.addingTimeInterval(cap), now: now))
        XCTAssertFalse(isSnoozeTargetValid(now.addingTimeInterval(cap + 1), now: now))
    }

    // MARK: - The label

    func testTheReturnShapeCountsDayBoundariesNotElapsedHours() {
        // 11pm to 1am is two hours and still "tomorrow"…
        XCTAssertEqual(
            snoozeReturnShape(until: at(1, day: 6), now: at(23, day: 5), calendar: calendar),
            .tomorrow
        )
        // …and 1am to 11pm is twenty-two hours and still "today".
        XCTAssertEqual(
            snoozeReturnShape(until: at(23, day: 5), now: at(1, day: 5), calendar: calendar),
            .today
        )
    }

    func testTheReturnShapeUsesAWeekdayInsideTheWeekAndADateBeyondIt() {
        let now = at(9, day: 5)
        XCTAssertEqual(
            snoozeReturnShape(until: at(9, day: 8), now: now, calendar: calendar), .weekday)
        XCTAssertEqual(
            snoozeReturnShape(until: at(9, day: 11), now: now, calendar: calendar), .weekday)
        // Seven days out, "Wednesday" could be either one.
        XCTAssertEqual(
            snoozeReturnShape(until: at(9, day: 12), now: now, calendar: calendar), .date)
        // An already-elapsed return is today, not a negative date.
        XCTAssertEqual(
            snoozeReturnShape(until: at(9, day: 1), now: now, calendar: calendar), .today)
    }

    func testTheLabelNamesTheDayItComesBack() {
        let now = at(9, day: 5)
        XCTAssertTrue(
            snoozeReturnLabel(at(15, day: 5), now: now, calendar: calendar)
                .hasPrefix("Back at "))
        XCTAssertTrue(
            snoozeReturnLabel(at(8, day: 6), now: now, calendar: calendar)
                .hasPrefix("Back tomorrow, "))
        XCTAssertTrue(
            snoozeReturnLabel(at(8, day: 8), now: now, calendar: calendar)
                .hasPrefix("Back Saturday, "))
    }

    // MARK: - The wire

    func testDeferralIsComputedFromTheReturnTimeNeverTheFieldsPresence() {
        let now = at(10)
        XCTAssertFalse(isSnoozed(nil, now: now))
        XCTAssertTrue(isSnoozed("2026-08-05T18:00:00Z", now: now))
        XCTAssertFalse(isSnoozed("2026-08-05T00:00:00Z", now: now))
    }

    func testAnUnparseableTimestampCountsAsNotDeferredNeverAsHidden() {
        // Hiding a live thread because a date failed to parse is the one
        // direction this must never fail in.
        XCTAssertFalse(isSnoozed("not a date", now: at(10)))
    }

    func testBothWireShapesParseNotJustTheOneWeHappenedToTestWith() {
        // PostgREST renders timestamptz with "+00:00" and sometimes a
        // fractional part. ISO8601DateFormatter matches its options EXACTLY, so
        // a single formatter returns nil for the other shape — which would have
        // made every real snooze look already-elapsed.
        XCTAssertNotNil(parseSnoozeInstant("2026-08-05T18:00:00Z"))
        XCTAssertNotNil(parseSnoozeInstant("2026-08-05T18:00:00+00:00"))
        XCTAssertNotNil(parseSnoozeInstant("2026-08-05T18:00:00.123456+00:00"))
        XCTAssertEqual(
            parseSnoozeInstant("2026-08-05T18:00:00+00:00"),
            parseSnoozeInstant("2026-08-05T18:00:00Z")
        )
    }

    func testTheInstantWeSendIsTheOneTheRouteAccepts() {
        // The route validates with z.iso.datetime({ offset: true }), which
        // rejects a bare local time — so this has to carry the zone.
        let iso = snoozeInstantISO(at(15, day: 5))
        XCTAssertEqual(parseSnoozeInstant(iso), at(15, day: 5))
        XCTAssertTrue(iso.hasSuffix("Z"))
    }
}
