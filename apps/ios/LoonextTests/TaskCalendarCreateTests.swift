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

    /// 12 Nov 2026 at midnight on the given calendar's clock.
    private func day(_ calendar: Calendar) -> Date {
        calendar.date(from: DateComponents(year: 2026, month: 11, day: 12))!
    }

    func testTheTappedDayCarriesADateAcrossWorkspaceZones() {
        let toronto = calendar("America/Toronto")
        XCTAssertEqual(
            taskDateKey(day(toronto), calendar: toronto),
            "2026-11-12"
        )
        let losAngeles = calendar("America/Los_Angeles")
        XCTAssertEqual(
            taskDateKey(day(losAngeles), calendar: losAngeles),
            "2026-11-12"
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
