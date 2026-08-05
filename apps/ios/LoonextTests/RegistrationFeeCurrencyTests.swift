import XCTest
@testable import Loonext

/// #522 — the one card in this app whose every reader is definitionally
/// Canadian, and which quoted them a US price.
///
/// `RegistrationBlock` renders `EnableUsCard` only while `country == "CA"` and
/// `us_texting_enabled` is false. `api_create_company` writes
/// `billing_currency = 'cad'` for every CA workspace and the column is
/// `not null default 'usd'`, so there is no null row and no "pre-#328
/// workspace": the reader of that card is charged CA$39 and the card said $29,
/// on the screen whose only purpose is to take consent to that charge.
///
/// WHY THE ASSERTIONS COME IN PAIRS. The amounts here are the product's own
/// constants, so a single-currency assertion is one a hardcode reproduces —
/// "$39" typed into the button passes a test that only ever asks about CAD.
/// Every check below asks BOTH currencies about the same sentence and demands
/// the other currency's figure be absent, so one typed constant cannot satisfy
/// both halves. That is the strongest available shape for a function whose
/// return value IS the figure.
///
/// AND WHY A SOURCE SCAN AS WELL. The behaviour tests read
/// `enableUsTextingCopy`; they say nothing about whether the CARD calls it.
/// A view that ignored the function and typed the sentence again would pass
/// every one of them, which is the exact defect being fixed — so the card's
/// source is read too.
final class RegistrationFeeCurrencyTests: XCTestCase {
    // MARK: - The figure

    /// The fee is its own price book entry, in both currencies.
    ///
    /// PINNED SEPARATELY FROM THE PLAN ON PURPOSE. The fee and the Starter plan
    /// are the same amount in both currencies today, so an implementation that
    /// reached for `planPriceCents("starter", currency)` would render correctly
    /// right up until one of the two is repriced, and then be wrong with
    /// nothing failing. `testTheCopyReadsTheFeeBookAndNotThePlanBook` below is
    /// the half of this that a shared amount cannot fake.
    func testTheRegistrationFeeIsPricedInBothCurrencies() {
        XCTAssertEqual(usRegistrationFeeCents(.usd), 2900)
        XCTAssertEqual(usRegistrationFeeCents(.cad), 3900)
        XCTAssertNotEqual(
            usRegistrationFeeCents(.usd),
            usRegistrationFeeCents(.cad),
            "the fee lost its currency axis, so every Canadian reader is quoted "
                + "the other country's number again"
        )
    }

    // MARK: - The three sentences

    /// A Canadian reader is quoted CA$39 in all three places, and never $29.
    ///
    /// All three, because they are three separate chances to be wrong and the
    /// consent sentence is the one that matters most: the button is an offer,
    /// the confirmation is the agreement.
    func testEveryCanadianSentenceQuotesTheCanadianFee() {
        let cad = enableUsTextingCopy(.cad)
        for (surface, sentence) in labelled(cad) {
            XCTAssertTrue(
                sentence.contains("$39"),
                "the \(surface) does not quote the CA$39 this workspace is "
                    + "actually charged: \(sentence)"
            )
            XCTAssertFalse(
                sentence.contains("$29"),
                "the \(surface) quotes the US fee to a Canadian reader, who is "
                    + "the only reader this card has: \(sentence)"
            )
        }
    }

    /// The mirror. Without it, "$39" typed into the copy passes the test above.
    ///
    /// A USD workspace never actually sees this card — it is charged the fee
    /// with its first subscription rather than being offered it — so this is
    /// not a screen we are protecting. It is the half of the pair that makes
    /// the CAD half mean "resolved" instead of "some constant".
    func testTheUsdCopyIsTheMirrorSoNoSingleConstantSatisfiesBoth() {
        let usd = enableUsTextingCopy(.usd)
        for (surface, sentence) in labelled(usd) {
            XCTAssertTrue(
                sentence.contains("$29"),
                "the USD \(surface) lost the US figure: \(sentence)"
            )
            XCTAssertFalse(
                sentence.contains("$39"),
                "the USD \(surface) prints the CAD figure, so the copy is "
                    + "pinned to one currency rather than resolved: \(sentence)"
            )
        }
    }

