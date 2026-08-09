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
        /// still carries `codeForRetry`, and all three Supabase calls are still present.
        /// The Kotlin twin guards this by name; Swift did not, on the one platform with
        /// no local compiler and no behavioural test.
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
        let source = squashed(try gateSource())
        // ONE retry, and its argument is the gated value rather than the parameter the
        // sheet handed in. `proof.attempt(code)` is the bug, exactly as written.
        let retries = source.components(separatedBy: "proof.attempt(").dropFirst()
        XCTAssertEqual(
            retries.count, 1,
            "expected exactly one retry of the held action, found \(retries.count)"
        )
        for retry in retries {
            XCTAssertTrue(
                retry.hasPrefix("codeForRetry)"),
                "\n\nThe retry must carry `codeForRetry`, which the Supabase path has "
                    + "already emptied — not the code the sheet supplied. Passing the "
                    + "code straight through sends a reprove code to our API, which is "
                    + "not checking a code there and answers with the same refusal "
                    + "every time.\n"
            )
        }
        XCTAssertTrue(
            source.contains("codeForRetry = nil"),
            "\n\nOn the Supabase path the retry must carry NO code at all: the server "
                + "reads how long ago this session proved a factor, and there is no "
                + "code for it to read.\n"
        )
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
