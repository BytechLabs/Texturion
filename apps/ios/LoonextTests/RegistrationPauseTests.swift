import Foundation
import XCTest
@testable import Loonext

/// #525 — enabling US texting while the plan is paused.
///
/// `POST /v1/registration/enable-us` charges the one-time fee and submits the
/// 10DLC registration without reading `paused_at`, and that stays true: nothing
/// in the registration path is blocked by a pause, so the money buys a thing
/// that really happens, and a seasonal crew's quiet winter is the cheapest time
/// of year to spend a carrier review that takes days to weeks. The pause blocks
/// SENDING, which is a different sentence.
///
/// So this file holds two properties at once, and they pull in opposite
/// directions:
///
///   1. THE OFFER IS UNCHANGED. Same button, same price, same read-only line,
///      no state in which the control is withheld or disabled. Refusing would
///      cost the customer a week in spring for nothing.
///   2. THE COPY IS NOT UNCHANGED. Approval starts no texting while the plan is
///      paused, so the shipped promise — "we email you when it's live" — is one
///      this workspace's own send gate then breaks.
///
/// # Every assertion reads a shipped constant
///
/// The sentences are not retyped here. Each check compares
/// `enableUsTextingCopy` against ITSELF across the two pause states, or against
/// the price book, so a guard cannot pass by quoting a string nobody renders.
/// The one exception is the source scan, which is about the card rather than
/// the copy.
final class RegistrationPauseTests: XCTestCase {
    // MARK: - The offer survives the pause

    /// The control and its price are byte-identical either way.
    ///
    /// THIS IS THE "DO NOT GATE" RULE, said in the only place a client can say
    /// it. A paused workspace is sold the same thing at the same price; a
    /// re-worded button ("Enable later", "Resume first") or a second figure
    /// would both be this card inventing a refusal the API does not make.
    func testThePausedReaderIsOfferedTheSameThingAtTheSamePrice() {
        for currency in [BillingCurrency.cad, .usd] {
            let plain = enableUsTextingCopy(currency, paused: false)
            let held = enableUsTextingCopy(currency, paused: true)
            XCTAssertEqual(
                held.buttonLabel, plain.buttonLabel,
                "the pause changed the button. It may change what the card "
                    + "SAYS and never what it offers — enable-us is not gated "
                    + "on `paused_at`, and a button that reads differently is a "
                    + "refusal nobody implemented."
            )
            XCTAssertEqual(
                held.readOnlyLine, plain.readOnlyLine,
                "the read-only line branched on a fact its reader cannot even "
                    + "ask for: the pause read is owner-only, so a member's "
                    + "sentence can never be the paused one"
            )
        }
    }

    /// The fee on the paused card is still the workspace's own fee.
    ///
    /// Read from the price book rather than typed, so the assertion cannot be
    /// satisfied by the constant it is checking for.
    func testThePausedSentencesStillQuoteTheWorkspacesOwnFee() {
        for currency in [BillingCurrency.cad, .usd] {
            let fee = formatMonthlyCents(usRegistrationFeeCents(currency))
            let held = enableUsTextingCopy(currency, paused: true)
            XCTAssertTrue(
                held.buttonLabel.contains(fee),
                "the paused button lost the fee: \(held.buttonLabel)"
            )
            XCTAssertTrue(
                held.confirmMessage.contains(fee),
                "the paused confirmation — the sentence that takes the consent "
                    + "to the charge — no longer names the charge: "
                    + "\(held.confirmMessage)"
            )
        }
    }

    // MARK: - The copy does not survive the pause

    /// The note and the extra terms exist exactly when there is something to
    /// disclose.
    ///
    /// Both halves matter. Without the first, a paused workspace pays for a
    /// capability that does nothing yet and is told nothing about it. Without
    /// the second, every ordinary reader gets a paragraph about a state they
    /// are not in, on the card that is about to charge them.
    func testTheDisclosureIsPresentExactlyWhenTheWorkspaceIsPaused() {
        for currency in [BillingCurrency.cad, .usd] {
            let plain = enableUsTextingCopy(currency, paused: false)
            let held = enableUsTextingCopy(currency, paused: true)
            XCTAssertNil(
                plain.pausedNote,
                "an unpaused workspace is being shown the pause note"
            )
            XCTAssertEqual(
                plain.pausedTerms, [String](),
                "an unpaused workspace is agreeing to terms about a pause it is "
                    + "not in"
            )
            XCTAssertNotNil(
                held.pausedNote,
                "a paused workspace reads a US texting card that says nothing "
                    + "about its pause, which reads as the feature being shut "
                    + "to them — refusal arrived at by silence"
            )
            XCTAssertEqual(
                held.pausedTerms.count, 3,
                "the paused terms are no longer three separate facts. The money, "
                    + "the wait and the limit are chunked because only the last "
                    + "changes an expectation, and a clause at the end of a long "
                    + "paragraph is the one that gets skimmed."
            )
        }
    }

