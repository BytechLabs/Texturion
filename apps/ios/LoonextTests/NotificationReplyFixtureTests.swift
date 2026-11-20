#if LOONEXT_QA
import Foundation
import XCTest
@testable import Loonext

@MainActor
final class NotificationReplyFixtureTests: XCTestCase {
    private struct Write: Decodable {
        let path: String
        let idempotencyKey: String?
    }

    func testReplySendsOnceAndAppearsInConversation() async throws {
        let fixture = try XCTUnwrap(URL(string: "http://127.0.0.1:8765"))
        guard AppConfig.apiURL == fixture, AppConfig.supabaseURL == fixture else {
            XCTFail("The reply test needs the local QA fixture")
            return
        }

        let suite = "qa-push-reply-\(UUID())"
        let defaults = try XCTUnwrap(UserDefaults(suiteName: suite))
        let mediaRoot = FileManager.default.temporaryDirectory.appendingPathComponent(suite, isDirectory: true)
        defer {
            defaults.removePersistentDomain(forName: suite)
            try? FileManager.default.removeItem(at: mediaRoot)
        }
        let graph = AppGraph(
            sessionStore: SessionStore(storage: InMemorySessionStorage()),
            outboxStore: Outbox(defaults: defaults, mediaRoot: mediaRoot)
        )
        try await graph.authManager.signIn(email: "qa@example.invalid", password: "simulator-only")
        let user = try XCTUnwrap(graph.sessionStore.current()?.userId)
        let company = "20000000-0000-4000-8000-000000000001"
        let conversation = "20000000-0000-4000-8000-000000000011"
        let repository = MessagingRepository(api: graph.api)
        let history = try await repository.messages(companyId: company, conversationId: conversation)
        let incoming = try XCTUnwrap(history.data.first?.id)
        let payload = [
            "thread_action": "message", "can_reply": "true",
            "action_company_id": company, "action_user_id": user,
            "action_conversation_id": conversation, "action_message_id": incoming,
        ]
        let reply = "Simulator reply handler fixture"
        let accepted = try await performThreadPushAction(.reply, data: payload, replyText: reply, graph: graph)
        XCTAssertTrue(accepted)
        XCTAssertTrue(graph.outbox.store.all().isEmpty)

        let updated = try await repository.messages(companyId: company, conversationId: conversation)
        let sent = try XCTUnwrap(updated.data.first(where: { $0.body == reply }))
        XCTAssertEqual(sent.direction, MessageDirection.outbound)
        XCTAssertEqual(sent.status, MessageStatus.sent)

        let (data, _) = try await URLSession.shared.data(from: fixture.appending(path: "__qa/writes"))
        let sends = try JSONDecoder().decode([Write].self, from: data).filter { $0.path == "/v1/messages/send" }
        XCTAssertEqual(sends.map(\.idempotencyKey), ["push-reply-\(incoming)-\(user)"])
    }
}
#endif
