import XCTest
@testable import Loonext

/// The frozen /v1/tasks route semantics, ported from the web's
/// task-params.ts: silent defaults, the "all" sentinel, the dual-cursor
/// ordering guard, and the tab → arms resolution.
final class TaskFiltersTests: XCTestCase {
    private let utc: Calendar = {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "UTC")!
        return calendar
    }()

    private func sent(_ filters: TaskListFilters, cursor: String? = nil) -> [String: String] {
        taskQueryParams(filters, cursor: cursor).compactMapValues { $0 }
    }

    // MARK: taskQueryParams

    func testNoParamsMeansTheRoutesSilentDefaults() {
        // NO filter params at all → the route applies status=open + assignee=me.
        XCTAssertEqual(sent(TaskListFilters()), ["limit": "25"])
    }

    func testAnyParamIsPassedThroughWithoutInjectedDefaults() {
        // Any explicit param kills BOTH route defaults — the client must not
        // re-inject them.
        XCTAssertEqual(
            sent(TaskListFilters(q: "roof")),
            ["q": "roof", "limit": "25"]
        )
        XCTAssertEqual(
            sent(TaskListFilters(unassigned: true)),
            ["unassigned": "true", "limit": "25"]
        )
    }

    func testAllSentinelInjectsStatusOpen() {
        // "all" is UI sugar: the assignee pin is dropped and status=open is
        // injected so the route's Open·Mine default is not re-applied.
        XCTAssertEqual(
            sent(TaskListFilters(assignedUserId: assigneeAll)),
            ["status": "open", "limit": "25"]
        )
    }

    func testAllSentinelSuppressedWhenAnotherExplicitParamSurvives() {
        XCTAssertEqual(
            sent(TaskListFilters(assignedUserId: assigneeAll, q: "roof")),
            ["q": "roof", "limit": "25"]
        )
        XCTAssertEqual(
            sent(TaskListFilters(status: "done", assignedUserId: assigneeAll)),
            ["status": "done", "limit": "25"]
        )
        XCTAssertEqual(
            sent(TaskListFilters(assignedUserId: assigneeAll, overdue: true)),
            ["overdue": "true", "limit": "25"]
        )
    }

    func testMeAndConcreteAssigneesAreSentVerbatim() {
        XCTAssertEqual(
            sent(TaskListFilters(status: "open", assignedUserId: assigneeMe)),
            ["status": "open", "assigned_user_id": "me", "limit": "25"]
        )
        XCTAssertEqual(
            sent(TaskListFilters(status: "open", assignedUserId: "user-7")),
            ["status": "open", "assigned_user_id": "user-7", "limit": "25"]
        )
    }

    func testCursorRidesAlong() {
        XCTAssertEqual(
            sent(TaskListFilters(status: "open", assignedUserId: assigneeMe), cursor: "c9"),
            ["status": "open", "assigned_user_id": "me", "cursor": "c9", "limit": "25"]
        )
    }

    // MARK: orderingKey

    func testOrderingKeyGuardsTheDualCursor() {
        XCTAssertEqual(orderingKey(TaskListFilters()), "created")
        XCTAssertEqual(orderingKey(TaskListFilters(status: "open", q: "x")), "created")
        XCTAssertEqual(orderingKey(TaskListFilters(overdue: true)), "due")
        XCTAssertEqual(orderingKey(TaskListFilters(dueBefore: "2026-07-16T00:00:00Z")), "due")
        XCTAssertEqual(orderingKey(TaskListFilters(dueAfter: "2026-07-15T00:00:00Z")), "due")
    }

    // MARK: due chips

    func testDueChipWindows() throws {
        let now = try XCTUnwrap(ISO8601DateFormatter().date(from: "2026-07-15T15:30:00Z"))

        let today = dueChipFilters(.today, now: now, calendar: utc)
        XCTAssertEqual(today.dueAfter, "2026-07-15T00:00:00Z")
        XCTAssertEqual(today.dueBefore, "2026-07-16T00:00:00Z")
        XCTAssertFalse(today.overdue)

        let week = dueChipFilters(.week, now: now, calendar: utc)
        XCTAssertEqual(week.dueAfter, "2026-07-15T00:00:00Z")
        XCTAssertEqual(week.dueBefore, "2026-07-22T00:00:00Z")

        let overdue = dueChipFilters(.overdue, now: now, calendar: utc)
        XCTAssertTrue(overdue.overdue)
        XCTAssertNil(overdue.dueBefore)
        XCTAssertNil(overdue.dueAfter)
    }

    func testDueChipWindowsCarryTheZoneOffset() throws {
        // A non-UTC zone must produce offset-bearing strings, not Z.
        var toronto = Calendar(identifier: .gregorian)
        toronto.timeZone = try XCTUnwrap(TimeZone(identifier: "America/Toronto"))
        let now = try XCTUnwrap(ISO8601DateFormatter().date(from: "2026-07-15T15:30:00Z"))
        let today = dueChipFilters(.today, now: now, calendar: toronto)
        XCTAssertEqual(today.dueAfter, "2026-07-15T00:00:00-04:00")
        XCTAssertEqual(today.dueBefore, "2026-07-16T00:00:00-04:00")
    }

    // MARK: taskListArms

    func testOpenAndDoneTabsAreSingleArms() {
        let open = taskListArms(tab: .open, assigneeUserId: nil, unassigned: false, due: nil, q: nil)
        XCTAssertEqual(open, [TaskListFilters(status: "open", assignedUserId: assigneeMe)])

        let done = taskListArms(tab: .done, assigneeUserId: nil, unassigned: false, due: nil, q: nil)
        XCTAssertEqual(done, [TaskListFilters(status: "done", assignedUserId: assigneeMe)])
    }

    func testStatuslessTabsBecomeTwoArmsOpenFirst() {
        let mine = taskListArms(tab: .mine, assigneeUserId: nil, unassigned: false, due: nil, q: nil)
        XCTAssertEqual(mine, [
            TaskListFilters(status: "open", assignedUserId: assigneeMe),
            TaskListFilters(status: "done", assignedUserId: assigneeMe),
        ])

        let all = taskListArms(tab: .all, assigneeUserId: nil, unassigned: false, due: nil, q: nil)
        XCTAssertEqual(all, [
            TaskListFilters(status: "open", assignedUserId: assigneeAll),
            TaskListFilters(status: "done", assignedUserId: assigneeAll),
        ])
    }

    func testAssigneeChipOverridesTheTabsMePin() {
        let arms = taskListArms(
            tab: .open, assigneeUserId: "user-7", unassigned: false, due: nil, q: nil
        )
        XCTAssertEqual(arms, [TaskListFilters(status: "open", assignedUserId: "user-7")])
    }

    func testUnassignedChipDropsTheAssignee() {
        let arms = taskListArms(
            tab: .open, assigneeUserId: nil, unassigned: true, due: nil, q: nil
        )
        XCTAssertEqual(arms, [TaskListFilters(status: "open", unassigned: true)])
    }

    func testSearchIsTrimmedAndEmptyDropped() {
        let arms = taskListArms(
            tab: .open, assigneeUserId: nil, unassigned: false, due: nil, q: "  roof  "
        )
        XCTAssertEqual(arms[0].q, "roof")

        let blank = taskListArms(
            tab: .open, assigneeUserId: nil, unassigned: false, due: nil, q: "   "
        )
        XCTAssertNil(blank[0].q)
    }

    func testDueChipRefinesEveryArm() throws {
        let now = try XCTUnwrap(ISO8601DateFormatter().date(from: "2026-07-15T15:30:00Z"))
        let arms = taskListArms(
            tab: .mine, assigneeUserId: nil, unassigned: false, due: .overdue, q: nil,
            now: now, calendar: utc
        )
        XCTAssertEqual(arms.count, 2)
        XCTAssertTrue(arms.allSatisfy(\.overdue))
        XCTAssertTrue(arms.allSatisfy { orderingKey($0) == "due" })
    }
}

