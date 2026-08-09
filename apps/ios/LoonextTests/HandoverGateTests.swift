import XCTest

/// #581/#7 — where the six digits GO, pinned at the one call site that decides.
///
/// # Why this is a source scan
///
/// `attemptHandover` takes a `SettingsScope`, which carries the whole object graph and a
/// live repository; there is no way to build one in a unit test, and standing up a fake
/// graph to reach one branch would mostly be a test of the fake. The property that
/// matters is nevertheless plain in the source — WHICH VALUE is handed to the retry — so
/// this reads the source, the way `ColorLiteralLintTests` and the pricing scans in this
/// target do.
///
/// # What it is guarding
///
/// The stale-proof demand reads word for word like the workspace-wall demand: same app,
/// same six digits. The fleet that shipped the vocabulary branched on that copy and
/// posted the reprove code to our API. Our server is not checking a code on that path —
/// it is checking how long ago this session last proved a factor — so the identical
/// refusal came back, the sheet said "that code didn't work", and it said that to every
/// CORRECT code forever. An enrolled owner could not hand over, close, or release
/// anything. Every client test passed the whole time, because every one of them asserted
/// wording.
///
/// So these assert the mechanism instead. A test that pins a label while the mechanism
/// is broken certifies the bug.
final class HandoverGateTests: XCTestCase {

    // MARK: - Reading the gate

    private func gateSource() throws -> String {
        // The test bundle runs out of DerivedData, so walk up to the checkout copy of
        // the sources rather than guessing a working directory.
        let path = URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent() // LoonextTests
            .deletingLastPathComponent() // ios
            .appendingPathComponent("Loonext/Features/Settings/HandoverGate.swift")
        guard let text = try? String(contentsOf: path, encoding: .utf8) else {
            // Fails rather than skips — see `MissingSource`.
            throw missingSource(path.path)
        }
        return text
    }

    /// Whitespace runs collapsed to one space, so line wrapping cannot decide the
    /// outcome and a reformat does not read as a behaviour change.
    private func squashed(_ text: String) -> String {
        text.split(whereSeparator: { $0.isWhitespace }).joined(separator: " ")
    }

    // MARK: - Who checks the digits

    func testTheFunnelAsksTheSharedRuleWhoChecksTheDigits() throws {
        XCTAssertTrue(
            squashed(try gateSource())
                .contains("HandoverConfirmation.codeGoesToOurApi(proof.kind)"),
            "\n\nThe gate must ask the SHARED rule where this code is checked, off the "
                + "kind the server named and held on the proof. Re-deriving it here — a "
                + "comparison against one case, or anything read out of the sentence on "
                + "screen — is how three clients ended up posting a reprove code to an "
                + "endpoint that never reads one.\n"
        )
    }

    func testEveryDestinationQuestionIsNegated() throws {
        /// Deleting one `!` inverts every destination, and NOTHING else in this file
        /// notices: the needle above still matches, the ordering still holds, the retry
        /// still carries nothing on the proved path, and all three Supabase calls are
        /// still present. The Kotlin twin guards this by name; Swift did not, on the
        /// one platform with no local compiler and, until #593, no behavioural test.
        ///
        /// Inverted, a stale-factor code goes back to our API — the original lockout,
        /// verbatim — and an EMAILED code gets proved against Supabase, where somebody
        /// with no authenticator has no factor at all, so a perfectly good code is
        /// refused too. In this file the only reason to ask is "these digits are not ours,
        /// prove them here", so the diverting branch is the negative one.
        let source = squashed(try gateSource())
        let before = source.components(separatedBy: "HandoverConfirmation.codeGoesToOurApi(")
            .dropLast()
        XCTAssertFalse(
            before.isEmpty,
            "the gate no longer asks the shared rule where the digits are checked"
        )
        for preceding in before {
            XCTAssertTrue(
                preceding.hasSuffix("!"),
                "\n\nA destination question here is not negated. If you invert it "
                    + "deliberately, the attempt that carries the code has to move inside "
                    + "its true branch and this assertion has to move with it.\n"
            )
        }
    }

