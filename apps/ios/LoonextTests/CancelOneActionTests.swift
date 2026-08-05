import XCTest

/// #277 — reaching Stripe while answering nothing is ONE action, and stays one.
///
/// # Why this is a source scan and not a UI test
///
/// The constraint is about the SHAPE of a screen — what is above the button that
/// leaves, and what is allowed to switch it off — and it has already been
/// regressed once. Every other test in this suite exercises a pure function, and
/// a pure function cannot see a `.disabled(…)` that grew a second term or a note
/// that moved above a button. Web's twin has 71 tests and its guard still could
/// not express a pending query; Android's compared a SET OF COMPOSABLE NAMES,
/// and a real regression walked through it using only allowed names. iOS had no
/// guard for this at all.
///
/// So this reads the file. It is coarse on purpose: a scan that understands the
/// text can only be fooled by rewriting the text, and every assertion below was
/// verified by BREAKING the property first and watching the named assertion fire
/// — each test says which mutation proved it.
///
/// # What it reads
///
/// FOUR PLACES, because the exit's reachability is decided in four and a guard
/// bounded to one of them cannot see the others: the `CancelCard(` call site in
/// `BillingSectionView` and what wraps it; `CancelCard.body`, the chain that
/// decides whether `leaving` is drawn at all; `CancelCard.leaving`, from its
/// first line down to the button; and the definition of every member either of
/// those names — `canCancel`, `handOff()`, `consequence` — followed
/// transitively. Each was added after the last proved insufficient, and the
/// order tells the story: everything here was once bounded by `leaving`, and
/// `} else if pauseChecking { ProgressView() } else { leaving }` in the body
/// above deletes the way out without touching a character of the block being
/// watched. It reads SettingsLogic.swift too, for the one property that lives
/// there rather than here: no price is ever typed.
///
/// # One property, and the narrower ones underneath it
///
/// `testNothingOnTheWayToTheExitConsultsThePauseRead` is the whole rule:
/// nothing on the path from arrival to the exit may DEPEND on the pause read.
/// Everything below it is older and narrower — an exact inventory of
/// `.disabled(…)`, a list of modifiers that kill a control by looks, a set of
/// names allowed to decide whether the exit is drawn. Those stay, because each
/// says something the general rule does not (a `.disabled(busy)` mentioning no
/// pause is still a second condition on the way out), but each of them
/// enumerates a MECHANISM, and five separate escapes were found against them by
/// applying a mechanism the list did not contain: a second chained `.disabled(`,
/// one on the card a line below, `canCancel` redefined to read the pause, a
/// `guard` inside `handOff()`, and one hung on the `CancelCard(` call site.
/// They were not five bugs. They were one bug five times, and the general rule
/// is the answer to it: it asks what the exit DEPENDS ON rather than how it
/// might be switched off, so a sixth mechanism needs no sixth assertion.
///
/// # What it does not claim
///
/// Not that the screen is usable, not that the button works, and not that a
/// press reaches Stripe — those need a device. It claims the structural facts
/// that decay silently: the exit exists in every state but the two about the
/// reader and the subscription, it is disabled by its own request and nothing
/// else, nothing about the pause renders or branches in front of it, the offer
/// sits below it, and the plan card states no fact it has not read.
final class CancelOneActionTests: XCTestCase {
    /// The label on the button that leaves. If this string moves, every test
    /// here fails with "not found" rather than passing vacuously — see
    /// `testTheScanIsActuallyReadingTheScreen`.
    private let exitLabel = "Continue to cancel"

    // MARK: - Reading the screen

    /// The pure-logic file, for the one guard that has to read both.
    ///
    /// Every sentence the pause prints a price into lives HERE, not on the
    /// screen: the screen calls `pausedStateLines`, `pauseOfferBody` and
    /// `pauseConfirmMessage`, and all three are declared in SettingsLogic.swift.
    /// A typed-price scan that read only the screen was watching the one of the
    /// two files that could not contain the defect.
    private func logicSource() throws -> [String] {
        let file = URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent() // LoonextTests
            .deletingLastPathComponent() // ios
            .appendingPathComponent("Loonext")
            .appendingPathComponent("Features")
            .appendingPathComponent("Settings")
            .appendingPathComponent("SettingsLogic.swift")
        guard let text = try? String(contentsOf: file, encoding: .utf8) else {
            // Fails rather than skips — see `MissingSource`.
            throw missingSource(file.path)
        }
        return text.split(separator: "\n", omittingEmptySubsequences: false).map(String.init)
    }

    private func billingSource() throws -> [String] {
        // The test bundle lives in DerivedData, so walk up to the repo copy of
        // the sources rather than guessing a working directory. Same approach as
        // `ColorLiteralLintTests`.
        let file = URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent() // LoonextTests
            .deletingLastPathComponent() // ios
            .appendingPathComponent("Loonext")
            .appendingPathComponent("Features")
            .appendingPathComponent("Settings")
            .appendingPathComponent("BillingSection.swift")
        guard let text = try? String(contentsOf: file, encoding: .utf8) else {
            // Fails rather than skips — see `MissingSource`.
            throw missingSource(file.path)
        }
        return text.split(separator: "\n", omittingEmptySubsequences: false).map(String.init)
    }