// MARK: - TaskListLoader

private func loaderTask(_ id: String) -> TaskItem {
    TaskItem(
        id: id,
        company_id: "c1",
        message_id: "m-\(id)",
        conversation_id: "conv1",
        title: id,
        description: "",
        assigned_user_id: nil,
        due_at: nil,
        created_by_user_id: "u1",
        created_at: "2026-07-01T00:00:00Z",
        updated_at: "2026-07-01T00:00:00Z",
        done: false,
        status: "open",
        contact: nil,
        attachment_count: nil
    )
}

@MainActor
final class TaskListLoaderTests: XCTestCase {
    private let openArm = TaskListFilters(status: "open", assignedUserId: assigneeMe)
    private let doneArm = TaskListFilters(status: "done", assignedUserId: assigneeMe)

    func testDrainsArmsSequentiallyOpenBeforeDone() async throws {
        // The script only answers the pairs a correct loader asks for — a
        // cursor crossing arms (e.g. ("done", "c1")) falls to the empty
        // default and the sequence assertion below catches it.
        let loader = TaskListLoader(arms: [openArm, doneArm]) { filters, cursor, _ in
            switch (filters.status, cursor) {
            case ("open", nil):
                return Page(data: [loaderTask("o1"), loaderTask("o2")], next_cursor: "c1")
            case ("open", "c1"):
                return Page(data: [loaderTask("o3")], next_cursor: nil)
            case ("done", nil):
                return Page(data: [loaderTask("d1")], next_cursor: nil)
            default:
                return Page(data: [], next_cursor: nil)
            }
        }

        var ids: [String] = []
        while loader.hasMore {
            ids += try await loader.nextPage().map(\.id)
        }
        XCTAssertEqual(ids, ["o1", "o2", "o3", "d1"])
        XCTAssertFalse(loader.hasMore)
    }

