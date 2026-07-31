import XCTest
@testable import Loonext

/// Timeline assembly vectors ported 1:1 from the Android TimelineTest.kt:
/// interleave, filters, pending rows, day dividers, and the audit-event lines.
final class MessagingTimelineTests: XCTestCase {
    /// UTC calendar + a fixed "now" (2026-07-15T12:00:00Z) so Today/Yesterday
    /// stay deterministic — the Android test pins zone/today the same way.
    private var calendar: Calendar {
        var cal = Calendar(identifier: .gregorian)
        cal.timeZone = TimeZone(identifier: "UTC") ?? .current
        cal.locale = Locale(identifier: "en_US_POSIX")
        return cal
    }

    private var now: Date {
        parseWireTimestamp("2026-07-15T12:00:00Z") ?? Date()
    }

    private func message(
        _ id: String,
        at: String,
        direction: String = MessageDirection.inbound
    ) -> Message {
        Message(
            id: id,
            conversation_id: "c1",
            direction: direction,
            body: "body \(id)",
            status: direction == MessageDirection.note ? nil : MessageStatus.received,
            segments: nil,
            encoding: nil,
            sent_by_user_id: nil,
            error_code: nil,
            error_detail: nil,
            telnyx_message_id: nil,
            done_at: nil,
            done_by_user_id: nil,
            pinned_at: nil,
            pinned_by_user_id: nil,
            created_at: at,
            attachments: [],
            has_task: false,
            promoted_task: nil,
            task_id: nil,
            task: nil
        )
    }

    private func event(
        _ id: String,
        at: String,
        type: String = "status_changed"
    ) -> ConversationEvent {
        ConversationEvent(
            id: id,
            conversation_id: "c1",
            actor_user_id: "u1",
            type: type,
            payload: .object(["to": .string("closed")]),
            created_at: at
        )
    }

    private func build(
        messages: [Message],
        events: [ConversationEvent] = [],
        pending: [PendingSend] = [],
        filter: ThreadFilter = ThreadFilter(),
        allMessagesLoaded: Bool = true
    ) -> [TimelineItem] {
        buildTimeline(
            messages: messages,
            events: events,
            pending: pending,
            filter: filter,
            allMessagesLoaded: allMessagesLoaded,
            calendar: calendar,
            now: now
        )
    }

    func testMessagesAndEventsInterleaveNewestFirstByCreatedAt() {
        let timeline = build(
            messages: [
                message("m2", at: "2026-07-15T12:00:00Z"),
                message("m1", at: "2026-07-15T10:00:00Z"),
            ],
            events: [event("e1", at: "2026-07-15T11:00:00Z")]
        )
        XCTAssertEqual(
            timeline.map(\.key),
            ["m:m2", "e:e1", "m:m1", "d:2026-07-15"]
        )
    }

    func testPendingSendsRenderNewestBottomOfAReversedList() {
        let timeline = build(
            messages: [message("m1", at: "2026-07-15T10:00:00Z")],
            pending: [
                PendingSend(
                    localId: "p1",
                    body: "hi",
                    mediaCount: 0,
                    createdAt: "2026-07-15T12:00:00Z",
                    idempotencyKey: "k1"
                ),
            ]
        )
        XCTAssertEqual(timeline.first?.key, "p:p1")
    }

    func testDayDividersAppendAfterEachDaysOldestItem() {
        let timeline = build(
            messages: [
                message("m2", at: "2026-07-15T09:00:00Z"),
                message("m1", at: "2026-07-14T09:00:00Z"),
            ]
        )
        XCTAssertEqual(
            timeline.map(\.key),
            ["m:m2", "d:2026-07-15", "m:m1", "d:2026-07-14"]
        )
        let labels = timeline.compactMap { item -> String? in
            if case let .dayDivider(label, _) = item { return label }
            return nil
        }
        XCTAssertEqual(labels, ["Today", "Yesterday"])
    }

    func testNotesFilterHidesNoteRows() {
        let timeline = build(
            messages: [
                message("m2", at: "2026-07-15T12:00:00Z", direction: MessageDirection.note),
                message("m1", at: "2026-07-15T10:00:00Z"),
            ],
            filter: ThreadFilter(notes: false)
        )
        XCTAssertEqual(timeline.map(\.key), ["m:m1", "d:2026-07-15"])
    }

    func testEventsOlderThanTheLoadedMessageWindowStayHidden() {
        let hidden = build(
            messages: [message("m1", at: "2026-07-15T10:00:00Z")],
            events: [event("e0", at: "2026-07-10T10:00:00Z")],
            allMessagesLoaded: false
        )
        XCTAssertFalse(hidden.contains { $0.key == "e:e0" })

        let loaded = build(
            messages: [message("m1", at: "2026-07-15T10:00:00Z")],
            events: [event("e0", at: "2026-07-10T10:00:00Z")],
            allMessagesLoaded: true
        )
        XCTAssertTrue(loaded.contains { $0.key == "e:e0" })
    }

