import XCTest

@testable import Loonext

/// #691 — who may delete, which text needs the "customer still has it"
/// confirmation, and the sentence each outcome says.
final class RecordDeletionTests: XCTestCase {
    private func message(_ direction: String, status: String?) -> Message {
        let statusJson = status.map { "\"\($0)\"" } ?? "null"
        let json = """
        {
          "id": "m1",
          "conversation_id": "c1",
          "direction": "\(direction)",
          "body": "On my way.",
          "status": \(statusJson),
          "created_at": "2026-07-15T12:00:00Z"
        }
        """
        return try! JSONDecoder().decode(Message.self, from: Data(json.utf8))
    }

    func testOnlyAdminsAndOwnersMayDelete() {
        XCTAssertTrue(RecordDeletion.canDelete(role: "owner"))
        XCTAssertTrue(RecordDeletion.canDelete(role: "admin"))
        XCTAssertFalse(RecordDeletion.canDelete(role: "member"))
        XCTAssertFalse(RecordDeletion.canDelete(role: "read_only"))
        XCTAssertFalse(RecordDeletion.canDelete(role: "bookkeeper"))
    }

    /// Tasks use the same gate: the creator of a task no longer deletes it on
    /// that ground, so a member (whoever created the task) gets no control.
    func testAMemberCannotDeleteATaskEvenIfTheyCreatedIt() {
        XCTAssertFalse(RecordDeletion.canDelete(role: MemberRole.member))
        XCTAssertTrue(RecordDeletion.canDelete(role: MemberRole.admin))
        XCTAssertTrue(RecordDeletion.canDelete(role: MemberRole.owner))
    }

    func testAnUnknownOrMissingRoleCannotDelete() {
        XCTAssertFalse(RecordDeletion.canDelete(role: nil))
        XCTAssertFalse(RecordDeletion.canDelete(role: "somebody_new"))
    }

    func testASentOrDeliveredTextIsConfirmedFirst() {
        XCTAssertTrue(RecordDeletion.isSentText(message(MessageDirection.outbound, status: MessageStatus.sent)))
        XCTAssertTrue(RecordDeletion.isSentText(message(MessageDirection.outbound, status: MessageStatus.delivered)))
    }

    func testAFailedQueuedInboundOrNoteIsNotASentText() {
        XCTAssertFalse(RecordDeletion.isSentText(message(MessageDirection.outbound, status: MessageStatus.failed)))
        XCTAssertFalse(RecordDeletion.isSentText(message(MessageDirection.outbound, status: MessageStatus.queued)))
        XCTAssertFalse(RecordDeletion.isSentText(message(MessageDirection.inbound, status: MessageStatus.received)))
        XCTAssertFalse(RecordDeletion.isSentText(message(MessageDirection.note, status: nil)))
    }

    func testTheNoticeNamesWhatWasDeleted() {
        XCTAssertEqual(
            RecordDeletion.messageDeletedKey(message(MessageDirection.note, status: nil)),
            "thread.noteDeleted"
        )
        XCTAssertEqual(
            RecordDeletion.messageDeletedKey(message(MessageDirection.inbound, status: MessageStatus.received)),
            "thread.messageDeleted"
        )
        XCTAssertEqual(
            RecordDeletion.messageDeletedKey(message(MessageDirection.outbound, status: MessageStatus.delivered)),
            "thread.sentMessageDeleted"
        )
    }

    func testASentTextNoticeSaysTheCustomerStillHasIt() {
        let text = AppStrings.translate("en", "thread.sentMessageDeleted")
        XCTAssertTrue(text.contains("customer still has it"), text)
        let body = AppStrings.translate("en", "thread.deleteSentBody")
        XCTAssertTrue(body.contains("Loonext only"), body)
    }

    func testTheMenuLabelDistinguishesANoteFromAMessage() {
        XCTAssertEqual(
            RecordDeletion.menuLabelKey(message(MessageDirection.note, status: nil)),
            "thread.deleteNote"
        )
        XCTAssertEqual(
            RecordDeletion.menuLabelKey(message(MessageDirection.inbound, status: MessageStatus.received)),
            "thread.deleteMessage"
        )
    }

    func testTrashKindsMatchTheRestoreContract() {
        XCTAssertEqual(TrashKind.message.rawValue, "message")
        XCTAssertEqual(TrashKind.conversation.rawValue, "conversation")
        XCTAssertEqual(TrashKind.call.rawValue, "call")
        XCTAssertEqual(TrashKind.voicemail.rawValue, "voicemail")
    }

    func testAConflictOnRestoreSaysRestoreTheConversationFirst() {
        XCTAssertEqual(RecordDeletion.restoreFailureKey(httpStatus: 409), "thread.restoreBlocked")
        XCTAssertNil(RecordDeletion.restoreFailureKey(httpStatus: 404))
    }

    func testEveryKindHasARestoredSentence() {
        for kind in [TrashKind.message, .conversation, .call, .voicemail] {
            let key = RecordDeletion.restoredKey(kind)
            XCTAssertNotEqual(AppStrings.translate("en", key), key)
            XCTAssertNotEqual(AppStrings.translate(MessageLocale.frCA, key), AppStrings.translate("en", key))
        }
    }
}
