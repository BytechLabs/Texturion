import XCTest

@testable import Loonext

/// #735: the Trash list decodes the way `GET /v1/trash` sends it, and a row says
/// what it is, who deleted it and how long is left in the same words as the web.
final class TrashTests: XCTestCase {
    private let json = """
    {
      "data": [
        {
          "kind": "conversation",
          "id": "11111111-1111-1111-1111-111111111111",
          "deleted_at": "2026-11-09T15:00:00Z",
          "deleted_by_user_id": "u-me",
          "purge_after": "2026-12-09T15:00:00Z",
          "conversation": { "contact_name": "Dana Whitcomb", "contact_phone": "+14165550134", "message_count": 12 }
        },
        {
          "kind": "message",
          "id": "22222222-2222-2222-2222-222222222222",
          "deleted_at": "2026-11-09T15:00:00Z",
          "deleted_by_user_id": null,
          "purge_after": "2026-12-09T15:00:00Z",
          "message": {
            "contact_name": null,
            "contact_phone": "+14155550188",
            "conversation_id": "c2",
            "direction": "note",
            "snippet": null
          }
        },
        {
          "kind": "call",
          "id": "33333333-3333-3333-3333-333333333333",
          "deleted_at": "2026-11-09T15:00:00Z",
          "deleted_by_user_id": "u-other",
          "purge_after": "2026-12-09T15:00:00Z",
          "call": {
            "contact_name": "Marta Reyes",
            "contact_phone": null,
            "outcome": "missed",
            "started_at": "2026-11-08T12:00:00Z",
            "has_voicemail": true
          }
        },
        {
          "kind": "voicemail",
          "id": "33333333-3333-3333-3333-333333333333",
          "deleted_at": "2026-11-09T15:00:00Z",
          "deleted_by_user_id": null,
          "purge_after": "2026-12-09T15:00:00Z",
          "voicemail": {
            "contact_name": null,
            "contact_phone": null,
            "started_at": "2026-11-08T12:00:00Z",
            "voicemail_seconds": 42
          }
        },
        {
          "kind": "task",
          "id": "44444444-4444-4444-4444-444444444444",
          "deleted_at": "2026-11-09T15:00:00Z",
          "deleted_by_user_id": null,
          "purge_after": "2026-12-09T15:00:00Z"
        }
      ],
      "next_cursor": "abc"
    }
    """

    private func decode() throws -> Page<TrashRow> {
        try JSONDecoder().decode(Page<TrashRow>.self, from: Data(json.utf8))
    }

    func testTheListDecodesEveryKindAndTheCursor() throws {
        let page = try decode()
        XCTAssertEqual(page.data.count, 5)
        XCTAssertEqual(page.next_cursor, "abc")
        XCTAssertEqual(page.data[0].kind, "conversation")
        XCTAssertEqual(page.data[0].details?.message_count, 12)
        XCTAssertEqual(page.data[1].details?.direction, "note")
        XCTAssertNil(page.data[1].deleted_by_user_id)
        XCTAssertNil(page.data[1].details?.contact_name)
        XCTAssertEqual(page.data[2].details?.has_voicemail, true)
        XCTAssertEqual(page.data[3].details?.voicemail_seconds, 42)
    }

    func testACallAndItsVoicemailShareAnIdButNotAKey() throws {
        let page = try decode()
        XCTAssertEqual(page.data[2].id, page.data[3].id)
        XCTAssertNotEqual(page.data[2].rowKey, page.data[3].rowKey)
    }

    func testAKindThisBuildCannotRestoreIsHidden() throws {
        let page = try decode()
        let kept = TrashText.usable(page.data)
        XCTAssertEqual(kept.count, 4)
        XCTAssertFalse(kept.contains { $0.kind == "task" })
    }

