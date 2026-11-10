import XCTest
@testable import Loonext

/// #689 C: a task can have a crew of up to ten. Decoding with and without the
/// new fields, who counts as "assigned to me", the cap, the exact request
/// bodies, the spoken avatar-stack label and the two history lines.
final class TaskAssigneesTests: XCTestCase {
    private func decode<T: Decodable>(_ json: String) throws -> T {
        try JSONDecoder().decode(T.self, from: Data(json.utf8))
    }

    private let en = MessageLocale.en

    private let baseTask = #"""
    "id":"t1","company_id":"c1","message_id":"m1","conversation_id":"conv1",
    "title":"Service the furnace","due_at":null,"created_by_user_id":"u1",
    "created_at":"2026-07-01T00:00:00Z","updated_at":"2026-07-01T00:00:00Z",
    "done":false,"status":"open"
    """#

    // MARK: decoding

    func testARowFromBeforeTheCrewReadsTheLegacyAssignee() throws {
        let task: TaskItem = try decode(#"{\#(baseTask),"assigned_user_id":"u2"}"#)
        XCTAssertNil(task.assignee_ids)
        XCTAssertEqual(task.assigneeIds, ["u2"])
        XCTAssertTrue(task.isAssigned(to: "u2"))
        XCTAssertFalse(task.isAssigned(to: "u1"))
    }

    func testARowWithNobodyReadsAsEmpty() throws {
        let task: TaskItem = try decode(#"{\#(baseTask),"assigned_user_id":null}"#)
        XCTAssertEqual(task.assigneeIds, [])
        XCTAssertTrue(task.assigneeFaces(roster: { _ in nil }).isEmpty)
    }

    func testACrewDecodesAndMembershipIsNotJustTheFirstAssignee() throws {
        let task: TaskItem = try decode(#"""
        {\#(baseTask),"assigned_user_id":"u2","assignee_ids":["u2","u1"],
         "assignees":[{"user_id":"u2","display_name":"Alex Mason"},
                      {"user_id":"u1","display_name":"Sam Carpenter"}]}
        """#)
        XCTAssertEqual(task.assigneeIds, ["u2", "u1"])
        // u1 is second in the crew, and the task is still theirs.
        XCTAssertTrue(task.isAssigned(to: "u1"))
        let faces = task.assigneeFaces(roster: { _ in nil })
        XCTAssertEqual(faces.map(\.name), ["Alex Mason", "Sam Carpenter"])
    }

    func testAFaceFallsBackToTheRosterThenToNothing() {
        let faces = taskAssigneeFaces(
            ids: ["u1", "u2", "u3"],
            profiles: [TaskProfile(user_id: "u1", display_name: "  ")],
            roster: { $0 == "u1" ? "Sam Carpenter" : nil }
        )
        XCTAssertEqual(faces.map(\.name), ["Sam Carpenter", nil, nil])
    }

    func testADetailNamesTheFirstAssigneeFromItsLegacyProfile() throws {
        let detail: TaskDetail = try decode(#"""
        {\#(baseTask),"assigned_user_id":"u2","assignee_ids":["u2"],
         "assignee":{"user_id":"u2","display_name":"Alex Mason"}}
        """#)
        XCTAssertEqual(detail.assigneeFaces(roster: { _ in nil }).map(\.name), ["Alex Mason"])
    }

    // MARK: the cap

    func testTogglingAddsRemovesAndStopsAtTen() {
        XCTAssertEqual(taskAssigneesToggled(["a"], id: "b"), ["a", "b"])
        XCTAssertEqual(taskAssigneesToggled(["a", "b"], id: "a"), ["b"])
        let full = (1 ... taskAssigneeMax).map { "u\($0)" }
        XCTAssertNil(taskAssigneesToggled(full, id: "extra"))
        // Removing still works at the cap.
        XCTAssertEqual(taskAssigneesToggled(full, id: "u1")?.count, taskAssigneeMax - 1)
    }

    // MARK: bodies

    func testPatchBodyReplacesTheCrewAndEmptyUnassignsEveryone() {
        XCTAssertEqual(
            taskAssigneesBody(["u1", "u2"]),
            .object(["assignee_ids": .array([.string("u1"), .string("u2")])])
        )
        XCTAssertEqual(taskAssigneesBody([]), .object(["assignee_ids": .array([])]))
    }

    func testCreateBodySendsTheCrewAndAnEmptyCrewMeansNobody() {
        let body = taskCreateBody(
            messageId: nil, title: "T", assignedUserId: "u1", dueAt: nil,
            assigneeIds: ["u1", "u2"]
        )
        XCTAssertEqual(body["assignee_ids"], .array([.string("u1"), .string("u2")]))
        XCTAssertEqual(body["assigned_user_id"], .string("u1"))

        let nobody = taskCreateBody(
            messageId: nil, title: "T", assignedUserId: nil, dueAt: nil, assigneeIds: []
        )
        XCTAssertEqual(nobody["assignee_ids"], .array([]))
        XCTAssertNil(nobody["assigned_user_id"])

        // A message or call task that chose no crew sends neither.
        let single = taskCreateBody(messageId: "m1", title: nil, assignedUserId: nil, dueAt: nil)
        XCTAssertNil(single["assignee_ids"])
    }

    func testBulkAssignAddsPeopleAndOnlyNullUnassigns() {
        let add = taskBulkBody(
            action: "assign", ids: ["t1"], filters: nil, targetUserId: nil, unassign: false,
            assigneeIds: ["u1", "u2"]
        )
        XCTAssertEqual(add["assignee_ids"], .array([.string("u1"), .string("u2")]))
        XCTAssertNil(add["target_user_id"])

        let legacy = taskBulkBody(
            action: "assign", ids: ["t1"], filters: nil, targetUserId: "u3", unassign: false
        )
        XCTAssertEqual(legacy["target_user_id"], .string("u3"))
        XCTAssertNil(legacy["assignee_ids"])

        let clear = taskBulkBody(
            action: "assign", ids: ["t1"], filters: nil, targetUserId: nil, unassign: true
        )
        XCTAssertEqual(clear["target_user_id"], .null)
    }

    // MARK: spoken label and summary

    private func faces(_ names: [String]) -> [AssigneeFace] {
        names.enumerated().map { AssigneeFace(id: "u\($0.offset)", name: $0.element) }
    }

    func testTheStackIsSpokenWithAnOverflowCount() {
        XCTAssertNil(taskAssigneeSpoken([], locale: en))
        XCTAssertEqual(taskAssigneeSpoken(faces(["Ana"]), locale: en), "Assigned to Ana")
        XCTAssertEqual(
            taskAssigneeSpoken(faces(["Ana", "Ben", "Cy"]), locale: en),
            "Assigned to Ana, Ben and Cy"
        )
        XCTAssertEqual(
            taskAssigneeSpoken(faces(["Ana", "Ben", "Cy", "Di", "Ed"]), locale: en),
            "Assigned to Ana, Ben, Cy and 2 more"
        )
    }

    func testTheSummaryNamesMeAsYouAndCountsTheRest() {
        XCTAssertEqual(taskAssigneeSummary([], meUserId: "u0", locale: en), "Unassigned")
        XCTAssertEqual(
            taskAssigneeSummary(faces(["Sam", "Ben", "Cy"]), meUserId: "u0", locale: en),
            "You, Ben and 1 more"
        )
    }

    // MARK: history

    private func event(
        _ kind: String,
        from: JSONValue? = nil,
        to: JSONValue? = nil,
        fromUser: TaskProfile? = nil,
        toUser: TaskProfile? = nil
    ) -> TaskFeedItem {
        TaskFeedItem(
            kind: "event", id: "e1", created_at: "2026-11-10T12:00:00Z", event: kind,
            from: from, to: to, from_user: fromUser, to_user: toUser, actor: nil,
            body: nil, author: nil, edited_at: nil, attachments: nil
        )
    }

    func testAssigneeAddedAndRemovedReadAsSentences() {
        XCTAssertEqual(
            taskHistorySentence(
                event("assignee_added", to: "u2", toUser: TaskProfile(user_id: "u2", display_name: "Alex")),
                by: "Sam", locale: en
            ),
            "Sam added Alex to this task"
        )
        XCTAssertEqual(
            taskHistorySentence(
                event("assignee_removed", from: "u2", fromUser: TaskProfile(user_id: "u2", display_name: "Alex")),
                by: "Sam", locale: en
            ),
            "Sam removed Alex from this task"
        )
        // Nobody to name: say it changed rather than guess.
        XCTAssertEqual(
            taskHistorySentence(event("assignee_added", to: "u2"), by: "Sam", locale: en),
            "Sam updated this task"
        )
    }

    func testTheOldAssigneeEventStaysReadable() {
        XCTAssertEqual(
            taskHistorySentence(
                event("assignee", to: "u2", toUser: TaskProfile(user_id: "u2", display_name: "Alex")),
                by: "Sam", locale: en
            ),
            "Sam assigned this to Alex"
        )
    }
}
