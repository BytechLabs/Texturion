import XCTest

@testable import Loonext

/// #689 G / #690: the Tasks screen's filters, sort and saved views.
///
/// A view stores the query, and the thing saved has to be the thing opened. So
/// every control that can be saved is round-tripped, and the allow-list is
/// checked with a positive case for each key as well as the refusals: a port
/// that rejects everything passes a refusal-only suite.
final class TaskSavedViewsTests: XCTestCase {
    private let me = "11111111-1111-4111-8111-111111111111"
    private let sam = "22222222-2222-4222-8222-222222222222"
    private let tag = "33333333-3333-4333-8333-333333333333"
    private let contact = "44444444-4444-4444-8444-444444444444"

    // MARK: The list request

    func testTheNewFiltersReachTheQuery() {
        let filters = TaskListFilters(
            status: "open",
            sort: "updated",
            contactId: contact,
            createdBy: "me",
            source: "call",
            hasAttachments: true,
            hasReferences: true
        )
        let query = taskQueryParams(filters)
        XCTAssertEqual(query["contact_id"] ?? nil, contact)
        XCTAssertEqual(query["created_by"] ?? nil, "me")
        XCTAssertEqual(query["source"] ?? nil, "call")
        XCTAssertEqual(query["has_attachments"] ?? nil, "true")
        XCTAssertEqual(query["has_references"] ?? nil, "true")
        XCTAssertEqual(query["sort"] ?? nil, "updated")
    }

    func testAFalseFlagIsNotSent() {
        let query = taskQueryParams(TaskListFilters(status: "open"))
        XCTAssertNil(query["has_attachments"] ?? nil)
        XCTAssertNil(query["has_references"] ?? nil)
        XCTAssertNil(query["contact_id"] ?? nil)
    }

    func testAnExtraFilterIsAnExplicitParameterSoAllDoesNotAddAStatus() {
        // "All" with nothing else adds a status so the route's default is not
        // re-applied. A #690 filter is already an explicit parameter.
        let bare = taskQueryParams(TaskListFilters(assignedUserId: assigneeAll))
        XCTAssertEqual(bare["status"] ?? nil, "open")
        let narrowed = taskQueryParams(
            TaskListFilters(assignedUserId: assigneeAll, hasReferences: true)
        )
        XCTAssertNil(narrowed["status"] ?? nil)
        XCTAssertEqual(narrowed["has_references"] ?? nil, "true")
    }

    func testUpdatedSortMintsItsOwnCursors() {
        XCTAssertEqual(orderingKey(TaskListFilters(sort: "updated")), "updated")
        XCTAssertNotEqual(
            orderingKey(TaskListFilters(sort: "updated")),
            orderingKey(TaskListFilters())
        )
        XCTAssertEqual(TaskSortChoice.all, ["created", "due", "updated", "priority"])
    }

    func testArmsCarryTheNewFiltersAndADatePickedRangeWinsOverAChip() {
        var meta = TaskMetaFilters()
        meta.contactId = contact
        meta.source = "text"
        meta.hasAttachments = true
        meta.dueAfter = "2026-11-01T00:00:00-05:00"
        meta.dueBefore = "2026-11-08T00:00:00-05:00"
        let arms = taskListArms(
            tab: .open,
            assigneeUserId: nil,
            unassigned: false,
            due: .overdue,
            q: nil,
            meta: meta
        )
        XCTAssertEqual(arms.count, 1)
        XCTAssertEqual(arms[0].contactId, contact)
        XCTAssertEqual(arms[0].source, "text")
        XCTAssertTrue(arms[0].hasAttachments)
        XCTAssertEqual(arms[0].dueAfter, "2026-11-01T00:00:00-05:00")
        XCTAssertEqual(arms[0].dueBefore, "2026-11-08T00:00:00-05:00")
        XCTAssertFalse(arms[0].overdue, "the picked range replaces the Overdue chip")
    }

    func testOpenForEveryoneIsOneArmOnTheAllTab() {
        var meta = TaskMetaFilters()
        meta.statusOnly = "open"
        let arms = taskListArms(
            tab: .all, assigneeUserId: nil, unassigned: false, due: nil, q: nil, meta: meta
        )
        XCTAssertEqual(arms.count, 1)
        XCTAssertEqual(arms[0].status, "open")
        XCTAssertEqual(arms[0].assignedUserId, assigneeAll)
        XCTAssertEqual(
            taskListArms(
                tab: .all, assigneeUserId: nil, unassigned: false, due: nil, q: nil
            ).count,
            2
        )
    }