    func testDaysLeftRoundsUpAndNeverSaysOneDayForAnHour() {
        let now = ISO8601DateFormatter().date(from: "2026-11-10T00:00:00Z")!
        XCTAssertEqual(TrashText.daysLeft(purgeAfter: "2026-11-10T01:00:00Z", now: now), 0)
        XCTAssertEqual(TrashText.daysLeft(purgeAfter: "2026-11-11T00:00:00Z", now: now), 1)
        XCTAssertEqual(TrashText.daysLeft(purgeAfter: "2026-11-11T06:00:00Z", now: now), 2)
        XCTAssertEqual(TrashText.daysLeft(purgeAfter: "2026-12-10T00:00:00Z", now: now), 30)
        XCTAssertEqual(TrashText.daysLeft(purgeAfter: "2026-11-01T00:00:00Z", now: now), 0)
        XCTAssertEqual(TrashText.daysLeft(purgeAfter: "not a date", now: now), 0)
    }

    func testDaysLeftSpeaksInBothLanguages() {
        let now = ISO8601DateFormatter().date(from: "2026-11-10T00:00:00Z")!
        XCTAssertEqual(
            TrashText.daysLeftLabel(purgeAfter: "2026-11-11T00:00:00Z", locale: MessageLocale.en, now: now),
            "1 day left"
        )
        XCTAssertEqual(
            TrashText.daysLeftLabel(purgeAfter: "2026-11-20T00:00:00Z", locale: MessageLocale.frCA, now: now),
            "10 jours restants"
        )
        XCTAssertEqual(
            TrashText.daysLeftLabel(purgeAfter: "2026-11-10T02:00:00Z", locale: MessageLocale.en, now: now),
            "Erased within a day"
        )
    }

    func testARowNamesTheCustomerThenWhatIsInside() throws {
        let rows = try decode().data
        let en = MessageLocale.en
        XCTAssertEqual(TrashText.subject(rows[0], locale: en), "Conversation · Dana Whitcomb")
        XCTAssertEqual(TrashText.detailLabel(rows[0], locale: en), "12 messages")
        // No name: the number; a note with no text says so.
        XCTAssertEqual(TrashText.subject(rows[1], locale: en), "Note · (415) 555-0188")
        XCTAssertEqual(TrashText.detailLabel(rows[1], locale: en), "No text")
        XCTAssertEqual(TrashText.detailLabel(rows[2], locale: en), "Missed · Includes a voicemail")
        // No name and no number.
        XCTAssertEqual(TrashText.subject(rows[3], locale: en), "Voicemail · Unknown contact")
        XCTAssertEqual(TrashText.detailLabel(rows[3], locale: en), "42s voicemail")
    }

    func testDeleteForeverNamesWhatWillBeErased() throws {
        let row = try decode().data[0]
        XCTAssertTrue(
            TrashText.deleteForeverBody(row, locale: MessageLocale.en)
                .hasPrefix("Conversation · Dana Whitcomb will be erased now")
        )
    }

    func testWhoDeletedItIsYouAColleagueOrNobodyKnown() throws {
        let rows = try decode().data
        let now = ISO8601DateFormatter().date(from: "2026-11-10T00:00:00Z")!
        let names = ["u-other": "Ari Bell"]
        let mine = TrashText.metaLine(
            rows[0], locale: MessageLocale.en, meUserId: "u-me", memberNames: names, now: now
        )
        XCTAssertTrue(mine.contains("by you"), mine)
        let theirs = TrashText.metaLine(
            rows[2], locale: MessageLocale.en, meUserId: "u-me", memberNames: names, now: now
        )
        XCTAssertTrue(theirs.contains("by Ari Bell"), theirs)
        let unknown = TrashText.metaLine(
            rows[1], locale: MessageLocale.en, meUserId: "u-me", memberNames: names, now: now
        )
        XCTAssertFalse(unknown.contains(" by "), unknown)
        XCTAssertTrue(unknown.hasSuffix("30 days left"), unknown)
    }
}
