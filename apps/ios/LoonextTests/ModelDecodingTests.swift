import XCTest
@testable import Loonext

/// Field-by-field Codable checks against apps/web/src/lib/api/types.ts for
/// the most-used wire models: snake_case property names ARE the wire names
/// (no CodingKeys, no key strategy), absent/null fields fall to their
/// kotlinx-style defaults, and pass-through payload bags stay verbatim.
final class ModelDecodingTests: XCTestCase {
    private func decode<T: Decodable>(_ json: String) throws -> T {
        try JSONDecoder().decode(T.self, from: Data(json.utf8))
    }

    // MARK: me / company

    func testMeWithoutCompanyHydration() throws {
        let me: Me = try decode(#"""
        {"user_id":"u1","display_name":"Dana","memberships":[
          {"company_id":"c1","name":"Acme Plumbing","role":"owner","subscription_status":"active"}
        ]}
        """#)
        XCTAssertEqual(me.user_id, "u1")
        XCTAssertEqual(me.display_name, "Dana")
        XCTAssertEqual(me.memberships.count, 1)
        XCTAssertEqual(me.memberships[0].company_id, "c1")
        XCTAssertEqual(me.memberships[0].role, "owner")
        XCTAssertEqual(me.memberships[0].subscription_status, "active")
        XCTAssertNil(me.company)
    }

    func testCompanyViewMinimalPayloadFallsToDefaults() throws {
        let company: CompanyView = try decode(#"""
        {"id":"c1","name":"Acme","country":"US","us_texting_enabled":true,
         "requested_area_code":"415","timezone":"America/Toronto",
         "subscription_status":"incomplete",
         "created_at":"2026-07-01T00:00:00Z","updated_at":"2026-07-01T00:00:00Z"}
        """#)
        XCTAssertFalse(company.cancel_at_period_end)
        XCTAssertTrue(company.business_hours.isEmpty)
        XCTAssertFalse(company.away_enabled)
        XCTAssertEqual(company.call_screening, "off")
        XCTAssertTrue(company.numbers.isEmpty)
        XCTAssertTrue(company.enabled_modules.isEmpty)
        XCTAssertNil(company.registration.brand)
        XCTAssertNil(company.plan)
        XCTAssertNil(company.overageCapMultiplier)
        XCTAssertFalse(company.subscriptionActive)
    }

    func testCompanyViewOverageCapUnionAndEmbeds() throws {
        let company: CompanyView = try decode(#"""
        {"id":"c1","name":"Acme","country":"US","us_texting_enabled":true,
         "requested_area_code":"415","timezone":"America/Toronto",
         "plan":"starter","subscription_status":"active",
         "overage_cap_multiplier":"2.5",
         "business_hours":{"mon":{"open":"08:00","close":"17:00"},"sun":null},
         "created_at":"2026-07-01T00:00:00Z","updated_at":"2026-07-01T00:00:00Z",
         "numbers":[{"id":"n1","status":"active","country":"US",
           "number_e164":"+14155550134","requested_area_code":"415",
           "created_at":"2026-07-01T00:00:00Z","source":"provisioned","voice_enabled":true}],
         "enabled_modules":["regions_ca"],
         "registration":{"brand":{"kind":"brand","status":"approved","sole_proprietor":false,
           "rejection_reason":null,"submission_count":1,"submitted_at":"2026-07-02T00:00:00Z",
           "approved_at":"2026-07-03T00:00:00Z","rejected_at":null,"deactivated_at":null},
           "campaign":null}}
        """#)
        // Wire union number|string — string arm.
        XCTAssertEqual(company.overageCapMultiplier, 2.5)
        XCTAssertTrue(company.subscriptionActive)
        // Business hours: missing weekday absent, null weekday present-as-nil.
        XCTAssertEqual(company.business_hours["mon"]??.open, "08:00")
        XCTAssertEqual(company.business_hours["sun"], .some(nil))
        XCTAssertNil(company.business_hours["tue"])
        XCTAssertEqual(company.numbers[0].number_e164, "+14155550134")
        XCTAssertEqual(company.numbers[0].status, NumberStatus.active)
        XCTAssertEqual(company.enabled_modules, ["regions_ca"])
        XCTAssertEqual(company.registration.brand?.status, "approved")
        XCTAssertNil(company.registration.campaign)

        // Number arm of the union.
        let numeric: CompanyView = try decode(#"""
        {"id":"c1","name":"Acme","country":"US","us_texting_enabled":true,
         "requested_area_code":"415","timezone":"UTC","subscription_status":"active",
         "overage_cap_multiplier":3,
         "created_at":"2026-07-01T00:00:00Z","updated_at":"2026-07-01T00:00:00Z"}
        """#)
        XCTAssertEqual(numeric.overageCapMultiplier, 3.0)
    }

    // MARK: conversations / messages

    func testConversationListItemDefaultsAndEmbeds() throws {
        // tags + unread intentionally absent — must default, not throw.
        let row: ConversationListItem = try decode(#"""
        {"id":"conv1","company_id":"c1","contact_id":"ct1","phone_number_id":"pn1",
         "status":"open","is_spam":false,"assigned_user_id":null,
         "pinned_at":null,"pinned_by_user_id":null,
         "last_message_at":"2026-07-10T12:00:00Z","closed_at":null,
         "created_at":"2026-07-01T00:00:00Z","updated_at":"2026-07-10T12:00:00Z",
         "contact":{"id":"ct1","name":null,"phone_e164":"+14155550134"},
         "last_message":{"id":"m9","direction":"inbound","body":"",
           "created_at":"2026-07-10T12:00:00Z","has_attachments":true}}
        """#)
        XCTAssertTrue(row.tags.isEmpty)
        XCTAssertFalse(row.unread)
        XCTAssertNil(row.contact.name)
        XCTAssertEqual(row.contact.phone_e164, "+14155550134")
        XCTAssertEqual(row.last_message?.has_attachments, true)
        XCTAssertEqual(row.status, ConversationStatus.open)
    }

    func testMessageMinimalNoteShape() throws {
        // A note: status null, everything optional absent.
        let note: Message = try decode(#"""
        {"id":"m1","conversation_id":"conv1","direction":"note","body":"crew note",
         "status":null,"created_at":"2026-07-10T12:00:00Z"}
        """#)
        XCTAssertNil(note.status)
        XCTAssertTrue(note.attachments.isEmpty)
        XCTAssertFalse(note.has_task)
        XCTAssertNil(note.task_id)
        XCTAssertFalse(note.retryable)
    }

    func testMessageRetryableRule() throws {
        func message(_ extra: String) throws -> Message {
            try decode(#"""
            {"id":"m1","conversation_id":"conv1","direction":"outbound","body":"hi",
             "created_at":"2026-07-10T12:00:00Z",\#(extra)}
            """#)
        }
        // API-level failure (no carrier id) → retryable.
        XCTAssertTrue(try message(#""status":"failed""#).retryable)
        // Carrier-accepted failure → not retryable.
        XCTAssertFalse(
            try message(#""status":"failed","telnyx_message_id":"tx1""#).retryable
        )
        // Carrier opt-out block → never retryable.
        XCTAssertFalse(
            try message(#""status":"failed","error_code":"40300""#).retryable
        )
        // Delivered → not retryable.
        XCTAssertFalse(try message(#""status":"delivered""#).retryable)
    }

    func testConversationDetailViewerLevelDefaultsToText() throws {
        let detail: ConversationDetail = try decode(#"""
        {"id":"conv1","company_id":"c1","contact_id":"ct1","phone_number_id":"pn1",
         "status":"open","is_spam":false,
         "last_message_at":"2026-07-10T12:00:00Z",
         "created_at":"2026-07-01T00:00:00Z","updated_at":"2026-07-10T12:00:00Z",
         "contact":{"id":"ct1","name":"Ray","phone_e164":"+14155550134",
           "address":null,"notes":null,"consent_source":"inbound_sms",
           "consent_at":"2026-07-01T00:00:00Z","deleted_at":null},
         "messages":{"data":[],"next_cursor":null}}
        """#)
        XCTAssertEqual(detail.viewer_level, "text")
        XCTAssertTrue(detail.tags.isEmpty)
        XCTAssertTrue(detail.messages.data.isEmpty)
        XCTAssertNil(detail.messages.next_cursor)
    }

    func testConversationEventPayloadStaysVerbatim() throws {
        // The payload bag must keep its snake_case keys untouched — the reason
        // the models avoid any key-decoding strategy.
        let event: ConversationEvent = try decode(#"""
        {"id":"e1","conversation_id":"conv1","actor_user_id":null,
         "type":"task_created","payload":{"task_id":"t1","message_id":"m1"},
         "created_at":"2026-07-10T12:00:00Z"}
        """#)
        XCTAssertNil(event.actor_user_id)
        XCTAssertEqual(event.payload["task_id"]?.stringValue, "t1")
        XCTAssertEqual(event.payload["message_id"]?.stringValue, "m1")
    }

    // MARK: tasks

    func testTaskPageAndDescriptionDefault() throws {
        let page: Page<TaskItem> = try decode(#"""
        {"data":[{"id":"t1","company_id":"c1","message_id":"m1","conversation_id":"conv1",
          "title":"Fix sink","assigned_user_id":null,
          "due_at":"2026-07-20T15:00:00-04:00","created_by_user_id":"u1",
          "created_at":"2026-07-01T00:00:00Z","updated_at":"2026-07-01T00:00:00Z",
          "done":false,"status":"open"}],
         "next_cursor":"opaque-cursor"}
        """#)
        XCTAssertEqual(page.next_cursor, "opaque-cursor")
        let task = try XCTUnwrap(page.data.first)
        XCTAssertEqual(task.description, "") // absent → default
        XCTAssertEqual(task.message_id, "m1") // the ONLY done-toggle write target
        XCTAssertNil(task.contact)
        XCTAssertNil(task.attachment_count)
    }

    func testTaskDetailDefaults() throws {
        let detail: TaskDetail = try decode(#"""
        {"id":"t1","company_id":"c1","message_id":"m1","conversation_id":"conv1",
         "title":"Fix sink","description":"under the counter","assigned_user_id":"u2",
         "due_at":null,"created_by_user_id":"u1",
         "created_at":"2026-07-01T00:00:00Z","updated_at":"2026-07-01T00:00:00Z",
         "done":true,"status":"done",
         "assignee":{"user_id":"u2","display_name":"Marco"},
         "created_by":null,"source_message":null}
        """#)
        XCTAssertEqual(detail.viewer_level, "text")
        XCTAssertTrue(detail.attachments.isEmpty)
        XCTAssertTrue(detail.activity.isEmpty)
        XCTAssertEqual(detail.assignee?.display_name, "Marco")
    }

    // MARK: contacts / team

    func testContactOptedOutDefaultsFalse() throws {
        let contact: Contact = try decode(#"""
        {"id":"ct1","phone_e164":"+14155550134","name":"Ray","address":null,
         "notes":null,"consent_source":null,"consent_at":null,
         "consent_attested_by":null,"deleted_at":null,
         "created_at":"2026-07-01T00:00:00Z","updated_at":"2026-07-01T00:00:00Z"}
        """#)
        XCTAssertFalse(contact.opted_out)
        XCTAssertNil(contact.last_activity_at)
    }

    func testMemberDisplayNameDefaultsEmpty() throws {
        let member: Member = try decode(#"""
        {"id":"mem1","user_id":"u1","role":"member","deactivated_at":null,
         "created_at":"2026-07-01T00:00:00Z"}
        """#)
        XCTAssertEqual(member.display_name, "")
        XCTAssertEqual(member.role, MemberRole.member)
    }

    // MARK: for-you / notifications

    func testForYouEmptyObjectIsAllCaughtUp() throws {
        let forYou: ForYou = try decode("{}")
        XCTAssertTrue(forYou.waiting_on_you.isEmpty)
        XCTAssertTrue(forYou.my_tasks.isEmpty)
        XCTAssertTrue(forYou.unread.isEmpty)
        XCTAssertNil(forYou.triage) // member: the strip is withheld entirely
    }

    func testForYouWaitingDefaults() throws {
        let forYou: ForYou = try decode(#"""
        {"waiting_on_you":[{"conversation_id":"conv1","status":"waiting",
          "contact":{"id":"ct1","name":"Ray","phone_e164":"+14155550134"},
          "assigned_user_id":"u1","last_message_at":"2026-07-10T12:00:00Z"}],
         "triage":{"conversations":[],"tasks":[]}}
        """#)
        let waiting = try XCTUnwrap(forYou.waiting_on_you.first)
        XCTAssertFalse(waiting.unread)
        XCTAssertFalse(waiting.has_overdue_task)
        XCTAssertEqual(waiting.urgency, 3)
        XCTAssertNotNil(forYou.triage)
    }

    func testNotificationItemAndUnreadCount() throws {
        let item: NotificationItem = try decode(#"""
        {"id":"n1","type":"missed_call","conversation_id":"conv1",
         "message_id":null,"task_id":null,
         "contact":{"id":"ct1","name":null,"phone_e164":"+14155550134"},
         "created_at":"2026-07-10T12:00:00Z","unread":true}
        """#)
        XCTAssertEqual(item.type, NotificationType.missedCall)
        XCTAssertTrue(item.unread)

        let count: UnreadCount = try decode(#"{"count":4}"#)
        XCTAssertEqual(count.count, 4)
    }

    // MARK: calls / usage / search

    func testCallDefaultsAndDisplayNameResolution() throws {
        let call: Call = try decode(#"""
        {"id":"call1","call_session_id":"sess1","caller_e164":"+14155550134",
         "contact_id":null,"contact_name":null,"caller_name":"RAY BUILDERS",
         "phone_number_id":"pn1","conversation_id":null,"outcome":"missed",
         "direction":"inbound","screening_result":null,"stir_attestation":"A",
         "voicemail_seconds":null,"answered_by_user_id":null,
         "started_at":"2026-07-10T12:00:00Z"}
        """#)
        XCTAssertEqual(call.forward_seconds, 0) // absent → 0, never ring time
        // contact > CNAM dip > raw number.
        XCTAssertEqual(call.displayName, "RAY BUILDERS")
        XCTAssertEqual(call.outcome, CallOutcome.missed)
        // #191: absent answered_by_name decodes to nil (pre-#191 rows are safe).
        XCTAssertNil(call.answered_by_name)

        // …and when the server sends it, the acting member's name decodes.
        let attributed: Call = try decode(#"""
        {"id":"call2","call_session_id":"sess2","caller_e164":"+14155550134",
         "contact_id":null,"contact_name":null,"caller_name":null,
         "phone_number_id":"pn1","conversation_id":null,"outcome":"answered",
         "direction":"outbound","forward_seconds":192,"screening_result":null,
         "stir_attestation":"A","voicemail_seconds":null,
         "answered_by_user_id":"u1","answered_by_name":"Sam",
         "started_at":"2026-07-10T12:00:00Z"}
        """#)
        XCTAssertEqual(attributed.answered_by_name, "Sam")
    }

    func testUsageNestedDefaults() throws {
        let usage: Usage = try decode("{}")
        XCTAssertNil(usage.period_start)
        XCTAssertEqual(usage.included_segments, 0)
        XCTAssertNil(usage.cap_segments)
        XCTAssertFalse(usage.overage_projection.trending_over)
        XCTAssertEqual(usage.storage.attachments_bytes, 0)
        XCTAssertEqual(usage.voice.included_minutes, 0)
        XCTAssertTrue(usage.voice.overage_billed) // pre-D42 payload default
        XCTAssertTrue(usage.history.isEmpty)
    }

    func testSearchResultArmsDefaultEmpty() throws {
        let result: SearchResult = try decode(#"{"next_cursor":null}"#)
        XCTAssertTrue(result.conversations.isEmpty)
        XCTAssertTrue(result.contacts.isEmpty)
        XCTAssertTrue(result.tasks.isEmpty)
        XCTAssertTrue(result.attachments.isEmpty)
        XCTAssertTrue(result.templates.isEmpty)
        XCTAssertNil(result.next_cursor)
    }

    func testWebRtcTokenExpiryDefault() throws {
        let token: WebRtcToken = try decode(#"{"token":"jwt","sip_username":"sip1"}"#)
        XCTAssertEqual(token.expires_in_hours, 24)
    }

    func testUnknownServerFieldsAreIgnored() throws {
        // A lagging client must never fail decoding on a new server field.
        let count: UnreadCount = try decode(#"{"count":1,"brand_new_field":{"x":1}}"#)
        XCTAssertEqual(count.count, 1)
    }
}
