import Foundation
import XCTest
@testable import Loonext

/// #248 — the importer's contract, and the one thing it must never do.
///
/// Two properties are held here, and they failed in opposite directions.
///
/// The CONTRACT was written down four times: the server's constants, a
/// commented mirror in the web wizard, and a pair of typed literals on each
/// phone. `consent_attested` was written down once, on the server, so when
/// #226 made it mandatory (2026-07-28) every CSV import from this app answered
/// 422 with a sentence naming a form field the UI had no control for — and CI
/// stayed green, because the gate was only ever asserted from the server side.
/// So the values below are read out of `packages/shared/src/contact-import.ts`
/// and compared against the Swift port, and the port cannot quietly describe
/// last month's contract.
///
/// The ATTESTATION is the property no round-trip test can see: the server
/// cannot tell an attestation somebody made from one a client invented, so the
/// only place that can refuse to invent it is this app. The scans at the bottom
/// hold that structurally — one origin, in the sheet, behind a box that starts
/// unticked.
final class ContactImportConsentTests: XCTestCase {

    // MARK: - The port, against the TypeScript it was ported from

    func testTheSwiftPortMatchesTheSharedContract() throws {
        let source = try sharedContractSource()
        XCTAssertEqual(
            try tsString("CONTACT_IMPORT_CONSENT_FIELD", in: source),
            ContactImport.consentField
        )
        XCTAssertEqual(
            try tsString("CONTACT_IMPORT_CONSENT_VALUE", in: source),
            ContactImport.consentValue
        )
        var resolved: [String: Int] = [:]
        let rows = try tsInt("CONTACT_IMPORT_MAX_ROWS", in: source, resolved: resolved)
        resolved["CONTACT_IMPORT_MAX_ROWS"] = rows
        XCTAssertEqual(rows, ContactImport.maxRows)
        XCTAssertEqual(
            try tsInt("CONTACT_IMPORT_MAX_BYTES", in: source, resolved: resolved),
            ContactImport.csvMaxBytes
        )
        XCTAssertEqual(
            try tsInt("VCARD_IMPORT_MAX_CARDS", in: source, resolved: resolved),
            ContactImport.vcardMaxCards
        )
        XCTAssertEqual(
            try tsInt("VCARD_IMPORT_MAX_BYTES", in: source, resolved: resolved),
            ContactImport.vcardMaxBytes
        )
    }

    // MARK: - What goes on the wire

    func testAnAttestedImportPostsTheFieldTheServerAsksFor() {
        let fields = ContactImport.formFields(consentAttested: true, columns: [], properties: [])
        XCTAssertEqual(fields.count, 1)
        XCTAssertEqual(fields.first?.name, ContactImport.consentField)
        XCTAssertEqual(fields.first?.value, ContactImport.consentValue)
    }

    func testAnUnattestedImportPostsNothingAtAll() {
        // Not "false": a field that also carries a refusal is a field, not an
        // attestation, and the server's gate accepts only the one value.
        XCTAssertTrue(
            ContactImport.formFields(consentAttested: false, columns: [], properties: []).isEmpty
        )
    }

    func testTheAttestationReachesTheMultipartBodyTheImportDoorsPost() {
        let body = multipartFormBody(
            boundary: "B",
            fields: ContactImport.formFields(consentAttested: true, columns: [], properties: []),
            fileField: "file",
            fileName: "customers.csv",
            contentType: ContactImportKind.csv.contentType,
            fileBytes: Data("phone\n+14165550100\n".utf8)
        )
        let text = String(decoding: body, as: UTF8.self)
        XCTAssertTrue(
            text.contains(
                "Content-Disposition: form-data; name=\"\(ContactImport.consentField)\""
                    + "\r\n\r\n\(ContactImport.consentValue)\r\n"
            ),
            "got \(text)"
        )
    }

    func testAnUnattestedBodyCarriesNoTraceOfTheField() {
        let body = multipartFormBody(
            boundary: "B",
            fields: ContactImport.formFields(consentAttested: false, columns: [], properties: []),
            fileField: "file",
            fileName: "customers.csv",
            contentType: ContactImportKind.csv.contentType,
            fileBytes: Data()
        )
        let text = String(decoding: body, as: UTF8.self)
        XCTAssertFalse(text.contains(ContactImport.consentField), "got \(text)")
    }

