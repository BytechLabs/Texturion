import XCTest
@testable import Loonext

/// #210 ongoing-card helpers — the Android `CallsLogicTest.kt` #210 vectors,
/// so the pinned card classifies, labels and ticks identically on both
/// clients. Plus the decode tolerance the card depends on: the CALLS-V3
/// fields are absent from every cached pre-v3 payload.
final class OngoingCallTests: XCTestCase {
    private func call(
        id: String = "c1",
        outcome: String? = nil,
        direction: String = "inbound",
        state: String? = nil,
        answeredBy: String? = nil,
        answeredAt: String? = nil,
        phoneNumberId: String? = nil
    ) -> Call {
        Call(
            id: id,
            call_session_id: "sess-\(id)",
            caller_e164: nil,
            contact_id: nil,
            contact_name: nil,
            caller_name: nil,
            phone_number_id: phoneNumberId,
            conversation_id: nil,
            outcome: outcome,
            direction: direction,
            forward_seconds: 0,
            screening_result: nil,
            stir_attestation: nil,
            voicemail_seconds: nil,
            answered_by_user_id: answeredBy,
            answered_by_name: nil,
            started_at: "2026-07-15T12:00:00Z",
            state: state,
            answered_at: answeredAt
        )
    }

    private func member(_ id: String, _ userId: String, _ name: String) -> Member {
        Member(
            id: id,
            user_id: userId,
            role: "member",
            deactivated_at: nil,
            created_at: "2026-07-01T00:00:00Z",
            display_name: name
        )
    }

    private func number(_ id: String, _ e164: String?) -> PhoneNumberSummary {
        PhoneNumberSummary(
            id: id,
            status: "active",
            country: "US",
            number_e164: e164,
            requested_area_code: nil,
            created_at: "2026-07-01T00:00:00Z",
            source: "provisioned",
            voice_enabled: true,
            suspended_at: nil,
            released_at: nil,
            failure_reason: nil,
            provision_attempts: nil,
            retrying: nil
        )
    }

    func testOngoingMeansOutcomeUnstampedAndStateNotAlreadyEnded() {
        XCTAssertTrue(isOngoingCall(call(outcome: nil, state: nil)))
        XCTAssertTrue(isOngoingCall(call(outcome: nil, state: "ringing")))
        XCTAssertTrue(isOngoingCall(call(outcome: nil, state: "answered")))
        XCTAssertTrue(isOngoingCall(call(outcome: nil, state: "voicemail_greeting")))
        XCTAssertTrue(isOngoingCall(call(outcome: nil, state: "voicemail_recording")))
        // Mirror lag: the state already says terminal — never pin a ghost.
        XCTAssertFalse(isOngoingCall(call(outcome: nil, state: "ended_missed")))
        XCTAssertFalse(isOngoingCall(call(outcome: nil, state: "ended_answered")))
        XCTAssertFalse(isOngoingCall(call(outcome: nil, state: "ended_rejected")))
        // A stamped outcome resolves the row whatever the mirror still says.
        XCTAssertFalse(isOngoingCall(call(outcome: "answered", state: "answered")))
        XCTAssertFalse(isOngoingCall(call(outcome: "missed")))
        XCTAssertFalse(isOngoingCall(call(outcome: "voicemail")))
    }

    func testTheOngoingResolvedPartitionKeepsOrderAndLosesNothing() {
        let list = [
            call(id: "a", outcome: nil, state: "ringing"),
            call(id: "b", outcome: "missed"),
            call(id: "c", outcome: nil, state: "answered"),
            call(id: "d", outcome: "answered"),
        ]
        XCTAssertEqual(["a", "c"], ongoingCalls(list).map(\.id))
        // The log below the card never lists a call the card is already
        // pinning, and never drops a resolved one.
        XCTAssertEqual(["b", "d"], resolvedCalls(list).map(\.id))
        XCTAssertTrue(ongoingCalls([]).isEmpty)
        XCTAssertTrue(resolvedCalls([]).isEmpty)
    }

    func testPhaseFollowsStateThenTheAnswerStampsThenDirection() {
        XCTAssertEqual(OngoingPhase.ringing, ongoingPhase(call(state: "ringing")))
        XCTAssertEqual(OngoingPhase.answered, ongoingPhase(call(state: "answered")))
        XCTAssertEqual(OngoingPhase.voicemail, ongoingPhase(call(state: "voicemail_greeting")))
        XCTAssertEqual(OngoingPhase.voicemail, ongoingPhase(call(state: "voicemail_recording")))
        // No state (outbound rows and pre-backfill rows): stamps speak next.
        XCTAssertEqual(OngoingPhase.answered, ongoingPhase(call(answeredBy: "u1")))
        XCTAssertEqual(
            OngoingPhase.answered,
            ongoingPhase(call(direction: "outbound", answeredAt: "2026-07-15T12:00:30Z"))
        )
        XCTAssertEqual(OngoingPhase.dialing, ongoingPhase(call(direction: "outbound")))
        XCTAssertEqual(OngoingPhase.ringing, ongoingPhase(call()))
    }

