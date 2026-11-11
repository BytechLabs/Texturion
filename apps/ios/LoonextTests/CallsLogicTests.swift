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
        screening: String? = nil,
        answeredByName: String? = nil,
        conversationId: String? = nil,
        contactId: String? = nil
    ) -> Call {
        Call(
            id: "c1",
            call_session_id: "sess-1",
            caller_e164: callerE164,
            contact_id: contactId,
            contact_name: contactName,
            caller_name: callerName,
            phone_number_id: nil,
            conversation_id: conversationId,
            outcome: outcome,
            direction: direction,
            forward_seconds: forwardSeconds,
            screening_result: screening,
            stir_attestation: nil,
            voicemail_seconds: nil,
            answered_by_user_id: nil,
            answered_by_name: answeredByName,
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

    func testAnsweredCallNamesTheActingPlacerOrAnswerer() {
        // #191: name the placer of an outbound call and the answerer of an
        // inbound one, mirroring the web's callOutcomeLabel exactly.
        XCTAssertEqual(
            "Sam called · 3m 12s",
            callOutcomeLabel(call(
                outcome: "answered",
                direction: "outbound",
                forwardSeconds: 192,
                answeredByName: "Sam"
            ))
        )
        XCTAssertEqual(
            "Answered by Sam · 4m 32s",
            callOutcomeLabel(call(
                outcome: "answered",
                direction: "inbound",
                forwardSeconds: 272,
                answeredByName: "Sam"
            ))
        )
        // Legacy/pre-#191 rows carry no actor → the viewer-neutral fallbacks.
        XCTAssertEqual(
            "You called",
            callOutcomeLabel(call(outcome: "answered", direction: "outbound"))
        )
        XCTAssertEqual(
            "Answered",
            callOutcomeLabel(call(outcome: "answered", direction: "inbound"))
        )
    }

    func testOnlyAnInboundMissIsActionableUrgency() {
        XCTAssertTrue(isActionableMiss(call(outcome: "missed")))
        XCTAssertFalse(isActionableMiss(call(outcome: "missed", direction: "outbound")))
        XCTAssertFalse(isActionableMiss(call(outcome: "answered")))
    }

    private struct ScreeningVector: Decodable {
        let result: String?
        let callerName: String?
        let spam: Bool
    }

    /// #721: the cases `packages/shared/src/call-screening.ts` generates. Every
    /// production call carries `"action":"flag_calls"`, and the old word match
    /// labelled all of them spam.
    func testScreeningAgreesWithTheSharedVectors() throws {
        var dir = URL(fileURLWithPath: #filePath).deletingLastPathComponent()
        var cases: [ScreeningVector] = []
        while dir.path != "/" {
            let candidate = dir.appendingPathComponent("packages/shared/vectors/call-screening.json")
            if FileManager.default.fileExists(atPath: candidate.path) {
                cases = try JSONDecoder().decode([ScreeningVector].self, from: Data(contentsOf: candidate))
                break
            }
            dir = dir.deletingLastPathComponent()
        }
        XCTAssertFalse(cases.isEmpty, "call-screening.json not found; run node scripts/generate-parity-vectors.mjs")
        for vector in cases {
            XCTAssertEqual(
                callLooksSpam(vector.result, callerName: vector.callerName),
                vector.spam,
                "result \(vector.result ?? "nil"), caller \(vector.callerName ?? "nil")"
            )
        }
        XCTAssertEqual("Spam likely", screeningLabel("spam_likely", callerName: nil))
        XCTAssertNil(screeningLabel(#"{"action":"flag_calls","reputation":0}"#, callerName: nil))
    }

    private struct RoutingVector: Decodable {
        let routing: String
        let reason: String?
    }

    /// #721: every route's reason, in the web's words.
    func testRoutingReasonsAgreeWithTheSharedVectors() throws {
        var dir = URL(fileURLWithPath: #filePath).deletingLastPathComponent()
        var cases: [RoutingVector] = []
        while dir.path != "/" {
            let candidate = dir.appendingPathComponent("packages/shared/vectors/call-routing.json")
            if FileManager.default.fileExists(atPath: candidate.path) {
                cases = try JSONDecoder().decode([RoutingVector].self, from: Data(contentsOf: candidate))
                break
            }
            dir = dir.deletingLastPathComponent()
        }
        XCTAssertFalse(cases.isEmpty, "call-routing.json not found; run node scripts/generate-parity-vectors.mjs")
        for vector in cases {
            XCTAssertEqual(callRoutingReason(vector.routing), vector.reason, vector.routing)
        }
        var voicemail = call(outcome: "voicemail")
        voicemail.routing = "after_hours"
        XCTAssertEqual(callOutcomeLabel(voicemail), "Voicemail · After hours, nobody on call")
        var rang = call(outcome: "missed")
        rang.routing = "rang"
        XCTAssertEqual(callOutcomeLabel(rang), "Missed")
    }

    private struct EndReasonVector: Decodable {
        let reason: String
        let words: String?
    }

    /// #725: every end reason, in the web's words.
    func testEndReasonsAgreeWithTheSharedVectors() throws {
        var dir = URL(fileURLWithPath: #filePath).deletingLastPathComponent()
        var cases: [EndReasonVector] = []
        while dir.path != "/" {
            let candidate = dir.appendingPathComponent("packages/shared/vectors/call-end-reasons.json")
            if FileManager.default.fileExists(atPath: candidate.path) {
                cases = try JSONDecoder().decode([EndReasonVector].self, from: Data(contentsOf: candidate))
                break
            }
            dir = dir.deletingLastPathComponent()
        }
        XCTAssertFalse(cases.isEmpty, "call-end-reasons.json not found; run node scripts/generate-parity-vectors.mjs")
        for vector in cases {
            XCTAssertEqual(callEndReason(vector.reason), vector.words, vector.reason)
        }
        XCTAssertNil(callEndReason(nil))
        XCTAssertNil(callEndReason("a_reason_from_the_future"))
        var missed = call(outcome: "missed")
        missed.ended_reason = "caller_hung_up"
        XCTAssertEqual(callOutcomeLabel(missed), "Missed · The caller hung up")
        var voicemail = call(outcome: "voicemail")
        voicemail.routing = "after_hours"
        voicemail.ended_reason = "caller_hung_up"
        XCTAssertEqual(callOutcomeLabel(voicemail), "Voicemail · After hours, nobody on call")
    }

    func testDurationsFormatLikeTheWeb() {
        XCTAssertEqual("58s", formatCallDuration(58))
        XCTAssertEqual("4m 32s", formatCallDuration(272))
        XCTAssertEqual("2m", formatCallDuration(120))
        XCTAssertEqual("0s", formatCallDuration(-5))
    }

    func testACallOverAnHourReadsWithHours() {
        // #570: it read "183m 12s". Nothing caps talk time — the timeouts in the
        // call code bound RINGING and a transfer, not a connected call.
        XCTAssertEqual("3h 3m", formatCallDuration(3 * 3600 + 3 * 60 + 12))
        XCTAssertEqual("1h", formatCallDuration(3600))
        // The hour boundary, both sides.
        XCTAssertEqual("59m 59s", formatCallDuration(3599))
        XCTAssertEqual("1h", formatCallDuration(3601))
        // Seconds are dropped past an hour and kept under one.
        XCTAssertEqual("1h", formatCallDuration(3600 + 59))
        XCTAssertEqual("59s", formatCallDuration(59))
    }

    func testTheLiveClockAndTheLoggedDurationAgree() {
        // #570: they did not. formatTimer has always rolled over to 1:02:33 while
        // formatCallDuration said "62m 33s", so one call was described two ways
        // depending on whether it was still happening.
        let oneHourTwoMinutes = 3600 + 2 * 60 + 33
        XCTAssertEqual("1:02:33", formatTimer(elapsedMs: oneHourTwoMinutes * 1000))
        XCTAssertEqual("1h 2m", formatCallDuration(oneHourTwoMinutes))
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

    /// #516 — mirrors CallsLogicTest.kt's `note control says Linking while the
    /// thread link resolves`, case for case, because the two are hand-ported.
    func testNoteControlSaysLinkingWhileTheThreadLinkResolves() {
        XCTAssertEqual("Linking…", noteControlLabel(linked: false, resolving: true))
        XCTAssertEqual("Note", noteControlLabel(linked: true, resolving: false))
        // Resolution genuinely gave up: honest plain label, no endless pending.
        XCTAssertEqual("Note", noteControlLabel(linked: false, resolving: false))
        // A linked note is never pending, whatever the resolver flag says.
        XCTAssertEqual("Note", noteControlLabel(linked: true, resolving: true))
    }

    /// #734 — mirrors CallsLogicTest.kt's `each outcome gets its one primary
    /// action`, case for case.
    func testEachOutcomeGetsItsOnePrimaryAction() {
        let number = "+14155550101"
        // Missed and voicemail want a call back.
        XCTAssertEqual(CallRowAction.callBack, callPrimaryAction(call(outcome: "missed", callerE164: number)))
        XCTAssertEqual(CallRowAction.callBack, callPrimaryAction(call(outcome: "voicemail", callerE164: number)))
        // Answered and outbound want a message, whatever their outcome.
        XCTAssertEqual(CallRowAction.message, callPrimaryAction(call(outcome: "answered", callerE164: number)))
        XCTAssertEqual(
            CallRowAction.message,
            callPrimaryAction(call(outcome: "answered", direction: "outbound", callerE164: number))
        )
        XCTAssertEqual(
            CallRowAction.message,
            callPrimaryAction(call(outcome: "missed", direction: "outbound", callerE164: number))
        )
        // A caller we cannot reach gets none; a thread alone can still be messaged.
        XCTAssertNil(callPrimaryAction(call(outcome: "missed")))
        XCTAssertEqual(
            CallRowAction.message,
            callPrimaryAction(call(outcome: "missed", conversationId: "conv-1"))
        )
        // The spoken name is the same key on both, and carries whose it is.
        XCTAssertEqual("shell.callActionCallBackFor", callRowActionLabelKey(.callBack))
        XCTAssertEqual("shell.callActionMessageFor", callRowActionLabelKey(.message))
    }

    /// #734 — everything else that leaves the row is in the record menu, and the
    /// row's tap is its Details item.
    func testTheRecordMenuHoldsEverythingTheRowNoLongerDraws() {
        func ids(_ call: Call, canDelete: Bool = false) -> [String] {
            callActions(
                CallActionsInput(
                    hasConversation: call.conversation_id != nil,
                    hasContact: call.contact_id != nil,
                    callerE164: call.caller_e164,
                    hasVoicemail: false,
                    canDelete: canDelete,
                    canMakeTask: call.outcome == "answered" && call.conversation_id != nil,
                    canOpenDetails: true
                )
            ).visibleIds
        }
        let linked = call(
            outcome: "answered", callerE164: "+14155550101",
            conversationId: "conv-1", contactId: "con-1"
        )
        XCTAssertEqual(
            ["call-back", "text", "copy-number", "contact", "task", "details", "delete-call"],
            ids(linked, canDelete: true)
        )
        // An unsaved number offers Add contact in place of Contact; a miss has no task.
        XCTAssertEqual(
            ["call-back", "text", "copy-number", "add-contact", "details"],
            ids(call(outcome: "missed", callerE164: "+14155550101"))
        )
        // No number and no thread: Details is all that is left.
        XCTAssertEqual(["details"], ids(call(outcome: "missed")))
    }
}