    // MARK: - Every figure printed comes off the cap

    func testTheSizeMessagesAreDerivedFromTheCapsRatherThanTyped() {
        XCTAssertEqual(
            ContactImportKind.csv.sizeMessage,
            "CSV files must be " + ContactImport.megabytes(ContactImport.csvMaxBytes) + " or less."
        )
        XCTAssertEqual(
            ContactImportKind.vcard.sizeMessage,
            "vCard files must be " + ContactImport.megabytes(ContactImport.vcardMaxBytes)
                + " or less."
        )
    }

    func testMegabytesReadsOffAnyCapItIsGiven() {
        // The derivation itself, on values that are not the shipped ones — a
        // helper that only ever sees 2 MB and 5 MB could be returning a
        // constant and nothing would notice.
        XCTAssertEqual(ContactImport.megabytes(1024 * 1024), "1 MB")
        XCTAssertEqual(ContactImport.megabytes(7 * 1024 * 1024), "7 MB")
        // A cap that is not a whole megabyte keeps its decimal rather than
        // rounding UP to a size a file could pass and the server reject.
        XCTAssertEqual(ContactImport.megabytes(1536 * 1024), "1.5 MB")
    }

    func testTheLimitsLineNamesBothBoundsOfTheKindItDescribes() {
        let csv = ContactImportKind.csv.limitsLine
        XCTAssertTrue(csv.contains(ContactImport.maxRows.formatted()), "got \(csv)")
        XCTAssertTrue(
            csv.contains(ContactImport.megabytes(ContactImport.csvMaxBytes)),
            "got \(csv)"
        )
        let vcard = ContactImportKind.vcard.limitsLine
        XCTAssertTrue(vcard.contains(ContactImport.vcardMaxCards.formatted()), "got \(vcard)")
        XCTAssertTrue(
            vcard.contains(ContactImport.megabytes(ContactImport.vcardMaxBytes)),
            "got \(vcard)"
        )
        // Bounded honestly by kind: a vCard has cards, and calling them rows
        // sends somebody looking for a row number the file does not have.
        XCTAssertTrue(csv.contains("rows"), "got \(csv)")
        XCTAssertTrue(vcard.contains("cards"), "got \(vcard)")
    }

    // MARK: - #248: what the attestation could NOT cover

    /// The three fields the answer grew, off the wire names the server sends.
    ///
    /// The fixture reasons and note are opaque tokens rather than the shipped
    /// sentences. What is being held here is that whatever the server said
    /// arrives intact — and a test that typed the real sentence in would pass
    /// just as happily against a client that rewrote it into its own words.
    func testARefusedImportDecodesTheCountTheRowsAndTheNote() throws {
        let result = try importResult(
            """
            {
              "imported": 400, "updated": 0, "skipped": 1,
              "errors": [{"row": 7, "reason": "OPAQUE-SKIP-REASON"}],
              "consent_refused": 2,
              "consent_refusals": [
                {"row": 3, "reason": "OPAQUE-REFUSAL-A"},
                {"row": 9, "reason": "OPAQUE-REFUSAL-B"}
              ],
              "consent_refused_note": "OPAQUE-SERVER-NOTE"
            }
            """
        )
        XCTAssertEqual(result.consent_refused, 2)
        XCTAssertEqual(result.consent_refusals.map(\.row), [3, 9])
        XCTAssertEqual(result.consent_refused_note, "OPAQUE-SERVER-NOTE")

        let outcome = ImportConsentOutcome(result)
        XCTAssertFalse(outcome.isEmpty)
        XCTAssertEqual(outcome.refused, 2)
        XCTAssertEqual(outcome.rows.map(\.reason), ["OPAQUE-REFUSAL-A", "OPAQUE-REFUSAL-B"])
        // The server's sentence, not ours, whenever it sent one.
        XCTAssertEqual(outcome.note, "OPAQUE-SERVER-NOTE")
    }

