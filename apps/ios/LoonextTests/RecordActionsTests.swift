import XCTest
@testable import Loonext

/// #712: one action list per record type. Every surface draws what the builder
/// returns, so these pin the list itself: its ids, its order, and who sees what.
/// Ported 1:1 from Android's `RecordActionsTest.kt`; both mirror the web lists in
/// `apps/web/src/lib/record-actions` and the per-record builders beside it.
final class RecordActionsTests: XCTestCase {
    private let roles = [MemberRole.owner, MemberRole.member, MemberRole.readOnly]

    private func viewer(_ role: String) -> RecordViewer { RecordViewer(role: role) }

    private func conversation(
        _ role: String,
        unread: Bool = false,
        closed: Bool = false,
        deferred: Bool = false,
        muted: Bool = false,
        blocked: Bool? = false,
        optOut: OptOutState? = OptOutState(optedOut: false, carrierEnforced: false),
        surface: ConversationSurface = ConversationSurface(
            canOpen: false, hasGallery: true, hasCatchUp: true, hasNewTask: true
        )
    ) -> [RecordAction] {
        conversationActions(
            ConversationActionsInput(
                unread: unread,
                closed: closed,
                pinned: false,
                deferred: deferred,
                muted: muted,
                followed: false,
                spam: false,
                blocked: blocked,
                optOut: optOut,
                viewer: viewer(role),
                hasMembers: true,
                surface: surface
            )
        )
    }

    func testAnOwnersConversationListIsTheWebOrderDestructiveLast() {
        XCTAssertEqual(
            conversation(MemberRole.owner).visibleIds,
            [
                "mark-unread", "catch-up", "assign", "close", "pin", "new-task", "snooze",
                "follow-up", "mute", "follow", "attachments",
                "spam", "block", "delete", "opt-out",
            ]
        )
    }

    func testAnInboxRowNeverOffersAGalleryCatchUpOrOptOutItCannotKnow() {
        let ids = conversation(
            MemberRole.owner,
            blocked: nil,
            optOut: nil,
            surface: ConversationSurface(
                canOpen: true, hasGallery: false, hasCatchUp: false, hasNewTask: false
            )
        ).visibleIds
        XCTAssertEqual(
            ids,
            [
                "open", "mark-unread", "assign", "close", "pin", "snooze", "follow-up",
                "mute", "follow", "spam", "delete",
            ]
        )
    }

    func testAMemberKeepsTheStateActionsButNotDeleteAndReadOnlyLosesTheWrites() {
        let member = conversation(MemberRole.member).visibleIds
        XCTAssertFalse(member.contains("delete"))
        XCTAssertTrue(member.contains("close") && member.contains("spam") && member.contains("block"))

        let readOnly = conversation(MemberRole.readOnly).visibleIds
        for write in ["assign", "close", "pin", "spam", "block", "delete"] {
            XCTAssertFalse(readOnly.contains(write), "\(write) for read-only")
        }
        // What reaches only me stays: nobody else's inbox changes when I snooze.
        XCTAssertTrue(
            readOnly.contains("snooze") && readOnly.contains("mute") && readOnly.contains("follow")
        )
    }

    func testStatesSwapTheirVerbAndADeferredThreadOffersOnlyTheWayBack() {
        let ids = conversation(
            MemberRole.owner, unread: true, closed: true, deferred: true, muted: true
        ).visibleIds
        XCTAssertTrue(ids.contains("mark-read") && !ids.contains("mark-unread"))
        XCTAssertTrue(ids.contains("reopen") && !ids.contains("close"))
        XCTAssertTrue(
            ids.contains("unsnooze") && !ids.contains("snooze") && !ids.contains("follow-up")
        )
        XCTAssertTrue(ids.contains("unmute") && !ids.contains("mute"))
    }

