import XCTest

@testable import Loonext

/// #324 — the contact history's pure logic.
///
/// The interleaving is the feature, so this pins the merge, the dedup key and
/// the row copy. Mirrors `ContactTimelineLogicTest.kt` case for case, so a
/// divergence between the hand-ported implementations fails on the platform it
/// happens on rather than being noticed on a screen.
final class ContactTimelineTests: XCTestCase {
    private func entry(
        kind: String = "conversation",
        id: String = "1",
        at: String = "2026-07-20T10:00:00Z",
        status: String? = nil,
        detail: String? = nil,
        talk: Int? = nil,
        due: String? = nil,
        done: Bool? = nil,
        conversationId: String? = "conv-1",
        answeredBy: String? = nil
    ) -> TimelineEntry {
        TimelineEntry(
            kind: kind,
            id: id,
            occurred_at: at,
            conversation_id: conversationId,
            status: status,
            detail: detail,
            talk_seconds: talk,
            due_at: due,
            done: done,
            answered_by_user_id: answeredBy
        )
    }

    private func page(_ entries: [TimelineEntry], next: String? = nil) -> ContactTimelinePage {
        ContactTimelinePage(entries: entries, next_cursor: next)
    }

    func testDedupeIsByKindAndId() {
        // The source tables have independent id spaces, so a conversation and a
        // job could share an id; keying on id alone would silently drop one.
        let cached = TimelineLog(
            entries: [entry(kind: "task", id: "same"), entry(id: "older")],
            nextCursor: "deep"
        )
        let merged = mergeTimelineFirstPage(
            cached: cached,
            page: page([entry(kind: "conversation", id: "same")])
        )
        XCTAssertEqual(merged.entries.count, 3)
        XCTAssertTrue(merged.entries.contains { $0.kind == "task" && $0.id == "same" })
        XCTAssertTrue(merged.entries.contains { $0.kind == "conversation" && $0.id == "same" })
    }

    func testRevalidateKeepsBothTheTailAndItsDeeperCursor() {
        // THE ONE THAT LOOKED FINE. When the merge keeps a deeper tail it must
        // also keep the DEEPER cursor: the fresh first page's next_cursor
        // points at the end of page one, and adopting it makes the next "Show
        // earlier" re-request rows already on screen — the button appears to do
        // nothing at all.
        let cached = TimelineLog(
            entries: (1...10).map { entry(id: "e\($0)") },
            nextCursor: "deep-cursor"
        )
        let merged = mergeTimelineFirstPage(
            cached: cached,
            page: page([entry(id: "e1")], next: "page-one-cursor")
        )
        XCTAssertEqual(merged.entries.count, 10)
        XCTAssertEqual(merged.nextCursor, "deep-cursor")
    }

    func testFreshPageWinsWhenNothingDeeperWasLoaded() {
        let merged = mergeTimelineFirstPage(
            cached: nil,
            page: page([entry(id: "a")], next: "next")
        )
        XCTAssertEqual(merged.entries.map(\.id), ["a"])
        XCTAssertEqual(merged.nextCursor, "next")
    }

    func testAppendingDropsRepeatsAndAdvancesTheCursor() {
        let appended = appendTimelinePage(
            current: TimelineLog(entries: [entry(id: "a")], nextCursor: "c1"),
            page: page([entry(id: "a"), entry(id: "b")], next: nil)
        )
        XCTAssertEqual(appended.entries.map(\.id), ["a", "b"])
        XCTAssertNil(appended.nextCursor)
    }

    func testTheOffsetFormTheServerActuallySendsParses() {
        // The endpoint emits `+00:00`, never `Z`. Every other fixture here uses
        // `Z`, so without this the parser was only ever proven on a shape this
        // endpoint does not produce.
        XCTAssertNotNil(parseWireTimestamp("2026-07-30T12:34:56.789012+00:00"))
        XCTAssertNotNil(parseWireTimestamp("2026-07-30T12:34:56+00:00"))
    }