    /// The answer this app shipped against before any of this existed still
    /// decodes.
    ///
    /// An older API build, a response a proxy trimmed — either one turning a
    /// finished import into a decode failure would lose the report for an
    /// import that already happened, and the rows are in the database whether
    /// this app can read the receipt or not.
    func testAnAnswerWithoutTheConsentFieldsStillDecodes() throws {
        let result = try importResult(
            """
            {"imported": 3, "updated": 1, "skipped": 0, "errors": []}
            """
        )
        XCTAssertEqual(result.consent_refused, 0)
        XCTAssertTrue(result.consent_refusals.isEmpty)
        XCTAssertNil(result.consent_refused_note)
        XCTAssertTrue(ImportConsentOutcome(result).isEmpty)
    }

    /// The fallback sentence is the shared contract's, read out of it.
    ///
    /// This is the only reason a second copy of that sentence is allowed to
    /// exist in Swift at all — see `ContactImport.consentRefusedNote`.
    func testTheFallbackRefusalNoteIsTheSharedContractsSentence() throws {
        XCTAssertEqual(
            try tsJoinedString("CONTACT_IMPORT_CONSENT_REFUSED_NOTE", in: sharedContractSource()),
            ContactImport.consentRefusedNote
        )
    }

    /// A refusal with no sentence attached still explains itself.
    ///
    /// A bare count is a number a reader guesses at, and the guess available is
    /// "the import quietly dropped people" — the opposite of what happened.
    func testRefusedRowsWithNoNoteFallBackToTheSharedSentence() throws {
        let outcome = try consentOutcome(refused: 1)
        XCTAssertFalse(outcome.isEmpty)
        XCTAssertEqual(outcome.note, ContactImport.consentRefusedNote)
    }

    /// Whichever of the two figures hides nothing wins.
    ///
    /// A count and a list can only disagree by the list being the shorter one,
    /// and every cause of that — a cap, a truncation, a dropped field — hides
    /// refusals. Reading either one alone lets the other silence a refusal that
    /// was reported.
    func testTheOutcomeTakesWhicheverFigureHidesNothing() throws {
        let listOnly = try importResult(
            """
            {"imported": 1, "updated": 0, "skipped": 0, "errors": [],
             "consent_refused": 0,
             "consent_refusals": [{"row": 2, "reason": "OPAQUE-REFUSAL-A"}]}
            """
        )
        XCTAssertEqual(ImportConsentOutcome(listOnly).refused, 1)
        XCTAssertFalse(ImportConsentOutcome(listOnly).isEmpty)

        let countOnly = try importResult(
            """
            {"imported": 1, "updated": 0, "skipped": 0, "errors": [],
             "consent_refused": 40, "consent_refusals": []}
            """
        )
        XCTAssertEqual(ImportConsentOutcome(countOnly).refused, 40)
        XCTAssertFalse(ImportConsentOutcome(countOnly).isEmpty)
    }

    /// A clean import says nothing about consent.
    ///
    /// An empty section headed with a raised hand on every successful import is
    /// how a section stops being read on the one import that has something in
    /// it.
    func testAnImportThatRefusedNothingDrawsNoConsentSection() throws {
        XCTAssertTrue(try consentOutcome(refused: 0).isEmpty)
    }

    /// The heading carries the number, and reads as a person when it is one.
    func testTheHeadingNamesHowManyPeopleWereRefused() throws {
        XCTAssertEqual(
            try consentOutcome(refused: 1).heading,
            "Consent not recorded for 1 person"
        )
        let many = 1200
        let heading = try consentOutcome(refused: many).heading
        // Grouped the way the reader's locale groups numbers, like every other
        // figure this screen prints — compared against the same formatter, so
        // this holds the number's presence in any locale and its grouping in
        // the ones that group.
        XCTAssertTrue(heading.contains(many.formatted()), "got \(heading)")
        XCTAssertTrue(heading.hasSuffix("people"), "got \(heading)")
    }

