import XCTest
@testable import Loonext

/// #408 — port of EVERY vector in packages/shared/src/duplicate-reply.test.ts
/// (via the Android DuplicateReplyTest twin).
///
/// The assertions that matter most are the ones about NOT warning. A
/// confirmation that fires when it should not is worse than none: the first
/// false one teaches people to dismiss it, and then the true one — the send
/// landing on top of a colleague's answer — gets dismissed too.
final class MessagingDuplicateReplyTests: XCTestCase {

    private let me = "user-me"
    private let sam = "user-sam"

    func testWarnsWhenATeammateRepliedWhileTheDraftWasBeingWritten() {
        XCTAssertEqual(
            duplicateReplyWarning(
                draftStartedAt: "2026-07-29T10:00:00.000Z",
                lastOutboundAt: "2026-07-29T10:00:40.000Z",
                lastOutboundByUserId: sam,
                meUserId: me
            ),
            DuplicateReplyWarning(warn: true, byUserId: sam)
        )
    }

    func testDoesNotWarnAboutAReplyThatPredatesTheDraft() {
        XCTAssertFalse(
            duplicateReplyWarning(
                draftStartedAt: "2026-07-29T10:00:00.000Z",
                lastOutboundAt: "2026-07-29T09:58:00.000Z",
                lastOutboundByUserId: sam,
                meUserId: me
            ).warn
        )
    }

    func testDoesNotWarnAboutYourOwnPreviousSend() {
        // Sending twice in a row is deliberate and ordinary; warning here would
        // fire on the most common action there is.
        XCTAssertFalse(
            duplicateReplyWarning(
                draftStartedAt: "2026-07-29T10:00:00.000Z",
                lastOutboundAt: "2026-07-29T10:00:40.000Z",
                lastOutboundByUserId: me,
                meUserId: me
            ).warn
        )
    }

    func testWarnsAboutAnAutomaticSendWithNoNameToGive() {
        XCTAssertEqual(
            duplicateReplyWarning(
                draftStartedAt: "2026-07-29T10:00:00.000Z",
                lastOutboundAt: "2026-07-29T10:00:05.000Z",
                lastOutboundByUserId: nil,
                meUserId: me
            ),
            DuplicateReplyWarning(warn: true, byUserId: nil)
        )
    }

    func testStaysSilentWhenTheDraftStartIsUnknown() {
        XCTAssertFalse(
            duplicateReplyWarning(
                draftStartedAt: nil,
                lastOutboundAt: "2026-07-29T10:00:40.000Z",
                lastOutboundByUserId: sam,
                meUserId: me
            ).warn
        )
    }

    func testStaysSilentInAThreadNobodyHasRepliedIn() {
        XCTAssertFalse(
            duplicateReplyWarning(
                draftStartedAt: "2026-07-29T10:00:00.000Z",
                lastOutboundAt: nil,
                lastOutboundByUserId: nil,
                meUserId: me
            ).warn
        )
    }

    func testStaysSilentOnATimestampItCannotRead() {
        XCTAssertFalse(
            duplicateReplyWarning(
                draftStartedAt: "not a date",
                lastOutboundAt: "2026-07-29T10:00:40.000Z",
                lastOutboundByUserId: sam,
                meUserId: me
            ).warn
        )
    }

    func testWarnsOnADraftLeftOvernightAndSentInTheMorning() {
        // A recency window would miss this, and it is the case where the sender
        // is LEAST likely to have seen the reply.
        XCTAssertTrue(
            duplicateReplyWarning(
                draftStartedAt: "2026-07-28T18:00:00.000Z",
                lastOutboundAt: "2026-07-29T08:00:00.000Z",
                lastOutboundByUserId: sam,
                meUserId: me
            ).warn
        )
    }

    func testParsesATimestampWithoutFractionalSeconds() {
        // The API emits both shapes; a formatter that only accepts one would
        // silently disable the warning for half of them.
        XCTAssertTrue(
            duplicateReplyWarning(
                draftStartedAt: "2026-07-29T10:00:00Z",
                lastOutboundAt: "2026-07-29T10:00:40Z",
                lastOutboundByUserId: sam,
                meUserId: me
            ).warn
        )
    }

    func testNamesThePersonBecauseThatIsAFactSomebodyCanActOn() {
        XCTAssertEqual(duplicateReplyPrompt(who: "Sam", secondsAgo: 40), "Sam replied just now.")
        XCTAssertEqual(duplicateReplyPrompt(who: "Sam", secondsAgo: 60), "Sam replied 1 minute ago.")
        XCTAssertEqual(
            duplicateReplyPrompt(who: "Sam", secondsAgo: 120),
            "Sam replied 2 minutes ago."
        )
        XCTAssertEqual(
            duplicateReplyPrompt(who: "Sam", secondsAgo: 7200),
            "Sam replied 2 hours ago."
        )
    }

    func testDoesNotBorrowANameItDoesNotHave() {
        XCTAssertEqual(
            duplicateReplyPrompt(who: nil, secondsAgo: 5),
            "An automatic reply went out just now."
        )
        XCTAssertEqual(
            duplicateReplyPrompt(who: "  ", secondsAgo: 5),
            "An automatic reply went out just now."
        )
    }

    func testStopsCountingPastADay() {
        XCTAssertEqual(
            duplicateReplyPrompt(who: "Sam", secondsAgo: 200_000),
            "Sam replied since you started writing."
        )
    }
}
