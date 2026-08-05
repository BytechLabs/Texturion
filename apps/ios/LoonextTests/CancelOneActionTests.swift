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
/// `CancelCard.leaving` — what is above the exit and what may switch it off —
/// AND `CancelCard.body`, the chain that decides whether `leaving` is drawn at
/// all. The second was added after the first proved insufficient: every exit
/// assertion here was bounded by `leaving`, and
/// `} else if pauseChecking { ProgressView() } else { leaving }` in the body
/// above deletes the way out without touching a character of the block being
/// watched. It reads SettingsLogic.swift too, for the one property that lives
/// there rather than here: no price is ever typed.
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
            throw XCTSkip("iOS sources not present at \(file.path)")
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
            throw XCTSkip("iOS sources not present at \(file.path)")
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

    /// The lines INSIDE the block a declaration opens.
    ///
    /// Brace counting, which is enough here and nowhere near a Swift parser: no
    /// string literal in that file contains a brace, and interpolation uses
    /// parentheses. `testTheScanIsActuallyReadingTheScreen` is what notices if
    /// that stops being true and the walk starts returning nonsense.
    private func blockBody(_ lines: [String], startingWith needle: String) -> [String]? {
        guard let start = lines.firstIndex(where: { trimmed($0).hasPrefix(needle) })
        else { return nil }
        var depth = 0
        var started = false
        var body: [String] = []
        for index in start ..< lines.count {
            let line = code(lines[index])
            depth += count(line, "{")
            depth -= count(line, "}")
            if !started {
                // The header line opens the block but is not inside it.
                if depth > 0 { started = true }
                continue
            }
            if depth <= 0 { return body }
            body.append(lines[index])
        }
        return nil
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
        var words: [String] = []
        var current = ""
        for character in statement {
            if character.isLetter || character.isNumber || character == "_" {
                current.append(character)
            } else if !current.isEmpty {
                words.append(current)
                current = ""
            }
        }
        if !current.isEmpty { words.append(current) }
        return words.filter { word in
            !keywords.contains(word) && !(word.first?.isNumber ?? true)
        }
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

    private func typesAPrice(_ line: String) -> Bool {
        let characters = Array(line)
        var inString = false
        var interpolation = 0
        var index = 0
        while index < characters.count {
            let character = characters[index]
            if inString, character == "\\", index + 1 < characters.count,
               characters[index + 1] == "(" {
                interpolation += 1
                index += 2
                continue
            }
            if inString, interpolation > 0 {
                if character == "(" { interpolation += 1 }
                if character == ")" { interpolation -= 1 }
                index += 1
                continue
            }
            if character == "\\" {
                index += 2
                continue
            }
            if character == "\"" {
                inString.toggle()
                index += 1
                continue
            }
            if inString, character == "$", index + 1 < characters.count,
               characters[index + 1].isNumber {
                return true
            }
            index += 1
        }
        return false
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
