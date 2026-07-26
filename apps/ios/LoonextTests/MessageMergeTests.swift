import XCTest

@testable import Loonext

/// The same rule the web and Android clients pin: a page refetch may not walk a
/// message's status backwards. All three show the same bubble, so they must
/// agree on what "sent" means.
final class MessageMergeTests: XCTestCase {

    /// Built by DECODING, not by the memberwise initialiser: that init is
    /// order-sensitive and silently shifts the moment a field is added, and
    /// this target only compiles in CI. Decoding also exercises the real path
    /// the app uses.
    private func message(_ id: String, _ status: String?, body: String = "hi") -> Message {
        let statusJson = status.map { "\"\($0)\"" } ?? "null"
        let json = """
        {
          "id": "\(id)",
          "conversation_id": "c1",
          "direction": "outbound",
          "body": "\(body)",
          "status": \(statusJson),
          "created_at": "2026-07-26T10:00:00Z"
        }
        """
        // A fixture that stops decoding is a broken test, not a passing one.
        return try! JSONDecoder().decode(Message.self, from: Data(json.utf8))
    }

    func testStalePageDoesNotMoveASentMessageBackToQueued() {
        // The send inserts the queued row and bumps the conversation in one
        // transaction, so the refetch that bump triggers can read 'queued' and
        // land after the broadcast that already said 'sent'.
        XCTAssertEqual(mergeMessage(message("m1", "sent"), message("m1", "queued")).status, "sent")
    }

    func testForwardTransitionsAreTaken() {
        XCTAssertEqual(mergeMessage(message("m1", "sent"), message("m1", "delivered")).status, "delivered")
        XCTAssertEqual(mergeMessage(message("m1", "sent"), message("m1", "failed")).status, "failed")
        XCTAssertEqual(mergeMessage(message("m1", "queued"), message("m1", "sent")).status, "sent")
    }

    func testRestOfANewerRowIsTakenWhenOnlyTheStatusIsBehind() {
        let merged = mergeMessage(
            message("m1", "delivered", body: "old"),
            message("m1", "queued", body: "edited")
        )
        XCTAssertEqual(merged.body, "edited")
        XCTAssertEqual(merged.status, "delivered")
    }

    func testANoteHasNoStatusToProtect() {
        let merged = mergeMessage(message("m1", nil), message("m1", nil, body: "note"))
        XCTAssertEqual(merged.body, "note")
        XCTAssertNil(merged.status)
    }

    func testMergingAPageKeepsTheFurthestStatusAndAddsNewRows() {
        let merged = mergeMessagesFirstPage(
            [message("m1", "sent")],
            [message("m1", "queued"), message("m2", "received")]
        )
        XCTAssertEqual(merged.first { $0.id == "m1" }?.status, "sent")
        XCTAssertEqual(merged.count, 2)
    }
}