    func testTheSupabasePathIsActuallyCalledAndNotJustPresent() throws {
        /// Present is not reached. Every other assertion in this file passes with the
        /// diverting branch gutted and the helper left behind as an unused function — the
        /// destination is still asked, the ask is still negated, all three Supabase calls
        /// still appear, inside a function nothing calls any more. Kotlin's twin was
        /// caught by exactly this and its equivalent assertion is what closed it.
        let source = squashed(try gateSource())
        guard let first = source.range(of: "handoverReproveFactor(") else {
            XCTFail("the Supabase path is gone from this file entirely")
            return
        }
        // The CALL sits above the declaration in this file, so the first occurrence must
        // be a call. If the first one is `private func …`, nothing invokes it.
        XCTAssertFalse(
            source[source.startIndex..<first.lowerBound].hasSuffix("func "),
            "\n\nThe first mention of handoverReproveFactor is its own declaration, so "
                + "the funnel never calls it: every code goes to our API and the "
                + "assertions above all still pass.\n"
        )
        XCTAssertTrue(
            source.contains("try await handoverReproveFactor("),
            "\n\nThe local proof must be awaited AND allowed to throw — the caller turns "
                + "a throw into the one refusal the sheet shows. Swallowing it would let "
                + "a wrong code fall through to a retry that then fails for a reason "
                + "nobody can act on.\n"
        )
    }

    func testNobodySendsTheCodeBeforeAskingWhoChecksIt() throws {
        let source = squashed(try gateSource())
        guard let decision = source.range(of: "codeGoesToOurApi"),
              let retry = source.range(of: "proof.attempt(")
        else {
            XCTFail("the gate no longer both asks the rule and retries the action")
            return
        }
        XCTAssertTrue(
            decision.lowerBound < retry.lowerBound,
            "the action is retried before anything has asked who checks the code"
        )
    }

    func testTheSuppliedCodeNeverTravelsToOurApi() throws {
        /// #593: PER CALL SITE, which is how the Kotlin twin has always done it.
        ///
        /// This used to require exactly ONE `proof.attempt(` and that its argument be the
        /// local `codeForRetry`. Both were descriptions of the shape this file happened to
        /// have rather than of the property, and #593's parity requirement made the file
        /// grow a second attempt site — inside the shared prove-then-retry both questions
        /// now reach. A rule that counted sites would have had to be relaxed to a weaker
        /// one; this rule needs no relaxing, because it asks the real question of every
        /// site independently: did anything ask where these digits are checked before
        /// sending them?
        ///
        /// It is strictly stronger than what it replaces. The old form was satisfied by a
        /// single correct site and said nothing about a second one; this one cannot be
        /// satisfied by adding a site that skips the question.
        let source = squashed(try gateSource())
        let attempts = attemptSites(in: source)
        XCTAssertFalse(attempts.isEmpty, "the funnel must still run the action it was handed")

        // The retry after a local proof carries NOTHING — that is what makes it work.
        XCTAssertTrue(
            attempts.contains { $0.argument == "nil" },
            "\n\nNo attempt runs the action without a code, so the Supabase path either "
                + "does not exist or is still posting digits at a route that ignores "
                + "them. That route reads how long ago this session proved a factor; "
                + "there is no code for it to read.\n"
        )

        // The API-checked kind still sends its code, so an attempt carrying one is
        // expected — every one of them just has to have asked the destination first.
        let carrying = attempts.filter { $0.argument != "nil" }
        XCTAssertFalse(
            carrying.isEmpty,
            "nothing carries a code any more; the emailed-code path needs it"
        )
        for site in carrying {
            XCTAssertTrue(
                site.ranBefore.contains("codeGoesToOurApi("),
                "\n\n`proof.attempt(\(site.argument))` is reached without asking where "
                    + "those digits are checked. On the reprove path our server is not "
                    + "reading a code at all — it is reading how long ago this session "
                    + "proved a factor — so posting them returns the same refusal "
                    + "forever and the owner is told their correct code is wrong every "
                    + "time.\n"
            )
        }
    }

    /// One `proof.attempt(...)` call, with what ran before it inside its own function.
    private struct AttemptSite {
        let argument: String
        /// Everything between the nearest preceding `func ` and this call.
        let ranBefore: String
    }

