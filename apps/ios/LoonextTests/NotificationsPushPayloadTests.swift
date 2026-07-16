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