    func testBulkSelectionCarriesTheSameFilters() {
        let body = taskBulkBody(
            action: "mark_done",
            ids: nil,
            filters: TaskListFilters(
                status: "open",
                contactId: contact,
                createdBy: "me",
                source: "none",
                hasAttachments: true,
                hasReferences: true
            ),
            targetUserId: nil,
            unassign: false
        )
        let filter = body["filter"]
        XCTAssertEqual(filter?["contact_id"]?.stringValue, contact)
        XCTAssertEqual(filter?["created_by"]?.stringValue, "me")
        XCTAssertEqual(filter?["source"]?.stringValue, "none")
        XCTAssertEqual(filter?["has_attachments"]?.boolValue, true)
        XCTAssertEqual(filter?["has_references"]?.boolValue, true)
    }

    // MARK: What a view may hold

    func testEveryTaskKeyHasAPositiveCase() {
        let good: [String: JSONValue] = [
            "status": .string("done"),
            "assigned_user_id": .string(sam),
            "unassigned": .bool(true),
            "overdue": .bool(true),
            "has_location": .bool(true),
            "due_before": .string("2026-11-08T00:00:00-05:00"),
            "due_after": .string("2026-11-01"),
            "priority": .string("urgent,high"),
            "tag_id": .string(tag),
            "sort": .string("updated"),
            "contact_id": .string(contact),
            "conversation_id": .string(contact),
            "created_by": .string("me"),
            "source": .string("call"),
            "has_attachments": .bool(true),
            "has_references": .bool(true),
            "group": .string("priority"),
        ]
        XCTAssertEqual(sanitizeTaskFilters(good), good)
    }

    func testStaleAndMalformedKeysAreDroppedNotRefused() {
        let kept = sanitizeTaskFilters([
            "status": .string("archived"),
            "assigned_user_id": .string("not-a-uuid"),
            "priority": .string("urgent,loud"),
            "sort": .string("alphabetical"),
            "source": .string("fax"),
            "created_by": .string("everyone"),
            "due_before": .string("next tuesday"),
            "group": .string("colour"),
            "removed_long_ago": .bool(true),
            "overdue": .string("yes"),
        ])
        XCTAssertTrue(kept.isEmpty, "\(kept)")
    }

    func testIsoShapes() {
        XCTAssertTrue(isSavedViewIso("2026-11-08"))
        XCTAssertTrue(isSavedViewIso("2026-11-08T00:00:00Z"))
        XCTAssertTrue(isSavedViewIso("2026-11-08T00:00:00.000Z"))
        XCTAssertTrue(isSavedViewIso("2026-11-08T00:00:00-05:00"))
        XCTAssertFalse(isSavedViewIso("2026-11-08T"))
        XCTAssertFalse(isSavedViewIso("2026-11-08T00:00:00"))
        XCTAssertFalse(isSavedViewIso("2026-11-08T00:00:00-0500"))
        XCTAssertFalse(isSavedViewIso("20261108"))
    }

    // MARK: Round trips

    private func roundTrip(_ state: TaskViewState) -> TaskViewState {
        taskViewState(taskViewFilters(state, meUserId: me), meUserId: me)
    }

    func testTheDefaultScreenSavesAsMyOpenTasks() {
        let filters = taskViewFilters(TaskViewState(), meUserId: me)
        XCTAssertEqual(filters["status"], .string("open"))
        XCTAssertEqual(filters["assigned_user_id"], .string(me))
        XCTAssertEqual(filters.count, 2)
    }

    func testEveryTabComesBack() {
        for tab in TasksTabKind.allCases {
            var state = TaskViewState()
            state.tab = tab
            let back = roundTrip(state)
            XCTAssertEqual(back.tab, tab, "\(tab)")
            XCTAssertNil(back.assigneeUserId)
            XCTAssertNil(back.meta.statusOnly)
        }
    }

    func testAFilteredScreenComesBackAsItWas() {
        var state = TaskViewState()
        state.tab = .mine
        state.due = .overdue
        state.group = TaskGroup.assignee
        state.meta.priority = ["urgent", "high"]
        state.meta.tagId = tag
        state.meta.sort = "due"
        state.meta.contactId = contact
        state.meta.createdBy = "me"
        state.meta.source = "text"
        state.meta.hasAttachments = true
        state.meta.hasReferences = true
        state.meta.dueAfter = "2026-11-01T00:00:00-05:00"
        state.meta.dueBefore = "2026-11-08T00:00:00-05:00"
        XCTAssertEqual(roundTrip(state), state)
    }

    func testSomebodyElsesTasksAndUnassignedComeBack() {
        var other = TaskViewState()
        other.tab = .open
        other.assigneeUserId = sam
        XCTAssertEqual(roundTrip(other), other)

        var nobody = TaskViewState()
        nobody.tab = .done
        nobody.unassigned = true
        XCTAssertEqual(roundTrip(nobody), nobody)
    }