    /// A reported row prints the server's reason unchanged, under the word the
    /// file's own shape earns.
    ///
    /// Unchanged including the number inside it: prettifying that phone would
    /// mean picking an E.164 out of the server's sentence and putting a
    /// reformatted one back, which is a parse of prose — and what it breaks,
    /// silently, is the answer to "which of them?".
    func testAReportedRowPrintsTheServersReasonUnderTheRightWord() {
        let reported = ImportResult.ImportRowError(row: 12, reason: "OPAQUE-SERVER-REASON")
        XCTAssertEqual(ContactImportKind.csv.rowLine(reported), "Row 12 — OPAQUE-SERVER-REASON")
        XCTAssertEqual(ContactImportKind.vcard.rowLine(reported), "Card 12 — OPAQUE-SERVER-REASON")
    }

    /// The summary line counts volume and nothing else.
    ///
    /// Refused rows beside "skipped" read as a subtraction from what landed,
    /// and they landed — the attestation was refused, not the row.
    func testTheVolumeSummaryLeavesRefusalsOutOfTheCounts() throws {
        let result = try importResult(
            """
            {"imported": 400, "updated": 0, "skipped": 1, "errors": [],
             "consent_refused": 7, "consent_refusals": []}
            """
        )
        XCTAssertEqual(result.volumeSummary, "400 imported · 0 updated · 1 skipped")
        // 7 appears in none of the three volume figures, so its absence here is
        // the refused count's absence and nothing else.
        XCTAssertFalse(result.volumeSummary.contains("7"), "got \(result.volumeSummary)")
    }

    /// The report sheet PRINTS the refusal.
    ///
    /// This is the deliverable, and nothing else in this file can see it. Every
    /// assertion above holds a value that is correct in memory, and a sheet
    /// that built `ImportConsentOutcome` and drew none of it would satisfy all
    /// of them while the workspace learned nothing — which is #248's exact
    /// shape, one layer up.
    func testTheImportReportDrawsWhatTheAttestationCouldNotCover() throws {
        let file = try repoPath("apps/ios/Loonext/Features/Contacts/ContactsTab.swift")
        let code = try codeLines(of: file)
        for drawn in [
            "ImportConsentOutcome(",
            "consent.localizedHeading",
            "consent.localizedNote",
            "consent.rows",
        ] {
            XCTAssertTrue(
                code.contains(where: { $0.contains(drawn) }),
                "the import report must draw \(drawn) — a refusal the sheet computes and "
                    + "does not print is the silent refusal #248 exists to end"
            )
        }
    }

    // MARK: - The one origin of an attestation

    /// A candidate is unattested until somebody says otherwise.
    ///
    /// The default matters more than it looks: `ContactImportCandidate` is
    /// built in the file picker's completion, before any question has been
    /// asked, and a `true` default would make the pick itself the attestation.
    func testAFreshlyPickedFileCarriesNoAttestation() {
        let candidate = ContactImportCandidate(
            kind: .csv,
            fileName: "customers.csv",
            bytes: Data()
        )
        XCTAssertFalse(candidate.consentAttested)
        // #248 round 3: and nobody has said what any column or property is
        // either. A default of "every column accounted for" would be the same
        // defect as a pre-ticked attestation, one door along — and it is the
        // defect the shared `defaultContactImportColumns` handed every client
        // until H1, because that one used to fill the unrecognised columns with
        // `ignore` and hand back a complete declaration nobody had made.
        XCTAssertTrue(candidate.declaredColumns.isEmpty)
        XCTAssertTrue(candidate.declaredProperties.isEmpty)
        XCTAssertTrue(
            ContactImport.formFields(
                consentAttested: candidate.consentAttested,
                columns: candidate.declaredColumns,
                properties: candidate.declaredProperties
            ).isEmpty
        )
    }

