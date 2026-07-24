import XCTest
@testable import Loonext

/// #186 item 2 — the founder-critical search-result routing: a TASK hit opens
/// the TASK (not its conversation), a conversation/message hit opens the THREAD
/// carrying the matched message as the scroll/flash target. The Android
/// `onOpenTask(task.id)` / `onOpenThread(id, matched_message_id)` twin.
final class InboxSearchRoutingTests: XCTestCase {
    private func decode<T: Decodable>(_ type: T.Type, _ json: String) throws -> T {
        try JSONDecoder().decode(T.self, from: Data(json.utf8))
    }

    func testTaskHitOpensTheTaskNotItsConversation() throws {
        let hit = try decode(
            SearchTaskHit.self,
            """
            {"id":"task-1","title":"Send the quote","conversation_id":"conv-9",
             "done":false,"matched_at":"2026-07-15T12:00:00Z"}
            """
        )
        // The regression this guards: it must NOT be .thread(conv-9).
        XCTAssertEqual(InboxSearchRouting.route(forTask: hit), .task(taskId: "task-1"))
    }

    func testConversationHitOpensThreadWithHighlight() throws {
        let hit = try decode(
            SearchConversationHit.self,
            """
            {"id":"conv-1","status":"open","is_spam":false,
             "last_message_at":"2026-07-15T12:00:00Z",
             "contact":{"id":"ct-1","name":"Dana","phone_e164":"+14155550134"},
             "matched_message_id":"msg-7","matched_at":"2026-07-15T12:00:00Z",
             "direction":"inbound","snippet":"the gate code"}
            """
        )
        XCTAssertEqual(
            InboxSearchRouting.route(forConversation: hit),
            .thread(conversationId: "conv-1", highlightMessageId: "msg-7")
        )
    }

    func testAttachmentHitOpensThreadWithoutHighlight() {
        XCTAssertEqual(
            InboxSearchRouting.route(forAttachment: "conv-42"),
            .thread(conversationId: "conv-42", highlightMessageId: nil)
        )
    }
}
