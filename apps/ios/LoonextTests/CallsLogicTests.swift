import XCTest
@testable import Loonext

/// Pure call-display helpers — the Android `CallsLogicTest.kt` vectors, so
/// the two clients read identically.
final class CallsLogicTests: XCTestCase {
    private func call(
        outcome: String? = nil,
        direction: String = "inbound",
        forwardSeconds: Int = 0,
        contactName: String? = nil,
        callerName: String? = nil,
        callerE164: String? = nil,
        screening: String? = nil
    ) -> Call {
        Call(
            id: "c1",
            call_session_id: "sess-1",
            caller_e164: callerE164,
            contact_id: nil,
            contact_name: contactName,
            caller_name: callerName,
            phone_number_id: nil,
            conversation_id: nil,
            outcome: outcome,
            direction: direction,
            forward_seconds: forwardSeconds,
            screening_result: screening,
            stir_attestation: nil,
            voicemail_seconds: nil,
            answered_by_user_id: nil,
            started_at: "2026-07-15T12:00:00Z"
        )
    }

    func testCallerResolutionOrderIsContactThenCnamThenNumber() {
        XCTAssertEqual(
            "Dana Fix-It",
            callerDisplayName(call(
                contactName: "Dana Fix-It",
                callerName: "DANA F",
                callerE164: "+14155550134"
            ))
        )
        XCTAssertEqual(
            "DANA F",
            callerDisplayName(call(callerName: "DANA F", callerE164: "+14155550134"))
        )
        XCTAssertEqual(
            "(415) 555-0134",
            callerDisplayName(call(callerE164: "+14155550134"))
        )
        XCTAssertEqual("Unknown caller", callerDisplayName(call()))
    }

    func testOutcomeLabelsMatchTheWebsPlainLanguage() {
        XCTAssertEqual("Missed", callOutcomeLabel(call(outcome: "missed")))
        XCTAssertEqual(
            "No answer",
            callOutcomeLabel(call(outcome: "missed", direction: "outbound"))
        )
        XCTAssertEqual("Voicemail", callOutcomeLabel(call(outcome: "voicemail")))
        XCTAssertEqual("Answered", callOutcomeLabel(call(outcome: "answered")))
        XCTAssertEqual(
            "Answered · 4m 32s",
            callOutcomeLabel(call(outcome: "answered", forwardSeconds: 272))
        )
        XCTAssertEqual(
            "You called · 58s",
            callOutcomeLabel(call(
                outcome: "answered",
                direction: "outbound",
                forwardSeconds: 58
            ))
        )
        XCTAssertEqual(
            "You called",
            callOutcomeLabel(call(outcome: "answered", direction: "outbound"))
        )
        XCTAssertEqual("In progress", callOutcomeLabel(call(outcome: nil)))
        XCTAssertEqual(
            "Calling…",
            callOutcomeLabel(call(outcome: nil, direction: "outbound"))
        )
        // Unknown future outcome values degrade to the in-flight copy, never crash.
        XCTAssertEqual("In progress", callOutcomeLabel(call(outcome: "some_new_state")))
    }

    func testOnlyAnInboundMissIsActionableUrgency() {
        XCTAssertTrue(isActionableMiss(call(outcome: "missed")))
        XCTAssertFalse(isActionableMiss(call(outcome: "missed", direction: "outbound")))
        XCTAssertFalse(isActionableMiss(call(outcome: "answered")))
    }

    func testScreeningLabelsStayQuietUnlessTheCarrierFlaggedTheCall() {
        XCTAssertNil(screeningLabel(nil))
        XCTAssertNil(screeningLabel(""))
        XCTAssertNil(screeningLabel("no_flag"))
        XCTAssertNil(screeningLabel("CLEAN"))
        XCTAssertEqual("Spam likely", screeningLabel("SPAM"))
        XCTAssertEqual("Spam likely", screeningLabel("fraud_risk"))
        XCTAssertEqual("Spam likely", screeningLabel("robocall"))
        XCTAssertNil(screeningLabel("unknown_verdict"))
    }

    func testDurationsFormatLikeTheWeb() {
        XCTAssertEqual("58s", formatCallDuration(58))
        XCTAssertEqual("4m 32s", formatCallDuration(272))
        XCTAssertEqual("2m", formatCallDuration(120))
        XCTAssertEqual("0s", formatCallDuration(-5))
    }

    func testTheLiveTimerFormatsMinutesAndHours() {
        XCTAssertEqual("0:00", formatTimer(elapsedMs: 0))
        XCTAssertEqual("0:42", formatTimer(elapsedMs: 42_000))
        XCTAssertEqual("12:04", formatTimer(elapsedMs: (12 * 60 + 4) * 1000))
        XCTAssertEqual("1:02:33", formatTimer(elapsedMs: (3600 + 2 * 60 + 33) * 1000))
    }

    func testDialableNumbersAreNanp() {
        XCTAssertEqual("+14155550134", dialableE164("4155550134"))
        XCTAssertEqual("+14155550134", dialableE164("(415) 555-0134"))
        XCTAssertEqual("+14155550134", dialableE164("14155550134"))
        XCTAssertEqual("+14155550134", dialableE164("+1 415 555 0134"))
        XCTAssertNil(dialableE164("415555"))
        XCTAssertNil(dialableE164(""))
        XCTAssertNil(dialableE164("24155550134"))
    }

    func testProgressiveDialFormatting() {
        XCTAssertEqual("", formatAsYouDial(""))
        XCTAssertEqual("(415", formatAsYouDial("415"))
        XCTAssertEqual("(415) 555", formatAsYouDial("415555"))
        XCTAssertEqual("(415) 555-0134", formatAsYouDial("4155550134"))
        XCTAssertEqual("(415) 555-0134", formatAsYouDial("14155550134"))
    }

    func testVoicemailLengthFormatsLikeTheTimer() {
        XCTAssertEqual("0:42", formatVoicemailLength(42))
        XCTAssertEqual("2:00", formatVoicemailLength(120))
    }
}
