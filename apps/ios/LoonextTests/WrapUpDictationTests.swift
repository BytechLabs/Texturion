import XCTest
@testable import Loonext

/// #507 Phase 1 — the wrap-up a crew member speaks after hanging up.
///
/// This app compiles only in CI, so the parts that can be asserted without a
/// device are asserted here: the wire shape, the client-side limits that mirror
/// the server's, the per-reason copy, and the one claim this feature must never
/// make.
///
/// The recorder itself is not exercised. AVAudioRecorder needs a microphone and
/// a live audio session, neither of which exists in a simulator test run, and a
/// test that stubbed both would only be asserting the stub.
final class WrapUpDictationTests: XCTestCase {
    private func decode<T: Decodable>(_ json: String) throws -> T {
        try JSONDecoder().decode(T.self, from: Data(json.utf8))
    }

    // MARK: - The wire shape

    func testDecodesTheWordsWhenThereAreSome() throws {
        let body: WrapUpTranscript = try decode(
            #"{"text":"quoted him $2,400 for the tank, parts Thursday"}"#
        )
        XCTAssertEqual(body.text, "quoted him $2,400 for the tank, parts Thursday")
        XCTAssertNil(body.reason)
    }

    func testDecodesARefusalWithItsReason() throws {
        let body: WrapUpTranscript = try decode(#"{"text":null,"reason":"over_cap"}"#)
        XCTAssertNil(body.text)
        XCTAssertEqual(body.reason, "over_cap")
    }

    func testDecodesABodyCarryingNeitherField() throws {
        // A lagging or leaner body must decode to "nothing", never throw and
        // take the composer down with it.
        let body: WrapUpTranscript = try decode("{}")
        XCTAssertNil(body.text)
        XCTAssertNil(body.reason)
    }

    // MARK: - Limits

    func testLimitsMirrorTheServersOwn() {
        // CALL_WRAPUP_MAX_SECONDS / CALL_WRAPUP_MAX_BYTES in
        // apps/api/src/ai/call-wrapup.ts. The server's copies are the ones that
        // count; these exist so a phone left in a pocket is stopped on the
        // device rather than after paying to upload it. If they drift, the
        // client spends an upload to be told no.
        XCTAssertEqual(WrapUpLimits.maxSeconds, 120)
        XCTAssertEqual(WrapUpLimits.maxBytes, 8 * 1024 * 1024)
        // A mis-tap is discarded here rather than billed there.
        XCTAssertEqual(WrapUpLimits.minSeconds, 1.0)
    }

    // MARK: - Failure copy

    func testEveryReasonGetsItsOwnSentence() {
        // One blanket "nothing came back" hid real breakage behind what looked
        // like a shrug — the lesson `replyDraftMessage` already carries. Each
        // reason has to say what happened and whether trying again will help.
        let reasons = [
            "too_long", "disabled", "over_cap", "model_error",
            "unavailable", "unusable_output",
        ]
        let messages = reasons.map { wrapUpFailureMessage($0) }
        // `model_error` and `unavailable` deliberately share one sentence: both
        // mean "Lou is not reachable right now", and splitting them would say
        // nothing a person could act on differently.
        XCTAssertEqual(Set(messages).count, reasons.count - 1)
        XCTAssertTrue(messages.allSatisfy { !$0.isBlank })
    }

    func testTheDisabledSentenceNamesWhereTheSwitchIs() {
        // A member told "turned off" with no idea where the switch is has been
        // given a dead end.
        XCTAssertTrue(wrapUpFailureMessage("disabled").contains("Settings"))
    }

    func testAnUnknownReasonStillLandsSomewhereUseful() {
        // A reason string the server adds later must degrade to a sentence that
        // still points at the keyboard, never to an empty toast.
        let unknown = wrapUpFailureMessage("something_new_from_the_server")
        XCTAssertEqual(unknown, wrapUpFailureMessage(nil))
        XCTAssertTrue(unknown.contains("Type the note"))
    }

    func testEveryFailureLeavesTheMemberSomewhereTheyCanStillAct() {
        // The whole failure posture: dictation is a shortcut, never a
        // precondition. Every dead end has to end at the composer.
        let reasons: [String?] = [
            "too_long", "disabled", "over_cap", "model_error",
            "unavailable", "unusable_output", nil,
        ]
        for reason in reasons {
            let message = wrapUpFailureMessage(reason)
            XCTAssertTrue(
                message.lowercased().contains("type the note")
                    || message.lowercased().contains("try again")
                    || message.lowercased().contains("lou will write it down")
                    || message.lowercased().contains("settings"),
                "\(reason ?? "nil") leaves nowhere to go: \(message)"
            )
        }
    }

    // MARK: - D117 — whose voice this is

    func testTheCallInProgressRefusalSaysWhoseVoiceThisIs() {
        // Pinned verbatim. This is the sentence a member reads at the one
        // moment they might believe the product listens to calls, and D117 is
        // the whole reason the moment is refused rather than allowed.
        XCTAssertEqual(
            WrapUpStartRefusal.callInProgress.message,
            "Finish the call first. Lou writes down what you say afterwards, never the call."
        )
    }

    func testEveryRefusalIsASentenceAndTheyAreAllDifferent() {
        let refusals: [WrapUpStartRefusal] = [
            .callInProgress, .micDenied, .micJustGranted, .couldNotStart,
        ]
        let messages = refusals.map(\.message)
        XCTAssertEqual(Set(messages).count, refusals.count)
        XCTAssertTrue(messages.allSatisfy { !$0.isBlank })
    }

    func testAFirstTimeGrantAsksThemToSayItAgain() {
        // iOS puts its permission sheet up while the member is already talking,
        // so the grant cannot rescue THAT press. An empty note posted as if it
        // had worked would be worse than saying so.
        XCTAssertTrue(
            WrapUpStartRefusal.micJustGranted.message.contains("say it again")
        )
    }

    /// The one unacceptable outcome, guarded by reading the source.
    ///
    /// Every string this feature shows is a claim about what it does, and the
    /// claim that would be FALSE is "we hear your calls". Copy is written
    /// inline in SwiftUI here, so there is no constant to assert against —
    /// scanning the three files that carry this feature's words is the only way
    /// to cover all of it. Scoped to those three deliberately: a lint over
    /// every string in the app would fail on somebody else's honest sentence
    /// one day, and a lint people switch off is not a lint (the same narrowing
    /// `ColorLiteralLintTests` argues for).
    func testNoStringInThisFeatureClaimsWeHearTheCall() throws {
        let forbidden = [
            "record the call", "records the call", "recording the call",
            "record your call", "records your call", "recording your call",
            "listen to the call", "listens to the call", "listening to the call",
            "transcribe the call", "transcribes the call",
            "summarise the call", "summarize the call",
            "what was said on the call", "writes the call down",
        ]
        let files = [
            "Features/Thread/WrapUpDictation.swift",
            "Features/Compose/Composer.swift",
            "Features/Settings/AiSection.swift",
        ]
        let root = try sourceRoot()
        for relative in files {
            let url = root.appendingPathComponent(relative)
            let source = try String(contentsOf: url, encoding: .utf8)
            for (index, line) in source.components(separatedBy: "\n").enumerated() {
                // A line that says "never" is denying the claim, not making it
                // — which is exactly the sentence this feature needs to be free
                // to write.
                let lowered = line.lowercased()
                if lowered.contains("never") { continue }
                for phrase in forbidden where lowered.contains(phrase) {
                    XCTFail("\(relative):\(index + 1) claims \"\(phrase)\": \(line)")
                }
            }
        }
    }

    /// The test bundle lives in DerivedData, so walk up to the repo copy of the
    /// sources rather than guessing a working directory (the same trick
    /// `ColorLiteralLintTests` uses).
    private func sourceRoot() throws -> URL {
        var dir = URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent() // LoonextTests
            .deletingLastPathComponent() // ios
        dir.appendPathComponent("Loonext")
        var isDir: ObjCBool = false
        guard FileManager.default.fileExists(atPath: dir.path, isDirectory: &isDir),
              isDir.boolValue
        else {
            // Fails rather than skips — see `MissingSource`.
            throw missingSource(dir.path)
        }
        return dir
    }

    // MARK: - The workspace switch

    func testDictationDefaultsOnWhenTheServerOmitsIt() {
        // Back to the rule the rest of the object follows: nothing here reaches
        // a stranger, and the member reads their own words before they become
        // a note. A lagging field decodes to ON.
        let json = """
        {"enrich_task_address":true,"enrich_task_due":true,"suggest_replies":true}
        """
        let settings = try? JSONDecoder().decode(
            CompanyAiSettings.self,
            from: Data(json.utf8)
        )
        XCTAssertEqual(settings?.call_wrapup, true)
    }

    func testDictationDecodesOffWhenTheWorkspaceTurnedItOff() throws {
        let settings: CompanyAiSettings = try decode(#"{"call_wrapup":false}"#)
        XCTAssertFalse(settings.call_wrapup)
    }

    func testTheMemberwiseDefaultMatchesTheDecodingDefault() {
        // `@Default` supplies a DECODING fallback and NOT a memberwise-init
        // default, so the two are written separately and can drift. The
        // optimistic flip in Settings builds a value by hand, and a `false`
        // here would draw the switch off the instant somebody touched an
        // unrelated toggle.
        let built = CompanyAiSettings(enrich_task_address: true, enrich_task_due: true)
        XCTAssertTrue(built.call_wrapup)
    }
}
