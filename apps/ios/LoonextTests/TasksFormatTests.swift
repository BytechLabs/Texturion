import XCTest
@testable import Loonext

/// The due_at offset-ISO encoder (the API requires ISO 8601 WITH offset) plus
/// the pure activity-sentence/label helpers — vectors ported from the Android
/// TaskFormatTest so the two clients never drift.
final class TasksFormatTests: XCTestCase {
    private let toronto = TimeZone(identifier: "America/Toronto")!

    private let utc: Calendar = {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "UTC")!
        return calendar
    }()

    /// A wall-clock date in a concrete zone (the DatePicker's output).
    private func localDate(
        _ year: Int, _ month: Int, _ day: Int, _ hour: Int, _ minute: Int,
        in zone: TimeZone
    ) throws -> Date {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = zone
        return try XCTUnwrap(
            calendar.date(
                from: DateComponents(
                    year: year, month: month, day: day, hour: hour, minute: minute
                )
            )
        )
    }

    // MARK: encodeDueAt

    func testSummerTorontoPickCarriesTheEdtOffset() throws {
        XCTAssertEqual(
            encodeDueAt(try localDate(2026, 7, 15, 15, 0, in: toronto), timeZone: toronto),
            "2026-07-15T15:00:00-04:00"
        )
    }

    func testWinterTorontoPickCarriesTheEstOffset() throws {
        XCTAssertEqual(
            encodeDueAt(try localDate(2026, 1, 15, 9, 30, in: toronto), timeZone: toronto),
            "2026-01-15T09:30:00-05:00"
        )
    }

    func testHalfHourZonesEncodeTheirExactOffset() throws {
        let stJohns = try XCTUnwrap(TimeZone(identifier: "America/St_Johns"))
        XCTAssertEqual(
            encodeDueAt(try localDate(2026, 7, 15, 8, 0, in: stJohns), timeZone: stJohns),
            "2026-07-15T08:00:00-02:30"
        )
    }

    func testUtcEncodesAsZ() throws {
        let zulu = try XCTUnwrap(TimeZone(identifier: "UTC"))
        XCTAssertEqual(
            encodeDueAt(try localDate(2026, 7, 15, 15, 0, in: zulu), timeZone: zulu),
            "2026-07-15T15:00:00Z"
        )
    }

    func testEncodedValueRoundTripsToThePickedInstant() throws {
        let picked = try localDate(2026, 11, 3, 7, 45, in: toronto)
        let encoded = encodeDueAt(picked, timeZone: toronto)
        XCTAssertEqual(parseWireTimestamp(encoded), picked)
    }

    func testAPickInsideTheSpringForwardGapStillEncodesWithARealOffset() throws {
        // 2026-03-08 02:30 does not exist in Toronto — Foundation pushes it
        // forward into EDT; whatever the wall time, the output must parse.
        let resolved = try localDate(2026, 3, 8, 2, 30, in: toronto)
        let encoded = encodeDueAt(resolved, timeZone: toronto)
        XCTAssertNotNil(parseWireTimestamp(encoded))
        XCTAssertTrue(encoded.hasSuffix("-04:00"), "got \(encoded)")
    }

    // MARK: dueSentenceTime

    func testDueSentenceTimeHumanizesTodayAndDatedTimes() throws {
        let now = try XCTUnwrap(ISO8601DateFormatter().date(from: "2026-07-15T16:00:00Z"))
        XCTAssertEqual(
            dueSentenceTime("2026-07-15T15:00:00Z", now: now, calendar: utc),
            "today 3:00 PM"
        )
        XCTAssertEqual(
            dueSentenceTime("2026-07-08T09:00:00Z", now: now, calendar: utc),
            "Jul 8 9:00 AM"
        )
        XCTAssertEqual(dueSentenceTime("garbage", now: now, calendar: utc), "")
    }

    // MARK: formatDue zone behavior

    func testDueDayIsJudgedInTheViewersZoneNotUtc() throws {
        // 03:00Z on Jul 16 is still 23:00 on Jul 15 in Toronto — Today.
        var torontoCalendar = Calendar(identifier: .gregorian)
        torontoCalendar.timeZone = toronto
        let now = try XCTUnwrap(ISO8601DateFormatter().date(from: "2026-07-15T16:00:00Z"))
        XCTAssertEqual(
            formatDue("2026-07-16T03:00:00Z", now: now, calendar: torontoCalendar),
            "Today"
        )
    }

    // MARK: taskEventSentence

    private func event(_ type: String, payload: JSONValue? = nil) -> TaskActivityItem {
        TaskActivityItem(
            kind: "event",
            id: "e1",
            created_at: "2026-07-15T12:00:00Z",
            type: type,
            payload: payload,
            actor_user_id: "u1",
            actor: nil,
            body: nil,
            author_user_id: nil,
            author: nil
        )
    }

    private func memberName(_ userId: String?) -> String? {
        userId == "u2" ? "Priya Shah" : nil
    }

    func testEventSentences() throws {
        let now = try XCTUnwrap(ISO8601DateFormatter().date(from: "2026-07-15T16:00:00Z"))

        XCTAssertEqual(
            taskEventSentence(event("task_created"), by: "Dana", memberName: memberName),
            "Dana turned this into a task"
        )
        XCTAssertEqual(
            taskEventSentence(
                event("task_assigned", payload: .object(["to_user_id": .string("u2")])),
                by: "Dana",
                memberName: memberName
            ),
            "Dana assigned this to Priya Shah"
        )
        // An unresolvable assignee is not faked.
        XCTAssertEqual(
            taskEventSentence(
                event("task_assigned", payload: .object(["to_user_id": .string("u-gone")])),
                by: "Dana",
                memberName: memberName
            ),
            "Dana reassigned this task"
        )
        XCTAssertEqual(
            taskEventSentence(
                event("task_assigned", payload: .object([:])),
                by: "Dana",
                memberName: memberName
            ),
            "Dana unassigned this task"
        )
        XCTAssertEqual(
            taskEventSentence(
                event("task_due_set", payload: .object(["due_at": .string("2026-07-15T15:00:00Z")])),
                by: "Dana",
                memberName: memberName,
                now: now,
                calendar: utc
            ),
            "Dana set the due date to today 3:00 PM"
        )
        XCTAssertEqual(
            taskEventSentence(
                event("task_due_set", payload: .object([:])),
                by: "Dana",
                memberName: memberName
            ),
            "Dana cleared the due date"
        )
        XCTAssertEqual(
            taskEventSentence(event("task_deleted"), by: "Dana", memberName: memberName),
            "Dana removed this task"
        )
        XCTAssertEqual(
            taskEventSentence(event("task_attachment_added"), by: "Dana", memberName: memberName),
            "Dana attached a file"
        )
        XCTAssertEqual(
            taskEventSentence(event("task_attachment_removed"), by: "Dana", memberName: memberName),
            "Dana removed a file"
        )
        // Unknown types are skipped, never crashed on.
        XCTAssertNil(
            taskEventSentence(event("task_sparkled"), by: "Dana", memberName: memberName)
        )
    }

    // MARK: formatBytes

    func testFormatBytes() {
        XCTAssertEqual(formatBytes(nil), "")
        XCTAssertEqual(formatBytes(512), "512 B")
        XCTAssertEqual(formatBytes(2048), "2 KB")
        XCTAssertEqual(formatBytes(1024 * 1024), "1.0 MB")
        XCTAssertEqual(formatBytes(3_670_016), "3.5 MB")
    }
}