    func testTheLastEnabledFilterToggleCannotTurnOff() {
        let onlyEvents = ThreadFilter(messages: false, notes: false, events: true)
        XCTAssertEqual(onlyEvents.toggledEvents(), onlyEvents)
        XCTAssertTrue(onlyEvents.toggledMessages().messages)
    }

    func testEventLinesResolveActorsStatusesAndUnknownTypesSafely() {
        let names = ["u1": "Dana"]
        XCTAssertEqual(
            eventLine(
                event("e1", at: "2026-07-15T00:00:00Z"),
                memberNames: names,
                contactName: "Sam"
            ),
            "Dana moved this to Closed"
        )
        let unknown = ConversationEvent(
            id: "e2",
            conversation_id: "c1",
            actor_user_id: nil,
            type: "brand_new_event_type",
            payload: .object([:]),
            created_at: "2026-07-15T00:00:00Z"
        )
        XCTAssertEqual(
            eventLine(unknown, memberNames: names, contactName: "Sam"),
            "Brand new event type"
        )
    }

    /// #225: the quiet-hours line states a FACT, never an attestation.
    ///
    /// It used to read "confirmed sending during quiet hours". Once an admin can
    /// switch the confirmation step off (#225 ask 5) the same event is written
    /// for a send nobody was asked about, and the old wording would have put a
    /// confirmation nobody gave into the customer's own audit trail. Web has
    /// always said it this way; this is the parity assertion.
    func testTheQuietHoursLineDoesNotClaimSomebodyConfirmed() {
        let asked = ConversationEvent(
            id: "e-quiet",
            conversation_id: "c1",
            actor_user_id: "u1",
            type: "quiet_hours_confirmed",
            payload: .object(["destination_local_hour": .number(23), "confirmed": .bool(true)]),
            created_at: "2026-07-15T00:00:00Z"
        )
        let line = eventLine(asked, memberNames: ["u1": "Dana"], contactName: "Sam")
        XCTAssertEqual(line, "Dana sent during this customer's quiet hours")
        XCTAssertFalse(line.contains("confirmed"))

        // The switched-off case renders identically — the event type is shared,
        // so the sentence has to be true for both readings of it.
        let notAsked = ConversationEvent(
            id: "e-quiet-2",
            conversation_id: "c1",
            actor_user_id: "u1",
            type: "quiet_hours_confirmed",
            payload: .object(["destination_local_hour": .number(2), "confirmed": .bool(false)]),
            created_at: "2026-07-15T00:00:00Z"
        )
        XCTAssertEqual(
            eventLine(notAsked, memberNames: ["u1": "Dana"], contactName: "Sam"),
            line
        )
    }

    // MARK: - #273: one call event, six readings
    //
    // Every shape that was not a voicemail collapsed to "Call with X ended", so
    // an outbound call, a missed call and a transfer were indistinguishable on
    // the phone while web showed all three. Same table as the Kotlin twin.
    //
    // Durations read "4m 32s", not "4:32" as #273's examples say: all three
    // formatCallDuration implementations agree on the m/s form, so the issue's
    // quoted web strings were illustrative rather than literal.

    private func callLine(_ payload: [String: JSONValue]) -> String {
        let event = ConversationEvent(
            id: "call-1",
            conversation_id: "c1",
            actor_user_id: nil,
            type: "call_completed",
            payload: .object(payload),
            created_at: "2026-07-15T00:00:00Z"
        )
        return eventLine(
            event,
            memberNames: ["u1": "Sam", "u2": "Alex"],
            contactName: "Dana"
        )
    }

    func testAnOutboundCallSpeaksFromTheCrewSideWithItsLength() {
        XCTAssertEqual(
            callLine([
                "direction": .string("outbound"),
                "outcome": .string("answered"),
                "forward_seconds": .number(272),
            ]),
            "You called · 4m 32s"
        )
        XCTAssertEqual(
            callLine(["direction": .string("outbound"), "outcome": .string("answered")]),
            "You called"
        )
        XCTAssertEqual(
            callLine(["direction": .string("outbound"), "outcome": .string("missed")]),
            "Called, no answer"
        )
    }

    func testATransferNamesWhoHandedTheCallToWhom() {
        XCTAssertEqual(
            callLine([
                "kind": .string("transferred"),
                "from_user_id": .string("u1"),
                "to_user_id": .string("u2"),
            ]),
            "Sam transferred the call to Alex"
        )
        // An unresolvable sender still names the recipient rather than going
        // generic — the useful half of the sentence survives.
        XCTAssertEqual(
            callLine(["kind": .string("transferred"), "to_user_id": .string("u2")]),
            "Call transferred to Alex"
        )
        XCTAssertEqual(callLine(["kind": .string("transferred")]), "Call transferred")
    }

