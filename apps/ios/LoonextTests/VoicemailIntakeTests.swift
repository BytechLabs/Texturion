import XCTest
@testable import Loonext

/// #367 — the Swift half of `packages/shared/src/voicemail-intake.ts`.
///
/// Hand-ported logic gets hand-ported bugs, and this app compiles only in CI, so
/// the port gets the same cases the TypeScript and Kotlin suites pin. The one
/// with consequences is that an absent field disappears rather than drawing an
/// empty labelled row: a blank "Address" reads as "we looked and the caller gave
/// none", which is a claim we cannot make.
final class VoicemailIntakeTests: XCTestCase {
    func testDrawsNothingForNothing() {
        XCTAssertTrue(VoicemailIntake().lines.isEmpty)
    }

    func testKeepsTheFieldOrderRegardlessOfTheObjects() {
        let lines = VoicemailIntake(
            problem: "water heater leaking",
            address: "12 Mill Road",
            callback: "555-0142",
            name: "Dave"
        ).lines
        XCTAssertEqual(lines.map(\.key), ["problem", "address", "callback", "name"])
        XCTAssertEqual(lines.map(\.label), ["Problem", "Address", "Call back", "Name"])
    }

    func testDropsTheFieldsTheCallerDidNotGive() {
        let lines = VoicemailIntake(problem: "no hot water").lines
        XCTAssertEqual(lines.count, 1)
        XCTAssertEqual(lines[0].label, "Problem")
        XCTAssertEqual(lines[0].value, "no hot water")
    }

    func testTreatsAWhitespaceOnlyValueAsAbsent() {
        XCTAssertTrue(VoicemailIntake(address: "   ").lines.isEmpty)
    }

    func testTrimsWhatItDraws() {
        XCTAssertEqual(VoicemailIntake(name: "  Dave  ").lines[0].value, "Dave")
    }

    func testNamesTheSignalRatherThanTheMachine() {
        // PORTAL-UX §3.1, and identical wording on all three clients.
        XCTAssertEqual(voicemailIntakeSourceLabel, "From the voicemail")
    }

    func testDecodesACallRowThatPredatesTheColumn() {
        // The reason `voicemail_intake` is a plain Optional rather than a
        // `@Default`: a cached payload written before this column must decode to
        // nil instead of throwing and taking the whole call log with it.
        let json = """
        {"id":"c1","call_session_id":"s1","caller_e164":"+15551000","contact_id":null,
         "contact_name":null,"caller_name":null,"phone_number_id":null,
         "conversation_id":null,"outcome":"voicemail","direction":"inbound",
         "forward_seconds":0,"screening_result":null,"stir_attestation":null,
         "voicemail_seconds":12,"answered_by_user_id":null,"started_at":"2026-07-30T10:00:00Z"}
        """
        let call = try? JSONDecoder().decode(Call.self, from: Data(json.utf8))
        XCTAssertNotNil(call)
        XCTAssertNil(call?.voicemail_intake)
    }

    func testSettingsDefaultTheIntakeOffWhenTheServerOmitsIt() {
        // The inverse of every other toggle on this object, and deliberately:
        // a lagging field must never turn on the switch that changes what a
        // stranger hears (D89).
        let json = """
        {"enrich_task_address":true,"enrich_task_due":true,"suggest_replies":true}
        """
        let settings = try? JSONDecoder().decode(
            CompanyAiSettings.self,
            from: Data(json.utf8)
        )
        XCTAssertEqual(settings?.transcribe_voicemail, true)
        XCTAssertEqual(settings?.voicemail_intake, false)
    }
}
