import XCTest
@testable import Loonext

/// Wire-level checks of the binding task invariants, mirroring the Android
/// TaskMutationsTest vectors: derived done is ALWAYS `{"done": …}` on the
/// message route (a task has no done column), metadata clears send explicit
/// JSON nulls, and the note body carries the task link. The bodies are pure
/// builders so the exact bytes are assertable without a mock server.
final class TasksMutationBodyTests: XCTestCase {
    private func encoded(_ value: JSONValue) throws -> String {
        String(decoding: try JSONEncoder().encode(value), as: UTF8.self)
    }

    private func decoded(_ value: JSONValue) throws -> JSONValue {
        try JSONDecoder().decode(JSONValue.self, from: try JSONEncoder().encode(value))
    }

    func testDerivedDoneBodyIsTheMessagePatchShape() throws {
        XCTAssertEqual(try encoded(messageDoneBody(true)), "{\"done\":true}")
        XCTAssertEqual(try encoded(messageDoneBody(false)), "{\"done\":false}")
    }

    func testClearingTheDueDateSendsAnExplicitJsonNull() throws {
        XCTAssertEqual(try encoded(taskDueBody(nil)), "{\"due_at\":null}")
        XCTAssertEqual(
            try encoded(taskDueBody("2026-07-15T15:00:00-04:00")),
            "{\"due_at\":\"2026-07-15T15:00:00-04:00\"}"
        )
    }

    func testUnassigningSendsAnExplicitJsonNull() throws {
        XCTAssertEqual(try encoded(taskAssignBody(nil)), "{\"assigned_user_id\":null}")
        XCTAssertEqual(try encoded(taskAssignBody("u2")), "{\"assigned_user_id\":\"u2\"}")
    }

    func testMetadataBodiesAreSingleField() throws {
        XCTAssertEqual(try encoded(taskRenameBody("Send the quote")), "{\"title\":\"Send the quote\"}")
        XCTAssertEqual(try encoded(taskDescribeBody("")), "{\"description\":\"\"}")
    }

    func testDiscussionNotesCarryTheTaskLink() throws {
        XCTAssertEqual(
            try decoded(taskNoteBody(body: "On it", taskId: "t1")),
            .object(["body": .string("On it"), "task_id": .string("t1")])
        )
    }

    func testCreateBodyOmitsAbsentOptionals() throws {
        XCTAssertEqual(
            try decoded(
                taskCreateBody(messageId: "m1", title: nil, assignedUserId: nil, dueAt: nil)
            ),
            .object(["message_id": .string("m1")])
        )
        XCTAssertEqual(
            try decoded(
                taskCreateBody(
                    messageId: "m1",
                    title: "Send the quote",
                    assignedUserId: "u2",
                    dueAt: "2026-07-15T15:00:00-04:00"
                )
            ),
            .object([
                "message_id": .string("m1"),
                "title": .string("Send the quote"),
                "assigned_user_id": .string("u2"),
                "due_at": .string("2026-07-15T15:00:00-04:00"),
            ])
        )
    }

    /// PATCH /v1/tasks/:id returns the raw tasks-table row (`to_jsonb` from
    /// the RPCs) — no derived done/status. The projection must decode it.
    func testTaskRowPatchDecodesTheRpcRowShape() throws {
        let json = """
        {"id":"t1","company_id":"c1","message_id":"m1","conversation_id":"cv1",
         "title":"Send the quote","description":"","assigned_user_id":null,
         "due_at":null,"created_by_user_id":"u1","deleted_at":null,
         "created_at":"2026-07-01T00:00:00Z","updated_at":"2026-07-02T00:00:00Z"}
        """
        let row = try JSONDecoder().decode(TaskRowPatch.self, from: Data(json.utf8))
        XCTAssertEqual(row.id, "t1")
        XCTAssertEqual(row.title, "Send the quote")
        XCTAssertNil(row.assigned_user_id)
        XCTAssertNil(row.due_at)
        XCTAssertEqual(row.updated_at, "2026-07-02T00:00:00Z")
    }
}