    /// The note invites; it does not re-price.
    ///
    /// The price belongs on the control that charges it, and once more where the
    /// charge is agreed to. A third figure in the paragraph above the button is
    /// how a card comes to quote two prices for one purchase, which is the
    /// defect `RegistrationFeeCurrencyTests` exists for.
    func testTheNoteCarriesNoPriceOfItsOwn() throws {
        for currency in [BillingCurrency.cad, .usd] {
            let note = try XCTUnwrap(
                enableUsTextingCopy(currency, paused: true).pausedNote
            )
            for (part, sentence) in [("heading", note.heading), ("detail", note.detail)] {
                XCTAssertFalse(
                    sentence.contains("$"),
                    "the note's \(part) grew a figure: \(sentence)"
                )
            }
        }
    }

    /// Exactly one of the three paused terms carries the fee, and it is this
    /// workspace's fee.
    ///
    /// One, not zero: the value argument — charged once ever, not again in
    /// spring — is worthless without the amount beside it. One, not two: a
    /// figure repeated is a figure that can come apart.
    func testTheMoneyTermQuotesTheWorkspacesOwnFeeExactlyOnce() {
        for currency in [BillingCurrency.cad, .usd] {
            let fee = formatMonthlyCents(usRegistrationFeeCents(currency))
            let priced = enableUsTextingCopy(currency, paused: true)
                .pausedTerms
                .filter { $0.contains(fee) }
            XCTAssertEqual(
                priced.count, 1,
                "\(priced.count) of the paused terms quote \(fee). Exactly one "
                    + "should: the line that says the charge lands today and "
                    + "lands once ever.\n\(priced.joined(separator: "\n"))"
            )
        }
    }

    /// The paused sheet DROPS the promise it cannot keep rather than qualifying
    /// it.
    ///
    /// The whole harm named in #525 is a sentence: "we email you when it's
    /// live", said to somebody for whom nothing goes live until they resume.
    /// Left in place with a correction beneath it, the false sentence is still
    /// on the screen — so the check is that the paused body is the shared terms
    /// and STOPS, computed by diffing the two shipped strings rather than by
    /// quoting either.
    func testThePausedSheetDropsThePromiseItCannotKeep() {
        let plain = enableUsTextingCopy(.cad, paused: false).confirmMessage
        let held = enableUsTextingCopy(.cad, paused: true).confirmMessage
        XCTAssertNotEqual(
            held, plain,
            "the sheet says the same thing to a paused workspace as to an "
                + "active one, so the consent is taken on a promise the send "
                + "gate then breaks"
        )
        XCTAssertTrue(
            plain.hasPrefix(held),
            "the two sheets no longer share their terms. What is charged, who "
                + "reviews it and how long that takes are the same agreement "
                + "either way — only the closing promise may differ."
        )
        let promise = String(plain.dropFirst(held.count))
        XCTAssertFalse(
            promise.isEmpty,
            "the running sheet lost its closing promise instead of the paused "
                + "one dropping it, so the check below has nothing to look for"
        )
        XCTAssertFalse(
            held.contains(promise),
            "the paused sheet still carries the promise (\(promise)), so the "
                + "false sentence is on the screen with its own correction "
                + "beside it"
        )
        let fee = formatMonthlyCents(usRegistrationFeeCents(.cad))
        XCTAssertTrue(
            held.contains(fee),
            "the paused sheet lost the fee along with the promise — it is the "
                + "sentence that takes the consent to the charge"
        )
    }

