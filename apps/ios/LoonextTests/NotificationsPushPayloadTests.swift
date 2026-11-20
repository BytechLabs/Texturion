import Foundation
import UserNotifications
import XCTest
@testable import Loonext

/// Mirrors the Android push/PushPayloadTest.kt vectors 1:1 (categories stand
/// in for Android channel ids — same constants), plus the iOS-only
/// `parsePushRoute` and `pushData(fromUserInfo:)` seams.
final class NotificationsPushPayloadTests: XCTestCase {
    private struct PushRouteVector: Decodable {
        let url: String
        let route: String
        let conversationId: String?
        let taskId: String?
        let messageId: String?
        let sessionId: String?
        let transferId: String?
        let section: String?
    }

    private struct RejectUnexpectedRequest: HTTPClient {
        func data(for request: URLRequest) async throws -> (Data, URLResponse) {
            XCTFail("The action made a request under a different account")
            throw URLError(.cancelled)
        }
    }

    private actor ReplyTransport: HTTPClient {
        private(set) var requests: [URLRequest] = []

        func data(for request: URLRequest) async throws -> (Data, URLResponse) {
            requests.append(request)
            let body = """
            {"id":"sent","conversation_id":"thread","body":"Shade reply",
             "direction":"outbound","status":"sent","created_at":"2026-11-20T00:00:00Z"}
            """
            let response = HTTPURLResponse(url: request.url!, statusCode: 201, httpVersion: nil, headerFields: nil)!
            return (Data(body.utf8), response)
        }
    }

    func testOnlyAFullyScopedPageOffersAcknowledgement() {
        var data = [
            "alert_id": "aaaaaaaa-1111-2222-3333-444455556666",
            "action_company_id": "bbbbbbbb-1111-2222-3333-444455556666",
            "action_user_id": "cccccccc-1111-2222-3333-444455556666",
        ]
        let action = OnCallPushAction(data: data)
        XCTAssertEqual(action?.alertId, data["alert_id"])
        XCTAssertEqual(action?.companyId, data["action_company_id"])
        XCTAssertEqual(action?.userId, data["action_user_id"])

        data["alert_id"] = "1-1-1-1-1"
        XCTAssertNil(OnCallPushAction(data: data))
        data.removeValue(forKey: "action_user_id")
        XCTAssertNil(OnCallPushAction(data: data))
    }

    func testOldPageCannotAcknowledgeUnderTheNewAccount() async {
        let store = SessionStore(storage: InMemorySessionStorage())
        store.save(Session(
            accessToken: "other-token",
            refreshToken: "other-refresh",
            expiresAt: Date().timeIntervalSince1970 + 3600,
            userId: "current-user",
            email: "current@example.com"
        ))
        let api = ApiClient(sessionStore: store, auth: SupabaseAuth(), transport: RejectUnexpectedRequest())
        do {
            _ = try await MessagingRepository(api: api).acknowledgeAlert(
                companyId: "company-1",
                alertId: "alert-1",
                expectedUserId: "old-user"
            )
            XCTFail("An old action must be cancelled")
        } catch is CancellationError {
        } catch {
            XCTFail("Unexpected error: \(error)")
        }
    }

    @MainActor
    func testNotificationActionsMatchTheServerCategories() {
        let categories = Dictionary(uniqueKeysWithValues: pushActionCategories().map { ($0.identifier, $0.actions) })
        XCTAssertEqual(categories["MESSAGE"]?.map(\.identifier), ["REPLY_TO_THREAD", "MARK_THREAD_READ"])
        XCTAssertNotNil(categories["MESSAGE_FR"]?.first as? UNTextInputNotificationAction)
        XCTAssertEqual(categories["MESSAGE_READ_ONLY_FR"]?.map(\.identifier), ["MARK_THREAD_READ"])
        XCTAssertEqual(categories["MISSED_CALL"]?.map(\.identifier), ["CALL_MISSED_CALLER", "TEXT_MISSED_CALLER"])
        XCTAssertEqual(categories["ON_CALL_ALERT_FR"]?.map(\.identifier), ["ACKNOWLEDGE_ON_CALL"])
        XCTAssertEqual(
            categories["ON_CALL_MISSED_CALL_FR"]?.map(\.identifier),
            ["ACKNOWLEDGE_ON_CALL", "CALL_MISSED_CALLER", "TEXT_MISSED_CALLER"]
        )
    }