    func testACarrierStopIsANoteAndNeverAnOptIn() {
        let carrier = conversation(
            MemberRole.owner, optOut: OptOutState(optedOut: true, carrierEnforced: true)
        ).visibleIds
        XCTAssertTrue(
            carrier.contains("carrier-stop") && !carrier.contains("opt-in")
                && !carrier.contains("opt-out")
        )
        let ours = conversation(
            MemberRole.owner, optOut: OptOutState(optedOut: true, carrierEnforced: false)
        ).visibleIds
        XCTAssertTrue(ours.contains("opt-in") && !ours.contains("carrier-stop"))
    }

    func testTheThreadSheetDrawsEveryActionOfTheListExactlyOnceInTheListsOrder() {
        for role in roles {
            let actions = conversation(role)
            let ids = actions.visibleIds
            let drawn: [String] = conversationSheetBlocks(actions).flatMap { block -> [String] in
                switch block {
                case .rows(let rows): return rows.map(\.id)
                case .status: return ["close", "reopen"].filter { ids.contains($0) }
                case .deferral:
                    return ["snooze", "unsnooze", "follow-up"].filter { ids.contains($0) }
                }
            }
            XCTAssertEqual(ids, drawn, "role \(role)")
        }
    }

    func testTheThreadSheetKeepsDestructiveRowsLastInTheirOwnCard() {
        let blocks = conversationSheetBlocks(conversation(MemberRole.owner))
        guard case .rows(let last)? = blocks.last else {
            return XCTFail("the last block is not a card of rows")
        }
        XCTAssertEqual(last.map(\.id), ["spam", "block", "delete", "opt-out"])
        XCTAssertEqual(
            blocks.map { block -> String in
                switch block {
                case .rows(let rows): return rows.map(\.id).joined(separator: ",")
                case .status: return "status"
                case .deferral: return "deferral"
                }
            },
            [
                "mark-unread,catch-up,assign", "status", "pin,new-task", "deferral",
                "mute,follow", "attachments", "spam,block,delete,opt-out",
            ]
        )
    }

    func testARecordWithNothingAllowedHasNoMenu() {
        let nothing = [
            RecordAction(id: "x", labelKey: "recordMenu.open", group: .primary, allowed: false),
            RecordAction(id: "y", labelKey: "recordMenu.deleteTask", group: .danger, allowed: false),
        ]
        XCTAssertTrue(nothing.visible.isEmpty)
        XCTAssertTrue(
            callActions(
                CallActionsInput(
                    hasConversation: false, hasContact: false, callerE164: nil,
                    hasVoicemail: false, canDelete: false
                )
            ).visible.isEmpty
        )
    }

    private func message(
        direction: String = MessageDirection.outbound,
        status: String? = MessageStatus.delivered,
        body: String = "hello",
        telnyxId: String? = "t1",
        errorCode: String? = nil,
        hasTask: Bool = false
    ) -> Message {
        Message(
            id: "m1",
            conversation_id: "c1",
            direction: direction,
            body: body,
            status: status,
            segments: nil,
            encoding: nil,
            sent_by_user_id: nil,
            error_code: errorCode,
            error_reason: nil,
            error_detail: nil,
            telnyx_message_id: telnyxId,
            done_at: nil,
            done_by_user_id: nil,
            pinned_at: nil,
            pinned_by_user_id: nil,
            created_at: "2026-07-15T00:00:00Z",
            attachments: [],
            has_task: hasTask,
            promoted_task: nil,
            task_id: nil,
            task: nil
        )
    }

    func testAMessageOffersCopyDoneMakeATaskAndPinWithDeleteLastForOwnersOnly() {
        XCTAssertEqual(
            messageActions(message(), viewer: viewer(MemberRole.owner)).visibleIds,
            ["copy-text", "done", "make-task", "pin", "delete"]
        )
        for role in [MemberRole.member, MemberRole.readOnly] {
            XCTAssertEqual(
                messageActions(message(), viewer: viewer(role)).visibleIds,
                ["copy-text", "done", "make-task", "pin"],
                role
            )
        }
    }

