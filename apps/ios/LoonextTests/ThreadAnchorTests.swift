import XCTest
@testable import Loonext

/// #718: opening a thread at a message, and every link that does it. Mirrors
/// the Android MessagesQueryTest, NotificationTargetTest and TaskSourceLinkTest.
final class ThreadAnchorTests: XCTestCase {
    private func decode<T: Decodable>(_ json: String) throws -> T {
        try JSONDecoder().decode(T.self, from: Data(json.utf8))
    }

    // MARK: - The request

    func testAnAnchoredReadNamesTheMessageAndNothingElse() {
        let q = messagesQuery(around: "m5", limit: 50)
        XCTAssertEqual(q["around"] ?? nil, "m5")
        XCTAssertEqual(q["limit"] ?? nil, "50")
        XCTAssertNil(q["cursor"] ?? nil)
        XCTAssertNil(q["direction"] ?? nil)
    }

    func testPagingNewerCarriesTheCursorAndTheDirection() {
        let q = messagesQuery(cursor: "c9", newer: true)
        XCTAssertEqual(q["cursor"] ?? nil, "c9")
        XCTAssertEqual(q["direction"] ?? nil, "newer")
        XCTAssertNil(q["around"] ?? nil)
    }

    func testThePlainReadIsUnchanged() {
        let q = messagesQuery(cursor: "c1")
        XCTAssertEqual(q["cursor"] ?? nil, "c1")
        XCTAssertNil(q["direction"] ?? nil)
        XCTAssertNil(q["around"] ?? nil)
    }

    func testAWindowDecodesWithBothCursorsAndAMissingAnchorIsSaid() throws {
        let window: MessagesPage = try decode(#"""
        {"data":[],"next_cursor":"o","newer_cursor":"n","anchor_id":"m5"}
        """#)
        XCTAssertEqual(window.next_cursor, "o")
        XCTAssertEqual(window.newer_cursor, "n")
        XCTAssertEqual(window.anchor_id, "m5")
        XCTAssertNil(window.anchor_missing)

        let gone: MessagesPage = try decode(#"""
        {"data":[],"next_cursor":null,"newer_cursor":null,"anchor_id":null,"anchor_missing":true}
        """#)
        XCTAssertEqual(gone.anchor_missing, true)
    }

    // MARK: - Source labels

    private var call: TaskSourceCall {
        // Decoded, as the wire does, so the defaulted wrappers need no spelling out.
        try! decode(#"""
        {"id":"k1","call_session_id":"sess-1","caller_e164":null,"caller_name":"Sam",
         "outcome":null,"started_at":"2026-11-10T10:00:00Z","ended_at":null,"contact_id":null}
        """#)
    }

    private func link(
        conversationId: String? = "c1",
        messageId: String? = "m1",
        source: TaskSource? = TaskSource(kind: "message", id: "m1"),
        call: TaskSourceCall? = nil,
        direction: String? = "inbound",
        contactName: String? = "Sam",
        locale: String? = nil
    ) -> TaskSourceLink? {
        taskSourceLink(
            conversationId: conversationId,
            messageId: messageId,
            source: source,
            call: call,
            sourceMessageDirection: direction,
            contactName: contactName,
            locale: locale
        )
    }

    func testATextNamesWhoItIsFrom() {
        let result = link()
        XCTAssertEqual(result?.label, "From a text from Sam")
        XCTAssertEqual(result?.conversationId, "c1")
        XCTAssertEqual(result?.messageId, "m1")
    }

    func testATextFromAnUnnamedContactStillNamesTheKind() {
        XCTAssertEqual(link(contactName: " ")?.label, "From a text")
        XCTAssertEqual(link(contactName: nil)?.label, "From a text")
    }

    func testANoteIsANoteFromTheRowOrTheDetail() {
        XCTAssertEqual(link(direction: "note")?.label, "Mentioned in a note")
        XCTAssertEqual(
            link(
                source: TaskSource(kind: "message", id: "m1", direction: "note"),
                direction: nil
            )?.label,
            "Mentioned in a note"
        )
    }

    func testACallNamesTheCallerAndOpensTheThreadWithoutAMessage() {
        let result = link(messageId: nil, source: TaskSource(kind: "call", id: "k1"), call: call)
        XCTAssertEqual(result?.label, "From a call with Sam")
        XCTAssertNil(result?.messageId)
        XCTAssertEqual(result?.callSessionId, "sess-1")
    }

    func testNoSourceMeansNoLink() {
        XCTAssertNil(link(conversationId: nil, messageId: nil, source: nil))
        XCTAssertNil(link(messageId: nil, source: nil))
        XCTAssertNil(link(conversationId: nil))
        XCTAssertNil(
            link(
                conversationId: nil,
                messageId: nil,
                source: TaskSource(kind: "call", id: "k1"),
                call: call
            )
        )
    }

    func testTheLabelIsFrenchWhenTheReaderIs() {
        XCTAssertEqual(link(locale: "fr-CA")?.label, "À partir d'un texto de Sam")
    }

    // MARK: - Every go-to-the-source link

    private func notification(
        type: String,
        conversationId: String? = "c1",
        messageId: String? = "m1",
        taskId: String? = nil
    ) throws -> NotificationItem {
        func quoted(_ value: String?) -> String { value.map { "\"\($0)\"" } ?? "null" }
        return try decode("""
        {"id":"n1","type":"\(type)","conversation_id":\(quoted(conversationId)),
         "message_id":\(quoted(messageId)),"task_id":\(quoted(taskId)),"contact":null,
         "created_at":"2026-11-10T10:00:00Z"}
        """)
    }

    func testAMentionOpensItsThreadAtTheMessage() throws {
        XCTAssertEqual(
            notificationTarget(try notification(type: "mention")),
            .thread(conversationId: "c1", messageId: "m1")
        )
    }

    func testANotificationThatNamesNoMessageOpensThePlainThread() throws {
        XCTAssertEqual(
            notificationTarget(try notification(type: "assigned", messageId: nil)),
            .thread(conversationId: "c1", messageId: nil)
        )
    }

    func testATaskAssignmentOpensTheTaskNotTheThread() throws {
        XCTAssertEqual(
            notificationTarget(try notification(type: "task_assigned", taskId: "t1")),
            .task(taskId: "t1")
        )
    }

    func testANotificationThatNamesNothingOpensNothing() throws {
        XCTAssertNil(
            notificationTarget(try notification(type: "x", conversationId: nil, messageId: nil))
        )
    }

    func testAPushLinkCanNameTheMessageToOpenAt() {
        XCTAssertEqual(
            parsePushRoute(url: "/inbox/conv-1?message=m-7"),
            .thread(conversationId: "conv-1", taskId: nil, messageId: "m-7")
        )
    }

    private func entry(kind: String, conversationId: String?) throws -> TimelineEntry {
        let conversation = conversationId.map { "\"\($0)\"" } ?? "null"
        return try decode("""
        {"kind":"\(kind)","id":"7","occurred_at":"2026-11-10T10:00:00Z",
         "conversation_id":\(conversation)}
        """)
    }

    func testAJobRowOpensTheJobAndEveryOtherRowItsThread() throws {
        XCTAssertEqual(
            timelineOpen(try entry(kind: "task", conversationId: "c1")),
            .task(taskId: "7")
        )
        XCTAssertEqual(
            timelineOpen(try entry(kind: "call", conversationId: "c1")),
            .thread(conversationId: "c1")
        )
        XCTAssertNil(timelineOpen(try entry(kind: "call", conversationId: nil)))
    }
}