    @MainActor
    func testNotificationReplyUsesScopedIdempotentOutboxSend() async throws {
        let company = UUID().uuidString
        let conversation = UUID().uuidString
        let user = UUID().uuidString
        let message = UUID().uuidString
        let suite = "push-reply-\(UUID())"
        let defaults = try XCTUnwrap(UserDefaults(suiteName: suite))
        let mediaRoot = FileManager.default.temporaryDirectory.appendingPathComponent(suite, isDirectory: true)
        defer {
            defaults.removePersistentDomain(forName: suite)
            try? FileManager.default.removeItem(at: mediaRoot)
        }
        let session = SessionStore(storage: InMemorySessionStorage())
        session.save(Session(
            accessToken: "test-token", refreshToken: "test-refresh",
            expiresAt: Date().timeIntervalSince1970 + 3600, userId: user, email: "simulator@loonext.test"
        ))
        let transport = ReplyTransport()
        let graph = AppGraph(
            sessionStore: session,
            transport: transport,
            outboxStore: Outbox(defaults: defaults, mediaRoot: mediaRoot)
        )
        let payload = [
            "thread_action": "message", "can_reply": "true",
            "action_company_id": company, "action_user_id": user,
            "action_conversation_id": conversation, "action_message_id": message,
        ]
        let accepted = try await performThreadPushAction(.reply, data: payload, replyText: " Shade reply ", graph: graph)
        XCTAssertTrue(accepted)
        XCTAssertTrue(graph.outbox.store.all().isEmpty)
        let requests = await transport.requests
        XCTAssertEqual(requests.count, 1)
        let request = try XCTUnwrap(requests.first)
        XCTAssertEqual(request.httpMethod, "POST")
        XCTAssertEqual(request.url?.path, "/v1/messages/send")
        XCTAssertEqual(request.value(forHTTPHeaderField: "X-Company-Id"), company)
        XCTAssertEqual(request.value(forHTTPHeaderField: "Idempotency-Key"), "push-reply-\(message)-\(user)")
        let body = try XCTUnwrap(request.httpBody)
        XCTAssertEqual(
            try JSONDecoder().decode([String: String].self, from: body),
            ["conversation_id": conversation, "body": "Shade reply"]
        )
    }

    // MARK: - parsePush

    func testReadClearsThreadAlertsWithoutClearingNoteMentions() {
        let tags = conversationNotificationTags("c1")
        let mention = parsePush(["url": "/inbox/c1?message=m1", "tag": "mention:m1"])
        let emergency = parsePush(["url": "/inbox/c1", "tag": "emergency:c1"])
        XCTAssertFalse(tags.contains(mention.tag))
        XCTAssertTrue(tags.contains(emergency.tag))
        XCTAssertTrue(tags.contains(parsePush(["url": "/inbox/c1"]).tag))
    }

    func testMessagePushLandsOnMessagesCategoryWithConversationTag() {
        let content = parsePush([
            "title": "New text from Dana",
            "body": "Can you come by Thursday?",
            "url": "\(AppConfig.appOrigin.absoluteString)/inbox/1f0f7a5e-1111-2222-3333-444455556666",
        ])

        XCTAssertEqual(content.category, PushCategory.messages)
        XCTAssertEqual(content.tag, "conversation:1f0f7a5e-1111-2222-3333-444455556666")
        XCTAssertEqual(content.title, "New text from Dana")
        XCTAssertEqual(content.body, "Can you come by Thursday?")
        XCTAssertNil(content.kind)
    }

    func testTaskReminderKeepsItsOwnIdentityOnAThreadUrl() {
        // A reminder links to the job over its customer's thread, so it carries
        // an /inbox url. The kind is what tells it apart from a text about that
        // conversation, which is what the foreground rule reads: suppressing on
        // the url alone dropped the reminder whenever the assignee had that
        // thread open.
        let content = parsePush([
            "kind": "task_due",
            "title": "Replace the outdoor tap",
            "body": "Due in 30 min",
            "url": "/inbox/1f0f7a5e-1111-2222-3333-444455556666?task=task-9",
        ])

        XCTAssertEqual(content.kind, PushKind.taskDue)
    }