    /// The receipt keeps the news and adds the limit.
    ///
    /// The toast is the last thing anybody reads before leaving this screen. It
    /// must not lose "your registration started" in order to gain "and nothing
    /// sends yet" — a receipt that only says what did NOT happen reads as a
    /// failed purchase.
    func testThePausedReceiptKeepsTheNewsAndAddsTheLimit() {
        let plain = enableUsTextingCopy(.cad, paused: false).startedMessage
        let held = enableUsTextingCopy(.cad, paused: true).startedMessage
        XCTAssertNotEqual(
            held, plain,
            "the receipt after a paused purchase says exactly what an active "
                + "one says, so the last word on the screen is the wrong one"
        )
        // Terminal punctuation is the one character allowed to differ: the
        // unpaused sentence ends, the paused one carries on.
        let news = plain.trimmingCharacters(in: CharacterSet(charactersIn: ".;"))
        XCTAssertTrue(
            held.hasPrefix(news),
            "the paused receipt no longer opens with the whole unpaused one, so "
                + "the confirmation that anything happened at all was traded "
                + "away for the caveat: \(held)"
        )
        XCTAssertGreaterThan(
            held.count, plain.count,
            "the paused receipt is not longer than the plain one, so nothing "
                + "was actually added"
        )
    }

    // MARK: - The card, read from its source

    /// The pause reaches the COPY and nothing else.
    ///
    /// The sharpest available statement of rule 1 in this app. `pauseIsActive`
    /// is the one place the read becomes a Bool, and if the card asks it exactly
    /// once, on the line that builds the sentences, then there is no branch left
    /// in which a control can be withheld — no hidden button, no disabled state,
    /// no early return.
    func testThePauseDecidesTheWordsAndNothingElse() throws {
        let uses = try enableUsCardCodeLines()
            .filter { $0.contains("pauseIsActive(") }
        guard uses.count == 1 else {
            XCTFail(
                "\n\(uses.joined(separator: "\n"))\n\n"
                    + "`pauseIsActive` is asked \(uses.count) times in this "
                    + "card. It may be asked exactly once, to choose the "
                    + "sentences. A second reading is a control being decided "
                    + "by the pause, and enable-us is deliberately not gated on "
                    + "it — the fee buys a registration that completes while "
                    + "paused.\n"
            )
            return
        }
        XCTAssertTrue(
            uses[0].contains("enableUsTextingCopy("),
            "the pause is being read somewhere other than the copy: \(uses[0])"
        )
    }

    /// Nothing on this card is disabled or withheld by the pause.
    ///
    /// The twin of the test above, from the other side: that one says the fact
    /// is read once, this one says no control mentions it.
    func testNoControlOnThisCardIsGatedOnThePause() throws {
        let lines = try enableUsCardCodeLines()
        let gated = lines.filter { gatesOnThePause($0) }
        XCTAssertEqual(
            gated, [String](),
            "\n\n" + gated.joined(separator: "\n") + "\n\n"
                + "A control on the enable-US card is switched by the pause. "
                + "The route charges and submits without reading `paused_at`, "
                + "and refusing here would mean a seasonal crew waits out the "
                + "carrier review in spring instead of in the winter they were "
                + "not working anyway.\n"
        )
        XCTAssertFalse(
            lines.contains { $0.contains("mayBuyAddOns") },
            "the card reached for `mayBuyAddOns`, which fails closed for "
                + "controls whose ROUTE refuses a paused workspace. This route "
                + "does not refuse one, so failing closed here invents a "
                + "refusal that does not exist."
        )
    }

    /// The card renders the resolved copy rather than composing its own.
    ///
    /// `RegistrationFeeCurrencyTests` holds the three sentences that carry
    /// money; these are the two #525 added, and the note's placement.
    func testTheCardRendersTheResolvedPauseCopy() throws {
        let card = try enableUsCardSource()
        for member in ["pausedNote", "pausedTerms", "startedMessage"] {
            XCTAssertTrue(
                card.contains("cardCopy.\(member)"),
                "the card stopped rendering `\(member)`, so that sentence is "
                    + "being composed somewhere no test can read it"
            )
        }
        XCTAssertTrue(
            card.contains("PausedStartNote(note: pausedNote)"),
            "the note is computed and not drawn"
        )
        XCTAssertTrue(
            card.contains("PausedTermRow(text: term)"),
            "the extra terms are resolved and never reach the sheet, so the "
                + "consent is taken without them"
        )
        XCTAssertFalse(
            card.contains("US registration started"),
            "the toast is typed into the view again, where it cannot branch on "
                + "the pause and cannot be read by a test"
        )
        let lines = try enableUsCardCodeLines()
        let note = lines.firstIndex { $0.contains("PausedStartNote(note: pausedNote)") }
        let button = lines.firstIndex { $0.contains("Button(cardCopy.buttonLabel)") }
        XCTAssertNotNil(note, "the note is gone from the card body")
        XCTAssertNotNil(button, "the enable button is gone from the card body")
        if let note, let button {
            XCTAssertLessThan(
                note, button,
                "the note sits under the control it introduces. An answer "
                    + "printed below the button is an answer read by somebody "
                    + "who has already pressed it."
            )
        }
    }