    func testAFailedSendOffersRetryANoteCannotBePromotedAndABlankBodyHasNothingToCopy() {
        let failed = message(
            status: MessageStatus.failed, telnyxId: nil, errorCode: "internal"
        )
        XCTAssertEqual(
            messageActions(failed, viewer: viewer(MemberRole.owner)).visibleIds[1], "retry"
        )
        let note = message(direction: MessageDirection.note, status: nil)
        let ids = messageActions(note, viewer: viewer(MemberRole.owner)).visibleIds
        XCTAssertFalse(ids.contains("make-task"))
        XCTAssertEqual(
            messageActions(note, viewer: viewer(MemberRole.owner)).last?.labelKey,
            "recordMenu.deleteNote"
        )
        XCTAssertFalse(
            messageActions(message(body: " "), viewer: viewer(MemberRole.owner))
                .visibleIds.contains("copy-text")
        )
        XCTAssertFalse(
            messageActions(message(hasTask: true), viewer: viewer(MemberRole.owner))
                .visibleIds.contains("make-task")
        )
    }

    func testACallOffersCallBackTextCopyAndTheTwoDeletesLast() {
        func list(_ role: String, voicemail: Bool) -> [String] {
            callActions(
                CallActionsInput(
                    hasConversation: true,
                    hasContact: true,
                    callerE164: "+14165550100",
                    hasVoicemail: voicemail,
                    canDelete: viewer(role).canDelete
                )
            ).visibleIds
        }
        XCTAssertEqual(
            list(MemberRole.owner, voicemail: true),
            ["call-back", "text", "copy-number", "delete-voicemail", "delete-call"]
        )
        XCTAssertEqual(
            list(MemberRole.owner, voicemail: false),
            ["call-back", "text", "copy-number", "delete-call"]
        )
        XCTAssertEqual(
            list(MemberRole.member, voicemail: true), ["call-back", "text", "copy-number"]
        )
        XCTAssertEqual(
            list(MemberRole.readOnly, voicemail: true), ["call-back", "text", "copy-number"]
        )
    }

    private func task(_ role: String, canOpen: Bool, hasAccess: Bool = true) -> [String] {
        taskActions(
            TaskActionsInput(
                done: false,
                hasAccess: hasAccess,
                canDelete: viewer(role).canDelete,
                canOpen: canOpen,
                canCopyLink: true
            )
        ).visibleIds
    }

    func testATaskOffersOpenCopyLinkDoneADueMoveAndDeleteLast() {
        XCTAssertEqual(
            task(MemberRole.owner, canOpen: true),
            ["open", "copy-link", "done", "due", "delete"]
        )
        XCTAssertEqual(
            task(MemberRole.member, canOpen: true), ["open", "copy-link", "done", "due"]
        )
        XCTAssertEqual(
            task(MemberRole.readOnly, canOpen: false), ["copy-link", "done", "due"]
        )
    }

    func testWithoutAccessToItsConversationATaskOffersNoDoneAndNoDueMove() {
        XCTAssertEqual(
            task(MemberRole.owner, canOpen: false, hasAccess: false), ["copy-link", "delete"]
        )
        XCTAssertEqual(
            task(MemberRole.member, canOpen: false, hasAccess: false), ["copy-link"]
        )
    }

    private func contact(
        _ role: String,
        optedOut: Bool = false,
        carrier: Bool = false,
        blocked: Bool? = false
    ) -> [String] {
        contactActions(
            ContactActionsInput(
                canOpen: true,
                optedOut: optedOut,
                carrierEnforced: carrier,
                blocked: blocked,
                canBlock: viewer(role).canWrite,
                canDelete: viewer(role).canDelete
            )
        ).visibleIds
    }

    func testAContactOffersOpenTextCallCopyThenBlockOptOutAndDeleteLast() {
        XCTAssertEqual(
            contact(MemberRole.owner),
            ["open", "text", "call", "copy-number", "block", "opt-out", "delete"]
        )
        XCTAssertEqual(
            contact(MemberRole.member),
            ["open", "text", "call", "copy-number", "block", "opt-out"]
        )
        XCTAssertEqual(
            contact(MemberRole.readOnly), ["open", "text", "call", "copy-number", "opt-out"]
        )
    }

