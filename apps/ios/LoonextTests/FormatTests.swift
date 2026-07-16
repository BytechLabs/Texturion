import XCTest
@testable import Loonext

/// Pure formatting helpers — pinned to a UTC calendar so the assertions are
/// deterministic on any CI machine.
final class FormatTests: XCTestCase {
    private let utc: Calendar = {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "UTC")!
        return calendar
    }()

    private func date(_ iso: String) throws -> Date {
        try XCTUnwrap(ISO8601DateFormatter().date(from: iso))
    }

    // MARK: relativeTime

    func testRelativeTimeBuckets() throws {
        let now = try date("2026-07-15T12:00:00Z")
        XCTAssertEqual(relativeTime("2026-07-15T11:59:40Z", now: now, calendar: utc), "now")
        XCTAssertEqual(relativeTime("2026-07-15T11:55:00Z", now: now, calendar: utc), "5m")
        XCTAssertEqual(relativeTime("2026-07-15T09:00:00Z", now: now, calendar: utc), "3h")
        XCTAssertEqual(relativeTime("2026-07-13T12:00:00Z", now: now, calendar: utc), "2d")
        // Same year past a week → month-day.
        XCTAssertEqual(relativeTime("2026-06-25T12:00:00Z", now: now, calendar: utc), "Jun 25")
        // Older year carries the year.
        XCTAssertEqual(relativeTime("2025-07-08T12:00:00Z", now: now, calendar: utc), "Jul 8 2025")
    }

    func testRelativeTimeAcceptsWireTimestampShapes() throws {
        let now = try date("2026-07-15T12:00:00Z")
        // Postgres offset form.
        XCTAssertEqual(relativeTime("2026-07-15T07:55:00-04:00", now: now, calendar: utc), "5m")
        // Fractional seconds.
        XCTAssertEqual(relativeTime("2026-07-15T11:55:00.123Z", now: now, calendar: utc), "5m")
        // Garbage renders nothing, never crashes.
        XCTAssertEqual(relativeTime("not-a-date", now: now, calendar: utc), "")
    }

    // MARK: parseWireTimestamp

    func testParseWireTimestampShapes() {
        XCTAssertNotNil(parseWireTimestamp("2026-07-15T12:00:00Z"))
        XCTAssertNotNil(parseWireTimestamp("2026-07-15T12:00:00+00:00"))
        XCTAssertNotNil(parseWireTimestamp("2026-07-15T08:00:00-04:00"))
        XCTAssertNotNil(parseWireTimestamp("2026-07-15T12:00:00.250Z"))
        XCTAssertNil(parseWireTimestamp(nil))
        XCTAssertNil(parseWireTimestamp("garbage"))
        // Z and +00:00 are the same instant.
        XCTAssertEqual(
            parseWireTimestamp("2026-07-15T12:00:00Z"),
            parseWireTimestamp("2026-07-15T12:00:00+00:00")
        )
    }

    // MARK: formatPhone

    func testFormatPhoneNanp() {
        XCTAssertEqual(formatPhone("+14155550134"), "(415) 555-0134")
    }

    func testFormatPhonePassesThroughNonNanp() {
        XCTAssertEqual(formatPhone("+442071838750"), "+442071838750")
        XCTAssertEqual(formatPhone("+1415555013"), "+1415555013") // 9 digits
        XCTAssertEqual(formatPhone("415-555-0134"), "415-555-0134")
        XCTAssertEqual(formatPhone(nil), "")
    }

    // MARK: initialsOf

    func testInitials() {
        XCTAssertEqual(initialsOf("Dana Whitcomb"), "DW")
        XCTAssertEqual(initialsOf("cher"), "CH")
        XCTAssertEqual(initialsOf("Ana Maria Rojas"), "AR")
        XCTAssertEqual(initialsOf("  "), "#")
        XCTAssertEqual(initialsOf(nil), "#")
    }

    // MARK: formatDue / isOverdue

    private func makeTask(done: Bool, dueAt: String?) -> TaskItem {
        TaskItem(
            id: "t1",
            company_id: "c1",
            message_id: "m1",
            conversation_id: "conv1",
            title: "Fix sink",
            description: "",
            assigned_user_id: nil,
            due_at: dueAt,
            created_by_user_id: "u1",
            created_at: "2026-07-01T00:00:00Z",
            updated_at: "2026-07-01T00:00:00Z",
            done: done,
            status: done ? "done" : "open",
            contact: nil,
            attachment_count: nil
        )
    }

    func testFormatDue() throws {
        let now = try date("2026-07-15T12:00:00Z")
        XCTAssertEqual(formatDue("2026-07-15T20:00:00Z", now: now, calendar: utc), "Today")
        XCTAssertEqual(formatDue("2026-07-16T01:00:00Z", now: now, calendar: utc), "Tomorrow")
        XCTAssertEqual(formatDue("2026-07-20T12:00:00Z", now: now, calendar: utc), "Jul 20")
        XCTAssertEqual(formatDue("2027-01-05T12:00:00Z", now: now, calendar: utc), "Jan 5 2027")
        XCTAssertEqual(formatDue(nil, now: now, calendar: utc), "")
        XCTAssertEqual(formatDue("garbage", now: now, calendar: utc), "")
    }

    func testIsOverdue() throws {
        let now = try date("2026-07-15T12:00:00Z")
        // Past due + not done = overdue.
        XCTAssertTrue(isOverdue(makeTask(done: false, dueAt: "2026-07-14T12:00:00Z"), now: now))
        // Done tasks are never overdue.
        XCTAssertFalse(isOverdue(makeTask(done: true, dueAt: "2026-07-14T12:00:00Z"), now: now))
        // Future due is not overdue.
        XCTAssertFalse(isOverdue(makeTask(done: false, dueAt: "2026-07-16T12:00:00Z"), now: now))
        // No due date / unparseable = never overdue.
        XCTAssertFalse(isOverdue(makeTask(done: false, dueAt: nil), now: now))
        XCTAssertFalse(isOverdue(makeTask(done: false, dueAt: "garbage"), now: now))
    }
}
