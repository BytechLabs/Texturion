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
}
