import XCTest

@testable import Loonext

/// #233 — the send-later port, against the same cases the TypeScript original
/// and the Kotlin port are pinned to.
///
/// This file matters more than its Android twin, because it is the only place
/// the Swift port is ever executed: there is no Xcode on the machine these are
/// written on, so CI's iOS job is the first and only thing that compiles them.
/// A `switch` missing an arm or a Monday landing on a Sunday would otherwise
/// reach a device.
final class ScheduledSendTests: XCTestCase {

    private let toronto = TimeZone(identifier: "America/Toronto")!

    private func hour(_ date: Date, in zone: TimeZone) -> Int {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = zone
        return calendar.component(.hour, from: date)
    }

    private func weekday(_ date: Date, in zone: TimeZone) -> Int {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = zone
        return calendar.component(.weekday, from: date)
    }

    private func instant(_ iso: String) -> Date {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime]
        return formatter.date(from: iso)!
    }

    func testPresetsLandOn8amWhereTheCustomerIs() {
        // Mid-afternoon UTC is still morning on the west coast — the case where
        // "tomorrow" is ambiguous if the arithmetic happens in the wrong zone.
        let vancouver = TimeZone(identifier: "America/Vancouver")!
        let presets = schedulePresets(now: instant("2026-06-15T21:00:00Z"), timeZone: vancouver)
        XCTAssertEqual(hour(presets[0].at!, in: vancouver), 8)
    }

    func testStill8amAcrossSpringForward() {
        // 2026-03-08, clocks jump 2am to 3am. A fixed-offset implementation
        // returns 9am here, and nobody notices until a customer does.
        let presets = schedulePresets(now: instant("2026-03-07T12:00:00Z"), timeZone: toronto)
        XCTAssertEqual(hour(presets[0].at!, in: toronto), 8)
    }

    func testStill8amAcrossFallBack() {
        let presets = schedulePresets(now: instant("2026-10-31T12:00:00Z"), timeZone: toronto)
        XCTAssertEqual(hour(presets[0].at!, in: toronto), 8)
    }

    func testMondayLandsOnAMonday() {
        // Calendar's weekday: 1 = Sunday, so Monday is 2.
        let presets = schedulePresets(now: instant("2026-06-17T15:00:00Z"), timeZone: toronto)
        XCTAssertEqual(weekday(presets[1].at!, in: toronto), 2)
        XCTAssertEqual(hour(presets[1].at!, in: toronto), 8)
    }

    func testMondayMeansNextMondayWhenTodayIsMonday() {
        // Otherwise the preset is a time that has passed, which the API refuses
        // — an option that cannot be used.
        let now = instant("2026-06-15T18:00:00Z")  // Monday
        let presets = schedulePresets(now: now, timeZone: toronto)
        XCTAssertEqual(weekday(presets[1].at!, in: toronto), 2)
        XCTAssertGreaterThan(presets[1].at!.timeIntervalSince(now), 0)
    }

    func testNoPresetIsEverAlreadyInThePast() {
        let vancouver = TimeZone(identifier: "America/Vancouver")!
        for hourOffset in 0..<24 {
            let now = instant(String(format: "2026-06-15T%02d:00:00Z", hourOffset))
            for preset in schedulePresets(now: now, timeZone: vancouver) {
                if let at = preset.at {
                    XCTAssertGreaterThan(
                        at.timeIntervalSince(now), 0,
                        "\(preset.id) at hour \(hourOffset) is in the past")
                }
            }
        }
    }

    func testTwoPresetsAndAWayOutInThatOrder() {
        let presets = schedulePresets(now: instant("2026-06-15T12:00:00Z"), timeZone: toronto)
        XCTAssertEqual(presets.map(\.id), ["tomorrow", "monday", "custom"])
        XCTAssertNil(presets[2].at)
    }

    func testEveryReasonHasCopyAndNoneOfItIsACode() {
        for (reason, copy) in ScheduledSend.holdReasons {
            XCTAssertGreaterThan(copy.count, 20, "\(reason) has no copy")
            XCTAssertTrue(copy.contains(" "), "\(reason) reads like a code")
            XCTAssertEqual(copy.trimmingCharacters(in: .whitespaces), copy)
        }
    }

    func testDoesNotPromiseARetryAgainstSomethingThatWillNeverChange() {
        // The distinction that matters. Marking an opt-out recoverable would
        // retry against a STOP forever, and the copy would be promising to send
        // a message that must never go.
        XCTAssertFalse(ScheduledSend.reasonRecovers("recipient_opted_out"))
        XCTAssertFalse(ScheduledSend.reasonRecovers("invalid_destination"))
        XCTAssertFalse(ScheduledSend.reasonRecovers("expired"))
        XCTAssertFalse(ScheduledSend.reasonRecovers("workspace_closed"))

        XCTAssertTrue(ScheduledSend.reasonRecovers("subscription_inactive"))
        XCTAssertTrue(ScheduledSend.reasonRecovers("registration_pending"))
        XCTAssertTrue(ScheduledSend.reasonRecovers("service_unavailable"))
        XCTAssertTrue(ScheduledSend.reasonRecovers("calendar_unverified"))
        XCTAssertTrue(ScheduledSend.reasonRecovers("customer_replied"))
    }

    func testOffersNoRemedyForTheOneThatHasNone() {
        XCTAssertTrue(
            ScheduledSend.holdReasons["recipient_opted_out"]!.contains("Only they can"))
    }

    func testTheWeakestClockRungAdmitsItIsOurs() {
        XCTAssertTrue(
            ScheduledSend.clockProvenance("company").contains("we don't know theirs"))
        XCTAssertTrue(ScheduledSend.clockProvenance("contact").contains("their time"))
        XCTAssertTrue(ScheduledSend.clockProvenance("area_code").contains("area code"))
    }

    func testLiveMeansPendingOrHeldAndNothingElse() {
        XCTAssertEqual(
            ScheduledSend.statuses.filter { ScheduledSend.isLive($0) },
            ["pending", "held"])
    }
}
