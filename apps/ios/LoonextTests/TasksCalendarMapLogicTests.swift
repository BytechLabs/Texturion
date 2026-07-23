import XCTest
@testable import Loonext

/// The pure Calendar + Map view helpers (#184/#186): the Mon..Sun week-aligned
/// grid window, the tab -> assignee collapse the calendar fetch rides once
/// status goes client-side, the client-side status/due-chip predicates that
/// narrow one fetched month payload, and the Map's coordinate guard +
/// per-contact pin partition. Fixed calendars/clocks throughout so the vectors
/// are deterministic on any CI machine (mirrors the Android TaskCalendarTest).
final class TasksCalendarMapLogicTests: XCTestCase {

    private let utc: Calendar = {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "UTC")!
        return calendar
    }()

    private let toronto: Calendar = {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "America/Toronto")!
        return calendar
    }()

    // 2026-07-15 noon in Toronto (16:00Z).
    private var clockNow: Date {
        ISO8601DateFormatter().date(from: "2026-07-15T16:00:00Z")!
    }

    private func task(
        done: Bool = false,
        dueAt: String? = nil,
        contact: TaskContactLocation? = nil
    ) -> TaskItem {
        TaskItem(
            id: "t1",
            company_id: "c1",
            message_id: "m1",
            conversation_id: "cv1",
            title: "Send the quote",
            description: "",
            assigned_user_id: nil,
            due_at: dueAt,
            created_by_user_id: "u1",
            created_at: "2026-07-01T00:00:00Z",
            updated_at: "2026-07-01T00:00:00Z",
            done: done,
            status: done ? "done" : "open",
            contact: contact,
            attachment_count: nil
        )
    }

    // MARK: - The week-aligned grid window

    private func firstOfMonth(_ year: Int, _ month: Int) -> Date {
        utc.date(from: DateComponents(year: year, month: month, day: 1))!
    }

    private func mondayOnOrBefore(_ date: Date) -> Date {
        var day = utc.startOfDay(for: date)
        while utc.component(.weekday, from: day) != 2 { // 2 == Monday
            day = utc.date(byAdding: .day, value: -1, to: day)!
        }
        return day
    }

    private func sundayOnOrAfter(_ date: Date) -> Date {
        var day = utc.startOfDay(for: date)
        while utc.component(.weekday, from: day) != 1 { // 1 == Sunday
            day = utc.date(byAdding: .day, value: 1, to: day)!
        }
        return day
    }

    func testGridStartIsMondayEndIsSundayAcrossTwoYears() {
        // Differential check against an independent walk, across 24 months
        // (leap February included).
        for offset in 0..<24 {
            let year = 2026 + offset / 12
            let month = offset % 12 + 1
            let first = firstOfMonth(year, month)
            let start = calendarGridStart(first, calendar: utc)
            let end = calendarGridEnd(first, calendar: utc)

            XCTAssertEqual(utc.component(.weekday, from: start), 2, "\(year)-\(month) start not Monday")
            XCTAssertEqual(utc.component(.weekday, from: end), 1, "\(year)-\(month) end not Sunday")
            XCTAssertEqual(start, mondayOnOrBefore(first))

            let lastDay = utc.range(of: .day, in: .month, for: first)!.count
            let last = utc.date(byAdding: .day, value: lastDay - 1, to: first)!
            XCTAssertEqual(end, sundayOnOrAfter(last))

            // Whole weeks only: 4, 5, or 6 rows.
            let days = utc.dateComponents([.day], from: start, to: end).day! + 1
            XCTAssertEqual(days % 7, 0)
            XCTAssertTrue((28...42).contains(days))
        }
    }

    func testGridDaysAreContiguousWholeWeeks() {
        let july = firstOfMonth(2026, 7)
        let days = calendarGridDays(july, calendar: utc)
        // 2026-07-01 is a Wednesday, 2026-07-31 a Friday: the grid runs
        // Mon Jun 29 .. Sun Aug 2 = six weeks = 42 cells.
        XCTAssertEqual(days.count, 42)
        XCTAssertEqual(days.first, calendarGridStart(july, calendar: utc))
        XCTAssertEqual(days.last, calendarGridEnd(july, calendar: utc))
        // Each day is exactly one after the previous.
        for index in 1..<days.count {
            XCTAssertEqual(
                utc.date(byAdding: .day, value: 1, to: days[index - 1]),
                days[index]
            )
        }
    }

    // MARK: - tab -> assignee collapse (status is client-side on the calendar)

    func testStatusTabsCollapseToMeAllToEveryAssigneeChipsOverride() {
        XCTAssertEqual(taskCalendarBaseAssignee(tab: .open, assigneeChip: nil, unassignedChip: false), assigneeMe)
        XCTAssertEqual(taskCalendarBaseAssignee(tab: .mine, assigneeChip: nil, unassignedChip: false), assigneeMe)
        XCTAssertEqual(taskCalendarBaseAssignee(tab: .done, assigneeChip: nil, unassignedChip: false), assigneeMe)
        XCTAssertEqual(taskCalendarBaseAssignee(tab: .all, assigneeChip: nil, unassignedChip: false), assigneeAll)
        // A concrete member chip overrides every tab baseline.
        XCTAssertEqual(taskCalendarBaseAssignee(tab: .all, assigneeChip: "u9", unassignedChip: false), "u9")
        // The unassigned chip drops the pin entirely.
        XCTAssertNil(taskCalendarBaseAssignee(tab: .open, assigneeChip: nil, unassignedChip: true))
    }

    // MARK: - client-side status predicate

    func testOpenAndDoneTabsPartitionByDoneMineAndAllPassEverything() {
        let open = task(done: false)
        let done = task(done: true)
        XCTAssertTrue(matchesCalendarTab(open, tab: .open))
        XCTAssertFalse(matchesCalendarTab(done, tab: .open))
        XCTAssertTrue(matchesCalendarTab(done, tab: .done))
        XCTAssertFalse(matchesCalendarTab(open, tab: .done))
        XCTAssertTrue(matchesCalendarTab(open, tab: .mine))
        XCTAssertTrue(matchesCalendarTab(done, tab: .all))
    }

    // MARK: - client-side due-chip predicate

    func testNoChipPassesEverythingDatedOrNot() {
        XCTAssertTrue(matchesCalendarDueChip(task(), chip: nil, now: clockNow, calendar: toronto))
        XCTAssertTrue(matchesCalendarDueChip(
            task(dueAt: "2026-07-20T12:00:00-04:00"), chip: nil, now: clockNow, calendar: toronto
        ))
    }

    func testOverdueChipIsPastDueAndNotDoneUndatedNeverMatches() {
        let pastDue = "2026-07-15T10:00:00-04:00" // 14:00Z, before the 16:00Z clock
        XCTAssertTrue(matchesCalendarDueChip(
            task(dueAt: pastDue), chip: .overdue, now: clockNow, calendar: toronto
        ))
        XCTAssertFalse(matchesCalendarDueChip(
            task(done: true, dueAt: pastDue), chip: .overdue, now: clockNow, calendar: toronto
        ))
        XCTAssertFalse(matchesCalendarDueChip(task(), chip: .overdue, now: clockNow, calendar: toronto))
    }

    func testTodayChipIsTheLocalCalendarDayHalfOpen() {
        // 23:00 Toronto tonight is still today; 09:00 tomorrow is not.
        XCTAssertTrue(matchesCalendarDueChip(
            task(dueAt: "2026-07-15T23:00:00-04:00"), chip: .today, now: clockNow, calendar: toronto
        ))
        XCTAssertFalse(matchesCalendarDueChip(
            task(dueAt: "2026-07-16T09:00:00-04:00"), chip: .today, now: clockNow, calendar: toronto
        ))
        XCTAssertFalse(matchesCalendarDueChip(task(), chip: .today, now: clockNow, calendar: toronto))
    }

    func testWeekChipSpansSevenLocalDaysFromStartOfToday() {
        XCTAssertTrue(matchesCalendarDueChip(
            task(dueAt: "2026-07-16T09:00:00-04:00"), chip: .week, now: clockNow, calendar: toronto
        ))
        XCTAssertTrue(matchesCalendarDueChip(
            task(dueAt: "2026-07-21T12:00:00-04:00"), chip: .week, now: clockNow, calendar: toronto
        ))
        // The 22nd is day eight — outside the half-open window.
        XCTAssertFalse(matchesCalendarDueChip(
            task(dueAt: "2026-07-22T12:00:00-04:00"), chip: .week, now: clockNow, calendar: toronto
        ))
    }

    // MARK: - Map: coordinate guard

    private func contact(id: String, name: String?, lat: Double?, lng: Double?) -> TaskContactLocation {
        TaskContactLocation(id: id, name: name, lat: lat, lng: lng)
    }

    func testTaskPinCoordsAcceptsInRangeFiniteCoordinatesOnly() {
        XCTAssertNil(taskPinCoords(task(contact: nil)))
        XCTAssertNil(taskPinCoords(task(contact: contact(id: "c1", name: "A", lat: nil, lng: -80))))
        XCTAssertNil(taskPinCoords(task(contact: contact(id: "c1", name: "A", lat: 43, lng: nil))))
        XCTAssertNil(taskPinCoords(task(contact: contact(id: "c1", name: "A", lat: 91, lng: -80))))
        XCTAssertNil(taskPinCoords(task(contact: contact(id: "c1", name: "A", lat: 43, lng: 181))))
        XCTAssertNil(taskPinCoords(task(contact: contact(id: "c1", name: "A", lat: .nan, lng: -80))))
        XCTAssertNil(taskPinCoords(task(contact: contact(id: "c1", name: "A", lat: 43, lng: .infinity))))

        let ok = taskPinCoords(task(contact: contact(id: "c1", name: "A", lat: 43.65, lng: -79.38)))
        XCTAssertEqual(ok?.lat, 43.65)
        XCTAssertEqual(ok?.lng, -79.38)
    }

    // MARK: - Map: located/unlocated partition

    private func located(id: String, contactId: String, name: String?, lat: Double, lng: Double) -> TaskItem {
        TaskItem(
            id: id,
            company_id: "c1",
            message_id: "m-\(id)",
            conversation_id: "cv1",
            title: "Task \(id)",
            description: "",
            assigned_user_id: nil,
            due_at: nil,
            created_by_user_id: "u1",
            created_at: "2026-07-01T00:00:00Z",
            updated_at: "2026-07-01T00:00:00Z",
            done: false,
            status: "open",
            contact: contact(id: contactId, name: name, lat: lat, lng: lng),
            attachment_count: nil
        )
    }

    func testBuildTaskMapModelFusesTasksAtOneContactAndCountsMissing() {
        let rows = [
            located(id: "a", contactId: "c1", name: "Henderson", lat: 43.6, lng: -79.4),
            located(id: "b", contactId: "c1", name: "Henderson", lat: 43.6, lng: -79.4),
            located(id: "c", contactId: "c2", name: "Ochoa", lat: 40.7, lng: -74.0),
            task(contact: nil), // unlocated
            task(contact: contact(id: "c3", name: "Bad", lat: 999, lng: -74)), // out of range -> unlocated
        ]
        let model = buildTaskMapModel(rows)

        XCTAssertEqual(model.located, 3)
        XCTAssertEqual(model.missing, 2)
        XCTAssertEqual(model.groups.count, 2)

        // Group order follows first appearance.
        XCTAssertEqual(model.groups.map(\.id), ["c1", "c2"])
        let henderson = model.groups[0]
        XCTAssertEqual(henderson.tasks.map(\.id), ["a", "b"])
        XCTAssertEqual(henderson.contactName, "Henderson")
        XCTAssertEqual(henderson.lat, 43.6)
        XCTAssertEqual(model.groups[1].tasks.map(\.id), ["c"])
    }

    func testBuildTaskMapModelBlankContactNameCollapsesToNil() {
        let rows = [located(id: "a", contactId: "c1", name: "   ", lat: 43.6, lng: -79.4)]
        let model = buildTaskMapModel(rows)
        XCTAssertEqual(model.groups.count, 1)
        XCTAssertNil(model.groups[0].contactName)
    }

    func testBuildTaskMapModelEmptyRowsIsAllZeros() {
        let model = buildTaskMapModel([])
        XCTAssertTrue(model.groups.isEmpty)
        XCTAssertEqual(model.located, 0)
        XCTAssertEqual(model.missing, 0)
    }
}