    func testEmptyFirstArmFallsThroughToTheNextArmInOneCall() async throws {
        let loader = TaskListLoader(arms: [openArm, doneArm]) { filters, _, _ in
            filters.status == "open"
                ? Page(data: [], next_cursor: nil)
                : Page(data: [loaderTask("d1")], next_cursor: nil)
        }
        // One "Load more" must never return nothing while rows still exist.
        let first = try await loader.nextPage()
        XCTAssertEqual(first.map(\.id), ["d1"])
        XCTAssertFalse(loader.hasMore)
    }

    func testNoArmsMeansExhausted() async throws {
        let loader = TaskListLoader(arms: []) { _, _, _ in
            XCTFail("must never fetch")
            return Page(data: [], next_cursor: nil)
        }
        XCTAssertFalse(loader.hasMore)
        let page = try await loader.nextPage()
        XCTAssertTrue(page.isEmpty)
    }

    func testErrorPropagatesAndLoaderStaysUsable() async throws {
        struct Boom: Error {}
        // Fails once, then succeeds — @unchecked state via actor-free closure
        // is fine here because the loader is @MainActor and calls sequentially.
        final class Flag: @unchecked Sendable { var failed = false }
        let flag = Flag()
        let loader = TaskListLoader(arms: [openArm]) { _, _, _ in
            if !flag.failed {
                flag.failed = true
                throw Boom()
            }
            return Page(data: [loaderTask("o1")], next_cursor: nil)
        }
        do {
            _ = try await loader.nextPage()
            XCTFail("expected a throw")
        } catch {}
        XCTAssertTrue(loader.hasMore)
        let retried = try await loader.nextPage()
        XCTAssertEqual(retried.map(\.id), ["o1"])
    }
}
