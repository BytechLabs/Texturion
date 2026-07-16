import XCTest
@testable import Loonext

/// The board's drag-to-move decision (`boardDropToggles`) — pure, so the
/// exact semantics are pinned without a UIKit drag session: a dropped card
/// moves only when it resolves to a card in the OPPOSITE column, its own
/// column is a no-op, foreign payloads (arbitrary text dragged from another
/// app) resolve to nothing, and duplicates toggle once. Every returned task
/// is toggled by the caller via the SAME derived-done
/// `PATCH /v1/messages/{message_id}` the move arrow uses — never a task write.
final class TasksBoardLogicTests: XCTestCase {
    private func task(_ id: String, done: Bool) -> TaskItem {
        TaskItem(
            id: id,
            company_id: "co1",
            message_id: "m-\(id)",
            conversation_id: "cv1",
            title: "Task \(id)",
            description: "",
            assigned_user_id: nil,
            due_at: nil,
            created_by_user_id: "u1",
            created_at: "2026-07-14T12:00:00Z",
            updated_at: "2026-07-14T12:00:00Z",
            done: done,
            status: done ? "done" : "open",
            contact: nil,
            attachment_count: nil
        )
    }

    private var todo: [TaskItem] { [task("t1", done: false), task("t2", done: false)] }
    private var done: [TaskItem] { [task("d1", done: true)] }

    func testDroppingATodoCardOnDoneTogglesIt() {
        let toggles = boardDropToggles(
            droppedIds: ["t1"], targetDone: true, todo: todo, done: done
        )
        XCTAssertEqual(toggles.map(\.id), ["t1"])
    }

    func testDroppingADoneCardOnTodoTogglesIt() {
        let toggles = boardDropToggles(
            droppedIds: ["d1"], targetDone: false, todo: todo, done: done
        )
        XCTAssertEqual(toggles.map(\.id), ["d1"])
    }

    func testDroppingACardOnItsOwnColumnIsANoOp() {
        XCTAssertTrue(
            boardDropToggles(droppedIds: ["t1"], targetDone: false, todo: todo, done: done)
                .isEmpty
        )
        XCTAssertTrue(
            boardDropToggles(droppedIds: ["d1"], targetDone: true, todo: todo, done: done)
                .isEmpty
        )
    }

    func testForeignPayloadResolvesToNothing() {
        // iPad multi-window can drop arbitrary text on the board — never a
        // toggle unless the string is a card in the opposite column.
        XCTAssertTrue(
            boardDropToggles(
                droppedIds: ["not-a-task-id"], targetDone: true, todo: todo, done: done
            ).isEmpty
        )
    }

    func testDuplicateIdsInOneDropToggleOnce() {
        let toggles = boardDropToggles(
            droppedIds: ["t1", "t1", "t1"], targetDone: true, todo: todo, done: done
        )
        XCTAssertEqual(toggles.map(\.id), ["t1"])
    }

    func testMixedDropKeepsPayloadOrderAndSkipsNonMovers() {
        let toggles = boardDropToggles(
            droppedIds: ["d1", "t2", "t1", "ghost"],
            targetDone: true,
            todo: todo,
            done: done
        )
        // d1 already lives in Done (no-op); ghost resolves to nothing.
        XCTAssertEqual(toggles.map(\.id), ["t2", "t1"])
    }

    func testEmptyDropTogglesNothing() {
        XCTAssertTrue(
            boardDropToggles(droppedIds: [], targetDone: true, todo: todo, done: done)
                .isEmpty
        )
    }

    func testTogglesCarryTheSourceMessageIdForTheDerivedDoneWrite() {
        // Derived-done invariant: the caller PATCHes /v1/messages/{message_id}
        // — the returned tasks must carry the message id the write uses.
        let toggles = boardDropToggles(
            droppedIds: ["t1"], targetDone: true, todo: todo, done: done
        )
        XCTAssertEqual(toggles.map(\.message_id), ["m-t1"])
    }

    func testEmptyColumnsAcceptNothing() {
        XCTAssertTrue(
            boardDropToggles(droppedIds: ["t1"], targetDone: true, todo: [], done: [])
                .isEmpty
        )
    }
}