    func testTransferWakeKeepsTheSessionTagAndExposesTheTransferId() {
        let transferId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
        let url = "/calls?call=sess-abc-123&transfer=\(transferId)"
        let content = parsePush(["kind": "call", "title": "Transfer from Sam", "url": url])

        XCTAssertEqual("call:sess-abc-123", content.tag)
        XCTAssertEqual("sess-abc-123", content.callSessionId)
        XCTAssertEqual(transferId, content.transferId)
        XCTAssertEqual(.calls(sessionId: "sess-abc-123", transferId: transferId), parsePushRoute(url: url))
    }

    func testCallPushIsHighUrgencyCategoryWithPerSessionTagAndSessionId() {
        let content = parsePush([
            "kind": "call",
            "title": "Incoming call",
            "body": "(415) 555-0134",
            "url": "/calls?call=sess-abc-123",
        ])

        XCTAssertTrue(content.isCall)
        XCTAssertEqual(content.category, PushCategory.incomingCalls)
        XCTAssertEqual(content.tag, "call:sess-abc-123")
        XCTAssertEqual(content.callSessionId, "sess-abc-123")
        XCTAssertEqual(content.url, "\(AppConfig.appOrigin.absoluteString)/calls?call=sess-abc-123")
    }

    func testTwoConcurrentCallsGetTwoDistinctTags() {
        let first = parsePush(["kind": "call", "url": "/calls?call=sess-1"])
        let second = parsePush(["kind": "call", "url": "/calls?call=sess-2"])

        XCTAssertNotEqual(first.tag, second.tag)
    }

    func testCallEndIdentifiesTheRingToClear() {
        let push = parsePush(["kind": "call_end", "url": "/calls?call=session-2"])
        XCTAssertTrue(push.isCallEnd)
        XCTAssertFalse(push.isCall)
        XCTAssertEqual(push.callSessionId, "session-2")
    }

    func testMissedCallKindRoutesToTheMissedCallsCategory() {
        let content = parsePush([
            "kind": "missed_call",
            "title": "Missed call from Dana",
            "body": "We sent them a text.",
            "url": "/inbox/conv-9",
        ])

        XCTAssertEqual(content.category, PushCategory.missedCalls)
        XCTAssertEqual(content.tag, "conversation:conv-9")
    }

    func testOnCallPagesAndEscalationsUseTheUrgentCategory() {
        let page = parsePush(["kind": "missed_call", "alert_id": "alert-1", "url": "/inbox/conv-9"])
        let escalation = parsePush(["kind": "escalation", "alert_id": "alert-1", "url": "/inbox/conv-9"])

        XCTAssertEqual(page.category, PushCategory.emergency)
        XCTAssertEqual(escalation.category, PushCategory.emergency)
    }

    func testSavedVoicemailUsesTheCallsCategoryAndThreadTag() {
        let content = parsePush(["kind": "voicemail", "url": "/inbox/conv-9"])
        XCTAssertEqual(content.category, PushCategory.missedCalls)
        XCTAssertEqual(content.tag, "conversation:conv-9")
    }

    func testBeingHandedWorkRoutesToTheAssignmentsCategory() {
        // #515. Separate from Messages for the same reason the Android channel
        // is: the inbox is the first thing a busy crew silences, and somebody
        // putting a job on your name is the alert that must survive that.
        let thread = parsePush([
            "kind": "conversation_assigned",
            "title": "Sam assigned you a conversation",
            "body": "Dana Reyes",
            "url": "/inbox/conv-4",
        ])
        let task = parsePush([
            "kind": "task_assigned",
            "title": "Sam assigned you a task",
            "body": "Re-pipe the basement",
            "url": "/tasks/task-2",
        ])

        XCTAssertEqual(thread.category, PushCategory.assignments)
        XCTAssertEqual(task.category, PushCategory.assignments)
    }

    func testAChangeToAFollowedTaskRoutesToTheAssignmentsCategory() {
        // #689 D: the same category as being handed work, and the link opens the task.
        let update = parsePush([
            "kind": "task_update",
            "title": "Dana finished a task",
            "body": "Re-pipe the basement",
            "url": "/tasks/task-2",
        ])

        XCTAssertEqual(update.category, PushCategory.assignments)
    }