    // MARK: - The read is a read, and knows it has not happened yet

    /// The card cannot claim it cannot ask when it simply has not asked.
    ///
    /// The billing screen's rule, one file over, for the same reason: the fourth
    /// case — `unaskable` — is a fact about the READER, produced only by
    /// `pauseReadFor` from the role. Stored in a view's own state it would cover
    /// the ordinary first frame of every visit, and `pauseIsActive(nil)` is
    /// false, so the disclosure would silently stop appearing for a paused
    /// workspace with nothing failing.
    func testTheCardStoresTheRequestRatherThanTheRead() throws {
        let lines = try registrationCardCodeLines()
        let stored = lines.filter { $0.contains("@State") && $0.contains("PauseRead") }
        XCTAssertEqual(
            stored, [String](),
            "\n\n" + stored.joined(separator: "\n") + "\n\n"
                + "The card's own pause state is a `PauseFetch`: three cases, "
                + "none of which is `unaskable`.\n"
        )
        let claims = lines.filter { $0.contains(".unaskable") }
        XCTAssertEqual(
            claims, [String](),
            "\n\n" + claims.joined(separator: "\n") + "\n\n"
                + "`.unaskable` has exactly one source — `pauseReadFor`, from "
                + "the role — and this card is not it.\n"
        )
        XCTAssertTrue(
            lines.contains { $0 == "@State private var pauseFetch: PauseFetch = .loading" },
            "the card no longer starts out having read nothing"
        )
    }

    /// A failed read is recorded, not swallowed.
    ///
    /// `GET /v1/billing/pause` throws rather than degrading to a null, on
    /// purpose. A `try?` here would turn "we could not check" into "not paused",
    /// which is the one sentence this card may not invent.
    func testTheFailedReadIsRecordedRatherThanSwallowed() throws {
        let card = try enableUsCardSource()
        XCTAssertTrue(
            card.contains("try await scope.repo.pauseOffer("),
            "the card no longer reads the pause at all, so the disclosure can "
                + "never appear"
        )
        XCTAssertFalse(
            card.contains("try? await scope.repo.pauseOffer("),
            "the throw was swallowed, so a read that failed is being rendered "
                + "as an answer that said 'not paused'"
        )
        XCTAssertTrue(
            card.contains("pauseFetch = .failed"),
            "a failed read leaves the card in whatever state it was already in "
                + "rather than recording the failure"
        )
    }

    // MARK: - The scan is reading something

    /// A walk that matches nothing passes forever.
    ///
    /// Both predicates are asked about a line that IS the offence and about the
    /// lines that merely look like one, then the slice is asked whether it came
    /// back with the card rather than with an empty string — which is how every
    /// source assertion above would otherwise pass on a file that had been
    /// deleted. `missingSource` FAILS rather than skips for the same reason.
    func testTheScanIsActuallyReadingTheCard() throws {
        XCTAssertTrue(
            gatesOnThePause("    .disabled(pauseIsActive(pauseKnown.answer))"),
            "the gate scan stopped recognising a control switched by the pause"
        )
        XCTAssertTrue(
            gatesOnThePause("                confirmEnabled: !paused,"),
            "the gate scan ignores the confirm sheet, where the consent is taken"
        )
        XCTAssertFalse(
            gatesOnThePause("                confirmEnabled: !pending,"),
            "the gate scan calls the in-flight flag a pause gate"
        )
        XCTAssertFalse(
            gatesOnThePause("    // the pause never disables this button"),
            "the gate scan reads a comment as code"
        )

        let card = try registrationCardSource()
        let slice = try enableUsCardSource()
        let lines = try registrationCardCodeLines()
        XCTAssertGreaterThan(card.count, 500, "expected the real registration card")
        XCTAssertGreaterThan(
            lines.count, 50,
            "the card came back as too few lines to be the card"
        )
        XCTAssertTrue(
            slice.contains("SettingsRoleGate.canEnableUsTexting"),
            "the slice is not the enable-US card"
        )
        XCTAssertLessThan(
            slice.count, card.count,
            "the slice ran past the struct, so anything it forbids could hide "
                + "elsewhere in the file and still be found"
        )
    }

