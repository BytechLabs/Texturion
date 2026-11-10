import XCTest
@testable import Loonext

/// D64: a task promotes a message or an answered call. Decoding survives both
/// shapes, the done write branches on the source, and only a plain answered
/// call line offers "Make a task".
final class CallTaskTests: XCTestCase {
    private func decode<T: Decodable>(_ json: String) throws -> T {
        try JSONDecoder().decode(T.self, from: Data(json.utf8))
    }

    private let messageTask = #"""
    {"id":"t1","company_id":"c1","message_id":"m1","conversation_id":"cv1",
     "source":{"kind":"message","id":"m1"},"call":null,
     "title":"Send the quote","created_by_user_id":"u1",
     "created_at":"2026-07-01T00:00:00Z","updated_at":"2026-07-01T00:00:00Z",
     "done":false,"status":"open"}
    """#

    private let callTask = #"""
    {"id":"t2","company_id":"c1","message_id":null,"conversation_id":"cv1",
     "source":{"kind":"call","id":"call1"},
     "call":{"id":"call1","call_session_id":"s1","caller_e164":"+14165550100",
             "caller_name":null,"outcome":"answered","forward_seconds":192,
             "started_at":"2026-07-01T10:00:00Z","ended_at":"2026-07-01T10:03:12Z",
             "contact_id":null,"has_voicemail":true},
     "title":"Call from +1 416 555 0100","created_by_user_id":"u1",
     "created_at":"2026-07-01T00:00:00Z","updated_at":"2026-07-01T00:00:00Z",
     "done":true,"status":"done"}
    """#

    func testMessageTaskAndCallTaskBothDecode() throws {
        let message: TaskItem = try decode(messageTask)
        XCTAssertEqual(message.message_id, "m1")
        XCTAssertEqual(message.source?.kind, "message")
        XCTAssertNil(message.call)
        XCTAssertFalse(message.isCallTask)

        let call: TaskItem = try decode(callTask)
        XCTAssertNil(call.message_id)
        XCTAssertEqual(call.source?.id, "call1")
        XCTAssertEqual(call.call?.forward_seconds, 192)
        XCTAssertEqual(call.call?.has_voicemail, true)
        XCTAssertTrue(call.isCallTask)
    }

    func testTaskFromAnOlderServerWithNoSourceStillDecodes() throws {
        let old: TaskItem = try decode(#"""
        {"id":"t1","company_id":"c1","message_id":"m1","conversation_id":"cv1",
         "title":"x","created_by_user_id":"u1",
         "created_at":"2026-07-01T00:00:00Z","updated_at":"2026-07-01T00:00:00Z",
         "done":false,"status":"open"}
        """#)
        XCTAssertNil(old.source)
        XCTAssertNil(old.call)
    }

    func testTaskDetailDecodesASourceCall() throws {
        let detail: TaskDetail = try decode(#"""
        {"id":"t2","company_id":"c1","message_id":null,"conversation_id":"cv1",
         "source":{"kind":"call","id":"call1"},"source_message":null,
         "source_call":{"id":"call1","call_session_id":"s1","caller_e164":null,
           "caller_name":"Ana","outcome":"answered","forward_seconds":0,
           "started_at":"2026-07-01T10:00:00Z","ended_at":null,
           "contact_id":null,"has_voicemail":false},
         "title":"Call from Ana","created_by_user_id":"u1",
         "created_at":"2026-07-01T00:00:00Z","updated_at":"2026-07-01T00:00:00Z",
         "done":false,"status":"open"}
        """#)
        XCTAssertTrue(detail.isCallTask)
        let call = try XCTUnwrap(detail.source_call)
        XCTAssertEqual(taskCallerName(call, locale: "en"), "Ana")
    }

    func testDoneRouteBranchesOnTheSource() {
        XCTAssertEqual(taskDoneRoute(messageId: "m1", taskId: "t1"), "/v1/messages/m1")
        XCTAssertEqual(taskDoneRoute(messageId: nil, taskId: "t2"), "/v1/tasks/t2")
    }

    func testCreateBodyCarriesExactlyOneSource() throws {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys]
        let body = taskCreateBody(
            messageId: nil, title: "Call from Ana", assignedUserId: nil, dueAt: nil,
            sourceCallId: "call1"
        )
        XCTAssertEqual(
            String(decoding: try encoder.encode(body), as: UTF8.self),
            "{\"source_call_id\":\"call1\",\"title\":\"Call from Ana\"}"
        )
    }

    private func event(_ payload: [String: JSONValue]) -> ConversationEvent {
        ConversationEvent(
            id: "e1", conversation_id: "cv1", actor_user_id: nil,
            type: "call_completed", payload: .object(payload),
            created_at: "2026-07-01T00:00:00Z"
        )
    }

    func testOnlyAPlainAnsweredCallLineOffersATask() {
        XCTAssertEqual(
            answeredCallSessionId(of: event([
                "outcome": .string("answered"), "call_session_id": .string("s1"),
            ])),
            "s1"
        )
        XCTAssertNil(answeredCallSessionId(of: event([
            "outcome": .string("missed"), "call_session_id": .string("s1"),
        ])))
        XCTAssertNil(answeredCallSessionId(of: event([
            "outcome": .string("answered"), "kind": .string("voicemail"),
            "call_session_id": .string("s1"),
        ])))
        XCTAssertNil(answeredCallSessionId(of: event(["outcome": .string("answered")])))
    }
}