    func testAnUrgentTextGetsItsOwnCategoryNotMessages() {
        // #564: it used to be indistinguishable from "on my way?" — same
        // category, same presentation — while the reply we send that customer
        // says the crew has been alerted. The loudness itself is server-side on
        // this platform (an `interruption-level` of time-sensitive, so a Focus
        // lets it through); this category is what the client branches on.
        let content = parsePush([
            "kind": "emergency",
            "title": "EMERGENCY from Maria Alvarez",
            "body": "URGENT no heat",
            "url": "/inbox/conv-9",
        ])

        XCTAssertEqual(content.category, PushCategory.emergency)
        XCTAssertEqual(content.kind, PushKind.emergency)
    }

    func testMoneyMovingGetsThePaymentsCategoryWhicheverWayItMoved() {
        // #607 option B. All three outcomes share one kind because they share
        // one destination: a refund in a category the deposit is not would be a
        // switch somebody could silence without ever knowing they had.
        let paid = parsePush([
            "kind": "payment",
            "title": "Maria Alvarez paid $250",
            "body": "Deposit for the driveway",
            "url": "/inbox/conv-9",
        ])
        let disputed = parsePush([
            "kind": "payment",
            "title": "Maria Alvarez's bank pulled back $250",
            "body": "Deposit for the driveway",
            "url": "/inbox/conv-9",
        ])

        XCTAssertEqual(paid.category, PushCategory.payments)
        XCTAssertEqual(disputed.category, PushCategory.payments)
        XCTAssertEqual(paid.kind, PushKind.payment)
    }

    func testThePaymentsCategoryIsNotMessages() {
        // The pairing that makes the category worth having: sharing Messages
        // would mean muting the inbox for an afternoon also mutes the deposit
        // somebody is standing in a driveway waiting on.
        XCTAssertNotEqual(PushCategory.payments, PushCategory.messages)
    }

    func testAnOrdinaryTextStaysInMessages() {
        // The other half of the pairing. Everything in the loud category is a
        // category everybody mutes, which tells nobody anything.
        let content = parsePush([
            "title": "Maria Alvarez",
            "body": "on my way?",
            "url": "/inbox/conv-9",
        ])

        XCTAssertEqual(content.category, PushCategory.messages)
        XCTAssertNil(content.kind)
    }

    func testTheUrgentCategoryIsNotTheRingingOne() {
        // Borrowing incomingCalls would present a text as a phone call, and
        // would mean somebody who silences ringing silences this too.
        XCTAssertNotEqual(PushCategory.emergency, PushCategory.incomingCalls)
        XCTAssertNotEqual(PushCategory.emergency, PushCategory.messages)
    }

    func testEmptyPayloadDegradesToACalmGenericNoticeNeverDropped() {
        let content = parsePush([:])

        XCTAssertEqual(content.title, "Loonext")
        XCTAssertEqual(content.body, "You have a new notification.")
        XCTAssertNil(content.url)
        XCTAssertEqual(content.category, PushCategory.messages)
    }

    func testCallPushWithNoUrlStillRingsWithAFallbackTag() {
        let content = parsePush(["kind": "call"])

        XCTAssertTrue(content.isCall)
        XCTAssertEqual(content.title, "Incoming call")
        XCTAssertEqual(content.category, PushCategory.incomingCalls)
        XCTAssertEqual(content.tag, "call:\(PushLink.fallbackDeepLink)")
        XCTAssertNil(content.callSessionId)
    }

    func testBlankTitleAndBodyFallBackWithoutTouchingAValidUrl() {
        let content = parsePush(["title": "  ", "body": "", "url": "/inbox/c1"])

        XCTAssertEqual(content.title, "Loonext")
        XCTAssertEqual(content.body, "You have a new notification.")
        XCTAssertEqual(content.url, "\(AppConfig.appOrigin.absoluteString)/inbox/c1")
    }

    // MARK: - normalizeDeepLink

    func testRelativePathsResolveAgainstTheAppOrigin() {
        XCTAssertEqual(
            normalizeDeepLink("/inbox/abc"),
            "\(AppConfig.appOrigin.absoluteString)/inbox/abc"
        )
    }

    func testLegacyConversationsPathsNormalizeToInbox() {
        XCTAssertEqual(
            normalizeDeepLink("\(AppConfig.appOrigin.absoluteString)/conversations/abc"),
            "\(AppConfig.appOrigin.absoluteString)/inbox/abc"
        )
        XCTAssertEqual(
            normalizeDeepLink("/conversations/abc"),
            "\(AppConfig.appOrigin.absoluteString)/inbox/abc"
        )
    }

