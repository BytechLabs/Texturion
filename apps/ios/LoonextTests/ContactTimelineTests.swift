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
        conversationId: String? = "conv-1"
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
            done: done
        )
    }

    func testDedupeIsByKindAndId() {
        // The source tables have independent id spaces, so a conversation and a
        // job could share an id; keying on id alone would silently drop one.
        let cached = [entry(kind: "task", id: "same"), entry(id: "older")]
        let merged = mergeTimelineFirstPage(
            cached: cached,
            page: [entry(kind: "conversation", id: "same")]
        )
        XCTAssertEqual(merged.count, 3)
        XCTAssertTrue(merged.contains { $0.kind == "task" && $0.id == "same" })
        XCTAssertTrue(merged.contains { $0.kind == "conversation" && $0.id == "same" })
    }

    func testRevalidateDoesNotCollapseWhatTheUserPagedTo() {
        let cached = (1...10).map { entry(id: "e\($0)") }
        let merged = mergeTimelineFirstPage(cached: cached, page: [entry(id: "e1")])
        XCTAssertEqual(merged.count, 10)
    }

    func testFreshPageWinsWhenNothingDeeperWasLoaded() {
        let merged = mergeTimelineFirstPage(cached: [], page: [entry(id: "a")])
        XCTAssertEqual(merged.map(\.id), ["a"])
    }

    func testAppendingDropsRepeats() {
        let appended = appendTimelinePage(
            current: [entry(id: "a")],
            page: [entry(id: "a"), entry(id: "b")]
        )
        XCTAssertEqual(appended.map(\.id), ["a", "b"])
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
        // Postgres emits fractional seconds; the fixtures often do not. A
        // parser that handles only one shape would render every row's time as
        // empty and every due date as "soon".
        XCTAssertNotNil(timelineDate("2026-07-20T10:00:00Z"))
        XCTAssertNotNil(timelineDate("2026-07-20T10:00:00.123456Z"))
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
}
