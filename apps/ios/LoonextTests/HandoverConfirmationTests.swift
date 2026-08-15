import XCTest
@testable import Loonext

/// #537 — the handover confirmation, and that this phone says what the laptop says.
///
/// A drift here means this app describes a security demand differently from web, for
/// the one action that hands a business to somebody else. It would not show up as a
/// crash, which is exactly why the port gets its own test — and why it matters that
/// iOS compiles only in CI.
final class HandoverConfirmationTests: XCTestCase {

    // MARK: - Which prompt to show

    func testSomebodyWithAnAuthenticatorIsSentToTheirApp() {
        XCTAssertEqual(
            HandoverConfirmation.kind(of: "mfa_challenge_required"),
            .authenticator
        )
    }

    func testAStaleProofSendsSomebodyBackToThatSameApp() {
        // #581/#7. Not the same refusal as above and not an alias for it: this one
        // says the session proved a factor too long ago, so the digits are verified
        // against SUPABASE here in the app and the action is retried with no code.
        // Posting them to our API instead would come back refused forever.
        XCTAssertEqual(
            HandoverConfirmation.kind(of: "mfa_reprove_required"),
            .reprove
        )
    }

    func testSomebodyWithoutOneIsSentToTheirInbox() {
        XCTAssertEqual(
            HandoverConfirmation.kind(of: "confirmation_code_required"),
            .email
        )
    }

    func testNoCodeIsAskedForWhenTheRefusalWasAboutSomethingElse() {
        // THE CASE THAT MATTERS. A handover is also refused because a transfer is
        // already in flight, or because the caller is not the owner. Prompting for a
        // code there would hide the real reason behind a code that cannot help.
        for code in ["conflict", "forbidden", "validation_failed", "not_found"] {
            XCTAssertNil(HandoverConfirmation.kind(of: code), code)
        }
        XCTAssertNil(HandoverConfirmation.kind(of: nil))
    }

    // MARK: - The six digits

    func testSixDigitsAreACode() {
        XCTAssertTrue(HandoverConfirmation.isCode("123456"))
        // A code beginning zero is one in ten, and must not read as five digits.
        XCTAssertTrue(HandoverConfirmation.isCode("000000"))
    }

    func testAPastedCodeKeepsItsWhitespaceAndStillCounts() {
        XCTAssertTrue(HandoverConfirmation.isCode("  123456 "))
        XCTAssertTrue(HandoverConfirmation.isCode("123456\n"))
    }

    func testAnythingElseIsNot() {
        for bad in ["", "12345", "1234567", "12345a", "abcdef", "12 34 56"] {
            XCTAssertFalse(HandoverConfirmation.isCode(bad), bad)
        }
        // Digits from another script are not the digits the server hashed.
        XCTAssertFalse(HandoverConfirmation.isCode("١٢٣٤٥٦"))
    }

    // MARK: - Against the original