    func testAContactOptedOutByACarrierStopCanOnlyBeToldNeverReOptedIn() {
        XCTAssertEqual(
            contact(MemberRole.owner, optedOut: true, carrier: true),
            ["open", "text", "call", "copy-number", "block", "carrier-stop", "delete"]
        )
        XCTAssertEqual(
            contact(MemberRole.owner, optedOut: true, carrier: false),
            ["open", "text", "call", "copy-number", "block", "opt-in", "delete"]
        )
        let unknown = contact(MemberRole.owner, blocked: nil)
        XCTAssertFalse(unknown.contains("block") || unknown.contains("unblock"))
    }

    func testAScheduledTextOffersOpenThenCancelInTheDestructiveGroup() {
        XCTAssertEqual(scheduledActions().visibleIds, ["open", "cancel"])
        XCTAssertEqual(scheduledActions().last?.destructive, true)
    }

    func testEveryLabelKeyInEveryListExistsInBothLanguages() {
        let everything: [RecordAction] =
            conversation(MemberRole.owner, optOut: OptOutState(optedOut: true, carrierEnforced: true))
            + conversation(MemberRole.owner)
            + messageActions(message(), viewer: viewer(MemberRole.owner))
            + messageActions(
                message(direction: MessageDirection.note, status: nil),
                viewer: viewer(MemberRole.owner)
            )
            + callActions(
                CallActionsInput(
                    hasConversation: true, hasContact: true, callerE164: "+1",
                    hasVoicemail: true, canDelete: true
                )
            )
            + taskActions(
                TaskActionsInput(
                    done: false, hasAccess: true, canDelete: true, canOpen: true, canCopyLink: true
                )
            )
            + contactActions(
                ContactActionsInput(
                    canOpen: true, optedOut: false, carrierEnforced: false, blocked: false,
                    canBlock: true, canDelete: true
                )
            )
            + scheduledActions()
        let keys = Set(
            everything.map(\.labelKey)
                + everything.flatMap(\.submenu).compactMap(\.labelKey)
                + recordMuteChoices.compactMap(\.labelKey)
                + recordTaskDueMoves.compactMap(\.labelKey)
        )
        for locale in [MessageLocale.en, MessageLocale.frCA] {
            for key in keys {
                let text = AppStrings.translate(locale, key)
                XCTAssertTrue(!text.isEmpty && text != key, "\(locale) \(key)")
            }
        }
    }

    func testTheGroupOrderIsPrimaryStateAlertsAttachmentsDanger() {
        XCTAssertEqual(
            ActionGroup.allCases,
            [.primary, .state, .alerts, .attachments, .danger]
        )
        let shuffled = [
            RecordAction(id: "d", labelKey: "recordMenu.open", group: .danger),
            RecordAction(id: "p", labelKey: "recordMenu.open", group: .primary),
            RecordAction(id: "s", labelKey: "recordMenu.open", group: .state),
        ]
        XCTAssertEqual(shuffled.visibleIds, ["p", "s", "d"])
    }

    func testDueMovesKeepTheTimeOfDayAndMoveOnlyTheDate() {
        var calendar = Calendar(identifier: .gregorian)
        let zone = TimeZone(identifier: "America/Toronto")!
        calendar.timeZone = zone
        let due = "2026-07-15T15:00:00-04:00"
        XCTAssertEqual(
            movedDueAt(due, days: 1, calendar: calendar, timeZone: zone),
            "2026-07-16T15:00:00-04:00"
        )
        XCTAssertEqual(
            movedDueAt(due, days: -1, calendar: calendar, timeZone: zone),
            "2026-07-14T15:00:00-04:00"
        )
        XCTAssertEqual(
            movedDueAt(due, days: 7, calendar: calendar, timeZone: zone),
            "2026-07-22T15:00:00-04:00"
        )
    }

    func testATaskLinkOpensTheTasksBoardOnThatTask() {
        XCTAssertEqual(
            taskLink(origin: URL(string: "https://app.loonext.com")!, taskId: "abc-123"),
            "https://app.loonext.com/tasks?task=abc-123"
        )
    }
}
