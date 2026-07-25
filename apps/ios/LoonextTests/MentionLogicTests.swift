import XCTest

@testable import Loonext

/// The same cases the web client pins in `mentions.test.ts` and Android pins in
/// `MentionLogicTest.kt`. All three clients POST `mention_user_ids`, so any
/// drift here is drift in who gets notified.
final class MentionLogicTests: XCTestCase {

    func testSendsThePickedIdNotOneGuessedFromText() {
        XCTAssertEqual(
            MentionLogic.resolveMentions(
                text: "@Sam can you look?",
                picked: [PickedMention(userId: "sam-rivera", name: "Sam")]
            ),
            ["sam-rivera"]
        )
    }

    func testWithdrawsAMentionDeletedFromTheDraft() {
        XCTAssertEqual(
            MentionLogic.resolveMentions(
                text: "never mind",
                picked: [PickedMention(userId: "sam-rivera", name: "Sam")]
            ),
            []
        )
    }

    func testDoesNotReArmAWithdrawnMentionWhoseNameIsAPrefixOfAnother() {
        // "@Sam" was deleted; "@Sam Rivera" remains and contains it.
        XCTAssertEqual(
            MentionLogic.resolveMentions(
                text: "@Sam Rivera can you look?",
                picked: [
                    PickedMention(userId: "sam", name: "Sam"),
                    PickedMention(userId: "sam-rivera", name: "Sam Rivera"),
                ]
            ),
            ["sam-rivera"]
        )
    }

    func testKeepsBothWhenTheDraftReallyNamesBoth() {
        XCTAssertEqual(
            Set(
                MentionLogic.resolveMentions(
                    text: "@Sam Rivera and @Sam please",
                    picked: [
                        PickedMention(userId: "sam", name: "Sam"),
                        PickedMention(userId: "sam-rivera", name: "Sam Rivera"),
                    ]
                )
            ),
            Set(["sam", "sam-rivera"])
        )
    }

    func testNotifiesOnePersonWhenTwoTeammatesShareANameAndOneIsNamed() {
        XCTAssertEqual(
            MentionLogic.resolveMentions(
                text: "@Sam can you check the shutoff?",
                picked: [
                    PickedMention(userId: "sam-a", name: "Sam"),
                    PickedMention(userId: "sam-b", name: "Sam"),
                ]
            ).count,
            1
        )
    }

    func testTreatsARepeatedNameAsSeparateClaims() {
        XCTAssertEqual(
            Set(
                MentionLogic.resolveMentions(
                    text: "@Sam and also @Sam",
                    picked: [
                        PickedMention(userId: "sam-a", name: "Sam"),
                        PickedMention(userId: "sam-b", name: "Sam"),
                    ]
                )
            ),
            Set(["sam-a", "sam-b"])
        )
    }

    func testTriggerOpensAtTheStartAndAfterASpace() {
        XCTAssertTrue(MentionLogic.isMentionTrigger(text: "@", caret: 1))
        XCTAssertTrue(MentionLogic.isMentionTrigger(text: "hey @", caret: 5))
    }

    func testTriggerStaysShutInsideAnEmailAddress() {
        // An internal note is exactly where someone writes a customer's email.
        XCTAssertFalse(MentionLogic.isMentionTrigger(text: "bob@acme.com", caret: 4))
        XCTAssertFalse(MentionLogic.isMentionTrigger(text: "rate2@", caret: 6))
        XCTAssertFalse(MentionLogic.isMentionTrigger(text: "hello", caret: 5))
    }

    func testInsertReplacesTheTriggerAndPlacesTheCaret() {
        let result = MentionLogic.insertMention(text: "hey @", caret: 5, name: "Sam")
        XCTAssertEqual(result.text, "hey @Sam ")
        XCTAssertEqual(result.caret, 9)
    }

    func testInsertMidDraftDoesNotDoubleAnExistingSpace() {
        let result = MentionLogic.insertMention(text: "hey @ can you look?", caret: 5, name: "Sam")
        XCTAssertEqual(result.text, "hey @Sam can you look?")
        XCTAssertEqual(result.caret, 8)
    }
}