    private func repoPath(_ relative: String) throws -> URL {
        var dir = URL(fileURLWithPath: #filePath).deletingLastPathComponent()
        while true {
            let candidate = dir.appendingPathComponent(relative)
            if FileManager.default.fileExists(atPath: candidate.path) { return candidate }
            let parent = dir.deletingLastPathComponent()
            if parent.path == dir.path { break }
            dir = parent
        }
        XCTFail("\(relative) is not reachable from \(#filePath)")
        throw CocoaError(.fileNoSuchFile)
    }

    private func sharedSource() throws -> String {
        try String(
            contentsOf: try repoPath("packages/shared/src/handover-confirmation.ts"),
            encoding: .utf8
        )
    }

    /// The web catalogue's ENGLISH half, which is where the SENTENCES went.
    ///
    /// #228 moved the handover copy out of `handover-confirmation.ts`, which
    /// names keys now. Only the sentence comparison follows it — the other use
    /// of `sharedSource()` reads `errorCode -> kind`, wire values that never
    /// moved, and pointing that one here would have it find no mappings and
    /// pass on an empty set.
    ///
    /// Sliced to the English half: the French holds the same keys, and a
    /// `contains` over the whole file would ask whether a sentence appears in
    /// EITHER language.
    private func handoverCopy() throws -> String {
        let raw = try String(
            contentsOf: try repoPath("apps/web/src/i18n/sections/domain.ts"),
            encoding: .utf8
        )
        guard let start = raw.range(of: "export const domainEn"),
              let end = raw.range(of: "export const domainFr")
        else {
            XCTFail("domain.ts no longer has both language blocks")
            return ""
        }
        return String(raw[start.upperBound ..< end.lowerBound])
    }

    /// Every `errorCode -> kind` the shared module maps, read out of its source.
    ///
    /// READ rather than typed out here, because a list typed here is a second copy of
    /// the thing under test — it would go on passing the day the shared module grows
    /// a fourth code, which is the drift this file exists to catch. Each mapping over
    /// there is one line of the shape
    ///
    ///     if (errorCode === "<code>") return "<kind>";
    ///
    /// so splitting on the quotes gives the pair without a regex.
    private func mappedCodes(_ shared: String) -> [String: String] {
        var pairs: [String: String] = [:]
        for line in shared.components(separatedBy: "\n") {
            guard line.contains("errorCode ===") else { continue }
            // ["…if (errorCode === ", code, ") return ", kind, ";"]
            let quoted = line.components(separatedBy: "\"")
            guard quoted.count >= 4 else { continue }
            pairs[quoted[1]] = quoted[3]
        }
        return pairs
    }

    /// Concatenation syntax and line wrapping removed, so what is left is the words.
    ///
    /// The TypeScript keeps each sentence on one long line; the Swift splits the
    /// longer one across a `+`. Comparing fragments would compare the formatting
    /// rather than the wording, which is the thing that must not drift.
    private func bare(_ text: String) -> String {
        let stripped = text
            .replacingOccurrences(of: "\"", with: "")
            .replacingOccurrences(of: "+", with: "")
            .replacingOccurrences(of: "\r", with: " ")
        return stripped
            .split(whereSeparator: { $0.isWhitespace })
            .joined(separator: " ")
    }

    func testBothSentencesMatchTheSharedModuleWhole() throws {
        let shared = bare(try handoverCopy())
        for kind in HandoverConfirmation.Kind.allCases {
            let sentence = bare(HandoverConfirmation.whereToLook(kind))
            XCTAssertTrue(
                shared.contains(sentence),
                "this sentence has drifted from the shared module: \(sentence)"
            )
        }
    }

    /// EVERY refusal the shared module names, understood here, as the same kind.
    ///
    /// THE ONE THAT WOULD HAVE CAUGHT #581/#7. `kind(of:)` answers nil for a code it
    /// has not heard of, the gate reads nil as "not a proof demand", and the person
    /// is shown a raw refusal for an action they are entitled to take — an owner
    /// locked out of handing over or closing their own workspace, by a phone that is
    /// simply a version behind the rule.
    func testEveryRefusalTheSharedModuleNamesIsUnderstoodHere() throws {
        let mapped = mappedCodes(try sharedSource())
        // A guard that stops matching passes everything below vacuously, which is
        // indistinguishable from being right. Three is what the module maps today.
        XCTAssertGreaterThanOrEqual(
            mapped.count, 3,
            "the shared mapping did not parse — this test is no longer checking anything"
        )
        for (code, kind) in mapped {
            XCTAssertEqual(
                HandoverConfirmation.kind(of: code)?.rawValue,
                kind,
                "this phone does not understand \(code)"
            )
        }
    }

    /// And the other direction, because set-equality one way is not set-equality.
    ///
    /// A kind here that the shared module never names is a prompt only this phone
    /// can show, for a refusal the server never sends.
    func testThisPhoneInventsNoKindTheSharedModuleDoesNot() throws {
        let named = Set(mappedCodes(try sharedSource()).values)
        for kind in HandoverConfirmation.Kind.allCases {
            XCTAssertTrue(
                named.contains(kind.rawValue),
                "the shared module names no refusal that means \(kind.rawValue)"
            )
        }
    }

    func testReproveAndAuthenticatorAreWordForWordTheSameSentence() {
        // Deliberate, and the reason it is its own kind rather than an alias: the
        // person does the identical thing — opens the app, reads six digits — so a
        // second phrasing for one physical act would read as a second demand. What
        // differs is entirely on our side of the wire, and never in this string.
        XCTAssertEqual(
            HandoverConfirmation.whereToLook(.reprove),
            HandoverConfirmation.whereToLook(.authenticator)
        )
    }

    func testTheTwoSentencesAreNotTheSameSentence() {
        // "Enter your code" is useless to somebody who does not know which code, and
        // the two codes live in completely different places.
        XCTAssertNotEqual(
            HandoverConfirmation.whereToLook(.authenticator),
            HandoverConfirmation.whereToLook(.email)
        )
    }

    func testTheEmailSentenceSaysHowLongTheCodeLasts() {
        // Ten minutes and one use turn "it didn't work" into "ask for another", which
        // is the next thing somebody needs to do.
        let email = HandoverConfirmation.whereToLook(.email)
        XCTAssertTrue(email.contains("once"))
        XCTAssertTrue(email.contains("ten minutes"))
    }

    func testNoClientPromisesToResendAnAuthenticatorCode() {
        // There is nothing to resend — the app generates them. True of `.reprove`
        // for the same reason, and the resend button must stay off both.
        XCTAssertTrue(HandoverConfirmation.resend.lowercased().contains("again"))
        for kind in [HandoverConfirmation.Kind.authenticator, .reprove] {
            XCTAssertFalse(
                HandoverConfirmation.whereToLook(kind).contains("again"),
                kind.rawValue
            )
        }
    }

    func testARefusedCodeInventsNoDistinctionTheServerRefusedToMake() {
        // The server answers the same way for wrong, expired, spent and out-of-
        // attempts, because saying which would tell an attacker whether they had the
        // right digits. A client must not undo that.
        for leak in ["expired", "already", "attempts", "wrong"] {
            XCTAssertFalse(
                HandoverConfirmation.rejected.lowercased().contains(leak),
                leak
            )
        }
    }

    func testTheLabelsMatchTheSharedModule() throws {
        let shared = try sharedSource()
        for label in [
            HandoverConfirmation.title,
            HandoverConfirmation.field,
            HandoverConfirmation.submit,
            HandoverConfirmation.resend,
            HandoverConfirmation.rejected,
        ] {
            XCTAssertTrue(
                shared.contains("\"\(label)\""),
                "this label has drifted: \(label)"
            )
        }
    }

    // MARK: - Where the digits go (#581/#7)

    /// The shared `HANDOVER_CODE_DESTINATION` map, read out of its source.
    ///
    /// Same reason as `mappedCodes`: a copy typed out here would be a second statement
    /// of the rule under test, and it would go on passing the day the shared map
    /// changes its mind about one of the three. The block over there is one
    ///
    ///     <kind>: "<destination>",
    ///
    /// per line, so the quotes give the destination and what precedes them the kind.
    /// Read from the declaration to the closing brace only — `HANDOVER_CONFIRM_WHERE`
    /// keys by the same names further down.
    private func sharedDestinations(_ shared: String) -> [String: String] {
        var pairs: [String: String] = [:]
        var inside = false
        for line in shared.components(separatedBy: "\n") {
            // The declaration itself wraps over several lines; the pairs follow it.
            if line.contains("HANDOVER_CODE_DESTINATION") {
                inside = true
                continue
            }
            guard inside else { continue }
            if line.hasPrefix("}") { break }
            let quoted = line.components(separatedBy: "\"")
            guard quoted.count >= 2 else { continue }
            let kind = quoted[0]
                .replacingOccurrences(of: ":", with: "")
                .trimmingCharacters(in: .whitespaces)
            pairs[kind] = quoted[1]
        }
        return pairs
    }

    func testOnlyTheCodeWeEmailedIsOursToCheck() {
        // THE ASSERTION THAT WAS MISSING, and its absence is why this shipped broken on
        // three clients at once. Every other test in this file checks the WORDING, and
        // the wording was right: `.reprove` and `.authenticator` say the same sentence
        // on purpose. So the suite stayed green while the app posted the reprove digits
        // to our API, where nothing reads them, and the sheet answered every CORRECT
        // code with "that code didn't work" — forever.
        //
        // `.authenticator` is here for the second half of the same lesson: the first fix
        // left it as `.api`, which is equally untrue. Both authenticator demands refuse
        // on a property of the SESSION, not on a secret our server is waiting to be
        // told, and digits in a request body move neither.
        XCTAssertEqual(HandoverConfirmation.codeDestination(.email), .api)
        XCTAssertEqual(HandoverConfirmation.codeDestination(.reprove), .supabase)
        XCTAssertEqual(HandoverConfirmation.codeDestination(.authenticator), .supabase)
    }

    func testTheGateCanAskWhetherTheDigitsAreOursToCheck() {
        // The question the funnel actually asks. It has to be answerable off the map,
        // because a call site that works it out from the kind by hand is the third
        // written copy of a rule that only needs to exist once.
        XCTAssertTrue(HandoverConfirmation.codeGoesToOurApi(.email))
        XCTAssertFalse(HandoverConfirmation.codeGoesToOurApi(.reprove))
        XCTAssertFalse(HandoverConfirmation.codeGoesToOurApi(.authenticator))
    }

    func testIdenticalCopyStillDoesNotMeanOneKind() {
        // The pair that hid the bug. They now agree on a destination, which is a fact
        // about the server rather than a licence to collapse them: they are different
        // refusals, raised by different code, and one of them ALSO wants the retry inside
        // five minutes. Anything branching on what the sheet SAYS would be right today
        // and wrong the next time either half moved.
        XCTAssertEqual(
            HandoverConfirmation.whereToLook(.reprove),
            HandoverConfirmation.whereToLook(.authenticator)
        )
        XCTAssertNotEqual(
            HandoverConfirmation.kind(of: "mfa_challenge_required"),
            HandoverConfirmation.kind(of: "mfa_reprove_required")
        )
        // And the kind that genuinely differs still differs, in both directions.
        XCTAssertNotEqual(
            HandoverConfirmation.whereToLook(.email),
            HandoverConfirmation.whereToLook(.authenticator)
        )
        XCTAssertNotEqual(
            HandoverConfirmation.codeDestination(.email),
            HandoverConfirmation.codeDestination(.authenticator)
        )
    }

    func testEveryDestinationMatchesTheSharedModule() throws {
        let mapped = sharedDestinations(try sharedSource())
        // A parse that stops matching passes everything below vacuously, which is
        // indistinguishable from being right. Three kinds, three destinations.
        XCTAssertEqual(
            mapped.count, HandoverConfirmation.Kind.allCases.count,
            "the shared destination map did not parse — this test is checking nothing"
        )
        for kind in HandoverConfirmation.Kind.allCases {
            guard let there = mapped[kind.rawValue] else {
                XCTFail("the shared map says nowhere for \(kind.rawValue)")
                continue
            }
            XCTAssertEqual(
                HandoverConfirmation.codeDestination(kind).rawValue, there,
                "this phone checks a \(kind.rawValue) code somewhere else than web does"
            )
        }
    }

    func testNoKindIsLeftWithoutADestination() {
        // The reason this is a map and not `kind != .reprove`: a fourth kind must not
        // inherit a destination from whichever side a boolean happened to favour. The
        // switch is exhaustive, so this is really a statement that both destinations
        // are in use — a map that answered `.api` to everything would compile.
        let used = Set(
            HandoverConfirmation.Kind.allCases.map { HandoverConfirmation.codeDestination($0) }
        )
        XCTAssertEqual(
            used, Set(HandoverConfirmation.CodeDestination.allCases),
            "a destination nothing uses is one nobody has thought about"
        )
    }
}
