import XCTest
@testable import Loonext

/// #191 record attribution + the #205 Calls-section day label — the pure,
/// device-free decisions ported from the Android ContactAttributionTest and
/// ContactCallsLogicTest so the clients phrase attribution and bucket calls
/// identically. The load-bearing rule: an attribution line shows ONLY when the
/// actor name resolves (older contacts carry null actors and render nothing).
final class ContactAttributionTests: XCTestCase {
    private let utc: Calendar = {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "UTC")!
        return calendar
    }()

    private let now: Date = {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime]
        return formatter.date(from: "2026-07-15T12:00:00Z")!
    }()

    // MARK: contactAttribution — show only when the name resolves

    func testPreAttributionContactShowsNothing() {
        let result = contactAttribution(
            createdByName: nil,
            createdAt: "2026-01-02T15:00:00Z",
            updatedByName: nil,
            calendar: utc
        )
        XCTAssertNil(result.added)
        XCTAssertNil(result.edited)
    }

    func testABlankNameIsTreatedAsUnresolvedNotFaked() {
        let result = contactAttribution(
            createdByName: "   ",
            createdAt: "2026-01-02T15:00:00Z",
            updatedByName: "",
            calendar: utc
        )
        XCTAssertNil(result.added)
        XCTAssertNil(result.edited)
    }

    func testAddedActorReadsWithTheCreationDate() {
        let result = contactAttribution(
            createdByName: "Dana Fields",
            createdAt: "2026-07-08T15:00:00Z",
            updatedByName: nil,
            calendar: utc
        )
        XCTAssertEqual(result.added, "Added by Dana Fields on Jul 8, 2026")
        XCTAssertNil(result.edited)
    }

    func testEditByADifferentMemberShowsBothLines() {
        let result = contactAttribution(
            createdByName: "Dana Fields",
            createdAt: "2026-07-08T15:00:00Z",
            updatedByName: "Sam Rivera",
            calendar: utc
        )
        XCTAssertEqual(result.added, "Added by Dana Fields on Jul 8, 2026")
        XCTAssertEqual(result.edited, "Edited by Sam Rivera")
    }

    func testEditByTheSameMemberDoesNotEchoTheAddedLine() {
        let result = contactAttribution(
            createdByName: "Dana Fields",
            createdAt: "2026-07-08T15:00:00Z",
            updatedByName: "Dana Fields",
            calendar: utc
        )
        XCTAssertEqual(result.added, "Added by Dana Fields on Jul 8, 2026")
        XCTAssertNil(result.edited)
    }

    func testAnEditorResolvesEvenWhenTheCreatorIsUnknown() {
        let result = contactAttribution(
            createdByName: nil,
            createdAt: "2026-07-08T15:00:00Z",
            updatedByName: "Sam Rivera",
            calendar: utc
        )
        XCTAssertNil(result.added)
        XCTAssertEqual(result.edited, "Edited by Sam Rivera")
    }

    func testAnUnparseableCreationDateDropsTheSuffixRatherThanCrashing() {
        let result = contactAttribution(
            createdByName: "Dana Fields",
            createdAt: "garbage",
            updatedByName: nil,
            calendar: utc
        )
        XCTAssertEqual(result.added, "Added by Dana Fields")
        XCTAssertNil(result.edited)
    }

    // MARK: contactCallDayLabel

    func testDayLabelsBucketTodayYesterdaySameYearOlderAndBadIso() {
        XCTAssertEqual(
            contactCallDayLabel("2026-07-15T18:00:00Z", now: now, calendar: utc), "Today"
        )
        XCTAssertEqual(
            contactCallDayLabel("2026-07-14T22:00:00Z", now: now, calendar: utc), "Yesterday"
        )
        XCTAssertEqual(
            contactCallDayLabel("2026-07-08T10:00:00Z", now: now, calendar: utc), "Jul 8"
        )
        XCTAssertEqual(
            contactCallDayLabel("2025-12-31T10:00:00Z", now: now, calendar: utc), "Dec 31 2025"
        )
        XCTAssertEqual(
            contactCallDayLabel("not-a-date", now: now, calendar: utc), "Earlier"
        )
    }

    func testDayLabelsResolveInTheGivenZone() {
        var minusFive = Calendar(identifier: .gregorian)
        minusFive.timeZone = TimeZone(secondsFromGMT: -5 * 3600)!
        // 03:00Z is still the 14th in UTC-5 → Yesterday there, Today in UTC.
        XCTAssertEqual(
            contactCallDayLabel("2026-07-15T03:00:00Z", now: now, calendar: minusFive),
            "Yesterday"
        )
        XCTAssertEqual(
            contactCallDayLabel("2026-07-15T03:00:00Z", now: now, calendar: utc),
            "Today"
        )
    }

    // MARK: groupContactCallsByDay

    func testGroupingPreservesNewestFirstOrderAndBuckets() {
        let calls = [
            makeCall(id: "a", startedAt: "2026-07-15T18:00:00Z"),
            makeCall(id: "b", startedAt: "2026-07-15T09:00:00Z"),
            makeCall(id: "c", startedAt: "2026-07-14T22:00:00Z"),
            makeCall(id: "d", startedAt: "2026-07-08T10:00:00Z"),
        ]
        let groups = groupContactCallsByDay(calls, now: now, calendar: utc)
        XCTAssertEqual(groups.map(\.label), ["Today", "Yesterday", "Jul 8"])
        XCTAssertEqual(groups.first?.calls.map(\.id), ["a", "b"])
    }

    private func makeCall(id: String, startedAt: String) -> Call {
        Call(
            id: id,
            call_session_id: "sess-\(id)",
            caller_e164: nil,
            contact_id: nil,
            contact_name: nil,
            caller_name: nil,
            phone_number_id: nil,
            conversation_id: nil,
            outcome: nil,
            direction: "inbound",
            forward_seconds: 0,
            screening_result: nil,
            stir_attestation: nil,
            voicemail_seconds: nil,
            answered_by_user_id: nil,
            started_at: startedAt
        )
    }
}