    /// Exactly one line in the whole Contacts feature sets the attestation
    /// true, and it is inside the consent sheet.
    ///
    /// This is the guard the #226 failure earns. A call site that passed
    /// `consentAttested: true` of its own would compile, pass every other test
    /// here, and post a legal statement about several thousand strangers that
    /// nobody in the workspace ever made. Nothing downstream can catch it — the
    /// server sees a well-formed attestation either way.
    func testOnlyTheConsentSheetCanSayTheAttestationWasMade() throws {
        let feature = try repoPath("apps/ios/Loonext/Features/Contacts")
        var origins: [String] = []
        for file in try swiftFiles(under: feature) {
            for line in try codeLines(of: file) {
                let claimsIt = line.range(
                    of: "consentAttested\\s*[:=]\\s*true",
                    options: .regularExpression
                ) != nil
                if claimsIt {
                    origins.append(file.lastPathComponent + ": " + importScanTrim(line))
                }
            }
        }
        XCTAssertEqual(
            origins,
            ["ContactImport.swift: confirmed.consentAttested = true"],
            "an attestation may be created in exactly one place — the confirm "
                + "button of ContactImportConsentSheet, which cannot fire until "
                + "the box is ticked. Found: \(origins)"
        )
    }

    /// Both import doors post the shared fields rather than naming them.
    ///
    /// The field names living in one place is the entire reason the port
    /// exists, so a door that re-typed one would have re-created the #226
    /// defect while the contract test above went on passing. All three names
    /// are checked: #248 round 3 added the column declaration and the vCard
    /// property, and either one typed at a call site would fail the same way.
    func testBothImportDoorsGoThroughTheSharedContract() throws {
        let file = try repoPath("apps/ios/Loonext/Features/Contacts/ContactsData.swift")
        let code = try codeLines(of: file)
        let routed = code.filter { $0.contains("ContactImport.formFields(") }
        XCTAssertEqual(routed.count, 2, "expected the CSV and vCard doors to both route through it")
        for name in [
            ContactImport.consentField,
            ContactImport.columnField,
            ContactImport.vcardPropertyField,
        ] {
            XCTAssertTrue(
                code.allSatisfy { !$0.contains("\"\(name)\"") },
                "\(name) belongs to the shared contract, not to a call site"
            )
        }
    }

    // MARK: - Reading an answer

    /// Decoded from JSON rather than built with the memberwise initializer, so
    /// these cases exercise the wire NAMES too. A fixture assembled in Swift
    /// would go on passing after a field was renamed to something the server
    /// never sends.
    private func importResult(_ json: String) throws -> ImportResult {
        try JSONDecoder().decode(ImportResult.self, from: Data(json.utf8))
    }

    private func consentOutcome(refused: Int) throws -> ImportConsentOutcome {
        let result = try importResult(
            """
            {"imported": 0, "updated": 0, "skipped": 0, "errors": [],
             "consent_refused": \(refused), "consent_refusals": []}
            """
        )
        return ImportConsentOutcome(result)
    }

    // MARK: - Reading the repo