    func testOpenForEveryoneIsAViewTooNotJustTheAllTab() {
        var state = TaskViewState()
        state.tab = .all
        state.meta.statusOnly = "open"
        let filters = taskViewFilters(state, meUserId: me)
        XCTAssertEqual(filters["status"], .string("open"))
        XCTAssertNil(filters["assigned_user_id"])
        XCTAssertEqual(roundTrip(state), state)
    }

    func testGroupingIsAViewSettingAndTheDefaultIsNotStored() {
        var state = TaskViewState()
        XCTAssertNil(taskViewFilters(state, meUserId: me)["group"])
        state.group = TaskGroup.priority
        XCTAssertEqual(taskViewFilters(state, meUserId: me)["group"], .string("priority"))
    }

    func testRelativeDueChipsAreNotStoredAndTheSheetSaysSo() {
        var state = TaskViewState()
        state.due = .today
        let filters = taskViewFilters(state, meUserId: me)
        XCTAssertNil(filters["due_before"])
        XCTAssertNil(filters["due_after"])
        XCTAssertNil(filters["overdue"])
        XCTAssertTrue(taskViewDropsDueChip(state))
        state.due = .overdue
        XCTAssertFalse(taskViewDropsDueChip(state))
        XCTAssertEqual(taskViewFilters(state, meUserId: me)["overdue"], .bool(true))
    }

    func testAViewMatchesTheScreenItDescribes() {
        var state = TaskViewState()
        state.meta.hasReferences = true
        let filters = taskViewFilters(state, meUserId: me)
        XCTAssertTrue(taskViewMatches(filters, state, meUserId: me))
        state.meta.hasReferences = false
        XCTAssertFalse(taskViewMatches(filters, state, meUserId: me))
    }

    // MARK: The count on the Filters button

    func testTheFilterCountIgnoresTheTabTheSortAndTheLayout() {
        var state = TaskViewState()
        XCTAssertEqual(taskFilterCount(state), 0)
        state.tab = .done
        state.meta.sort = "due"
        state.group = TaskGroup.priority
        XCTAssertEqual(taskFilterCount(state), 0)
        state.assigneeUserId = sam
        state.meta.hasReferences = true
        state.meta.priority = ["urgent", "high"]
        state.meta.dueAfter = "2026-11-01"
        XCTAssertEqual(taskFilterCount(state), 4)
    }

    // MARK: Grouping the list

    private func task(_ id: String, assignees: [String], priority: String?) -> TaskItem {
        var item = TaskItem(
            id: id, company_id: "c", message_id: nil, conversation_id: nil, title: id,
            description: "", assigned_user_id: assignees.first, due_at: nil,
            created_by_user_id: "u", created_at: "2026-11-10T12:00:00Z",
            updated_at: "2026-11-10T12:00:00Z", done: false, status: "open",
            contact: nil, attachment_count: nil
        )
        item.assignee_ids = assignees
        item.priority = priority
        return item
    }

    func testGroupingByAssigneeUsesTheFirstAssigneeAndKeepsListOrder() {
        let rows = [
            task("a", assignees: [sam], priority: nil),
            task("b", assignees: [], priority: nil),
            task("c", assignees: [sam, me], priority: nil),
        ]
        let sections = groupTasks(rows, by: TaskGroup.assignee) { $0 == "22222222-2222-4222-8222-222222222222" ? "Sam" : nil }
        XCTAssertEqual(sections.map(\.id), [sam, "unassigned"])
        XCTAssertEqual(sections[0].tasks.map(\.id), ["a", "c"])
        XCTAssertEqual(sections[0].title, "Sam")
        XCTAssertEqual(sections[1].titleKey, "contactsTasks.unassigned")
    }

    func testGroupingByPriorityIsBusiestFirstAndSkipsEmptySections() {
        let rows = [
            task("a", assignees: [], priority: "low"),
            task("b", assignees: [], priority: "urgent"),
            task("c", assignees: [], priority: nil),
        ]
        let sections = groupTasks(rows, by: TaskGroup.priority) { _ in nil }
        XCTAssertEqual(sections.map(\.id), ["urgent", "normal", "low"])
    }

    func testStatusGroupingIsTheFlatList() {
        let rows = [task("a", assignees: [], priority: nil)]
        let sections = groupTasks(rows, by: TaskGroup.status) { _ in nil }
        XCTAssertEqual(sections.count, 1)
        XCTAssertEqual(sections[0].tasks.map(\.id), ["a"])
    }

    // MARK: Words

    func testTheSavedViewNameIsSuggestedFromTheFilters() {
        var state = TaskViewState()
        state.tab = .mine
        state.due = .overdue
        XCTAssertEqual(
            suggestTaskViewName(state, locale: "en", tagName: nil),
            "Mine \u{00B7} Overdue"
        )
        XCTAssertFalse(suggestTaskViewName(state, locale: "en", tagName: nil).contains("\u{2014}"))
    }
}