    private func trimmed(_ line: String) -> String {
        line.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    /// A whole-line comment is prose, not code. Only whole-line ones are
    /// stripped, so a real statement is still read however it is annotated — and
    /// the reasoning in that file, which mentions the pause constantly, does not
    /// have to fight the guard that reasoning asked for.
    private func code(_ line: String) -> String {
        trimmed(line).hasPrefix("//") ? "" : line
    }

    private func count(_ line: String, _ character: Character) -> Int {
        line.filter { $0 == character }.count
    }

    /// A line with its string literals emptied and its interpolations kept.
    ///
    /// A guard that reads NAMES has to stop reading the copy. `read` is both
    /// the pause value this card is handed and an ordinary English word, and a
    /// scan that tokenised `Text("…names, numbers, tags and when they opted
    /// in…")` would start failing the day somebody writes a sentence with it
    /// in. Interpolation is real code living inside a literal, so what is
    /// inside `\(…)` is kept and the prose around it is blanked — the same
    /// distinction `typesAPrice` makes, for the same reason.
    ///
    /// Blanked rather than deleted, so the walk that counts braces and
    /// parentheses is looking at the same columns the compiler is.
    private func withoutLiterals(_ line: String) -> String {
        let characters = Array(line)
        var out = ""
        var inString = false
        var interpolation = 0
        var index = 0
        while index < characters.count {
            let character = characters[index]
            if inString, interpolation == 0, character == "\\", index + 1 < characters.count,
               characters[index + 1] == "(" {
                interpolation = 1
                out.append("  ")
                index += 2
                continue
            }
            if inString, interpolation > 0 {
                if character == "(" { interpolation += 1 }
                if character == ")" { interpolation -= 1 }
                out.append(interpolation > 0 ? String(character) : " ")
                index += 1
                continue
            }
            if inString, character == "\\" {
                out.append("  ")
                index += 2
                continue
            }
            if character == "\"" {
                inString.toggle()
                out.append(" ")
                index += 1
                continue
            }
            out.append(inString ? " " : String(character))
            index += 1
        }
        return out
    }

    /// The code on a line: no whole-line comment, no string contents, no
    /// trailing comment. In that order, because a `//` inside a URL literal is
    /// not a comment and a `"` inside a comment is not a literal.
    private func readable(_ line: String) -> String {
        let text = withoutLiterals(code(line))
        return text.components(separatedBy: "//").first ?? text
    }

    private func braceDelta(_ line: String) -> Int {
        count(line, "{") - count(line, "}")
    }

    /// The lines INSIDE the block opened at `header`, as absolute indices.
    ///
    /// Brace counting, which is enough here and nowhere near a Swift parser:
    /// `readable` has already emptied the string literals, so a brace inside a
    /// sentence cannot move the walk. `testTheScanIsActuallyReadingTheScreen`
    /// is what notices if it starts returning nonsense anyway.
    private func blockRange(_ lines: [String], openedAt header: Int) -> Range<Int>? {
        var depth = 0
        var opened: Int?
        for index in header ..< lines.count {
            depth += braceDelta(readable(lines[index]))
            guard let first = opened else {
                // The header line opens the block but is not inside it.
                if depth > 0 { opened = index + 1 }
                continue
            }
            if depth <= 0 { return first ..< index }
        }
        return nil
    }

    private func blockRange(_ lines: [String], startingWith needle: String) -> Range<Int>? {
        guard let start = lines.firstIndex(where: { trimmed($0).hasPrefix(needle) })
        else { return nil }
        return blockRange(lines, openedAt: start)
    }

    /// The lines INSIDE the block a declaration opens.
    private func blockBody(_ lines: [String], startingWith needle: String) -> [String]? {
        blockRange(lines, startingWith: needle).map { Array(lines[$0]) }
    }

    /// `CancelCard.body` — the chain that decides whether `leaving` is drawn at
    /// all, which is a different question from what `leaving` contains.
    ///
    /// Every exit assertion in this file used to be bounded by `leaving`, and a
    /// screen can delete the exit outright without touching a line of it:
    /// `} else if pauseChecking { ProgressView() } else { leaving }` in the body
    /// above leaves `leaving` word-for-word as it is and still hands somebody a
    /// spinner where the way out was. That is the LOADING shape that walked
    /// through web's 71 tests.
    private func cancelCardBody() throws -> [String]? {
        let source = try billingSource()
        guard let card = blockBody(source, startingWith: "private struct CancelCard: View {")
        else {
            XCTFail("CancelCard is gone from the billing screen")
            return nil
        }
        guard let body = blockBody(card, startingWith: "var body: some View {") else {
            XCTFail("`body` is gone from CancelCard — this guard is reading nothing")
            return nil
        }
        return body
    }

    /// Every `.disabled(…)` in these lines, as the expression each one asks
    /// about.
    ///
    /// ALL of them, and per OCCURRENCE rather than per line. SwiftUI ORs chained
    /// modifiers — `.disabled(opening).disabled(pauseChecking)` switches the
    /// button off whenever either is true — and the guard here read only the
    /// FIRST `.disabled(` after the button, so the second one passed. One applied
    /// to the enclosing `VStack` does the same thing to the exit and was equally
    /// invisible, which is why this reads the whole block rather than the button.
    private func disabledExpressions(_ lines: [String]) -> [String] {
        var found: [String] = []
        for line in lines.map(code) {
            var rest = Substring(line)
            while let marker = rest.range(of: ".disabled(") {
                let after = rest[marker.upperBound...]
                var depth = 1
                var argument = ""
                for character in after {
                    if character == "(" { depth += 1 }
                    if character == ")" {
                        depth -= 1
                        if depth == 0 { break }
                    }
                    argument.append(character)
                }
                found.append(argument)
                rest = after
            }
        }
        return found
    }

    /// The names a line of code mentions, ignoring anything after a `//`.
    ///
    /// Names rather than a keyword blacklist, because the regression to catch is
    /// a condition nobody has thought of yet: `pauseChecking` is the one that
    /// happened, but `!loaded`, `readFailed` and `busy` are the same defect and a
    /// guard listing forbidden words would miss all three.
    private func identifiers(in line: String) -> [String] {
        // `statement`, not `code`: a local of that name would shadow the
        // whole-line-comment stripper this file uses everywhere else.
        let statement = line.components(separatedBy: "//").first ?? line
        let keywords: Set<String> = [
            "if", "else", "switch", "guard", "let", "var", "case", "default",
            "true", "false", "nil", "self", "return", "some", "View", "in",
        ]
        return words(statement).filter { word in
            !keywords.contains(word) && !(word.first?.isNumber ?? true)
        }
    }

    /// Every word in a line, keywords included.
    ///
    /// `identifiers` throws `let`, `var` and `func` away, which is right for
    /// asking what an expression consults and useless for asking what a line
    /// DECLARES — that question is answered by finding the keyword itself.
    private func words(_ text: String) -> [String] {
        var found: [String] = []
        var current = ""
        for character in text {
            if character.isLetter || character.isNumber || character == "_" {
                current.append(character)
            } else if !current.isEmpty {
                found.append(current)
                current = ""
            }
        }
        if !current.isEmpty { found.append(current) }
        return found
    }

    /// `CancelCard.leaving`, and where the way out sits inside it.
    private func leavingBody() throws -> (body: [String], exit: Int)? {
        let source = try billingSource()
        guard let body = blockBody(source, startingWith: "private var leaving: some View {")
        else {
            XCTFail("`leaving` is gone from CancelCard — this guard is reading nothing")
            return nil
        }
        guard let exit = body.firstIndex(where: { $0.contains(exitLabel) }) else {
            XCTFail("no \"\(exitLabel)\" in `leaving` — the way out moved or was renamed")
            return nil
        }
        return (body, exit)
    }

    // MARK: - The way out

    /// Proven three ways: `.disabled(opening || exporting)`, a second chained
    /// `.disabled(pauseChecking)` under the first, and a `.disabled(pauseChecking)`
    /// on the enclosing `VStack`. All three fire this assertion, printing the
    /// whole inventory.
    ///
    /// EXACT MATCH, not "does not mention the pause". The regression web shipped
    /// was `disabled={portal.isPending || pause.isPending}` — a LOADING state,
    /// not a data-shaped one — and a guard that only knew the word "pause" would
    /// equally miss `|| !loaded`, `|| readFailed` and `|| busy`. The only
    /// enabledness this button may have is the handoff it started itself.
    ///
    /// EVERY OCCURRENCE IN THE BLOCK, not the first one after the button. The
    /// first two of those three mutations walked past the old version of this
    /// test: SwiftUI ORs chained modifiers, so a second `.disabled(` under the
    /// first switches the exit off while the first still reads exactly as
    /// required — and a `.disabled(` on the container never came after the
    /// button's line at all.
    func testTheWayOutIsDisabledOnlyByItsOwnRequest() throws {
        guard let found = try leavingBody() else { return }
        XCTAssertEqual(
            ["opening"], disabledExpressions(found.body),
            "\n\nEvery .disabled(…) in `leaving`: \(disabledExpressions(found.body))\n\n"
                + "The button that leaves may be disabled by the handoff it started and by "
                + "nothing else — not by a pause read in flight, not by one that failed, "
                + "not by a flag that happens to be false on arrival, and not by a second "
                + "modifier chained under the first or hung on the stack around it. "
                + "Reaching Stripe while answering nothing is one action from landing on "
                + "this screen, and a second condition here is how that stops being true "
                + "without anybody deciding it should.\n"
        )
        // ...and it is on the exit rather than somewhere else in the block: an
        // inventory of one proves nothing about WHICH control carries it.
        let onTheExit = found.body[found.exit...]
            .prefix(9)
            .first(where: { trimmed($0).hasPrefix(".disabled(") })
        XCTAssertEqual(".disabled(opening)", onTheExit.map(trimmed))
    }

    /// Proven by adding `.opacity(0.5)` and again by `.allowsHitTesting(false)`
    /// under the exit; both fired this assertion quoting the line.
    ///
    /// THE CSS-DEAD EXIT, in Swift. Web shipped
    /// `className={pause.isPending ? "pointer-events-none opacity-50" : undefined}`
    /// on its own "Continue to cancel": unpressable for a real person through the
    /// whole cold-start read, and invisible to all 83 of its tests, because
    /// happy-dom applies no CSS and every `disabled` check sailed past. These are
    /// the three modifiers that do the same thing here — the button stays
    /// enabled, and the press stops landing or the control stops being readable.
    func testTheWayOutIsNotSwitchedOffByLooksEither() throws {
        guard let found = try leavingBody() else { return }
        let killers = [".allowsHitTesting(", ".hidden()", ".opacity("]
        let offenders = found.body.map(code)
            .filter { line in killers.contains(where: { line.contains($0) }) }
            .map(trimmed)
        XCTAssertEqual(
            offenders, [String](),
            "\n\nIn `leaving`:\n  \(offenders.joined(separator: "\n  "))\n\n"
                + "A control that is enabled but takes no touches, or is drawn at half "
                + "opacity to say so, is a disabled exit that no `.disabled` check can "
                + "see. If one of these is ever genuinely needed here, this guard is the "
                + "place to argue for it.\n"
        )
    }

    /// Proven by moving `PauseOfferNote` above the button, which fired this
    /// assertion naming the offending lines.
    func testNothingAboutThePauseRendersAboveTheWayOut() throws {
        guard let found = try leavingBody() else { return }
        let offenders = found.body[..<found.exit]
            .map(code)
            .filter { $0.lowercased().contains("pause") }
            .map(trimmed)
        XCTAssertEqual(
            offenders, [String](),
            "\n\nRendered above the way out:\n  \(offenders.joined(separator: "\n  "))\n\n"
                + "The pause takes the seasonal answer's SLOT, which is below the exit. It "
                + "is an offer, never a confirmation in front of the door — anything of "
                + "its own above that button pushes the button down the screen in answer "
                + "to a question the reader was told was optional.\n"
        )
    }

    /// Proven twice: by inserting `if !detail.isEmpty { … }` above the button,
    /// and by hanging a `.sheet(…)` there. Both fired this assertion.
    ///
    /// Branches and presentations rather than "anything new", because a second
    /// line of copy is not a press and this guard has to stay usable. What costs
    /// a press is a gate (something that may or may not be there, or has to be
    /// dealt with) and a surface that opens over the screen.
    func testNothingBranchesOrOpensInFrontOfTheWayOut() throws {
        guard let found = try leavingBody() else { return }
        let statements = ["if ", "if(", "switch ", "guard ", "} else"]
        let presentations = [
            ".sheet(", ".alert(", ".confirmationDialog(", ".fullScreenCover(",
            ".popover(", "NavigationLink", "DisclosureGroup", ".onTapGesture",
        ]
        let offenders = found.body[..<found.exit].map(code).filter { line in
            let head = trimmed(line)
            return statements.contains(where: { head.hasPrefix($0) })
                || presentations.contains(where: { line.contains($0) })
        }.map(trimmed)
        XCTAssertEqual(
            offenders, [String](),
            "\n\nIn front of the way out:\n  \(offenders.joined(separator: "\n  "))\n\n"
                + "Everything above this button renders unconditionally and opens nothing. "
                + "A branch here is a control that may or may not be present; a sheet is a "
                + "surface to dismiss. Either turns a one-press exit into two, for "
                + "somebody who has already decided to leave.\n"
        )
    }

    /// Proven by moving the note above the button: this fired alongside the
    /// pause-above-the-exit assertion.
    func testTheOfferRendersBelowTheWayOut() throws {
        guard let found = try leavingBody() else { return }
        guard let note = found.body.firstIndex(where: {
            code($0).contains("PauseOfferNote(")
        }) else {
            XCTFail("the pause offer is gone from the cancel card")
            return
        }
        XCTAssertGreaterThan(
            note, found.exit,
            "the pause offer must render after the way out, in the slot the shared "
                + "seasonal answer already occupied"
        )
    }

    /// Proven by rewriting the gate to
    /// `if company.subscriptionActive && pauseKnown.answer != nil {`, which fired
    /// this assertion quoting that line.
    ///
    /// The chain is read by walking BACKWARDS from the call and recording every
    /// unmatched `{` — which is exactly the set of conditions that must all hold
    /// for the exit to exist. Two of them, and both are about who is reading and
    /// whether there is a subscription to cancel. Nothing the pause read can be
    /// in may join them: a screen that has not finished asking about the pause
    /// must still be a screen you can leave from.
    func testTheWayOutIsGatedOnlyByRoleAndSubscriptionState() throws {
        let source = try billingSource()
        guard let section = blockBody(source, startingWith: "var body: some View {"),
              let card = section.firstIndex(where: { code($0).contains("CancelCard(") })
        else {
            XCTFail("CancelCard( is gone from the billing section")
            return
        }
        var enclosing: [String] = []
        var pending = 0
        for index in stride(from: card - 1, through: 0, by: -1) {
            let line = code(section[index])
            pending += count(line, "}")
            pending -= count(line, "{")
            if pending < 0 {
                enclosing.append(trimmed(section[index]))
                pending = 0
            }
        }
        XCTAssertEqual(
            2, enclosing.count,
            "expected exactly two conditions around the way out, saw \(enclosing)"
        )
        XCTAssertEqual(
            [String](), enclosing.filter { $0.lowercased().contains("pause") },
            "\n\nThe way out is gated on: \(enclosing)\n\n"
                + "Nothing about the pause — not the answer, not the loading, not the "
                + "failure — may decide whether the cancel card exists. A workspace whose "
                + "pause read is in flight or broken is still a workspace that can leave, "
                + "in one press.\n"
        )
    }

    /// Proven by inserting `} else if pauseChecking { ProgressView() }` into
    /// `CancelCard.body` between the two branches it already has, which fired
    /// this assertion naming both the line and the name it objected to. Proven
    /// again with `} else if !loaded {`, which no list of forbidden words would
    /// have caught.
    ///
    /// WHY THIS IS A SEPARATE TEST FROM THE ONE ABOVE. That one reads the
    /// billing section and asks what guards the CARD; this one reads the card and
    /// asks what guards the EXIT inside it. The two are different code, and the
    /// second was unread: every exit assertion in this file was bounded by
    /// `leaving`, so a branch in `body` could hand somebody a spinner where the
    /// way out belongs without changing a character of the block being watched.
    /// That is exactly the shape web shipped, one level up.
    ///
    /// NAMES, NOT KEYWORDS. Only two questions may decide whether the exit is
    /// drawn — who is reading (`canCancel`) and whether there is a live
    /// subscription to cancel (`alreadyEnding`). Anything else that appears in a
    /// condition here fails, whatever it is called, because the regression to
    /// catch is the condition nobody has thought of yet.
    func testOnlyTheReaderAndTheSubscriptionDecideWhetherTheExitIsDrawn() throws {
        guard let body = try cancelCardBody() else { return }
        guard body.contains(where: { code($0).contains("leaving") }) else {
            XCTFail("`CancelCard.body` no longer renders `leaving` — where is the exit?")
            return
        }
        let permitted: Set<String> = ["canCancel", "alreadyEnding"]
        let branches = ["if ", "if(", "} else if ", "else if ", "switch ", "guard "]
        var offenders: [String] = []
        for raw in body {
            let line = trimmed(code(raw))
            guard branches.contains(where: { line.hasPrefix($0) }) else { continue }
            for name in identifiers(in: line) where !permitted.contains(name) {
                offenders.append("\(line)   ← \(name)")
            }
        }
        XCTAssertEqual(
            offenders, [String](),
            "\n\nDeciding whether the way out is drawn:\n  "
                + offenders.joined(separator: "\n  ")
                + "\n\nTwo questions may: whether this reader can cancel, and whether the "
                + "subscription is already ending. A third — a read in flight, a read that "
                + "failed, a flag that is false on arrival — deletes the exit from the "
                + "screen for as long as it is true, which is a longer outage than any "
                + "disabled button.\n"
        )
    }

    /// Proven by replacing the call with the plain
    /// `cancellationOffer(reason: chosen, plan: company.plan, …)`, which fired
    /// this assertion quoting the argument it found instead.
    ///
    /// THE ANSWER BELOW THE EXIT HAS TO KNOW WHAT WAS READ. A paused workspace
    /// answering `too_expensive` was handed "Switch to Starter", whose
    /// POST /v1/billing/change-plan replies 409 until they resume — and a client
    /// that passed a plain `false` for "paused" while its read was still in
    /// flight would put that same button back. The read is passed whole for that
    /// reason: `cancellationOffer(read:…)` is the only overload that can tell
    /// "not paused" from "not read yet".
    ///
    /// It changes nothing about the exit. This is an argument to a call that
    /// renders BELOW the button, and the two tests above are what say so.
    func testTheAnswerBelowTheExitIsDecidedByTheReadItself() throws {
        guard let found = try leavingBody() else { return }
        guard let call = found.body.firstIndex(where: {
            code($0).contains("cancellationOffer(")
        }) else {
            XCTFail("the cancel card no longer answers the reason at all")
            return
        }
        XCTAssertGreaterThan(
            call, found.exit,
            "the answer must still render after the way out"
        )
        let firstArgument = found.body[(call + 1)...]
            .map(code)
            .map(trimmed)
            .first(where: { !$0.isEmpty })
        XCTAssertEqual(
            "read: read,", firstArgument,
            "\n\nThe answer is being computed from: \(firstArgument ?? "nothing")\n\n"
                + "It must be handed the READ. A Bool derived here cannot tell a workspace "
                + "that is not paused from one whose pause read has not landed, and the "
                + "difference between those two is a button that opens a plan switcher "
                + "and a button that opens a 409.\n"
        )
        // ...and the pause OFFER above it reads the same value, so the two
        // halves of this slot can never describe different workspaces.
        XCTAssertTrue(
            found.body.contains(where: { code($0).contains("pause: read.answer") }),
            "the pause offer no longer reads from the same value the answer does"
        )
    }

    /// Proven by putting the state back to `@State private var pauseRead:
    /// PauseRead = .loading`, which fired the first assertion, and by then
    /// editing that default to `.unaskable`, which fired the second.
    ///
    /// A SCREEN THAT HAS NOT ASKED MAY NOT SAY IT CANNOT ASK. `planCardShape`
    /// answers `.active` for `.unaskable`, deliberately and narrowly: a reader
    /// without `billing.manage` can never get an answer, so withholding the plan
    /// price from them forever would guard nothing. While the screen's own state
    /// was typed `PauseRead`, that exception was one token away from covering the
    /// ordinary first frame of every visit — `= .unaskable` restored the whole
    /// defect (a paused workspace shown its plan's price beside a green `Active`
    /// pill) with every test in the suite green.
    ///
    /// `PauseFetch` cannot spell it, so the mutation stops compiling; this guard
    /// is what stops the type quietly going back.
    func testTheScreenCannotClaimItCannotAskWhenItSimplyHasNotAsked() throws {
        let source = try billingSource()
        let stored = source.map(code)
            .filter { $0.contains("@State") && $0.contains("PauseRead") }
            .map(trimmed)
        XCTAssertEqual(
            stored, [String](),
            "\n\n\(stored.joined(separator: "\n"))\n\n"
                + "The screen's own pause state is a `PauseFetch`: three cases, none of "
                + "which is `unaskable`. Storing a `PauseRead` there puts the exception "
                + "written for a tech one keyword away from the state every visit starts "
                + "in.\n"
        )
        let claims = source.map(code).filter { $0.contains(".unaskable") }.map(trimmed)
        XCTAssertEqual(
            claims, [String](),
            "\n\n\(claims.joined(separator: "\n"))\n\n"
                + "`.unaskable` has exactly one source — `pauseReadFor`, from the role — "
                + "and this screen is not it.\n"
        )
        XCTAssertTrue(
            source.contains(where: {
                trimmed(code($0)) == "@State private var pauseFetch: PauseFetch = .loading"
            }),
            "the screen no longer starts out having read nothing"
        )
    }

    // MARK: - The plan card may not state a fact it has not read

    /// Proven twice: by deleting the unread branch (fired "the unread branch"),
    /// and by dropping the paused branch (fired "the paused branch").
    ///
    /// ORDER, because order IS the property. The ordinary plan card — the plan's
    /// own price and the green `Active` pill — is the LAST branch, reachable only
    /// once the read has come back and said "not paused". Before that it is the
    /// wrong card in three ways at once: the plan price over a workspace paying a
    /// holding fee, a pill that reads as "everything is on" over one that cannot
    /// send, and five allowance lines describing a plan that is not running.
    func testTheOrdinaryPlanCardIsTheLastBranchOfTheRead() throws {
        let source = try billingSource()
        guard let cards = blockBody(source, startingWith: "private var cards: some View {")
        else {
            XCTFail("`cards` is gone from PlanCard — this guard is reading nothing")
            return
        }
        let body = cards.map(code)
        func at(_ needle: String) -> Int? {
            body.firstIndex(where: { $0.contains(needle) })
        }
        let consults = at("planCardShape(read)")
        let paused = at("shape == .paused")
        let unread = at("case .unconfirmed(let checking) = shape")
        let pill = at("StatusPill(label: \"Active\"")
        let price = at("facts.price")

        var missing: [String] = []
        if consults == nil { missing.append("the read itself, `planCardShape(read)`") }
        if paused == nil { missing.append("the paused branch, `shape == .paused`") }
        if unread == nil {
            missing.append("the unread branch, `case .unconfirmed(let checking) = shape`")
        }
        if pill == nil { missing.append("the Active pill") }
        if price == nil { missing.append("the plan price") }
        guard missing.isEmpty else {
            XCTFail(
                "\n\nThe plan card no longer branches on the pause read.\n\nMissing: "
                    + missing.joined(separator: "; ")
                    + "\n\nExpected, in this order: `planCardShape(read)`, a paused branch, "
                    + "a branch for a read that has not landed, and only then the ordinary "
                    + "card with its price and its Active pill.\n"
            )
            return
        }
        guard let consults, let paused, let unread, let pill, let price else { return }

        XCTAssertLessThan(consults, paused, "the read must be consulted before its branches")
        XCTAssertLessThan(paused, unread, "paused is answered before unread")
        XCTAssertLessThan(
            unread, pill,
            "the green Active pill must sit AFTER the branch for a read that has not "
                + "landed — a paused workspace told it is Active is the defect this exists "
                + "to end"
        )
        XCTAssertLessThan(
            unread, price,
            "the plan's own price must sit AFTER the branch for a read that has not "
                + "landed — during a pause the licensed line IS the holding fee, so the "
                + "plan's price overstates the charge many times over"
        )

        // ...and no branch in that chain is switched off by a constant. Proven by
        // `} else if false, let facts = …`, which leaves every marker above
        // present and in order while the unread branch never runs — order alone
        // cannot see it, and what reaches the screen is the ordinary plan card on
        // a fact nobody has read.
        let neutered = body.filter { line in
            let head = trimmed(line)
            guard head.hasPrefix("if ") || head.hasPrefix("} else if ") else { return false }
            return [" false", "(false", " true", "(true"].contains { head.contains($0) }
        }.map(trimmed)
        XCTAssertEqual(
            neutered, [String](),
            """

            Switched off by a constant:
              \(neutered.joined(separator: "\n  "))
            """
        )
    }

    /// Proven by restoring `if let fresh = try? await scope.repo.pauseOffer(…)`,
    /// which fired this assertion quoting that line.
    ///
    /// `GET /v1/billing/pause` THROWS on a Stripe failure rather than degrading
    /// to a null — deliberately, so the offer is never on screen with no price
    /// beside it. A `try?` on the calling line undoes that decision on the client
    /// and turns a failure into "there is no pause", which is the one reading it
    /// must never have.
    func testTheReadsFailureIsRecordedRatherThanSwallowed() throws {
        let source = try billingSource()
        let swallowed = source.map(code)
            .filter { $0.contains("pauseOffer(") && $0.contains("try?") }
            .map(trimmed)
        XCTAssertEqual(
            swallowed, [String](),
            "\n\n\(swallowed.joined(separator: "\n"))\n\n"
                + "The route throws so this screen is never wrong about money. `try?` here "
                + "turns that throw into a nil, and nil renders as 'not paused'.\n"
        )
        XCTAssertTrue(
            source.contains(where: { code($0).contains("onRead(.failed)") }),
            "nothing records a failed pause read, so a failure is indistinguishable from "
                + "an answer"
        )
    }

    /// Proven by deleting `&& mayBuyAddOns(pauseKnown)` from the gate, which
    /// fired this assertion printing the weakened condition.
    ///
    /// AT THE RENDER SITE, not on the pure function. A unit test of
    /// `mayBuyAddOns` passes happily while the card renders unconditionally —
    /// that is exactly how Android's price rule survived a render site that
    /// fabricated its own eligible pause. Enabling a module invoices
    /// immediately and the route refuses a paused workspace, so this control may
    /// be offered only on an answer that came back.
    func testAddOnsAreOfferedOnlyOnAnAnswerThatCameBack() throws {
        let source = try billingSource()
        guard let section = blockBody(source, startingWith: "var body: some View {"),
              let card = section.firstIndex(where: { code($0).contains("ModulesCard(") })
        else {
            XCTFail("ModulesCard( is gone from the billing section")
            return
        }
        // The `if` header immediately above it, however many lines its condition
        // is spread over. A `}` on the way up means the card is not inside that
        // `if` at all, which is its own failure.
        var header: [String] = []
        var gate: String?
        for index in stride(from: card - 1, through: 0, by: -1) {
            let line = code(section[index])
            if trimmed(line).isEmpty { continue }
            if line.contains("}") { break }
            header.insert(trimmed(line), at: 0)
            if trimmed(line).hasPrefix("if ") {
                gate = header.joined(separator: " ")
                break
            }
        }
        XCTAssertNotNil(gate, "the add-ons card is not inside a condition at all")
        XCTAssertTrue(
            gate?.contains("mayBuyAddOns(") ?? false,
            "\n\nThe add-ons card is gated on: \(gate ?? "nothing")\n\n"
                + "A module toggle invoices immediately and POST /v1/billing/modules "
                + "refuses a paused workspace, so the card may be offered only when the "
                + "read came back and said the plan is running. `mayBuyAddOns` is that "
                + "question, and asking it in a unit test rather than here proves "
                + "nothing.\n"
        )
    }

    // MARK: - No price is typed on this screen

    /// Proven twice: by typing `Button("Pause for $5/mo")` into a preview, and by
    /// passing a literal where the derived price was passed. Both fired this
    /// assertion with the line and its number.
    ///
    /// The pause price does not exist in this repository — the founder
    /// provisions a Stripe price and the API reads it back. Every price on this
    /// screen therefore arrives as cents and is formatted by `formatMonthlyCents`
    /// or `planFacts`. A typed one is a recurring charge a client invented, and
    /// it is worst inside a `#Preview`, where it looks like documentation of the
    /// real thing while sitting one copy-paste from the render path.
    ///
    /// `$` inside `\(…)` is interpolation and `$0` in a closure is a parameter;
    /// neither is a price, so the scan reads literal text only and looks only for
    /// a `$` followed by a digit.
    /// BOTH FILES, and that is the fix rather than a widening for its own sake.
    /// This read only BillingSection.swift, while every sentence the pause prints
    /// a price into is declared in SettingsLogic.swift — `pauseOfferBody`,
    /// `pauseConfirmMessage`, `pausedStateLines`, `pausedConfirmationMessage`.
    /// The scan was watching the one of the two files that could not hold the
    /// defect.
    func testNoPriceIsTypedIntoTheBillingScreen() throws {
        var offenders: [String] = []
        for (index, raw) in try billingSource().enumerated() where typesAPrice(code(raw)) {
            offenders.append("BillingSection.swift:\(index + 1): \(trimmed(raw))")
        }
        for entry in try pauseCopySource() where typesAPrice(code(entry.text)) {
            offenders.append("SettingsLogic.swift:\(entry.line): \(trimmed(entry.text))")
        }
        XCTAssertEqual(
            offenders, [String](),
            "\n\nTyped price(s):\n  \(offenders.joined(separator: "\n  "))\n\n"
                + "Prices on this screen come from the API as cents and are formatted by "
                + "`formatMonthlyCents` or `planFacts`. Previews included: a fixture is a "
                + "RESPONSE — cents in — never a formatted price, so the preview exercises "
                + "the same function the screen does.\n"
        )
    }

    /// SettingsLogic.swift from the cancellation/pause MARK onward, with each
    /// line's real number.
    ///
    /// SLICED, and the line above the slice is why: the merge-field tidier calls
    /// `replacingPattern(…, template: "$1")`, and `$1` is a regex backreference
    /// rather than a price — a scan reading "`$` then a digit" cannot tell them
    /// apart. Everything above the cut has its own guard
    /// (`testThePlanCardReadsThePriceBookAndTheCallerHasToNameTheCurrency` in
    /// SettingsLogicTests reads `planFacts` for exactly this), so cutting here
    /// leaves nothing unwatched.
    private func pauseCopySource() throws -> [(line: Int, text: String)] {
        let lines = try logicSource()
        guard let start = lines.firstIndex(where: {
            trimmed($0).hasPrefix("// MARK: - Answering that reason")
        }) else {
            XCTFail("the cancellation/pause section of SettingsLogic.swift is gone")
            return []
        }
        return lines[start...].enumerated().map { item in
            (line: start + item.offset + 1, text: item.element)
        }
    }

    // `typesAPrice` moved to TypedPriceScan.swift when #522 gave it a second
    // caller (the registration card). The walk is unchanged; see that file for
    // why it is a walk and not a pattern.

    // MARK: - One property instead of a list of ways to break it

    /// A line that decides something about the exit: where it came from, what
    /// it says, the names it consults, and the pause-derived names that apply
    /// where it lives.
    ///
    /// The taint set travels WITH the line because the two views on the path
    /// share member names — both have a `scope`, a `company` and a `body` — and
    /// one set for both would let the billing section's `body`, which reads the
    /// pause on purpose, condemn the cancel card's, which does not.
    private struct PathLine {
        let place: String
        let number: Int
        let text: String
        let names: [String]
        let pauseNames: Set<String>
    }

    /// A `let`, `var` or `func`, and the lines it spans.
    private struct Declared {
        let name: String
        let range: Range<Int>
    }

    /// The name a line declares, or nil.
    ///
    /// Found by looking for the KEYWORD rather than by skipping a list of
    /// attributes and access modifiers. `@State private var opening = false`
    /// and `private func handOff() {` have nothing in common on the left, and a
    /// list of things to skip is exactly the kind of list this issue is about.
    private func declaredName(_ line: String) -> String? {
        let head = words(readable(line))
        guard let keyword = head.firstIndex(where: { ["let", "var", "func"].contains($0) }),
              keyword + 1 < head.count
        else { return nil }
        return head[keyword + 1]
    }

    private func nameAfter(_ keyword: String, in line: String) -> String? {
        let head = words(readable(line))
        guard let at = head.firstIndex(of: keyword), at + 1 < head.count else { return nil }
        return head[at + 1]
    }

    /// Every `let`, `var` and `func` declared at the TOP LEVEL of `region`.
    ///
    /// Top level only, which is the point rather than a shortfall: a local
    /// inside a view's body belongs to that body, and every body on the path is
    /// read whole. Hoisting them would also lift `let price =
    /// pauseAnswerPrice(…)` — which lives BELOW the exit, where the pause is
    /// welcome — into the same namespace as the members that gate it.
    private func declarations(_ lines: [String], in region: Range<Int>) -> [Declared] {
        var found: [Declared] = []
        var index = region.lowerBound
        while index < region.upperBound {
            guard let name = declaredName(lines[index]) else {
                index += 1
                continue
            }
            // Parentheses as well as braces, so a signature spread over several
            // lines does not end the declaration before its body starts.
            var braces = 0
            var parens = 0
            var end = index
            for scan in index ..< region.upperBound {
                let text = readable(lines[scan])
                braces += braceDelta(text)
                parens += count(text, "(") - count(text, ")")
                end = scan
                if braces <= 0, parens <= 0 { break }
            }
            found.append(Declared(name: name, range: index ..< (end + 1)))
            index = end + 1
        }
        return found
    }

    /// Every block header the line at `index` sits inside, innermost first.
    private func enclosingHeaders(_ lines: [String], of index: Int) -> [Int] {
        var found: [Int] = []
        var pending = 0
        var scan = index - 1
        while scan >= 0 {
            let text = readable(lines[scan])
            pending += count(text, "}")
            pending -= count(text, "{")
            if pending < 0 {
                found.append(scan)
                pending = 0
            }
            scan -= 1
        }
        return found
    }

    /// A block header, including the lines its condition is spread over.
    ///
    /// A continuation changes no braces, so nothing but the operators tells the
    /// walk where the statement began — and it takes both shapes this codebase
    /// writes, an operator leading the next line (`&& mayBuyAddOns(…)`) and one
    /// trailing the previous (`if canManage,`). Android's guard read only the
    /// line the `{` was on, which is how an added `&&` on a continuation walked
    /// straight through it.
    private func fullHeader(_ lines: [String], endingAt index: Int) -> [Int] {
        let leading = ["&&", "||", ",", "+", "?", ":", "."]
        let trailing = ["&&", "||", ",", "(", "?", ":", "=", "+"]
        var rows = [index]
        var scan = index - 1
        while scan >= 0, rows.count < 10 {
            let above = trimmed(readable(lines[scan]))
            let below = trimmed(readable(lines[rows[0]]))
            guard !above.isEmpty,
                  leading.contains(where: { below.hasPrefix($0) })
                      || trailing.contains(where: { above.hasSuffix($0) })
            else { break }
            rows.insert(scan, at: 0)
            scan -= 1
        }
        return rows
    }

    /// The last line of the call starting at `index` — where its arguments
    /// close, which is where anything chained onto it begins.
    private func statementEnd(
        _ lines: [String], from index: Int, in region: Range<Int>
    ) -> Int {
        var parens = 0
        for scan in index ..< region.upperBound {
            let text = readable(lines[scan])
            parens += count(text, "(") - count(text, ")")
            if parens <= 0 { return scan }
        }
        return index
    }

    /// Whatever is written after that closing parenthesis, on the same line.
    ///
    /// `CancelCard(…).disabled(pauseChecking)` puts the whole card, exit and
    /// all, behind the pause read without occupying a line of its own.
    private func statementTail(
        _ lines: [String], from index: Int, in region: Range<Int>
    ) -> String {
        var parens = 0
        for scan in index ..< region.upperBound {
            let characters = Array(readable(lines[scan]))
            var cut = characters.count
            for (offset, character) in characters.enumerated() {
                if character == "(" { parens += 1 }
                if character == ")" {
                    parens -= 1
                    if parens <= 0 {
                        cut = offset + 1
                        break
                    }
                }
            }
            if parens <= 0 { return trimmed(String(characters[cut...])) }
        }
        return ""
    }

    /// Every view modifier that lands on the thing at `anchor` — its own chain,
    /// and the chain of every container that closed around it.
    ///
    /// OUTWARD, not "the next few lines". SwiftUI ORs chained `.disabled(…)`,
    /// so a second one under the first switches the exit off while the first
    /// still reads exactly as required; and a modifier hung on the stack the
    /// exit sits in, or on the card that stack sits in, never appears near the
    /// button at all. The walk therefore follows the exit out to the root of
    /// the block: a line is attached when the chain is still alive, and the
    /// chain comes back to life every time a brace closes around the exit.
    ///
    /// A modifier that opens a block of its own — `.overlay { … }` — is
    /// swallowed whole, so a condition hidden inside one is read rather than
    /// ending the chain.
    private func attachedModifiers(
        _ lines: [String], in region: Range<Int>, anchor: Int
    ) -> [Int] {
        var depth = 0
        for index in region.lowerBound ... anchor {
            depth += braceDelta(readable(lines[index]))
        }
        var watermark = depth
        var chained = true
        var found: [Int] = []
        var index = anchor + 1
        while index < region.upperBound {
            let text = readable(lines[index])
            let head = trimmed(text)
            if head.isEmpty {
                index += 1
                continue
            }
            if chained, head.hasPrefix(".") {
                let opened = depth
                found.append(index)
                depth += braceDelta(text)
                index += 1
                while index < region.upperBound, depth > opened {
                    found.append(index)
                    depth += braceDelta(readable(lines[index]))
                    index += 1
                }
                continue
            }
            depth += braceDelta(text)
            if depth < watermark {
                // A container that enclosed the exit just closed, so what
                // follows applies to it — and therefore to the exit.
                watermark = depth
                chained = true
            } else {
                chained = false
            }
            index += 1
        }
        return found
    }

    /// The arguments a call hands down, as label to expression.
    ///
    /// Read so the taint follows the VALUE rather than a parameter's name or
    /// its type: `read: pauseKnown` makes `read` a pause name inside the card
    /// whether or not the parameter is still called that, and whether or not
    /// its type still says "pause" out loud.
    private func arguments(_ lines: [String], call: Range<Int>) -> [String: String] {
        var text = ""
        for index in call { text += readable(lines[index]) + " " }
        guard let open = text.firstIndex(of: "(") else { return [:] }
        var chunks: [String] = []
        var current = ""
        var depth = 0
        for character in text[text.index(after: open)...] {
            if "([{".contains(character) { depth += 1 }
            if ")]}".contains(character) {
                if depth == 0 { break }
                depth -= 1
            }
            if character == ",", depth == 0 {
                chunks.append(current)
                current = ""
                continue
            }
            current.append(character)
        }
        chunks.append(current)
        var found: [String: String] = [:]
        for chunk in chunks {
            guard let colon = chunk.firstIndex(of: ":") else { continue }
            let label = trimmed(String(chunk[..<colon]))
            guard words(label).count == 1 else { continue }
            found[label] = String(chunk[chunk.index(after: colon)...])
        }
        return found
    }

    /// The names inside `region` that carry the pause read, or are computed
    /// from something that does.
    ///
    /// Two seeds and a fixpoint. A declaration is pause-derived when its own
    /// text says "pause" in any casing, when it mentions a name already
    /// pause-derived, or when it is HANDED one from outside. Assignments count
    /// as well as initialisers, because `checking = pauseFetch.isLoading`
    /// somewhere below is the same fact arriving through a different door than
    /// `var checking = pauseFetch.isLoading` would.
    ///
    /// `substituting` replaces the lines read for one declaration, and has
    /// exactly one caller and one reason: the block that HOLDS the exit renders
    /// the pause offer below it, by design, so its own pause-derivedness is
    /// judged on the part of it that is on the way to the exit rather than on
    /// the part that is past it.
    private func pauseDerived(
        _ lines: [String],
        in region: Range<Int>,
        incoming: Set<String>,
        substituting: [Int: [Int]] = [:]
    ) -> Set<String> {
        let declared = declarations(lines, in: region)
        var found = incoming
        var growing = true
        while growing {
            growing = false
            for entry in declared where !found.contains(entry.name) {
                let rows = substituting[entry.range.lowerBound] ?? Array(entry.range)
                let text = rows.map { readable(lines[$0]) }.joined(separator: "\n")
                guard text.lowercased().contains("pause")
                    || identifiers(in: text).contains(where: { found.contains($0) })
                else { continue }
                found.insert(entry.name)
                growing = true
            }
            for index in region {
                // EVERY assignment on the line, not the first one.
                //
                // This read only the first ` = `, so
                // `onRead: { pauseFetch = $0; leaveAllowed = $0 != .loading }`
                // tainted `pauseFetch` (already tainted, so nothing changed) and
                // never considered `leaveAllowed` - which then gated the exit
                // from outside the taint set. Six separate escapes shared that
                // one root, and each was a single line of ordinary SwiftUI.
                for statement in statements(in: readable(lines[index])) {
                    guard let target = assignmentTarget(statement),
                          !found.contains(target)
                    else { continue }
                    let value = statement.components(separatedBy: " = ")
                        .dropFirst().joined(separator: " = ")
                    guard identifiers(in: value).contains(where: { found.contains($0) })
                    else { continue }
                    found.insert(target)
                    growing = true
                }
            }
        }
        return found
    }

    /// A line split into the statements it actually contains.
    ///
    /// Swift lets a closure body hold several statements separated by `;`, and
    /// a single line is the ordinary way to write a two-line callback. Treating
    /// the line as one statement made the second assignment invisible.
    private func statements(in text: String) -> [String] {
        text.split(separator: ";").map(String.init)
    }

    /// What a line assigns to, taking the last component of the chain: the
    /// value flowing in reaches the stored property however it is written to
    /// (`self.error`, `set: { detail = … }`).
    private func assignmentTarget(_ text: String) -> String? {
        guard text.range(of: " = ") != nil else { return nil }
        let left = text.components(separatedBy: " = ")[0]
        // `let x = …` is a declaration and is read as one; taking it here too
        // would be harmless but says something the declaration walk already did.
        guard let last = words(left).last, !["let", "var", "case"].contains(last)
        else { return nil }
        return last
    }

    /// Every line that decides whether the exit is drawn, whether it can be
    /// pressed, and what happens when it is.
    ///
    /// FOUR PLACES, because the reachability of one button is decided in four,
    /// and a guard bounded to one of them cannot see the other three:
    ///
    ///   the call site   what the billing section wraps the card in, and
    ///                   anything it hangs on the card once built.
    ///   the card        every member that renders the block holding the exit —
    ///                   found by walking the references BACK from that block,
    ///                   so an intermediate view inserted between them is read
    ///                   for the same reason the entry point is.
    ///   the block       from its first line to the exit, plus every modifier
    ///                   that lands on the exit or on anything that closed
    ///                   around it. NOT the part below the exit: the pause
    ///                   offer renders there on purpose.
    ///   what it reaches every member either of those two views names, followed
    ///                   transitively — which is how `canCancel`'s definition
    ///                   and the body of `handOff()` are read without this
    ///                   function naming either of them.
    ///
    /// The two views are found by walking OUT from the button rather than by
    /// being named here, so a rename fails loudly rather than quietly reading
    /// the wrong thing — or nothing.
    private func theWayToTheExit() throws -> [PathLine]? {
        let source = try billingSource()
        guard let exit = source.firstIndex(where: { code($0).contains(exitLabel) }) else {
            XCTFail(
                "no \"\(exitLabel)\" in the billing screen — the way out moved or was renamed"
            )
            return nil
        }
        guard let cardHeader = enclosingHeaders(source, of: exit)
            .first(where: { words(readable(source[$0])).contains("struct") }),
            let cardName = nameAfter("struct", in: source[cardHeader]),
            let cardRange = blockRange(source, openedAt: cardHeader)
        else {
            XCTFail(
                "the exit is inside no struct — this guard cannot find the card it draws on"
            )
            return nil
        }
        guard let call = source.indices.first(where: { index in
            !cardRange.contains(index) && readable(source[index]).contains(cardName + "(")
        }) else {
            XCTFail("\(cardName)( is built nowhere — the exit is on no screen")
            return nil
        }
        let outward = enclosingHeaders(source, of: call)
        guard let render = outward.first(where: { declaredName(source[$0]) != nil }),
              let renderRange = blockRange(source, openedAt: render),
              let sectionHeader = outward.first(where: {
                  words(readable(source[$0])).contains("struct")
              }),
              let sectionRange = blockRange(source, openedAt: sectionHeader)
        else {
            XCTFail(
                "\(cardName)( is inside no view — this guard cannot find its call site"
            )
            return nil
        }

        let sectionPause = pauseDerived(source, in: sectionRange, incoming: [])
        let end = statementEnd(source, from: call, in: renderRange)
        var handedDown: Set<String> = []
        for (label, value) in arguments(source, call: call ..< (end + 1))
        where identifiers(in: value).contains(where: { sectionPause.contains($0) }) {
            handedDown.insert(label)
        }

        let cardMembers = declarations(source, in: cardRange)
        guard let holder = cardMembers.first(where: { $0.range.contains(exit) }) else {
            XCTFail("the exit is in no member of \(cardName) — this guard is reading nothing")
            return nil
        }
        let slice = Array(holder.range.lowerBound ... exit)
            + attachedModifiers(source, in: holder.range, anchor: exit)
        let cardPause = pauseDerived(
            source,
            in: cardRange,
            incoming: handedDown,
            substituting: [holder.range.lowerBound: slice]
        )

        var path: [PathLine] = []
        var taken: Set<Int> = []
        func add(_ place: String, _ row: Int, _ pauseNames: Set<String>) {
            let text = readable(source[row])
            guard !taken.contains(row), !trimmed(text).isEmpty else { return }
            taken.insert(row)
            path.append(PathLine(
                place: place,
                number: row + 1,
                text: trimmed(source[row]),
                names: identifiers(in: text),
                pauseNames: pauseNames
            ))
        }

        // (1) the call site.
        for gate in outward.prefix(while: { $0 != render }) {
            for row in fullHeader(source, endingAt: gate) {
                add("the call site", row, sectionPause)
            }
        }
        for row in attachedModifiers(source, in: renderRange, anchor: end) {
            add("the call site", row, sectionPause)
        }
        let tail = statementTail(source, from: call, in: renderRange)
        if !tail.isEmpty {
            path.append(PathLine(
                place: "the call site",
                number: end + 1,
                text: tail,
                names: identifiers(in: tail),
                pauseNames: sectionPause
            ))
        }

        // (2) every member of the card that leads to the block holding the exit.
        var renders: Set<String> = [holder.name]
        var growing = true
        while growing {
            growing = false
            for entry in cardMembers where !renders.contains(entry.name) {
                let text = entry.range.map { readable(source[$0]) }.joined(separator: "\n")
                guard identifiers(in: text).contains(where: { renders.contains($0) })
                else { continue }
                renders.insert(entry.name)
                growing = true
            }
        }
        for entry in cardMembers
        where renders.contains(entry.name) && entry.name != holder.name {
            for row in entry.range { add("the card", row, cardPause) }
        }

        // (3) the block that holds the exit, up to and including the exit.
        for row in slice { add("the block that holds the exit", row, cardPause) }

        // (4) everything the three above name, followed to a fixpoint. Scoped
        // per view: both structs declare a `body` and a `company`, and one
        // shared namespace would drag the billing section's body — which reads
        // the pause on purpose, one card higher up — onto the cancel card's path.
        let sectionMembers = declarations(source, in: sectionRange)
        var seen: Set<String> = []
        var frontier: [(inCard: Bool, name: String)] = []
        for line in path {
            let inCard = line.place != "the call site"
            for name in line.names { frontier.append((inCard: inCard, name: name)) }
        }
        while let next = frontier.popLast() {
            let key = "\(next.inCard)|\(next.name)"
            guard !seen.contains(key) else { continue }
            seen.insert(key)
            let members = next.inCard ? cardMembers : sectionMembers
            let pauseNames = next.inCard ? cardPause : sectionPause
            for entry in members where entry.name == next.name {
                let rows = entry.range.lowerBound == holder.range.lowerBound
                    ? slice : Array(entry.range)
                for row in rows {
                    add("what it reaches", row, pauseNames)
                    for name in identifiers(in: readable(source[row])) {
                        frontier.append((inCard: next.inCard, name: name))
                    }
                }
            }
        }
        return path
    }

    /// # The property
    ///
    /// Nothing on the path from arrival to the exit may depend on the pause
    /// read.
    ///
    /// Not "may not be disabled by it" — may not DEPEND on it. Every escape
    /// this replaces worked by making some part of that path consult the pause
    /// state, and each of the guards below could only see the particular way it
    /// consulted it. A second chained `.disabled(`, one on the card a line
    /// lower, `canCancel` redefined to read the answer, a `guard` at the top of
    /// `handOff()`, a modifier on the `CancelCard(` call site: five mechanisms,
    /// one fact. This asks for the fact.
    ///
    /// # Proven against fifteen mutations, including all five escapes
    ///
    /// Each was applied to a copy of the screen and run through this walk; each
    /// produced an offender naming the line and the name it objected to. The
    /// FIVE that were found against the guards below are the first five:
    ///
    ///   a second `.disabled(checking)` chained under `.disabled(opening)`
    ///   `.disabled(checking)` on the card, one line below `leaving`'s brace
    ///   `canCancel` redefined as `… && read.answer != nil`
    ///   `guard read.answer != nil else { return }` first in `handOff()`
    ///   `.disabled(pauseKnown.answer == nil)` under the `CancelCard(` call
    ///
    /// and the ten nobody had thought of yet, which is the point:
    ///
    ///   `.disabled(pauseChecking)`, a name nothing declares — caught by name
    ///   `checking` only ASSIGNED the read, never initialised from it
    ///   `).disabled(pauseKnown.answer == nil)` inline on the closing line
    ///   `&& pauseKnown.answer == nil` on a CONTINUATION of the gate above
    ///   `} else if checking { ProgressView() }` inside `CancelCard.body`
    ///   a pause line rendered above the exit inside `leaving`
    ///   a covering `.overlay { … }` whose condition reads the pause
    ///   the press routed through a new helper that reads the pause
    ///   a `Group` wrapped round the exit carrying `.disabled(checking)`
    ///   `reasonQuestion`, which renders above the exit, gaining a pause branch
    ///
    /// Three changes that say nothing about the pause were run through it too
    /// and stayed clean: a new line inside the pause offer BELOW the exit, the
    /// word "read" appearing in the COPY above the button, and a branch above
    /// it on `detail`. The last of those is still refused by
    /// `testNothingBranchesOrOpensInFrontOfTheWayOut` on its own separate
    /// grounds, which is the division of labour: that guard counts presses,
    /// this one traces a dependency. A guard that fired on all three would be
    /// deleted within the week.
    ///
    /// The WALK is what those fifteen prove; no Swift compiler runs on the
    /// machine this was written on, so the assertion itself is first executed by
    /// CI's `Gate / iOS`.
    ///
    /// # What it costs
    ///
    /// A member of the cancel card may not mention the pause above the exit,
    /// and nothing the press reaches may either. If one of them ever genuinely
    /// must, this guard is the place to argue for it — which is the difference
    /// between a decision somebody made and a line that slipped in.
    func testNothingOnTheWayToTheExitConsultsThePauseRead() throws {
        guard let path = try theWayToTheExit() else { return }
        var offenders: [String] = []
        for line in path {
            // Either the value is derived from the read, or the name says so
            // itself — `pauseIsActive(company)` is declared in another file and
            // is nobody's local, so the closure above could never reach it.
            let hits = line.names.filter {
                line.pauseNames.contains($0) || $0.lowercased().contains("pause")
            }
            guard !hits.isEmpty else { continue }
            offenders.append(
                "\(line.place) — BillingSection.swift:\(line.number): \(line.text)"
                    + "   ← \(hits.joined(separator: ", "))"
            )
        }
        XCTAssertEqual(
            offenders, [String](),
            "\n\nOn the way to the exit:\n  \(offenders.joined(separator: "\n  "))\n\n"
                + "Nothing between landing on the billing screen and pressing \"\(exitLabel)\" "
                + "may consult the pause read. Not 'may not disable the button' — may not "
                + "CONSULT it: every escape this guard replaces worked by making some part of "
                + "that path ask about the pause, and a guard that lists the ways to ask is a "
                + "list somebody can add to. The read is welcome BELOW the exit, which is "
                + "where the offer renders and where the answer is computed. Above it, or "
                + "in anything the press reaches, a workspace whose read is slow or broken "
                + "is a workspace that cannot leave.\n"
        )
    }

    /// The walk above reads four places; this is what says it read them.
    ///
    /// A path that came back empty, or that swallowed the whole file, would
    /// pass the property forever. The four anchors are one line from each
    /// place, and the fifth assertion is the boundary that makes the guard
    /// usable at all: the pause offer renders BELOW the exit, so a walk that
    /// ran past the button would fail on the shipped screen — which is the same
    /// as having no guard.
    func testThePathToTheExitIsTheOneBeingRead() throws {
        guard let path = try theWayToTheExit() else { return }
        let source = try billingSource()
        let numbers = Set(path.map { $0.number })
        func row(_ needle: String) -> Int? {
            source.firstIndex(where: { code($0).contains(needle) }).map { $0 + 1 }
        }
        for needle in [
            "if company.subscriptionActive {",  // the call site
            "if !canCancel {",                  // the card
            exitLabel,                          // the block that holds the exit
            "guard canCancel else",             // what the press reaches
        ] {
            guard let line = row(needle) else {
                XCTFail("\"\(needle)\" is gone from the billing screen")
                continue
            }
            XCTAssertTrue(
                numbers.contains(line),
                "the path does not include \"\(needle)\" (BillingSection.swift:\(line))"
            )
        }
        guard let offer = row("PauseOfferNote(") else {
            XCTFail("the pause offer is gone from the cancel card")
            return
        }
        XCTAssertFalse(
            numbers.contains(offer),
            "the walk ran past the exit and into the pause offer, which renders below it"
        )
        XCTAssertTrue(
            path.contains { $0.pauseNames.contains("read") },
            "nothing on this screen is being treated as pause-derived — the value handed to "
                + "the cancel card is no longer being followed, so the property is vacuous"
        )
    }

    // MARK: - The scan is reading something

    /// A walk that matches nothing passes forever. Every other test here fails
    /// with "not found" rather than passing vacuously, but that only holds while
    /// the brace walk itself works — a string literal containing a brace would
    /// silently truncate every block it reads.
    func testTheScanIsActuallyReadingTheScreen() throws {
        let source = try billingSource()
        XCTAssertGreaterThan(source.count, 500, "expected the real billing screen")
        guard let found = try leavingBody() else { return }
        XCTAssertGreaterThan(
            found.body.count, 8, "`leaving` came back too small: \(found.body.count)"
        )
        XCTAssertGreaterThan(found.exit, 0, "the way out is the first thing in `leaving`?")
        XCTAssertNotNil(
            blockBody(source, startingWith: "private var cards: some View {"),
            "PlanCard's branch chain could not be read"
        )
        XCTAssertNotNil(
            blockBody(source, startingWith: "var body: some View {"),
            "the billing section's body could not be read"
        )
        guard let card = try cancelCardBody() else { return }
        XCTAssertGreaterThan(
            card.count, 5, "`CancelCard.body` came back too small: \(card.count)"
        )
        // The typed-price scan's second half: a slice that matched nothing would
        // pass forever, so it has to contain a sentence known to live there.
        let copy = try pauseCopySource()
        XCTAssertGreaterThan(copy.count, 100, "the pause copy slice came back too small")
        XCTAssertTrue(
            copy.contains(where: { $0.text.contains("a month holds your number") }),
            "the pause copy is not inside the slice the price scan reads"
        )
    }
}