    private func repoPath(_ relative: String) throws -> URL {
        var dir = URL(fileURLWithPath: #filePath).deletingLastPathComponent()
        while true {
            let candidate = dir.appendingPathComponent(relative)
            if FileManager.default.fileExists(atPath: candidate.path) { return candidate }
            let parent = dir.deletingLastPathComponent()
            if parent.path == dir.path { break }
            dir = parent
        }
        // Fails rather than skips — see `MissingSource`.
        throw missingSource(relative)
    }

    private func sharedContractSource() throws -> String {
        let url = try repoPath("packages/shared/src/contact-import.ts")
        return try String(contentsOf: url, encoding: .utf8)
    }

    private func swiftFiles(under directory: URL) throws -> [URL] {
        let names = try FileManager.default.contentsOfDirectory(atPath: directory.path)
        return names.sorted()
            .filter { $0.hasSuffix(".swift") }
            .map { directory.appendingPathComponent($0) }
    }

    /// Source lines with whole-line comments removed.
    ///
    /// Without this, documenting the rule in the file the rule protects fails
    /// the scan that asked for the documentation, which leaves an author
    /// choosing between explaining the change and passing the check.
    private func codeLines(of file: URL) throws -> [String] {
        let text = try String(contentsOf: file, encoding: .utf8)
        return text.components(separatedBy: .newlines)
            .filter { !importScanTrim($0).hasPrefix("//") }
    }

    // MARK: - Reading the TypeScript

    private func tsExpression(_ name: String, in source: String) throws -> String {
        let pattern = "export const \(name) =([^;]+);"
        let regex = try NSRegularExpression(pattern: pattern)
        let range = NSRange(source.startIndex ..< source.endIndex, in: source)
        guard
            let match = regex.firstMatch(in: source, range: range),
            let captured = Range(match.range(at: 1), in: source)
        else {
            XCTFail("\(name) is not declared in packages/shared/src/contact-import.ts")
            throw MissingSource.at(name)
        }
        return importScanTrim(String(source[captured]))
    }

    /// A contract value written as adjacent string literals joined by `+`.
    ///
    /// `tsString` refuses anything that is not one plain literal, which is
    /// right for a field name and wrong for a sentence: the refusal note is
    /// three literals because it is a paragraph wrapped at the line width, and
    /// reading only the first would leave this test passing while the app
    /// printed a third of a sentence.
    ///
    /// The glue between the literals is checked to be nothing but `+` and
    /// whitespace. Without that, a value that became a template literal or a
    /// function call would be silently reduced to whichever quoted fragments it
    /// happened to contain, and the comparison below would then be against a
    /// sentence nobody ships.
    private func tsJoinedString(_ name: String, in source: String) throws -> String {
        let raw = try tsExpression(name, in: source)
        let literal = try NSRegularExpression(pattern: "\"((?:[^\"\\\\]|\\\\.)*)\"")
        let matches = literal.matches(
            in: raw,
            range: NSRange(raw.startIndex ..< raw.endIndex, in: raw)
        )
        var joined = ""
        var glue = ""
        var cursor = raw.startIndex
        for match in matches {
            guard
                let whole = Range(match.range, in: raw),
                let piece = Range(match.range(at: 1), in: raw)
            else { continue }
            glue += String(raw[cursor ..< whole.lowerBound])
            joined += String(raw[piece])
            cursor = whole.upperBound
        }
        glue += String(raw[cursor...])
        let leftovers = importScanTrim(glue.replacingOccurrences(of: "+", with: ""))
        guard !joined.isEmpty, leftovers.isEmpty else {
            XCTFail("\(name) is not a run of string literals joined by '+': \(raw)")
            throw MissingSource.at(name)
        }
        return joined
    }

    private func tsString(_ name: String, in source: String) throws -> String {
        let raw = try tsExpression(name, in: source)
        guard raw.hasPrefix("\""), raw.hasSuffix("\""), raw.count >= 2 else {
            XCTFail("\(name) is not a plain string literal: \(raw)")
            throw MissingSource.at(name)
        }
        return String(raw.dropFirst().dropLast())
    }

    /// Evaluate the integer expressions the contract actually uses: a literal,
    /// a product of literals (`2 * 1024 * 1024`), or a reference to a constant
    /// already read out of the same file (`VCARD_IMPORT_MAX_CARDS`).
    private func tsInt(_ name: String, in source: String, resolved: [String: Int]) throws -> Int {
        let raw = try tsExpression(name, in: source)
        var product = 1
        // `whereSeparator` rather than `split(separator: "*")`: a bare string
        // literal there is ambiguous between the Character and RegexComponent
        // overloads, and `*` means something else entirely to the second one.
        for part in raw.split(whereSeparator: { $0 == "*" }) {
            let token = importScanTrim(part)
            if let literal = Int(token) {
                product *= literal
            } else if let known = resolved[token] {
                product *= known
            } else {
                XCTFail("cannot evaluate \(name) = \(raw): unknown token '\(token)'")
                throw MissingSource.at(name)
            }
        }
        return product
    }
}

/// Deliberately not `extension String { var trimmed }`: a private top-level
/// name that later grows an internal twin in the app module is an invalid
/// redeclaration across `@testable import`, and this file only needs it four
/// times.
private func importScanTrim(_ value: some StringProtocol) -> String {
    value.trimmingCharacters(in: .whitespacesAndNewlines)
}