    /// Every attempt site in squashed source, each with its enclosing function's prefix.
    ///
    /// Function-scoped rather than file-scoped on purpose: a question asked in some OTHER
    /// function above is not a question this call site asked. Kotlin's twin resolves the
    /// enclosing declaration the same way, by taking the nearest preceding `fun name(`.
    private func attemptSites(in source: String) -> [AttemptSite] {
        var sites: [AttemptSite] = []
        var cursor = source.startIndex
        while let call = source.range(of: "proof.attempt(", range: cursor ..< source.endIndex) {
            let afterOpen = call.upperBound
            guard let close = source.range(of: ")", range: afterOpen ..< source.endIndex) else {
                break
            }
            let argument = String(source[afterOpen ..< close.lowerBound])
                .trimmingCharacters(in: .whitespaces)
            let head = source[source.startIndex ..< call.lowerBound]
            let declaration = head.range(of: "func ", options: .backwards)?.lowerBound
                ?? source.startIndex
            sites.append(
                AttemptSite(
                    argument: argument,
                    ranBefore: String(source[declaration ..< call.lowerBound])
                )
            )
            cursor = close.upperBound
        }
        return sites
    }

    // MARK: - The local proof

    func testTheFactorIsProvedAgainstSupabaseAndTheFreshSessionIsStored() throws {
        let source = squashed(try gateSource())
        for step in ["challengeFactor(", "verifyFactor(", "sessionStore.save("] {
            XCTAssertTrue(
                source.contains(step),
                "\n\nThe Supabase path needs all three: challenge the factor, verify "
                    + "the code, and SAVE the session that comes back. Missing \(step)"
                    + " — and without the save the app keeps presenting the old token, "
                    + "so the retry is refused again and the dialog can never be "
                    + "satisfied.\n"
            )
        }
    }

    func testACodeSupabaseRefusedLeavesTheSheetUpAndSaysSoOnce() throws {
        XCTAssertTrue(
            squashed(try gateSource()).contains("refused: true"),
            "a code refused locally must come back as a refusal, so the sheet stays up "
                + "and says the one thing it says about a code that did not work"
        )
    }

    // MARK: - The three screens that answer a demand

    /// Every screen has to hand the funnel the kind the SERVER named, because that is
    /// what the funnel decides off. Two do it by giving the held proof straight back; the
    /// third rebuilds its proof on every press and has to carry the kind across
    /// deliberately.
    ///
    /// Named per file rather than derived, because there are three and each answers this
    /// differently — the same reason `check-sign-out-path` names its native call sites.
    /// Every entry is re-checked, so a screen that has moved fails loudly instead of
    /// quietly stopping being covered. The file header on the gate claimed TWO screens
    /// for as long as there were three, and the third is the one that broke.
    func testEveryScreenHandsTheFunnelTheKindTheServerNamed() throws {
        let screens: [(file: String, marker: String, why: String)] = [
            (
                "OwnershipCard.swift", "attempt(pending, code: code)",
                "the sheet is built from the HELD proof and gives that same value back, "
                    + "so the kind the server named travels with the digits"
            ),
            (
                "OwnershipPrompt.swift", "attempt(pending, code: code)",
                "the sheet is built from the HELD proof and gives that same value back, "
                    + "so the kind the server named travels with the digits"
            ),
            (
                "NumbersSection.swift", "kind: proof?.kind",
                "this screen REBUILDS its proof inside every attempt rather than handing "
                    + "the held one back, so the kind has to be carried across "
                    + "explicitly. Left at the default it says .email, the funnel sends a "
                    + "stale-factor code to our API where nothing reads it, and the sheet "
                    + "answers every correct code with \"that code didn't work\" forever"
            ),
        ]
        let root = URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .appendingPathComponent("Loonext/Features/Settings")
        for screen in screens {
            let path = root.appendingPathComponent(screen.file)
            guard let text = try? String(contentsOf: path, encoding: .utf8) else {
                throw missingSource(path.path)
            }
            XCTAssertTrue(
                text.contains("attemptHandover("),
                "\n\n\(screen.file) no longer calls attemptHandover(, so this entry is "
                    + "checking a screen that has moved. Update the list rather than "
                    + "dropping it — a surface nobody checks is how the third one was "
                    + "missed.\n"
            )
            XCTAssertTrue(
                squashed(text).contains(screen.marker),
                "\n\n\(screen.file) must contain `\(screen.marker)`: \(screen.why).\n"
            )
        }
    }

    // MARK: - The scan itself

    func testTheScanIsActuallyReadingTheGate() throws {
        // A scan that matches nothing passes forever.
        let source = try gateSource()
        XCTAssertTrue(
            source.contains("func attemptHandover"),
            "this scan is not reading the funnel it is meant to check"
        )
        XCTAssertGreaterThan(source.count, 2000, "expected the whole gate, saw \(source.count) bytes")
    }
}