    /// `paused` has to be ASKED FOR, at both levels.
    ///
    /// A defaulted `false` is how this regresses without anybody typing a
    /// sentence: nothing at the call site has to mention the pause, so nothing
    /// does, and the paused branch quietly stops being reachable. The currency
    /// learned this the same way — see
    /// `testTheCurrencyIsAskedForRatherThanDefaulted`.
    func testThePauseIsAskedForRatherThanDefaulted() throws {
        let copy = try topLevelDeclaration(
            try settingsLogicSource(),
            "func enableUsTextingCopy("
        )
        XCTAssertTrue(
            copy.contains("paused: Bool"),
            "`enableUsTextingCopy` no longer takes the pause, so one of its two "
                + "branches is unreachable"
        )
        XCTAssertFalse(
            copy.contains("paused: Bool ="),
            "`enableUsTextingCopy` grew a default pause state, which lets a "
                + "call site claim a workspace is not paused without anything "
                + "on that line mentioning the pause"
        )
    }

    // MARK: - Helpers

    /// Does this line switch a CONTROL on the pause?
    ///
    /// Two shapes, because the card has two: a SwiftUI `.disabled(…)` and the
    /// confirm sheet's own `confirmEnabled:`. `!pending` is the in-flight flag
    /// every sheet in this app carries and is not a gate, so the pause word is
    /// what separates them.
    private func gatesOnThePause(_ line: String) -> Bool {
        let source = code(line)
        guard source.contains(".disabled(") || source.contains("confirmEnabled:")
        else { return false }
        return source.lowercased().contains("pause")
    }

    /// A whole-line comment is prose, not code. This card's comments name the
    /// rejected designs on purpose ("`mayBuyAddOns` … is deliberately not
    /// used"), and a guard that could not tell that from a call would force the
    /// reasoning out of the file the reasoning is about.
    private func code(_ line: String) -> String {
        let trimmed = line.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.hasPrefix("//") ? "" : trimmed
    }

    /// Walk up to the repo's own copy of the sources. The test bundle lives in
    /// DerivedData, so a working directory is not something to guess at.
    private func iosSourceRoot() throws -> URL {
        var dir = URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent() // LoonextTests
            .deletingLastPathComponent() // ios
        dir.appendPathComponent("Loonext")
        guard FileManager.default.fileExists(atPath: dir.path) else {
            // Fails rather than skips — see `MissingSource`.
            throw missingSource(dir.path)
        }
        return dir
    }

    /// Line endings normalised: every pattern here is written with LF and a
    /// checkout on a Windows machine hands back CRLF.
    private func settingsSource(_ file: String) throws -> String {
        let path = try iosSourceRoot()
            .appendingPathComponent("Features")
            .appendingPathComponent("Settings")
            .appendingPathComponent(file)
        return try String(contentsOf: path, encoding: .utf8)
            .replacingOccurrences(of: "\r\n", with: "\n")
    }

    private func registrationCardSource() throws -> String {
        try settingsSource("RegistrationCard.swift")
    }

    private func settingsLogicSource() throws -> String {
        try settingsSource("SettingsLogic.swift")
    }

    private func registrationCardCodeLines() throws -> [String] {
        try registrationCardSource()
            .components(separatedBy: "\n")
            .map { code($0) }
            .filter { !$0.isEmpty }
    }

    private func enableUsCardSource() throws -> String {
        try topLevelDeclaration(
            try registrationCardSource(),
            "private struct EnableUsCard: View {"
        )
    }

    private func enableUsCardCodeLines() throws -> [String] {
        try enableUsCardSource()
            .components(separatedBy: "\n")
            .map { code($0) }
            .filter { !$0.isEmpty }
    }

    /// A top-level declaration, from its first line to the brace that closes it
    /// at column 0.
    private func topLevelDeclaration(
        _ source: String,
        _ declaration: String
    ) throws -> String {
        guard let start = source.range(of: declaration) else {
            throw RegistrationPauseSourceMissing.declaration(declaration)
        }
        let rest = source[start.lowerBound...]
        guard let end = rest.range(of: "\n}\n") else {
            throw RegistrationPauseSourceMissing.closingBrace
        }
        return String(rest[..<end.upperBound])
    }
}

private enum RegistrationPauseSourceMissing: Error {
    case declaration(String)
    case closingBrace
}
