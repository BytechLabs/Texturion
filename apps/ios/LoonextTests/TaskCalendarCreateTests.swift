import SwiftUI
import XCTest
@testable import Loonext

/// #739: a long-press (or Return) on a calendar day starts New task due that
/// day, on the WORKSPACE's clock rather than the phone's. Toronto and Los
/// Angeles are the fixtures; Alberta dropped DST in 2026, so it is a poor zone
/// to pin a vector on.
final class TaskCalendarCreateTests: XCTestCase {

    private func calendar(_ id: String) -> Calendar {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: id)!
        return calendar
    }

    private func instant(_ iso: String) -> Date {
        ISO8601DateFormatter().date(from: iso)!
    }

    /// 12 Nov 2026 at midnight on the given calendar's clock.
    private func day(_ calendar: Calendar) -> Date {
        calendar.date(from: DateComponents(year: 2026, month: 11, day: 12))!
    }

    func testTheDueIsNineInTheMorningOfTheTappedDayInTheWorkspaceZone() {
        let toronto = calendar("America/Toronto")
        XCTAssertEqual(
            calendarDayDue(day(toronto), calendar: toronto),
            instant("2026-11-12T14:00:00Z")
        )
        let losAngeles = calendar("America/Los_Angeles")
        XCTAssertEqual(
            calendarDayDue(day(losAngeles), calendar: losAngeles),
            instant("2026-11-12T17:00:00Z")
        )
    }

    func testTheSameTappedDayIsADifferentInstantInEachWorkspaceZone() {
        let toronto = calendar("America/Toronto")
        let losAngeles = calendar("America/Los_Angeles")
        XCTAssertNotEqual(
            calendarDayDue(day(toronto), calendar: toronto),
            calendarDayDue(day(losAngeles), calendar: losAngeles)
        )
    }

    func testTheWorkspaceCalendarReadsTheWorkspaceZoneAndFallsBackToThePhones() {
        XCTAssertEqual(
            workspaceCalendar(timeZoneId: "America/Toronto").timeZone.identifier,
            "America/Toronto"
        )
        let phone = Calendar.current.timeZone
        XCTAssertEqual(workspaceCalendar(timeZoneId: nil).timeZone, phone)
        XCTAssertEqual(workspaceCalendar(timeZoneId: "Not/AZone").timeZone, phone)
    }

    func testReturnOpensNewTaskAndNoOtherKeyDoes() {
        XCTAssertTrue(calendarKeyCreates(.return))
        XCTAssertFalse(calendarKeyCreates(.space))
        XCTAssertFalse(calendarKeyCreates(.tab))
        XCTAssertFalse(calendarKeyCreates(.downArrow))
    }
}
