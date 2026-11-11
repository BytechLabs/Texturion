import XCTest
@testable import Loonext

/// #725: an automated text says which automation sent it, in both languages.
/// Mirrors `MessageAutomationTest.kt` and web's `clusters.test.ts`: the phones
/// have no clusters, so the split is that an automated text is never credited
/// to the owner it was sent in the name of.
final class MessageAutomationTests: XCTestCase {
    private let fr = MessageLocale.frCA

    private func text(
        automated: Bool = false,
        automation: String? = nil,
        sentBy: String? = "owner",
        direction: String = MessageDirection.outbound
    ) -> Message {
        Message(
            id: "m1",
            conversation_id: "c1",
            direction: direction,
            body: "hi",
            status: MessageStatus.sent,
            segments: nil,
            encoding: nil,
            sent_by_user_id: sentBy,
            error_code: nil,
            error_detail: nil,
            telnyx_message_id: nil,
            done_at: nil,
            done_by_user_id: nil,
            pinned_at: nil,
            pinned_by_user_id: nil,
            created_at: "2026-11-10T15:00:00Z",
            attachments: [],
            has_task: false,
            promoted_task: nil,
            task_id: nil,
            task: nil,
            automated: automated,
            automation: automation
        )
    }

    func testEveryAutomationHasItsOwnNameInBothLanguages() {
        XCTAssertEqual(messageAutomations.count, 7)
        let english = messageAutomations.map { messageAutomationName($0) }
        let french = messageAutomations.map { messageAutomationName($0, fr) }
        XCTAssertFalse(english.contains(where: { $0 == nil }))
        XCTAssertFalse(french.contains(where: { $0 == nil }))
        XCTAssertEqual(Set(english.compactMap { $0 }).count, english.count)
        XCTAssertEqual(Set(french.compactMap { $0 }).count, french.count)
        for index in messageAutomations.indices {
            XCTAssertNotEqual(english[index], french[index])
        }
    }

    func testNamesMatchTheWebCatalogue() {
        XCTAssertEqual(messageAutomationName("away_reply"), "Away reply")
        XCTAssertEqual(messageAutomationName("missed_call_text"), "Missed-call text")
        XCTAssertEqual(messageAutomationName("away_reply", fr), "Réponse d’absence")
        XCTAssertNil(messageAutomationName("something_new"))
        XCTAssertNil(messageAutomationName(nil))
    }

    func testTheLabelReadsSentAutomaticallyWithTheAutomationOrWithoutIt() {
        XCTAssertEqual(sentAutomaticallyLabel("away_reply"), "Sent automatically · Away reply")
        XCTAssertEqual(sentAutomaticallyLabel(nil), "Sent automatically")
        XCTAssertEqual(sentAutomaticallyLabel("something_new"), "Sent automatically")
        XCTAssertEqual(
            sentAutomaticallyLabel("reminder", fr),
            "Envoyé automatiquement · Rappel de tâche"
        )
    }

    func testAnAutomatedTextIsNotCreditedToTheOwnerItWasSentInTheNameOf() {
        let names = ["owner": "Sam Ortiz"]
        XCTAssertEqual(messageSenderLabel(text(), names: names), "Sam Ortiz")
        XCTAssertEqual(
            messageSenderLabel(text(automated: true, automation: "away_reply"), names: names),
            "Sent automatically · Away reply"
        )
        XCTAssertEqual(
            messageSenderLabel(text(automated: true), names: names),
            "Sent automatically"
        )
        XCTAssertNil(messageSenderLabel(text(sentBy: nil), names: names))
    }

    func testTheAutomationKeysExistInBothCatalogues() {
        let keys = AppStrings.en.keys.filter { $0.hasPrefix("thread.automation") }
            + ["thread.sentAutomatically", "thread.sentAutomaticallyBy"]
        XCTAssertEqual(keys.count, 9)
        for key in keys {
            XCTAssertNotNil(AppStrings.frCA[key], key)
        }
    }

    func testAMessageDecodesWithAndWithoutTheAutomationFields() throws {
        let base = #"{"id":"m1","conversation_id":"c1","direction":"outbound","body":"hi","created_at":"2026-11-10T15:00:00Z""#
        let plain = try JSONDecoder().decode(Message.self, from: Data((base + "}").utf8))
        XCTAssertFalse(plain.automated)
        XCTAssertNil(plain.automation)
        let automated = try JSONDecoder().decode(
            Message.self,
            from: Data((base + #","automated":true,"automation":"off_ramp"}"#).utf8)
        )
        XCTAssertTrue(automated.automated)
        XCTAssertEqual(automated.automation, "off_ramp")
    }
}