    func testQueryStringsSurviveForTheCallsWakeLink() {
        XCTAssertEqual(
            normalizeDeepLink("\(AppConfig.appOrigin.absoluteString)/calls?call=sess-1"),
            "\(AppConfig.appOrigin.absoluteString)/calls?call=sess-1"
        )
    }

    func testForeignOriginsDoNotNavigate() {
        XCTAssertNil(normalizeDeepLink("https://evil.example.com/inbox/x"))
        XCTAssertNil(normalizeDeepLink("http://app.loonext.com/inbox/x"))
        XCTAssertNil(normalizeDeepLink("//evil.example.com/inbox/x"))
    }

    func testGarbageAndBlanksDoNotNavigate() {
        XCTAssertNil(normalizeDeepLink(nil))
        XCTAssertNil(normalizeDeepLink("   "))
        XCTAssertNil(normalizeDeepLink("::not a url::"))
        XCTAssertNil(normalizeDeepLink(PushLink.appOrigin))
    }

    // MARK: - coalescingTag

    func testRepeatPushesForOneThreadCoalesceOnOneTag() throws {
        let url = try XCTUnwrap(normalizeDeepLink("/inbox/conv-1"))

        XCTAssertEqual(
            coalescingTag(kind: nil, normalizedUrl: url),
            coalescingTag(kind: "missed_call", normalizedUrl: url)
        )
    }

    func testNonThreadLinksTagPerDeepLink() {
        let tag = coalescingTag(kind: nil, normalizedUrl: "\(AppConfig.appOrigin.absoluteString)/tasks")

        XCTAssertEqual(tag, "notice:\(AppConfig.appOrigin.absoluteString)/tasks")
    }

    // MARK: - queryParam

    func testQueryParamReadsTheFirstValueAndDecodesIt() {
        XCTAssertEqual(queryParam(url: "\(AppConfig.appOrigin.absoluteString)/x?call=a%20b&other=1", name: "call"), "a b")
        XCTAssertNil(queryParam(url: "\(AppConfig.appOrigin.absoluteString)/x?other=1", name: "call"))
        XCTAssertNil(queryParam(url: "\(AppConfig.appOrigin.absoluteString)/x?call=", name: "call"))
    }

    // MARK: - parsePushRoute (deep-link routing contract)