    /// The whole sentence, not just the digits — a figure can be right and land
    /// in the wrong place. Pinned once per currency so a rewording is a
    /// deliberate edit here rather than a silent drift away from web's wording.
    func testTheSentencesReadTheWayWebsDo() {
        XCTAssertEqual(
            enableUsTextingCopy(.cad).buttonLabel,
            "Enable US texting: $39 one-time"
        )
        XCTAssertEqual(
            enableUsTextingCopy(.usd).buttonLabel,
            "Enable US texting: $29 one-time"
        )
        XCTAssertEqual(
            enableUsTextingCopy(.cad).confirmMessage,
            "A one-time $39 registration fee is charged to your card on file, "
                + "and we register your business with US carriers. Approval "
                + "usually takes 3 to 7 business days. We handle it and email "
                + "you when it's live."
        )
        XCTAssertEqual(
            enableUsTextingCopy(.cad).readOnlyLine,
            "Ask your account owner to enable US texting; it's a one-time $39 "
                + "carrier registration."
        )
    }

    // MARK: - The card, read from its source

    /// No price is typed into the registration card.
    ///
    /// The twin of `testNoPriceIsTypedIntoTheBillingScreen`, which watches
    /// BillingSection.swift and the pause copy and could never have seen this
    /// file — which is precisely how a flat "$29" survived #328 on it.
    ///
    /// It borrows that test's walk rather than writing a second one, and the
    /// borrowing is the point: the pattern this file reached for first ("a
    /// quote, then a `$`, then a digit") fired on `RegistrationRow`'s
    /// relative-date sentences, where the `$0` is a closure parameter inside an
    /// interpolation inside a literal. See `typesAPrice`.
    func testNoPriceIsTypedIntoTheRegistrationCard() throws {
        var offenders: [String] = []
        let lines = try registrationCardLines()
        for (index, line) in lines.enumerated() where typesAPrice(code(line)) {
            offenders.append(
                "RegistrationCard.swift:\(index + 1): "
                    + line.trimmingCharacters(in: .whitespaces)
            )
        }
        XCTAssertEqual(
            offenders, [String](),
            "\n\nTyped price(s):\n  " + offenders.joined(separator: "\n  ")
                + "\n\nThis card has no US readers. Its figures come from "
                + "`enableUsTextingCopy`, which resolves them through the "
                + "workspace's own `billing_currency`.\n"
        )
    }

    /// The card renders the resolved copy rather than composing its own.
    ///
    /// Three separate assertions rather than one, because the three sentences
    /// failed independently before: the button, the read-only line and the
    /// confirmation each held their own typed `$29`.
    func testTheCardRendersTheResolvedCopy() throws {
        let card = try enableUsCardSource()
        for member in ["buttonLabel", "readOnlyLine", "confirmMessage"] {
            XCTAssertTrue(
                card.contains("cardCopy.\(member)"),
                "the card stopped rendering `\(member)`, so that sentence is "
                    + "being composed somewhere a currency cannot reach it"
            )
        }
    }

    /// The currency has to be ASKED FOR, and asked for at every level.
    ///
    /// A default is how the defect gets back in without anybody typing a price:
    /// nothing at the call site has to mention money, so nothing does. The
    /// plan card learned this the same way — see
    /// `testThePlanCardReadsThePriceBookAndTheCallerHasToNameTheCurrency`.
    func testTheCurrencyIsAskedForRatherThanDefaulted() throws {
        let card = try enableUsCardSource()
        XCTAssertTrue(
            card.contains("let currency: BillingCurrency"),
            "the card no longer takes a currency at all"
        )
        XCTAssertFalse(
            card.contains("BillingCurrency ="),
            "the currency parameter grew a default, which quietly puts one "
                + "workspace's money in front of another's"
        )
        let copy = try topLevelDeclaration(
            try settingsLogicSource(),
            "func enableUsTextingCopy("
        )
        XCTAssertFalse(
            copy.contains("BillingCurrency ="),
            "`enableUsTextingCopy` grew a default currency"
        )
    }

    /// The call site hands over the WORKSPACE's currency, not a constant.
    ///
    /// The gap every other guard here leaves open. A card that resolves through
    /// a currency it was handed `.usd` for is wrong in exactly the way #522
    /// describes, and reads as correct at every point except this one line.
    func testTheCallSitePassesTheWorkspacesOwnCurrency() throws {
        let block = try topLevelDeclaration(
            try registrationCardSource(),
            "struct RegistrationBlock: View {"
        )
        XCTAssertTrue(
            block.contains("currency: company.billedIn"),
            "the enable-US card is no longer given the workspace's own "
                + "currency; `billedIn` is the resolved column, and anything "
                + "else on this line is a guess about somebody's invoice"
        )
        XCTAssertNil(
            block.range(of: "currency: \\.(usd|cad)", options: .regularExpression),
            "a literal currency reached the card, so one country's price is "
                + "being shown to every workspace again"
        )
    }