    func testTodayAndYesterdayAreMeasuredAgainstTheInjectedClock() {
        // `calendar.isDateInToday` reads the SYSTEM clock, so the injected
        // `now` was dead and this test pinned nothing at all.
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "UTC")!
        let now = calendar.startOfDay(for: Date(timeIntervalSince1970: 1_800_000_000))
        XCTAssertEqual(timelineDayLabel(now, calendar: calendar, now: now), "Today")
        XCTAssertEqual(
            timelineDayLabel(
                calendar.date(byAdding: .day, value: -1, to: now)!,
                calendar: calendar,
                now: now
            ),
            "Yesterday"
        )
        let older = calendar.date(byAdding: .day, value: -9, to: now)!
        let label = timelineDayLabel(older, calendar: calendar, now: now)
        XCTAssertNotEqual(label, "Today")
        XCTAssertNotEqual(label, "Yesterday")
    }

    func testDaysAreGroupedInTheLocalZoneNotUtc() {
        // An evening call in Vancouver falls on the NEXT UTC day. Grouping on
        // the timestamp's UTC prefix would file it under a date the crew does
        // not remember it happening on.
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "America/Vancouver")!
        let groups = groupTimelineByDay(
            [entry(at: "2026-07-21T04:00:00Z")],
            calendar: calendar,
            now: Date(timeIntervalSince1970: 0)
        )
        XCTAssertEqual(groups.count, 1)
        // 21:00 on the 20th, local.
        XCTAssertTrue(groups[0].label.contains("20"))
    }

    func testTimestampsParseWithAndWithoutFractionalSeconds() {
        // Postgres emits fractional seconds; hand-written fixtures often do
        // not. Handled by the module's shipped parseWireTimestamp rather than a
        // bespoke parser here.
        XCTAssertNotNil(parseWireTimestamp("2026-07-20T10:00:00Z"))
        XCTAssertNotNil(parseWireTimestamp("2026-07-20T10:00:00.123456Z"))
    }

    func testCallSaysTalkTimeAndAMissedOneSaysNoAnswer() {
        // "0s" on a missed call reads as a fault rather than as an absence.
        XCTAssertEqual(
            timelineDetail(entry(kind: "call", status: "answered", talk: 245)),
            "Talked for 4m 5s"
        )
        XCTAssertEqual(
            timelineDetail(entry(kind: "call", status: "missed", talk: 0)),
            "No answer"
        )
        XCTAssertEqual(timelineTitle(entry(kind: "call", status: "answered")), "Call answered")
        XCTAssertEqual(timelineTitle(entry(kind: "call", status: "voicemail")), "Voicemail")
        XCTAssertEqual(timelineTitle(entry(kind: "call", status: "missed")), "Missed call")
    }

    func testFinishedJobReadsDoneRatherThanShowingItsDueDate() {
        XCTAssertEqual(
            timelineDetail(entry(kind: "task", due: "2026-07-25T00:00:00Z", done: true)),
            "Done"
        )
        XCTAssertEqual(timelineDetail(entry(kind: "task", done: false)), "Open")
        XCTAssertEqual(
            timelineTitle(entry(kind: "task", detail: "Replace the blower")),
            "Replace the blower"
        )
    }

    func testConversationCarriesItsOpenOrClosedState() {
        XCTAssertEqual(timelineDetail(entry(status: "closed")), "Closed")
        XCTAssertEqual(timelineDetail(entry(status: "open")), "Open")
        XCTAssertEqual(timelineTitle(entry()), "Conversation")
    }

    func testTalkTimeDropsTheMinutesWhenThereAreNone() {
        XCTAssertEqual(timelineTalkTime(45), "45s")
        XCTAssertEqual(timelineTalkTime(60), "1m 0s")
    }

    /// #517 — the row says WHO took the call, or falls back rather than
    /// trailing off. Mirrors ContactTimelineLogicTest.kt case for case,
    /// because the two are hand-ported.
    func testAnsweredCallNamesWhoPickedItUp() {
        let call = entry(kind: "call", status: "answered", answeredBy: "u1")
        XCTAssertEqual(
            timelineTitle(call, memberNames: ["u1": "Sam Ortiz"]),
            "Call answered by Sam Ortiz"
        )
        // Left the crew, or a call answered before the server reported it:
        // "Call answered by " with nothing after it is worse than the label.
        XCTAssertEqual(timelineTitle(call, memberNames: [:]), "Call answered")
        XCTAssertEqual(
            timelineTitle(entry(kind: "call", status: "answered")),
            "Call answered"
        )
        // The other outcomes never carry a name.
        XCTAssertEqual(
            timelineTitle(entry(kind: "call", status: "voicemail"), memberNames: ["u1": "Sam"]),
            "Voicemail"
        )
    }
}