    func testStatusLineRingingNamesNoOneAndAnsweredNamesWhoHasTheLine() {
        XCTAssertEqual("Ringing…", ongoingStatusLabel(.ringing, memberName: nil))
        // A ringing call never shows a member, even if a stale name is passed.
        XCTAssertEqual("Ringing…", ongoingStatusLabel(.ringing, memberName: "Dana"))
        XCTAssertEqual("With Dana", ongoingStatusLabel(.answered, memberName: "Dana"))
        // Answered but the roster can't name the member: the line is still
        // honestly taken, not blank.
        XCTAssertEqual("On the line", ongoingStatusLabel(.answered, memberName: nil))
        XCTAssertEqual("On the line", ongoingStatusLabel(.answered, memberName: "  "))
        XCTAssertEqual("Calling…", ongoingStatusLabel(.dialing, memberName: nil))
        XCTAssertEqual("Leaving a voicemail", ongoingStatusLabel(.voicemail, memberName: nil))
    }

    func testOnlyTheAnsweredPhaseTicksATimer() {
        XCTAssertTrue(ongoingShowsTimer(.answered))
        XCTAssertFalse(ongoingShowsTimer(.ringing))
        XCTAssertFalse(ongoingShowsTimer(.dialing))
        XCTAssertFalse(ongoingShowsTimer(.voicemail))
    }

    func testTheTimerAnchorsOnAnsweredAtAndFallsBackToStartedAt() {
        XCTAssertEqual(
            "2026-07-15T12:00:30Z",
            ongoingAnchorIso(call(answeredAt: "2026-07-15T12:00:30Z"))
        )
        // Un-stamped: ring time over-counts by seconds, a frozen timer lies.
        XCTAssertEqual("2026-07-15T12:00:00Z", ongoingAnchorIso(call()))
    }

    func testMemberNamesResolveFromTheRosterByUserId() {
        let roster = [member("m1", "u1", "Dana"), member("m2", "u2", "")]
        XCTAssertEqual("Dana", memberDisplayName("u1", in: roster))
        // A blank display name is no name at all.
        XCTAssertNil(memberDisplayName("u2", in: roster))
        XCTAssertNil(memberDisplayName("u9", in: roster))
        XCTAssertNil(memberDisplayName(nil, in: roster))
        XCTAssertNil(memberDisplayName("u1", in: []))
    }

    func testTheNumberChipAppearsOnlyWhenTheCompanyOwnsMoreThanOneNumber() {
        let one = [number("n1", "+14155550100")]
        let two = one + [number("n2", "+14155550101")]
        // One number: zero ambiguity, no chip.
        XCTAssertNil(ongoingNumberLabel("n1", in: one))
        XCTAssertEqual("(415) 555-0101", ongoingNumberLabel("n2", in: two))
        // Unresolvable or absent ids stay quiet instead of guessing.
        XCTAssertNil(ongoingNumberLabel("n9", in: two))
        XCTAssertNil(ongoingNumberLabel(nil, in: two))
        XCTAssertNil(ongoingNumberLabel("n3", in: two + [number("n3", nil)]))
    }

    func testAPreV3RowWithoutStateOrAnswerStampStillDecodes() throws {
        // A cached payload written before CALLS-V3 carries neither key. Both
        // must fall to nil rather than throw — a decode failure would take the
        // whole call log down, not just the card.
        let row: Call = try decode(#"""
        {"id":"c1","call_session_id":"s1","caller_e164":"+14155550134",
         "contact_id":null,"contact_name":null,"caller_name":null,
         "phone_number_id":null,"conversation_id":null,"outcome":null,
         "direction":"inbound","forward_seconds":0,"screening_result":null,
         "stir_attestation":null,"voicemail_seconds":null,
         "answered_by_user_id":null,"started_at":"2026-07-15T12:00:00Z"}
        """#)
        XCTAssertNil(row.state)
        XCTAssertNil(row.answered_at)
        // An unstamped legacy row still reads as live, anchored on its start.
        XCTAssertTrue(isOngoingCall(row))
        XCTAssertEqual(OngoingPhase.ringing, ongoingPhase(row))
        XCTAssertEqual("2026-07-15T12:00:00Z", ongoingAnchorIso(row))
    }

    func testTheV3StateAndAnswerStampDecodeFromTheWire() throws {
        let row: Call = try decode(#"""
        {"id":"c1","call_session_id":"s1","caller_e164":"+14155550134",
         "contact_id":null,"contact_name":null,"caller_name":null,
         "phone_number_id":null,"conversation_id":null,"outcome":null,
         "direction":"inbound","forward_seconds":0,"screening_result":null,
         "stir_attestation":null,"voicemail_seconds":null,
         "answered_by_user_id":"u1","started_at":"2026-07-15T12:00:00Z",
         "state":"answered","answered_at":"2026-07-15T12:00:30Z"}
        """#)
        XCTAssertEqual("answered", row.state)
        XCTAssertEqual("2026-07-15T12:00:30Z", row.answered_at)
        XCTAssertEqual(OngoingPhase.answered, ongoingPhase(row))
        XCTAssertTrue(ongoingShowsTimer(ongoingPhase(row)))
        XCTAssertEqual("2026-07-15T12:00:30Z", ongoingAnchorIso(row))
    }

    private func decode<T: Decodable>(_ json: String) throws -> T {
        try JSONDecoder().decode(T.self, from: Data(json.utf8))
    }
}
