import XCTest
@testable import Loonext

/// Mirrors the Android push/PushPayloadTest.kt vectors 1:1 (categories stand
/// in for Android channel ids — same constants), plus the iOS-only
/// `parsePushRoute` and `pushData(fromUserInfo:)` seams.
final class NotificationsPushPayloadTests: XCTestCase {
    // MARK: - parsePush

    func testMessagePushLandsOnMessagesCategoryWithConversationTag() {
        let content = parsePush([
            "title": "New text from Dana",
            "body": "Can you come by Thursday?",
            "url": "https://app.loonext.com/inbox/1f0f7a5e-1111-2222-3333-444455556666",
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
        XCTAssertEqual(content.url, "https://app.loonext.com/calls?call=sess-abc-123")
    }

    func testTwoConcurrentCallsGetTwoDistinctTags() {
        let first = parsePush(["kind": "call", "url": "/calls?call=sess-1"])
        let second = parsePush(["kind": "call", "url": "/calls?call=sess-2"])

        XCTAssertNotEqual(first.tag, second.tag)
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
        XCTAssertEqual(content.url, PushLink.fallbackDeepLink)
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
        XCTAssertEqual(content.url, "https://app.loonext.com/inbox/c1")
    }

    // MARK: - normalizeDeepLink

    func testRelativePathsResolveAgainstTheAppOrigin() {
        XCTAssertEqual(
            normalizeDeepLink("/inbox/abc"),
            "https://app.loonext.com/inbox/abc"
        )
    }

    func testLegacyConversationsPathsNormalizeToInbox() {
        XCTAssertEqual(
            normalizeDeepLink("https://app.loonext.com/conversations/abc"),
            "https://app.loonext.com/inbox/abc"
        )
        XCTAssertEqual(
            normalizeDeepLink("/conversations/abc"),
            "https://app.loonext.com/inbox/abc"
        )
    }

    func testQueryStringsSurviveForTheCallsWakeLink() {
        XCTAssertEqual(
            normalizeDeepLink("https://app.loonext.com/calls?call=sess-1"),
            "https://app.loonext.com/calls?call=sess-1"
        )
    }

    func testForeignOriginsFallBackToTheInbox() {
        XCTAssertEqual(
            normalizeDeepLink("https://evil.example.com/inbox/x"),
            PushLink.fallbackDeepLink
        )
        XCTAssertEqual(
            normalizeDeepLink("http://app.loonext.com/inbox/x"),
            PushLink.fallbackDeepLink
        )
    }

    func testGarbageAndBlanksFallBackToTheInbox() {
        XCTAssertEqual(normalizeDeepLink(nil), PushLink.fallbackDeepLink)
        XCTAssertEqual(normalizeDeepLink("   "), PushLink.fallbackDeepLink)
        XCTAssertEqual(normalizeDeepLink("::not a url::"), PushLink.fallbackDeepLink)
    }

    // MARK: - coalescingTag

    func testRepeatPushesForOneThreadCoalesceOnOneTag() {
        let url = normalizeDeepLink("/inbox/conv-1")

        XCTAssertEqual(
            coalescingTag(kind: nil, normalizedUrl: url),
            coalescingTag(kind: "missed_call", normalizedUrl: url)
        )
    }

    func testNonThreadLinksTagPerDeepLink() {
        let tag = coalescingTag(kind: nil, normalizedUrl: "https://app.loonext.com/tasks")

        XCTAssertEqual(tag, "notice:https://app.loonext.com/tasks")
    }

    // MARK: - queryParam

    func testQueryParamReadsTheFirstValueAndDecodesIt() {
        XCTAssertEqual(queryParam(url: "https://app.loonext.com/x?call=a%20b&other=1", name: "call"), "a b")
        XCTAssertNil(queryParam(url: "https://app.loonext.com/x?other=1", name: "call"))
        XCTAssertNil(queryParam(url: "https://app.loonext.com/x?call=", name: "call"))
    }

    // MARK: - parsePushRoute (deep-link routing contract)

    func testInboxUrlsRouteToTheThread() {
        XCTAssertEqual(
            parsePushRoute(url: "https://app.loonext.com/inbox/conv-1"),
            .thread(conversationId: "conv-1")
        )
        XCTAssertEqual(
            parsePushRoute(url: "/inbox/conv-1"),
            .thread(conversationId: "conv-1")
        )
    }

    func testLegacyConversationsUrlsRouteToTheThread() {
        XCTAssertEqual(
            parsePushRoute(url: "https://app.loonext.com/conversations/conv-1"),
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
            parsePushRoute(url: "https://app.loonext.com/calls/sess-3"),
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
            parsePushRoute(url: "https://app.loonext.com/tasks/task-9"),
            .task(taskId: "task-9")
        )
    }

    func testCallsUrlsRouteToCallsWithTheSession() {
        XCTAssertEqual(
            parsePushRoute(url: "/calls?call=sess-9"),
            .calls(sessionId: "sess-9")
        )
        XCTAssertEqual(
            parsePushRoute(url: "https://app.loonext.com/calls"),
            .calls(sessionId: nil)
        )
    }

    func testPlainInboxFallbackHasNoRoute() {
        // Foreign origins normalize to /inbox, which is "open the app, no
        // navigation" — same as the Android parseDeepLink null.
        XCTAssertNil(parsePushRoute(url: "https://evil.example.com/inbox/x"))
        XCTAssertNil(parsePushRoute(url: "/inbox"))
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