    func testPushRoutesAgreeWithTheSharedFixture() throws {
        var directory = URL(fileURLWithPath: #filePath).deletingLastPathComponent()
        var cases: [PushRouteVector] = []
        while directory.path != "/" {
            let fixture = directory.appendingPathComponent("packages/shared/vectors/push-routes.json")
            if FileManager.default.fileExists(atPath: fixture.path) {
                cases = try JSONDecoder().decode([PushRouteVector].self, from: Data(contentsOf: fixture))
                break
            }
            directory = directory.deletingLastPathComponent()
        }
        XCTAssertFalse(cases.isEmpty, "Missing push-routes.json")
        let sections: [String: SettingsSection] = [
            "billing": .billing, "notifications": .notifications, "numbers": .numbers,
            "profile": .profile, "usage": .usage,
        ]
        for vector in cases {
            let expected: PushRoute
            switch vector.route {
            case "inbox": expected = .inbox
            case "thread":
                expected = .thread(conversationId: try XCTUnwrap(vector.conversationId),
                                   taskId: vector.taskId, messageId: vector.messageId)
            case "task": expected = .task(taskId: try XCTUnwrap(vector.taskId))
            case "calls": expected = .calls(sessionId: vector.sessionId, transferId: vector.transferId)
            case "forYou": expected = .forYou
            case "settings":
                expected = .settings(section: try XCTUnwrap(sections[vector.section ?? ""]))
            default:
                XCTFail("Unknown fixture route: \(vector.route)")
                continue
            }
            let content = parsePush(["url": vector.url])
            XCTAssertEqual(parsePushRoute(url: content.url), expected, vector.url)
        }
    }

    func testInboxUrlsRouteToTheThread() {
        XCTAssertEqual(
            parsePushRoute(url: "\(AppConfig.appOrigin.absoluteString)/inbox/conv-1"),
            .thread(conversationId: "conv-1")
        )
        XCTAssertEqual(
            parsePushRoute(url: "/inbox/conv-1"),
            .thread(conversationId: "conv-1")
        )
    }

    func testLegacyConversationsUrlsRouteToTheThread() {
        XCTAssertEqual(
            parsePushRoute(url: "\(AppConfig.appOrigin.absoluteString)/conversations/conv-1"),
            .thread(conversationId: "conv-1")
        )
    }

    func testATaskReminderOpensTheJobOverItsCustomersThread() {
        // The server points reminders at /inbox/<conv>?task=<id> so one tap
        // carries the address and checklist AND the thread they are about.
        XCTAssertEqual(
            parsePushRoute(url: "/inbox/conv-1?task=task-9"),
            .thread(conversationId: "conv-1", taskId: "task-9")
        )
    }

    func testACallPermalinkCarriesItsSession() {
        // #336: /calls/<session> matched the "calls" branch and then read only
        // the query param, so a permalink somebody was handed resolved to the
        // empty calls list — the dead-end tap this table exists to prevent.
        XCTAssertEqual(
            parsePushRoute(url: "\(AppConfig.appOrigin.absoluteString)/calls/sess-3"),
            .calls(sessionId: "sess-3")
        )
    }

    func testTheCallPathWinsOverTheWakeParam() {
        // The query form is the ring-wake link a push sends; a path segment is
        // only present when a human followed a link to one specific call.
        XCTAssertEqual(
            parsePushRoute(url: "/calls/from-path?call=from-query"),
            .calls(sessionId: "from-path")
        )
    }

    func testTheWakeLinkStillWorksWithNoPathSegment() {
        XCTAssertEqual(
            parsePushRoute(url: "/calls?call=sess-1"),
            .calls(sessionId: "sess-1")
        )
        XCTAssertEqual(parsePushRoute(url: "/calls"), .calls(sessionId: nil))
    }

    func testATaskWithNoThreadBehindItOpensItsOwnPage() {
        // This used to resolve to nothing, so the tap appeared to do nothing.
        XCTAssertEqual(
            parsePushRoute(url: "\(AppConfig.appOrigin.absoluteString)/tasks/task-9"),
            .task(taskId: "task-9")
        )
    }

    func testCallsUrlsRouteToCallsWithTheSession() {
        XCTAssertEqual(
            parsePushRoute(url: "/calls?call=sess-9"),
            .calls(sessionId: "sess-9")
        )
        XCTAssertEqual(
            parsePushRoute(url: "\(AppConfig.appOrigin.absoluteString)/calls"),
            .calls(sessionId: nil)
        )
    }

    func testSettingsAndForYouUrlsRouteToTheirNativeSurfaces() {
        XCTAssertEqual(
            parsePushRoute(url: "/settings/notifications"),
            .settings(section: .notifications)
        )
        XCTAssertEqual(
            parsePushRoute(url: "/settings/account"),
            .settings(section: .profile)
        )
        XCTAssertEqual(
            parsePushRoute(url: "/settings/newer-section"),
            .settings(section: nil)
        )
        XCTAssertEqual(parsePushRoute(url: "/for-you"), .forYou)
    }

    func testAnExplicitInboxLinkOpensInboxWhileAnInvalidLinkHasNoRoute() {
        let digest = parsePush(["url": "\(AppConfig.appOrigin.absoluteString)/inbox"])
        XCTAssertEqual(parsePushRoute(url: digest.url), .inbox)
        XCTAssertNil(parsePushRoute(url: "https://evil.example.com/inbox/x"))
        XCTAssertNil(parsePushRoute(url: nil))
    }

    // MARK: - pushData (APNs userInfo extraction)

    func testUserInfoExtractionTakesStringsAndAppliesAlertFallbacks() {
        let userInfo: [AnyHashable: Any] = [
            "url": "/inbox/c1",
            "aps": ["alert": ["title": "ignored"]],
            7: "non-string key ignored",
        ]

        let data = pushData(
            fromUserInfo: userInfo,
            fallbackTitle: "From alert",
            fallbackBody: "Alert body"
        )

        XCTAssertEqual(data["url"], "/inbox/c1")
        XCTAssertEqual(data["title"], "From alert")
        XCTAssertEqual(data["body"], "Alert body")
        XCTAssertNil(data["aps"])
    }

    func testUserInfoDataKeysWinOverAlertFallbacks() {
        let data = pushData(
            fromUserInfo: ["title": "Data title", "body": "Data body"],
            fallbackTitle: "Alert title",
            fallbackBody: "Alert body"
        )

        XCTAssertEqual(data["title"], "Data title")
        XCTAssertEqual(data["body"], "Data body")
    }
}