    func testAnInboundCallReportsItsOutcome() {
        XCTAssertEqual(
            callLine([
                "direction": .string("inbound"),
                "outcome": .string("answered"),
                "forward_seconds": .number(272),
            ]),
            "Call answered · 4m 32s"
        )
        XCTAssertEqual(
            callLine(["direction": .string("inbound"), "outcome": .string("answered")]),
            "Call answered"
        )
        XCTAssertEqual(
            callLine(["direction": .string("inbound"), "outcome": .string("missed")]),
            "Missed call"
        )
        XCTAssertEqual(
            callLine(["direction": .string("inbound"), "outcome": .string("voicemail")]),
            "Call went to voicemail"
        )
    }

    func testAVoicemailCarriesTheMessageLengthNotTheCallOutcome() {
        // Branch order is the point: a voicemail also has outcome=voicemail, so
        // testing outcome first would swallow the message duration. And the
        // seconds arrive as a JSON NUMBER (#270).
        XCTAssertEqual(
            callLine([
                "kind": .string("voicemail"),
                "outcome": .string("voicemail"),
                "voicemail_seconds": .number(45),
            ]),
            "Left a voicemail · 45s"
        )
        XCTAssertEqual(
            callLine(["kind": .string("voicemail"), "outcome": .string("voicemail")]),
            "Left a voicemail"
        )
    }

    func testATransferredCallIsReadAsATransferNotAsItsDirection() {
        // The other ordering trap: a transferred call still carries a direction.
        XCTAssertEqual(
            callLine([
                "kind": .string("transferred"),
                "direction": .string("inbound"),
                "from_user_id": .string("u1"),
                "to_user_id": .string("u2"),
            ]),
            "Sam transferred the call to Alex"
        )
    }

    func testABarePayloadNeverReadsAsTheOldCatchAll() {
        // "Call with Dana ended" was the bug. "Call answered" is the honest
        // default for an inbound call the server told us completed.
        let line = callLine([:])
        XCTAssertEqual(line, "Call answered")
        XCTAssertFalse(line.contains("ended"))
    }

    // MARK: - #465: which timeline lines go somewhere when tapped
    //
    // Vectors ported 1:1 from TimelineTest.kt so the phone and the laptop
    // cannot disagree about which lines are live.

    private func targetEvent(
        _ type: String,
        _ key: String? = nil,
        _ value: String? = nil
    ) -> ConversationEvent {
        var payload: [String: JSONValue] = [:]
        if let key, let value { payload[key] = .string(value) }
        return ConversationEvent(
            id: "e-target",
            conversation_id: "c1",
            actor_user_id: "u1",
            type: type,
            payload: .object(payload),
            created_at: "2026-07-15T00:00:00Z"
        )
    }

    func testTaskLinesOpenTheirTask() {
        for type in [
            "task_created",
            "task_assigned",
            "task_due_set",
            "task_attachment_added",
            "task_attachment_removed",
        ] {
            XCTAssertEqual(
                eventTarget(of: targetEvent(type, "task_id", "t1")),
                .openTask("t1"),
                "\(type) should open its task"
            )
        }
    }

    func testADeletedTaskOffersNothingToOpen() {
        // The task it names no longer exists, so a tap would dead-end.
        XCTAssertNil(eventTarget(of: targetEvent("task_deleted", "task_id", "t1")))
    }

    func testDoneAndUndoneLinesGoToTheMessageTheyQuote() {
        XCTAssertEqual(
            eventTarget(of: targetEvent("message_done", "message_id", "m1")),
            .jumpToMessage("m1")
        )
        XCTAssertEqual(
            eventTarget(of: targetEvent("message_undone", "message_id", "m1")),
            .jumpToMessage("m1")
        )
    }

    func testALineWhosePayloadNamesNoTargetStaysInert() {
        // A truncated or older payload must not produce a tap that goes nowhere.
        XCTAssertNil(eventTarget(of: targetEvent("task_created")))
        XCTAssertNil(eventTarget(of: targetEvent("message_done")))
    }

    func testLinesThatNameNoDestinationAreNeverActionable() {
        // Restraint is the point: an assignment or a tag change has nowhere to
        // go, and a false affordance is worse than a quiet line.
        for type in [
            "assigned",
            "tag_added",
            "tag_removed",
            "status_changed",
            "call_completed",
            "missed_call",
            "opted_out",
            "media_refused",
        ] {
            XCTAssertNil(
                eventTarget(of: targetEvent(type, "task_id", "t1")),
                "\(type) should not be tappable"
            )
        }
    }
}