    /// The fee is read from the fee book, not from the plan book.
    ///
    /// The one substitution no amount assertion in this file can catch: the fee
    /// and Starter agree in both currencies today (2900/3900), so
    /// `planPriceCents("starter", currency)` produces byte-identical copy. It
    /// stops agreeing the first time either is repriced, and the failure would
    /// be a wrong price on a consent screen with a green test suite.
    func testTheCopyReadsTheFeeBookAndNotThePlanBook() throws {
        let copy = try topLevelDeclaration(
            try settingsLogicSource(),
            "func enableUsTextingCopy("
        )
        XCTAssertTrue(
            copy.contains("usRegistrationFeeCents("),
            "the fee sentence stopped reading the fee price book"
        )
        XCTAssertFalse(
            copy.contains("planPriceCents("),
            "the fee is being read out of the PLAN price book. They are the "
                + "same amount today and separate figures; the first repricing "
                + "of either makes this card lie."
        )
    }

    // MARK: - The scan is reading something

    /// A walk that matches nothing passes forever.
    ///
    /// Both halves, because both have been wrong. `typesAPrice` is asked about a
    /// line that IS a typed price and about the two shapes that merely look like
    /// one — the second of those is the false positive that a plain pattern
    /// produced here, on `RegistrationRow`, which has no money in it at all.
    /// Then the source walk is asked whether it came back with the card rather
    /// than an empty string, which is how every source assertion above would
    /// otherwise pass on a file that had been deleted.
    func testTheScanIsActuallyReadingTheCard() throws {
        XCTAssertTrue(
            typesAPrice(#"Button("Enable US texting: $29 one-time") { }"#),
            "the price scan stopped recognising the exact line #522 is about"
        )
        XCTAssertFalse(
            typesAPrice(#"return "Approved" + (detail.approved_at.map { " \(relativeTime($0)) ago" } ?? "")"#),
            "the scan calls a closure parameter inside an interpolation a price"
        )
        XCTAssertFalse(
            typesAPrice(#".sheet(isPresented: $confirming) {"#),
            "the scan calls a SwiftUI binding a price"
        )

        let card = try registrationCardSource()
        let lines = try registrationCardLines()
        XCTAssertGreaterThan(card.count, 500, "expected the real registration card")
        XCTAssertGreaterThan(
            lines.count, 50,
            "the card came back as too few lines to be the card"
        )
        let enableUs = try enableUsCardSource()
        XCTAssertTrue(
            enableUs.contains("SettingsRoleGate.canEnableUsTexting"),
            "the EnableUsCard slice is not the enable-US card"
        )
        XCTAssertLessThan(
            enableUs.count, card.count,
            "the slice ran past the struct, so `BillingCurrency =` could hide "
                + "anywhere in the file and still be found"
        )
    }

    // MARK: - Helpers

    /// The three sentences with names, so a failure says which one broke.
    private func labelled(_ copy: EnableUsTextingCopy) -> [(String, String)] {
        [
            ("button", copy.buttonLabel),
            ("confirmation", copy.confirmMessage),
            ("read-only line", copy.readOnlyLine),
        ]
    }

    /// A whole-line comment is prose, not code. This file's own doc comments
    /// name the wrong figure on purpose ("THE FEE IS NOT $29 HERE"), and a
    /// guard that could not tell that from a rendered sentence would force the
    /// reasoning out of the file the reasoning is about.
    private func code(_ line: String) -> String {
        line.trimmingCharacters(in: .whitespacesAndNewlines).hasPrefix("//")
            ? ""
            : line
    }

    /// Walk up to the repo's own copy of the sources. The test bundle lives in
    /// DerivedData, so a working directory is not something to guess at.
    private func iosSourceRoot() throws -> URL {
        var dir = URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent() // LoonextTests
            .deletingLastPathComponent() // ios
        dir.appendPathComponent("Loonext")
        guard FileManager.default.fileExists(atPath: dir.path) else {
            throw XCTSkip("iOS sources not present at \(dir.path)")
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

    private func registrationCardLines() throws -> [String] {
        try registrationCardSource().components(separatedBy: "\n")
    }

    private func enableUsCardSource() throws -> String {
        try topLevelDeclaration(
            try registrationCardSource(),
            "private struct EnableUsCard: View {"
        )
    }

    /// A top-level declaration, from its first line to the brace that closes it
    /// at column 0.
    private func topLevelDeclaration(
        _ source: String,
        _ declaration: String
    ) throws -> String {
        guard let start = source.range(of: declaration) else {
            throw RegistrationCardSourceMissing.declaration(declaration)
        }
        let rest = source[start.lowerBound...]
        guard let end = rest.range(of: "\n}\n") else {
            throw RegistrationCardSourceMissing.closingBrace
        }
        return String(rest[..<end.upperBound])
    }
}

private enum RegistrationCardSourceMissing: Error {
    case declaration(String)
    case closingBrace
}
