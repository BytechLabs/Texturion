import Foundation
import XCTest
@testable import Loonext

/// #248 ROUND 3 — there is no classifier, and this is what proves it.
///
/// # What failed twice
///
/// Round one asked "does this dropped column mean do-not-contact" of the header
/// WORD — `optout`, `unsubscribe`, `^dnc$`. A file headed "Do Not Call" matched
/// nothing, was dropped without a word, the file's consent attestation was
/// written over the top, and a real text reached somebody that file said not to
/// contact.
///
/// Round two asked it of the SHAPE of the values — few distinct, short,
/// repeated across rows — which is a vocabulary of numbers, and it lost the same
/// way. Three independent verifiers got messages delivered through it: four
/// distinct answers walked past `FLAG_MAX_DISTINCT`, a 25-character value walked
/// past `FLAG_MAX_LENGTH`, the same answer on all sixty rows was skipped as a
/// "constant column", a four-row file failed the ratio, and a cell PAST THE END
/// of the header row was never looked at by any rule at all.
///
/// # What this file holds instead
///
/// The classifier is DELETED, not tuned, and the first test here says so out
/// loud in both languages — a shape test kept "as a hint" is the defect kept.
///
/// The PORT, against the TypeScript it was ported from: the header patterns
/// (now only a DEFAULT GUESS), both flag vocabularies, the wire field names,
/// and the wire FORMAT itself, rebuilt from the template read out of
/// `formatContactImportColumn` so a reordering on either side fails.
///
/// The COUNT coming from the data rather than the header row, which is what
/// makes a cell past the end of the header a column somebody has to answer for.
///
/// The WIRE, and the one property no round trip can see: the server cannot tell
/// a declaration a person made from one a client assembled out of its own
/// guesses, so the only place that can refuse to assemble it is this app.
final class ContactImportColumnsTests: XCTestCase {

    // MARK: - The classifier is gone

    /// Deleted rather than tuned, in the shared contract AND in the port.
    ///
    /// This is the one assertion that would have to be weakened to bring any of
    /// it back, which is exactly why it is first. "Keep it as a hint" is how a
    /// third round starts.
    func testTheShapeClassifierIsDeletedRatherThanTuned() throws {
        let shared = try tsCode(sharedHeadersSource()) + "\n" + tsCode(sharedContractSource())
        for gone in ["FLAG_MAX_DISTINCT", "FLAG_MAX_LENGTH", "FLAG_MIN_REPEAT", "unmappedFlagColumns"]
        {
            XCTAssertFalse(
                shared.contains(gone),
                "\(gone) is back in the shared contract — the shape test is what round two lost "
                    + "with, and a threshold kept as a hint is the defect kept"
            )
        }
        let feature = try repoPath("apps/ios/Loonext/Features/Contacts")
        for file in try swiftFiles(under: feature) {
            let code = try codeLines(of: file).joined(separator: "\n")
            for gone in ["flagMaxDistinct", "flagMaxLength", "flagMinRepeat", "unmappedFlagColumns"]
            {
                XCTAssertFalse(
                    code.contains(gone),
                    "\(file.lastPathComponent) still carries \(gone)"
                )
            }
        }
    }

    // MARK: - The port, against the TypeScript it was ported from

    /// Every header pattern, in order, character for character.
    ///
    /// Still asserted, and still load-bearing — but the thing it describes has
    /// changed job. This list is now the wizard's DEFAULT GUESS and nothing
    /// else: no column is dropped because it failed to match, and no import
    /// proceeds because it did. Order still matters for the guess itself:
    /// `opted_out` before `phone` so a do-not-text column is not claimed by
    /// phone's broad `number` pattern, and the split-name fields before `name`.
    func testTheHeaderPatternsAreTheSharedContractsInTheSharedOrder() throws {
        let shared = try sharedFieldPatterns()
        let ported = ContactColumns.fieldPatterns
        XCTAssertEqual(
            shared.map { $0.field },
            ported.map { $0.field.rawValue },
            "the Swift port lists different fields, or lists them in a different order, "
                + "from packages/shared/src/contact-import-headers.ts"
        )
        XCTAssertEqual(shared.count, ported.count)
        for (index, group) in shared.enumerated() where index < ported.count {
            XCTAssertEqual(
                group.patterns,
                ported[index].patterns,
                "the patterns for \(group.field) have drifted from the shared contract"
            )
        }
    }

    /// No pattern carries a backslash, and the port is only portable because of
    /// it.
    ///
    /// This repo has already paid for the lesson: `\b` is a BACKSPACE in Kotlin,
    /// where it compiled and silently matched nothing, and it does not compile
    /// at all in Swift. A shared pattern that grows an escape has to be
    /// hand-checked on three clients rather than copied, and this is what says
    /// so at the moment it is added rather than at the moment it misbehaves.
    func testNoSharedPatternCarriesAnEscapeThePortsCannotCopy() throws {
        for group in try sharedFieldPatterns() {
            for pattern in group.patterns {
                XCTAssertFalse(
                    pattern.contains("\\"),
                    "\(group.field) pattern /\(pattern)/ contains an escape — a literal copy is "
                        + "no longer safe on Kotlin or Swift, and each port needs re-deriving"
                )
            }
        }
    }

    /// The phone NUMBER wins over the label beside it.
    ///
    /// THE REAL HEADER ROW of a Google Contacts export, which is what a contractor
    /// leaving a personal phone actually has. Google writes every repeatable field
    /// as a pair — `Phone 1 - Type` holding "Mobile", then `Phone 1 - Value`
    /// holding the number — and the label comes FIRST. Patterns are tried in order
    /// and each scans the columns left to right, so the loose `phone` pattern
    /// claimed the labels: every row's number read "Mobile", every row was
    /// unusable, and the person was left to work out why.
    func testThePhoneNumberColumnWinsOverTheLabelBesideIt() {
        let google = [
            "Name",
            "Given Name",
            "Additional Name",
            "Family Name",
            "Group Membership",
            "E-mail 1 - Type",
            "E-mail 1 - Value",
            "Phone 1 - Type",
            "Phone 1 - Value",
            "Organization 1 - Name",
            "Notes",
        ]
        let found = ContactColumns.detect(google)
        XCTAssertEqual(found[.phone].map { google[$0] }, "Phone 1 - Value")
        XCTAssertEqual(found[.firstName].map { google[$0] }, "Given Name")
        XCTAssertEqual(found[.lastName].map { google[$0] }, "Family Name")
    }

    func testTheFlagVocabulariesAreTheSharedContracts() throws {
        let source = try sharedHeadersSource()
        XCTAssertEqual(try sharedStringList("FLAG_TRUE", in: source), ContactColumns.flagTrue)
        XCTAssertEqual(try sharedStringList("FLAG_FALSE", in: source), ContactColumns.flagFalse)
    }

    /// Every field name the declaration rides on, off the shared contract.
    func testTheDeclarationFieldNamesAreTheSharedContracts() throws {
        let source = try sharedContractSource()
        XCTAssertEqual(
            try tsString("CONTACT_IMPORT_COLUMN_FIELD", in: source),
            ContactImport.columnField
        )
        XCTAssertEqual(
            try tsString("CONTACT_IMPORT_IGNORE", in: source),
            ContactImport.ignoreAction
        )
        XCTAssertEqual(
            try tsString("CONTACT_IMPORT_VCARD_PROPERTY_FIELD", in: source),
            ContactImport.vcardPropertyField
        )
    }

    /// The properties the importer READS, so this app cannot go on asking about
    /// one the server has started reading — or, far worse, stop asking about
    /// one it has not.
    func testTheMappedVCardPropertiesAreTheSharedContracts() throws {
        XCTAssertEqual(
            try tsStringArray("VCARD_MAPPED_PROPERTIES", in: sharedContractSource()),
            VCardProperties.mapped
        )
    }

    /// THE WIRE FORMAT ITSELF, rebuilt from the shared template.
    ///
    /// `<index>:<action>:<header>` is not a constant anybody can compare, so the
    /// template is read out of `formatContactImportColumn` and the placeholders
    /// substituted. A port that emitted `<header>:<action>:<index>` would pass
    /// any test that only checked the pieces were present; this one fails,
    /// because the server splits on the first two colons and would read a header
    /// where it expects a position.
    func testTheColumnWireFormatIsTheSharedContractsTemplate() throws {
        let template = try tsTemplate("formatContactImportColumn", in: sharedContractSource())
        let rebuilt = template
            .replacingOccurrences(of: "${declaration.index}", with: "3")
            .replacingOccurrences(of: "${declaration.action}", with: ContactImport.ignoreAction)
            .replacingOccurrences(of: "${declaration.header}", with: "Route, North")
        XCTAssertFalse(
            rebuilt.contains("${"),
            "the shared template no longer names index/action/header: \(template)"
        )
        XCTAssertEqual(
            ContactImportColumnDeclaration(index: 3, action: .ignore, header: "Route, North").wire,
            rebuilt
        )
    }

    func testThePropertyWireFormatIsTheSharedContractsTemplate() throws {
        let template = try tsTemplate("formatVCardProperty", in: sharedContractSource())
        let rebuilt = template
            .replacingOccurrences(of: "${declaration.property}", with: "CATEGORIES")
            .replacingOccurrences(of: "${declaration.action}", with: ContactImport.ignoreAction)
        XCTAssertFalse(rebuilt.contains("${"), "got \(template)")
        XCTAssertEqual(
            VCardPropertyDeclaration(property: "CATEGORIES", action: .ignore).wire,
            rebuilt
        )
    }

    /// Every action token is a shipped name, and the two doors agree on the one
    /// word they share.
    func testEveryActionTokenComesOffAShippedName() {
        XCTAssertEqual(ContactImportColumnAction.ignore.wire, ContactImport.ignoreAction)
        XCTAssertEqual(VCardPropertyAction.ignore.wire, ContactImport.ignoreAction)
        XCTAssertEqual(
            VCardPropertyAction.optedOut.wire,
            ContactImportField.optedOut.rawValue
        )
        for field in ContactImportField.allCases {
            XCTAssertEqual(ContactImportColumnAction.field(field).wire, field.rawValue)
        }
    }

    /// Every field the contract knows is on the menu.
    ///
    /// A field added to `ContactImportField` and not to the menu would be a
    /// column somebody could not answer correctly — they would have to call it
    /// `ignore`, which is the one answer that lowers nobody's standing and
    /// carries nobody's phone number either.
    func testEveryFieldIsOfferedAsAnAnswerAlongsideIgnore() {
        let offered = ContactImportColumnAction.answers
        XCTAssertEqual(offered.count, ContactImportField.allCases.count + 1)
        for field in ContactImportField.allCases {
            XCTAssertTrue(offered.contains(.field(field)), "\(field.rawValue) is not on the menu")
        }
        XCTAssertEqual(offered.last, ContactImportColumnAction.ignore)
        // And every one of them says something a person can read. A menu of
        // raw wire names asks somebody to translate `opted_out`, and this is
        // the one screen where a translation error texts somebody who said stop.
        for action in offered {
            XCTAssertFalse(action.label.isEmpty)
            XCTAssertFalse(action.label.contains("_"), "got \(action.label)")
        }
    }

    // MARK: - Reading one cell

    func testAnEmptyCellIsAGenuineNo() {
        // A flag column marks the rows it means; the blanks are the others.
        XCTAssertEqual(ContactColumns.readFlag(""), false)
        XCTAssertEqual(ContactColumns.readFlag("   "), false)
        XCTAssertEqual(ContactColumns.readFlag(nil), false)
    }

    /// `x` is how a hand-kept spreadsheet marks the rows to block.
    ///
    /// The API's own truthy set left it out, so an x-marked opt-out column
    /// imported as nobody having opted out at all — the column was found, read,
    /// and understood as empty.
    func testXMarksTheRowsAHandKeptSheetBlocks() {
        XCTAssertEqual(ContactColumns.readFlag("x"), true)
        XCTAssertEqual(ContactColumns.readFlag("X"), true)
    }

    /// The third answer, and the whole reason this returns an optional.
    ///
    /// Anything-that-is-not-true-is-false is how a column of
    /// `Subscribed`/`Unsubscribed` becomes a column of nobody having opted out.
    func testAValueTheReaderDoesNotKnowIsNilRatherThanFalse() {
        XCTAssertNil(ContactColumns.readFlag("Unsubscribed"))
        XCTAssertNil(ContactColumns.readFlag("suppressed"))
        XCTAssertNil(ContactColumns.readFlag("2"))
    }

    /// The sentence that tells somebody how to fix the file names every value
    /// the reader would accept.
    func testTheSpokenVocabularyNamesEveryValueTheReaderAccepts() {
        let spoken = ContactColumns.flagVocabulary
        for value in ContactColumns.flagTrue + ContactColumns.flagFalse {
            XCTAssertTrue(spoken.contains(value), "\(value) is accepted and unspoken: \(spoken)")
        }
    }

    // MARK: - Parsing the file

    /// The line ending every spreadsheet export on Earth uses.
    ///
    /// Swift treats CRLF as ONE grapheme cluster, so a `Character`-by-character
    /// port of the server's parser never sees a `\r` at all: it falls through to
    /// the default branch, appends the line break into the field, and turns the
    /// whole file into a single enormous row with no columns to review. Every
    /// CSV a crew exports from Excel is that file.
    func testTheParserSurvivesTheWindowsLineEndingsEveryExportHas() {
        let text = [
            "phone,name",
            "+14165550100,Dave",
            "+14165550101,Sam",
            "",
        ].joined(separator: "\r\n")
        let file = ContactColumns.parse(text)
        XCTAssertEqual(file.headers, ["phone", "name"])
        XCTAssertEqual(file.rows.count, 2)
        XCTAssertEqual(file.rows.first, ["+14165550100", "Dave"])
    }

    func testTheParserKeepsQuotedCommasAndDropsTheByteOrderMark() {
        let text = "\u{FEFF}phone,name,notes\n"
            + "+14165550100,\"Chen, Dave\",\"said \"\"call first\"\"\"\n"
            + "\n"
            + "+14165550101,Sam,\n"
        let file = ContactColumns.parse(text)
        XCTAssertEqual(file.headers, ["phone", "name", "notes"])
        // The blank line is dropped, exactly as the server drops it — otherwise
        // the two disagree about which row is which.
        XCTAssertEqual(file.rows.count, 2)
        XCTAssertEqual(file.rows.first?[1], "Chen, Dave")
        XCTAssertEqual(file.rows.first?[2], "said \"call first\"")
    }

    // MARK: - How many columns this file has

    /// THE CELL PAST THE END OF THE HEADER ROW.
    ///
    /// Round two's every loop was bounded by `headers.length`, so this cell was
    /// not merely misread — no rule ever looked at it, and the message went out.
    /// A MIX on purpose: one row shorter than the header, one exactly as long,
    /// one longer.
    func testTheColumnCountComesFromTheDataAndNotTheHeaderRow() {
        let rows = [
            ["+14165550100"],
            ["+14165550101", "Sam"],
            ["+14165550102", "Ann", "DO NOT CALL"],
        ]
        XCTAssertEqual(ContactColumns.columnCount(headers: ["Phone", "Name"], rows: rows), 3)
        // No rows at all still has the header's columns to answer for.
        XCTAssertEqual(ContactColumns.columnCount(headers: ["Phone", "Name"], rows: []), 2)
    }

    /// And the review turns that cell into a column with a blank name, in its
    /// own position, waiting for an answer like every other.
    func testACellPastTheHeaderRowBecomesAColumnSomebodyHasToAnswerFor() {
        let review = ContactColumns.review(
            """
            Phone,Name
            +14165550100,Dave
            +14165550101,Ann,DO NOT CALL
            """
        )
        XCTAssertEqual(review.columns.count, 3)
        XCTAssertEqual(review.columns.last?.index, 2)
        XCTAssertEqual(review.columns.last?.header, "")
        // And the reader SEES what it holds, which is the whole point.
        XCTAssertEqual(review.columns.last?.samples, ["DO NOT CALL"])
        XCTAssertNil(review.columns.last?.guess)
    }

    /// An entirely empty column is still a column.
    ///
    /// The temptation is real — a stray trailing comma adds one nobody meant —
    /// and it is refused anyway. "A column with nothing in it decides nothing"
    /// is a rule about which columns may be skipped, and a rule about which
    /// columns may be skipped is what both earlier rounds lost to. One tap is
    /// the whole cost.
    func testAnEmptyColumnIsStillAColumnThatHasToBeAnsweredFor() {
        let review = ContactColumns.review(
            """
            Phone,Name,
            +14165550100,Dave,
            +14165550101,Sam,
            """
        )
        XCTAssertEqual(review.columns.count, 3)
        XCTAssertEqual(review.columns.last?.samples, [])
        // It says so for itself rather than showing a blank line, which reads
        // as a bug rather than as a column with nothing in it.
        XCTAssertEqual(review.columns.last?.sampleLine, ContactColumns.emptyColumnNote)
    }

    // MARK: - What a column holds

    /// The values, distinct, in file order, blanks dropped, bounded.
    ///
    /// A MIX: a blank, a repeat, a case-variant repeat, and more distinct values
    /// than the bound allows.
    func testTheSamplesAreWhatAReaderNeedsToDecideAndNoMore() {
        let rows = [
            ["a", "Active"],
            ["b", ""],
            ["c", "active"],
            ["d", "DO NOT CALL"],
            ["e", "Paused"],
            ["f", "Pending"],
            ["g", "Closed"],
            ["h", "Archived"],
        ]
        let samples = ContactColumns.samples(rows: rows, index: 1)
        XCTAssertEqual(samples.count, ContactColumns.sampleLimit)
        // The file's own spelling, the first time it used it — `Active` and
        // `active` are one value and the one to show is the one they wrote.
        XCTAssertEqual(
            samples,
            ["Active", "DO NOT CALL", "Paused", "Pending", "Closed"]
        )
    }

    /// The unreadable values, and the TOTAL past the bound.
    ///
    /// "and 12 more" is the difference between a reader believing they have seen
    /// the problem and knowing they have not. A MIX: readable, blank, and seven
    /// distinct unreadable values.
    func testTheUnreadableValuesAreBoundedAndTheirTotalIsNot() {
        var rows: [[String]] = [["a", "yes"], ["b", ""], ["c", "no"]]
        for word in ["Alpha", "Bravo", "Charlie", "Delta", "Echo", "Foxtrot", "Golf"] {
            rows.append(["x", word])
        }
        let unreadable = ContactColumns.unreadableValues(rows: rows, index: 1)
        XCTAssertEqual(unreadable.shown.count, ContactColumns.sampleLimit)
        XCTAssertEqual(unreadable.shown.first, "Alpha")
        XCTAssertEqual(unreadable.total, 7)
        // A column of nothing but yes/no/blank has nothing unreadable in it.
        XCTAssertEqual(
            ContactColumns.unreadableValues(rows: [["a", "y"], ["b", ""]], index: 1).total,
            0
        )
    }

    // MARK: - The whole review

    /// One MIX file whose columns take every branch there is.
    ///
    /// Recognised, unrecognised, one holding a decision spelled a way no
    /// vocabulary contains, an empty one, and one that exists only because a row
    /// runs past the header. Every one of them comes back, in order, with no
    /// gaps — because "which columns get reported" is the question that has no
    /// safe answer, so it is not asked.
    func testEveryColumnComesBackWhateverItLooksLike() {
        let review = ContactColumns.review(
            """
            Phone,Full Name,Contact Preference,Tags
            +14165550100,Dave Chen,Do not text this customer,
            +14165550101,Sam Ali,Happy to hear from us,
            +14165550102,Jo Park,,,DO NOT CALL
            """
        )
        XCTAssertEqual(review.rowCount, 3)
        XCTAssertEqual(review.columns.map(\.index), [0, 1, 2, 3, 4])
        XCTAssertEqual(
            review.columns.map(\.header),
            ["Phone", "Full Name", "Contact Preference", "Tags", ""]
        )
        // The 25-character sentence round two skipped for being longer than
        // `FLAG_MAX_LENGTH`, on the screen, in front of somebody.
        XCTAssertEqual(
            review.columns[2].samples,
            ["Do not text this customer", "Happy to hear from us"]
        )
        // The guess covers what it recognises and NOTHING else. The case is
        // spelled out because the left side is optional, and implicit member
        // lookup through an Optional is not something to bet a CI cycle on.
        XCTAssertEqual(review.columns[0].guess, ContactImportField.phone)
        XCTAssertEqual(review.columns[1].guess, ContactImportField.name)
        XCTAssertNil(review.columns[2].guess)
        XCTAssertNil(review.columns[3].guess)
        XCTAssertNil(review.columns[4].guess)
    }

    /// The same answer on every row — round two's "constant column", skipped as
    /// a property of the file. It was an agency's unsubscribe list.
    func testAColumnThatSaysTheSameThingOnEveryRowIsStillAsked() {
        let review = ContactColumns.review(
            """
            phone,name,Marketing Status
            +14165550100,Dave,Unsubscribed
            +14165550101,Sam,Unsubscribed
            +14165550102,Jo,Unsubscribed
            """
        )
        XCTAssertEqual(review.columns.count, 3)
        XCTAssertEqual(review.columns[2].samples, ["Unsubscribed"])
        XCTAssertNil(review.columns[2].guess)
    }

    /// Over the row cap there is nothing to ask about.
    ///
    /// The server refuses on the cap before it ever looks at the columns, and
    /// this app refuses before it uploads — so reading every cell of every
    /// column in a file that big is the phone doing exactly the work the cap
    /// exists to prevent.
    func testAFileOverTheRowCapIsCountedRatherThanCombedThrough() {
        var lines = ["phone,Marketing Status"]
        for index in 0 ... ContactImport.maxRows {
            lines.append("+1416555\(index)," + (index % 2 == 0 ? "active" : "paused"))
        }
        let review = ContactColumns.review(lines.joined(separator: "\n"))
        XCTAssertGreaterThan(review.rowCount, ContactImport.maxRows)
        XCTAssertTrue(review.columns.isEmpty)
    }

    /// The cap is said out loud off the cap itself, with the way out attached.
    func testTheRowCapMessageIsDerivedFromTheCapAndOffersTheWayOut() {
        let message = ContactImportKind.csv.rowCapMessage
        XCTAssertTrue(message.contains(ContactImport.maxRows.formatted()), "got \(message)")
        XCTAssertTrue(message.contains("Split the file"), "got \(message)")
        XCTAssertTrue(
            ContactImportKind.vcard.rowCapMessage
                .contains(ContactImport.vcardMaxCards.formatted())
        )
    }

    // MARK: - The do-not-text column somebody named

    /// The blocker comes out of the ANSWER, not out of the detector.
    ///
    /// Round two only ever checked the column its own patterns had claimed, so
    /// a `Description` column of prose could be handed to `opted_out` and
    /// nothing would look at it — and `Description` is claimed by `notes`, so
    /// its gate could not see the column at all. A MIX: three columns, one
    /// unreadable-but-not-declared, one declared and unreadable.
    func testTheColumnWhoseValuesMustBeReadableIsWhicheverOneWasNamed() {
        let columns = ContactColumns.review(
            """
            phone,Description,Region
            +14165550100,DO NOT CONTACT,North
            +14165550101,call before 9,South
            """
        ).columns

        // Nobody has called anything the do-not-text column yet.
        XCTAssertNil(ContactColumns.blocker(columns, answers: [:]))
        // `Region` is unreadable too, and irrelevant until somebody says it
        // decides who may be texted.
        XCTAssertNil(ContactColumns.blocker(columns, answers: [2: .ignore]))

        let blocked = ContactColumns.blocker(columns, answers: [1: .field(.optedOut)])
        XCTAssertEqual(blocked?.header, "Description")
        XCTAssertEqual(blocked?.values, ["DO NOT CONTACT", "call before 9"])
        XCTAssertEqual(blocked?.more, 0)
    }

    /// What the blocked card says names the column, what it holds, and what
    /// dismissing it instead would cost.
    func testABlockedFileNamesTheColumnItsValuesAndThePriceOfIgnoringIt() {
        let blocker = ContactImportBlocker(
            header: "Do Not Contact",
            values: ["Subscribed", "Unsubscribed"],
            more: 12
        )
        XCTAssertTrue(blocker.detail.contains("Do Not Contact"), "got \(blocker.detail)")
        XCTAssertTrue(blocker.detail.contains("Unsubscribed"), "got \(blocker.detail)")
        XCTAssertTrue(blocker.detail.contains("12 more"), "got \(blocker.detail)")
        XCTAssertTrue(
            blocker.detail.contains(ContactColumns.flagVocabulary),
            "the way out has to name the values the reader accepts; got \(blocker.detail)"
        )
        // The honest half: marking it Ignore DOES clear this card, and imports
        // every one of those people as textable. Somebody will otherwise find
        // that out by tapping it.
        XCTAssertTrue(
            blocker.detail.contains(ContactColumns.ignoreLabel),
            "got \(blocker.detail)"
        )
        // A column with no heading is named rather than wrapped in a pair of
        // quotes around nothing.
        XCTAssertTrue(
            ContactImportBlocker(header: "", values: ["x"], more: 0).detail
                .contains(ContactColumns.quoted("")),
            "got \(ContactImportBlocker(header: "", values: ["x"], more: 0).detail)"
        )
    }

    // MARK: - The default guess, and the half of it this app refuses to make

    /// #248 H1 — THE SHIP BLOCKER, as a fixture, in this client's terms.
    ///
    /// `Phone,Name,Notes` over a Notes column reading "DO NOT CALL - asked us to
    /// stop". `defaultContactImportColumns` answered `2:notes:Notes`, all three
    /// clients posted that with NO interaction, the server accepted a complete
    /// declaration, and the send returned 201 with a messages row created. Proved
    /// live.
    ///
    /// What has to be true here is not that the guess is absent — `notes` is the
    /// RIGHT guess, and a mapping cannot lower anybody's standing — but that the
    /// sentence saying stop is in front of somebody before anything is uploaded.
    /// It reaches the screen through `samples`, which is what `columnRow` prints
    /// under the header, so this is the fixture that fails if a future sampler
    /// stops carrying it.
    func testTheShipBlockerFileArrivesWithItsWarningOnTheScreen() {
        let review = ContactColumns.review(
            """
            Phone,Name,Notes
            +14165550100,Dave Chen,DO NOT CALL - asked us to stop
            +14165550101,Sam Ali,call before 9
            """
        )
        XCTAssertEqual(review.columns.count, 3)
        XCTAssertEqual(
            review.columns[2].samples,
            ["DO NOT CALL - asked us to stop", "call before 9"]
        )
        // The line the sheet actually draws, rather than the array behind it.
        XCTAssertTrue(
            review.columns[2].sampleLine.contains("DO NOT CALL - asked us to stop"),
            "got \(review.columns[2].sampleLine)"
        )
        // A MAPPING and never a dismissal: `notes` files the sentence against
        // the contact, where somebody reads it. `ignore` would have asserted the
        // column decides nothing — which is the claim nobody made.
        let guessed = ContactImport.guessedAnswers(review.columns)
        XCTAssertEqual(guessed[2], ContactImportColumnAction.field(.notes))
        XCTAssertEqual(guessed.count, 3)
        for action in guessed.values {
            XCTAssertNotEqual(action, ContactImportColumnAction.ignore)
        }
    }

    /// THE HEADLINE GUARD FOR THIS CLIENT.
    ///
    /// A pre-filled `ignore` is an answer this app invented, and somebody
    /// tapping Import without scrolling would then have dismissed a "Do Not
    /// Call" column they never saw. That is round one exactly, with a nicer
    /// screen — and it is what the shared `defaultContactImportColumns` did
    /// until round three narrowed its answer to a field or nothing.
    ///
    /// Asserted as a PROPERTY of the returned values rather than as the absence
    /// of a line, so it holds against however the next author writes this
    /// function: no value it hands back may be the dismissal.
    ///
    /// A recognised column is different in kind — the guess is about what the
    /// column IS, it is drawn as a chip anybody can change beside that column's
    /// own values, and getting it wrong cannot lower anybody's standing.
    func testTheGuessNeverAnswersAColumnItDidNotRecognise() {
        let columns = ContactColumns.review(
            """
            Phone,Full Name,Marketing Status,Tags
            +14165550100,Dave Chen,DO NOT CALL,vip
            +14165550101,Sam Ali,active,
            """
        ).columns
        let guessed = ContactImport.guessedAnswers(columns)
        XCTAssertEqual(guessed[0], ContactImportColumnAction.field(.phone))
        XCTAssertEqual(guessed[1], ContactImportColumnAction.field(.name))
        XCTAssertNil(guessed[2], "a column nobody recognised must arrive UNANSWERED")
        XCTAssertNil(guessed[3], "a column nobody recognised must arrive UNANSWERED")
        // And no guess is ever the dismissal itself.
        for action in guessed.values {
            XCTAssertNotEqual(
                action,
                ContactImportColumnAction.ignore,
                "this app may never invent an `ignore`"
            )
        }
    }

    /// AND THE SHARED GUESS CANNOT DISMISS ANYTHING EITHER.
    ///
    /// H1's second fault: `defaultContactImportColumns` answered `ignore` for
    /// every column its patterns did not recognise, which is the silent drop
    /// with extra steps — a function that manufactures a complete declaration is
    /// a classifier wearing a different hat. Round three narrowed its answer to
    /// a field or null, in the TYPE rather than in the body.
    ///
    /// Read from here because this port's justification rests on it. The
    /// docblock over `guessedAnswers` says the two ends now agree that a
    /// dismissal is an answer only a person can give; a shared function that
    /// quietly regained the ability would leave that paragraph describing a
    /// contract nobody keeps, on the one client whose reviewers cannot run the
    /// TypeScript.
    func testTheSharedGuessCannotDismissAColumnEither() throws {
        let source = try sharedContractSource()
        let action = try tsInterfaceMember("action", of: "ContactImportColumnGuess", in: source)
        XCTAssertFalse(
            action.contains(ContactImport.ignoreAction),
            "the shared guess can manufacture a dismissal again: \(action)"
        )
        XCTAssertTrue(
            action.contains("null"),
            "a column the detector did not recognise has to come back with NO answer, which is "
                + "the only thing that puts it in front of somebody; got \(action)"
        )
        // And the function still answers in that type rather than in the
        // declaration's, which differs by exactly the token above.
        XCTAssertTrue(
            tsCode(source).contains("): ContactImportColumnGuess[] {"),
            "defaultContactImportColumns no longer returns the guess type, so the narrowing "
                + "above may no longer describe what it hands a client"
        )
    }

    /// A column nobody answered can never reach the wire.
    ///
    /// The mirror of the guess above, one layer down: even if a gate were moved,
    /// the list that goes on the wire is built by filtering on answers rather
    /// than by walking the columns. A MIX: one answered as a field, one as
    /// ignore, one not at all.
    func testAColumnNobodyAnsweredIsNeverDeclared() {
        let columns = [
            ContactImportColumn(index: 0, header: "Phone", samples: ["+1416"], guess: .phone),
            ContactImportColumn(index: 1, header: "Marketing Status", samples: ["DO NOT CALL"]),
            ContactImportColumn(index: 2, header: "Tags", samples: ["vip"]),
        ]
        let declared = ContactImport.declarations(
            columns,
            answers: [0: .field(.phone), 2: .ignore]
        )
        XCTAssertEqual(declared.map(\.index), [0, 2])
        XCTAssertEqual(declared.map(\.action), [.field(.phone), .ignore])
        XCTAssertEqual(declared.map(\.header), ["Phone", "Tags"])
        XCTAssertTrue(ContactImport.declarations(columns, answers: [:]).isEmpty)
    }

    /// The header goes on the wire as the FILE spells it, including a nameless
    /// column's empty string.
    ///
    /// The server compares it against the header at that index and refuses a
    /// declaration describing some other file. A client that sent a tidied-up
    /// name — or "column 3" for a blank one — would be refused for a file it had
    /// read correctly.
    func testTheDeclaredHeaderIsTheFilesOwnSpelling() {
        let columns = [
            ContactImportColumn(index: 0, header: "Route, North", samples: ["a"]),
            ContactImportColumn(index: 1, header: "", samples: ["DO NOT CALL"]),
        ]
        let declared = ContactImport.declarations(columns, answers: [0: .ignore, 1: .ignore])
        XCTAssertEqual(
            declared.map(\.wire),
            [
                "0:" + ContactImport.ignoreAction + ":Route, North",
                "1:" + ContactImport.ignoreAction + ":",
            ]
        )
    }

    // MARK: - What goes on the wire

    func testEveryDeclaredColumnPostsItsOwnFieldUnderTheSharedName() {
        let fields = ContactImport.formFields(
            consentAttested: true,
            columns: [
                ContactImportColumnDeclaration(index: 0, action: .field(.phone), header: "Phone"),
                ContactImportColumnDeclaration(index: 1, action: .ignore, header: "Route, North"),
            ],
            properties: []
        )
        XCTAssertEqual(fields.count, 3)
        XCTAssertEqual(fields.first?.name, ContactImport.consentField)
        XCTAssertEqual(
            fields.dropFirst().map { $0.name },
            [ContactImport.columnField, ContactImport.columnField]
        )
        // The header exactly as the file spelled it, comma and all — the field
        // is repeated rather than delimited precisely so a header containing a
        // comma has no quoting rule to get wrong.
        XCTAssertEqual(
            fields.dropFirst().map { $0.value },
            [
                "0:" + ContactImportField.phone.rawValue + ":Phone",
                "1:" + ContactImport.ignoreAction + ":Route, North",
            ]
        )
    }

    /// A MIX at the vCard door: an attestation, no columns, two properties.
    func testEveryDeclaredPropertyPostsItsOwnFieldUnderTheSharedName() {
        let fields = ContactImport.formFields(
            consentAttested: true,
            columns: [],
            properties: [
                VCardPropertyDeclaration(property: "CATEGORIES", action: .optedOut),
                VCardPropertyDeclaration(property: "EMAIL", action: .ignore),
            ]
        )
        XCTAssertEqual(fields.map { $0.name }, [
            ContactImport.consentField,
            ContactImport.vcardPropertyField,
            ContactImport.vcardPropertyField,
        ])
        XCTAssertEqual(
            fields.dropFirst().map { $0.value },
            [
                "CATEGORIES:" + ContactImportField.optedOut.rawValue,
                "EMAIL:" + ContactImport.ignoreAction,
            ]
        )
    }

    func testEachDeclarationReachesTheMultipartBodyAsItsOwnPart() {
        let body = multipartFormBody(
            boundary: "B",
            fields: ContactImport.formFields(
                consentAttested: true,
                columns: [
                    ContactImportColumnDeclaration(index: 0, action: .field(.phone), header: "Phone"),
                    ContactImportColumnDeclaration(index: 1, action: .ignore, header: "Route, North"),
                ],
                properties: []
            ),
            fileField: "file",
            fileName: "customers.csv",
            contentType: ContactImportKind.csv.contentType,
            fileBytes: Data("phone\n+14165550100\n".utf8)
        )
        let text = String(decoding: body, as: UTF8.self)
        let disposition = "Content-Disposition: form-data; name=\"\(ContactImport.columnField)\""
        XCTAssertEqual(
            text.components(separatedBy: disposition).count - 1,
            2,
            "each declared column is its own part; got \(text)"
        )
        XCTAssertTrue(
            text.contains(
                disposition + "\r\n\r\n1:" + ContactImport.ignoreAction + ":Route, North\r\n"
            ),
            "got \(text)"
        )
    }

    // MARK: - The gate

    /// Nothing is uploaded until every column has an answer.
    ///
    /// A MIX: two columns, answered one at a time.
    func testNothingIsUploadedUntilEveryColumnHasBeenAnswered() {
        let candidate = staged(
            columns: [
                ContactImportColumn(index: 0, header: "Phone", samples: ["+1416"], guess: .phone),
                ContactImportColumn(index: 1, header: "Marketing Status", samples: ["DO NOT CALL"]),
            ]
        )
        XCTAssertFalse(mayImport(candidate, attested: true, columns: [:]))
        XCTAssertFalse(mayImport(candidate, attested: true, columns: [0: .field(.phone)]))
        XCTAssertTrue(
            mayImport(candidate, attested: true, columns: [0: .field(.phone), 1: .ignore])
        )
    }

    /// The same rule at the vCard door, which had no rule at all.
    func testNothingIsUploadedUntilEveryVCardPropertyHasAnAnswer() {
        var candidate = staged(columns: [])
        candidate.properties = [
            VCardProperty(name: "CATEGORIES", cards: 3, samples: ["DNC"]),
            VCardProperty(name: "EMAIL", cards: 40, samples: ["dave@example.com"]),
        ]
        XCTAssertFalse(mayImport(candidate, attested: true, properties: [:]))
        XCTAssertFalse(
            mayImport(candidate, attested: true, properties: ["CATEGORIES": .optedOut])
        )
        XCTAssertTrue(
            mayImport(
                candidate,
                attested: true,
                properties: ["CATEGORIES": .optedOut, "EMAIL": .ignore]
            )
        )
    }

    func testAnUnattestedFileIsStillRefusedHoweverCompleteTheDeclarationIs() {
        let candidate = staged(
            columns: [ContactImportColumn(index: 0, header: "Phone", samples: ["+1416"])]
        )
        XCTAssertFalse(mayImport(candidate, attested: false, columns: [0: .field(.phone)]))
    }

    /// A file whose named do-not-text column cannot be read stays refused,
    /// however completely the rest is answered.
    func testANamedDoNotTextColumnThatCannotBeReadRefusesTheWholeFile() {
        let candidate = staged(
            columns: [
                ContactImportColumn(index: 0, header: "Phone", samples: ["+1416"], guess: .phone),
                ContactImportColumn(
                    index: 1,
                    header: "Do Not Contact",
                    samples: ["Subscribed", "Unsubscribed"],
                    guess: .optedOut,
                    unreadable: ["Subscribed", "Unsubscribed"],
                    unreadableCount: 2,
                    values: ["Subscribed", "Unsubscribed"],
                    total: 2
                ),
            ]
        )
        let answered: [Int: ContactImportColumnAction] = [0: .field(.phone), 1: .field(.optedOut)]
        XCTAssertFalse(mayImport(candidate, attested: true, columns: answered))
        // The conceded case, held explicitly so nobody mistakes it for a bug:
        // a person who has read those values on the screen and calls the column
        // `ignore` anyway is making an informed claim, and this app cannot tell
        // that apart from a correct one. The silent case is what is closed.
        XCTAssertTrue(
            mayImport(candidate, attested: true, columns: [0: .field(.phone), 1: .ignore])
        )
    }

    /// The gate and the sentence under the button are one function.
    ///
    /// A grey primary with nothing beside it is a dead end, and this screen is
    /// somebody's first day by definition. A MIX walking every refusal in order,
    /// then the answer that clears them all.
    func testEveryRefusalHasASentenceAndAClearedFileHasNone() {
        var candidate = staged(
            columns: [
                ContactImportColumn(
                    index: 0,
                    header: "Do Not Contact",
                    samples: ["Unsubscribed"],
                    guess: .optedOut,
                    unreadable: ["Unsubscribed"],
                    unreadableCount: 1,
                    values: ["Unsubscribed"],
                    total: 1
                ),
                ContactImportColumn(index: 1, header: "Tags", samples: ["vip"]),
            ]
        )
        candidate.properties = [VCardProperty(name: "CATEGORIES", cards: 1, samples: ["DNC"])]

        let blocked = ContactImport.gateReason(
            candidate,
            attested: true,
            columnAnswers: [0: .field(.optedOut), 1: .ignore],
            propertyAnswers: ["CATEGORIES": .ignore]
        )
        XCTAssertEqual(
            blocked,
            ContactImportBlocker(header: "Do Not Contact", values: ["Unsubscribed"], more: 0).wayOut
        )

        XCTAssertEqual(
            ContactImport.gateReason(
                candidate,
                attested: true,
                columnAnswers: [0: .ignore],
                propertyAnswers: ["CATEGORIES": .ignore]
            ),
            ContactColumns.unansweredReason(1)
        )
        XCTAssertEqual(
            ContactImport.gateReason(
                candidate,
                attested: true,
                columnAnswers: [0: .ignore, 1: .ignore],
                propertyAnswers: [:]
            ),
            VCardProperties.unansweredReason(1)
        )
        XCTAssertEqual(
            ContactImport.gateReason(
                candidate,
                attested: false,
                columnAnswers: [0: .ignore, 1: .ignore],
                propertyAnswers: ["CATEGORIES": .ignore]
            ),
            ContactImport.attestationReason
        )
        XCTAssertNil(
            ContactImport.gateReason(
                candidate,
                attested: true,
                columnAnswers: [0: .ignore, 1: .ignore],
                propertyAnswers: ["CATEGORIES": .ignore]
            )
        )
    }

    /// The counter over the list, and the bulk answer under it.
    func testTheCounterAndTheBulkAnswerCountWhatIsLeft() {
        XCTAssertEqual(ContactColumns.answeredLine(answered: 3, total: 6), "3 of 6 answered")
        XCTAssertTrue(ContactColumns.ignoreRestLabel(1).contains("1 column"))
        XCTAssertTrue(ContactColumns.ignoreRestLabel(4).contains("4 columns"))
        XCTAssertTrue(VCardProperties.ignoreRestLabel(1).contains("1 property"))
        XCTAssertTrue(VCardProperties.ignoreRestLabel(3).contains("3 properties"))
        // And what pressing it asserts is spelled out, off the one phrase.
        XCTAssertTrue(
            ContactColumns.ignoreMeaning.contains(ContactColumns.ignoreAssertion),
            "got \(ContactColumns.ignoreMeaning)"
        )
        XCTAssertTrue(
            ContactColumns.ignoreMeaning.contains(ContactColumns.ignoreLabel),
            "got \(ContactColumns.ignoreMeaning)"
        )
    }

    /// #228: the model helpers stay usable from pure tests and wire code with
    /// their established English defaults, while the sheet can explicitly ask
    /// for the reader's app language.
    func testTheColumnAndPropertyCopyHasFrenchTwinsWithoutChangingEnglishDefaults() {
        let fr = MessageLocale.frCA

        XCTAssertEqual(ContactImportField.phone.label, "Phone")
        XCTAssertEqual(ContactImportField.phone.localizedLabel(fr), "Téléphone")
        XCTAssertEqual(ContactImportField.optedOut.label, "Do not text")
        XCTAssertEqual(ContactImportField.optedOut.localizedLabel(fr), "Ne pas texter")

        let column = ContactImportColumn(index: 3, header: "", samples: [])
        XCTAssertEqual(column.title, "Column 4 — no heading")
        XCTAssertEqual(column.localizedTitle(fr), "Colonne 4 — sans en-tête")
        XCTAssertEqual(column.sampleLine, "every row leaves this blank")
        XCTAssertEqual(
            column.line(showingAll: false, locale: fr),
            "chaque ligne laisse cette colonne vide"
        )
        XCTAssertEqual(ContactColumns.ignoreRestLabel(4), "Ignore the 4 columns left")
        XCTAssertEqual(
            ContactColumns.ignoreRestLabel(4, locale: fr),
            "Ignorer les 4 colonnes restantes"
        )

        let property = VCardProperty(name: "", cards: 2, samples: [])
        XCTAssertEqual(property.title, "A property with no name")
        XCTAssertEqual(property.localizedTitle(fr), "Un élément sans nom")
        XCTAssertEqual(property.cardLine, "on 2 cards")
        XCTAssertEqual(property.localizedCardLine(fr), "sur 2 fiches")
        XCTAssertEqual(VCardPropertyAction.optedOut.label, "Don't text any card with it")
        XCTAssertEqual(
            VCardPropertyAction.optedOut.localizedLabel(fr),
            "Ne texter aucune fiche qui le contient"
        )

        let blocker = ContactImportBlocker(header: "DNC", values: ["peut-être"], more: 2)
        XCTAssertEqual(blocker.title, "We can't read the do-not-text column")
        XCTAssertTrue(blocker.localizedTitle(fr).contains("ne pas texter"))
        XCTAssertTrue(blocker.localizedDetail(fr).contains("oui ou non"))
        XCTAssertTrue(blocker.localizedDetail(fr).contains("Ignorer"))
        XCTAssertTrue(blocker.localizedWayOut(fr).contains("Corrigez"))
    }

    // MARK: - The vCard door's own scan

    /// One MIX .vcf: two cards, folded lines, a grouped property, a parameter
    /// with a quoted colon in it, mapped properties, and a property only one of
    /// the two cards carries.
    ///
    /// Both of the places a .vcf can say do-not-text are in it, and both were
    /// dropped by this door without a word before round 3.
    func testTheScanReportsEveryPropertyTheCardsCarryAndNothingItReads() {
        let text = [
            "BEGIN:VCARD",
            "VERSION:3.0",
            "FN:Dave Chen",
            "TEL;TYPE=CELL:+14165550100",
            "CATEGORIES:DNC",
            // Folded across two lines, the way Google wraps a long NOTE. The
            // continuation loses exactly ONE leading character, so the second
            // space here is the one that survives into the sentence — get that
            // off by one and the value reads "...asked us tostop".
            "NOTE:DO NOT CONTACT - asked us to",
            "  stop",
            "END:VCARD",
            "BEGIN:VCARD",
            "VERSION:3.0",
            "FN:Sam Ali",
            "item1.TEL;TYPE=\"work,voice\":+14165550101",
            "CATEGORIES:Friends",
            "X-ABLabel:Roofer",
            "END:VCARD",
        ].joined(separator: "\r\n")
        let found = VCardProperties.scan(text)
        // `TEL;TYPE` IS IN THIS LIST, and its absence was #528's iOS defect. This
        // assertion used to read ["CATEGORIES", "NOTE", "X-ABLABEL"] — with the
        // parameterised TEL line sitting in the fixture above, unenumerated, while
        // the test passed. The server demands a declaration for every parameter of
        // every property including the mapped ones, so leaving it out refused the
        // whole upload for a token this app never showed.
        XCTAssertEqual(
            found.map(\.name),
            ["TEL;TYPE", "CATEGORIES", "NOTE", "X-ABLABEL"]
        )
        // Keyed by NAME, not by position: the order is file order and a new token
        // appearing ahead of the others should not be an assertion about NOTE.
        let byName = Dictionary(uniqueKeysWithValues: found.map { ($0.name, $0) })
        // Counted per CARD. Both cards carry a parameterised TEL.
        XCTAssertEqual(byName["CATEGORIES"]?.cards, 2)
        XCTAssertEqual(byName["TEL;TYPE"]?.cards, 2)
        XCTAssertEqual(byName["NOTE"]?.cards, 1)
        // The folded line is rejoined — Google wraps a long NOTE across four
        // lines, and a reader that did not join them would drop the sentence
        // saying they asked us to stop.
        XCTAssertEqual(byName["NOTE"]?.samples, ["DO NOT CONTACT - asked us to stop"])
        // Both spellings on the screen, so "coarse in the safe direction" is a
        // choice somebody makes with the evidence in front of them.
        XCTAssertEqual(byName["CATEGORIES"]?.samples, ["DNC", "Friends"])
        // The parameter's own text, quotes off — `TYPE="work,voice"` is the value
        // a person reads to decide, and Apple's inline `X-ABLabel=DO NOT CALL`
        // lives in exactly this position.
        XCTAssertEqual(byName["TEL;TYPE"]?.samples, ["CELL", "work,voice"])
    }

    /// A parameter of a MAPPED property still has to be declared.
    ///
    /// The exemption belongs to a property name and never to what hangs off it.
    /// `TEL` is read, so it is exempt; `TEL;X-ABLABEL` is not read by anything,
    /// and on Apple's inline shape it is where the instruction lives.
    func testAParameterOfAMappedPropertyIsStillReported() {
        let text = [
            "BEGIN:VCARD",
            "VERSION:3.0",
            "FN:Dave Chen",
            "TEL;TYPE=CELL;X-ABLabel=DO NOT CALL:+16135550100",
            "END:VCARD",
        ].joined(separator: "\r\n")
        let found = VCardProperties.scan(text)
        XCTAssertEqual(found.map(\.name), ["TEL;TYPE", "TEL;X-ABLABEL"])
        let label = found.first { $0.name == "TEL;X-ABLABEL" }
        XCTAssertEqual(label?.samples, ["DO NOT CALL"])
        // TEL itself is read, so it is not asked about.
        XCTAssertFalse(found.contains { $0.name == "TEL" })
    }

    /// A line with no colon is still a line somebody wrote.
    ///
    /// It used to be dropped the moment no colon was found, so `DO-NOT-CALL` on
    /// its own line was never enumerated here — while the server counted it and
    /// refused the upload for it.
    func testALineWithNoColonIsStillReported() {
        let text = [
            "BEGIN:VCARD",
            "VERSION:3.0",
            "FN:Dave Chen",
            "DO-NOT-CALL",
            "END:VCARD",
        ].joined(separator: "\r\n")
        let found = VCardProperties.scan(text)
        XCTAssertEqual(found.map(\.name), ["DO-NOT-CALL"])
        // Nothing to read, only something to declare — so no values beside it.
        XCTAssertEqual(found[0].samples, [])
        XCTAssertEqual(found[0].cards, 1)
    }

    /// A card of nothing but PROPERTIES the importer reads still asks about their
    /// parameters — and that is the server's rule, not this app's preference.
    ///
    /// This test used to assert `scan(text).isEmpty`, reasoning that a gate firing
    /// on an ordinary Apple export is one everybody learns to route around. The
    /// reasoning is sound and the assertion was still wrong: the server's own
    /// suite sends `[TEL;TYPE, TEL;VALUE]` as the declarations an ordinary export
    /// must carry, so it demands both. An app that asked about neither produced a
    /// screen with nothing on it, a declaration with nothing in it, and a 422
    /// naming a token the person had never been shown. Fail-closed and total.
    ///
    /// The noise is a KNOWN cost, accepted on purpose. Exempting the ubiquitous
    /// parameter names would be a vocabulary, and this issue has already lost two
    /// rounds to vocabularies — `TYPE=DNC` is a real export, so no parameter name
    /// is safe to wave through. Whatever changes here changes in the server first.
    func testACardCarryingOnlyMappedPropertiesStillAsksAboutTheirParameters() {
        let text = [
            "BEGIN:VCARD",
            "VERSION:4.0",
            "N:Chen;Dave;;;",
            "FN:Dave Chen",
            "TEL;VALUE=uri:tel:+14165550100",
            "END:VCARD",
        ].joined(separator: "\n")
        let found = VCardProperties.scan(text)
        XCTAssertEqual(found.map(\.name), ["TEL;VALUE"])
        // N and FN carry a `;`-heavy value, NOT parameters: the split happens on
        // the name side of the colon only, so `N:Chen;Dave;;;` is one mapped
        // property and asks nothing.
        XCTAssertFalse(found.contains { $0.name.hasPrefix("N;") })
    }

    /// Anything outside a card is not a property of anybody's.
    func testLinesOutsideACardAreNotProperties() {
        XCTAssertTrue(VCardProperties.scan("X-STRAY:value\nBEGIN:VCARD\nFN:A\nEND:VCARD").isEmpty)
    }

    // MARK: - The screens actually draw it

    /// Exactly one line in the whole Contacts feature builds each declaration,
    /// and both are inside the consent sheet's confirm.
    ///
    /// This earns its place the same way the attestation's own scan does: a call
    /// site that assigned `declaredColumns` from the column list would compile,
    /// pass every assertion above, and tell the server that somebody accounted
    /// for columns nobody was ever shown.
    func testOnlyTheConsentSheetCanDeclareWhatAColumnIs() throws {
        let feature = try repoPath("apps/ios/Loonext/Features/Contacts")
        var origins: [String] = []
        var builders = 0
        for file in try swiftFiles(under: feature) {
            for line in try codeLines(of: file) {
                for name in ["declaredColumns", "declaredProperties"] {
                    if line.range(of: name + "\\s*=", options: .regularExpression) != nil {
                        origins.append(file.lastPathComponent + ": " + columnScanTrim(line))
                    }
                }
                if line.contains("ContactImport.declarations(") { builders += 1 }
                if line.contains("ContactImport.propertyDeclarations(") { builders += 1 }
            }
        }
        XCTAssertEqual(
            origins,
            [
                "ContactImport.swift: confirmed.declaredColumns = ContactImport.declarations(",
                "ContactImport.swift: confirmed.declaredProperties = "
                    + "ContactImport.propertyDeclarations(",
            ],
            "a declaration may be built in exactly two places — the confirm button of "
                + "ContactImportConsentSheet, out of answered menus. Found: \(origins)"
        )
        XCTAssertEqual(
            builders,
            2,
            "declarations/propertyDeclarations are the only things that may build those lists, "
                + "and each may be called once"
        )
    }

    /// The sheet PUTS EVERY COLUMN AND ITS VALUES IN FRONT OF SOMEBODY.
    ///
    /// Everything above is correct in memory. A sheet that computed the columns
    /// and drew none of them would satisfy all of it while the file uploaded
    /// with a declaration nobody could honestly have made — which is #248's
    /// exact shape, one layer up.
    func testTheConsentSheetDrawsEveryColumnItsValuesAndAWayToAnswer() throws {
        let file = try repoPath("apps/ios/Loonext/Features/Contacts/ContactImport.swift")
        let code = try codeLines(of: file)
        for drawn in [
            "candidate.columns",
            "columnRow(column)",
            "column.localizedTitle(appLocale)",
            "column.line(showingAll: showingAll, locale: appLocale)",
            "columnMenu(column)",
            // #528: and a way to reach the values it did NOT print. A list
            // that simply stopped read as complete, so a restriction at the
            // sixth value was on screen legally and invisible in practice.
            "column.total > column.samples.count",
            "showAllValuesButton(total: column.total",
            "ContactImportColumnAction.answers",
            "ContactColumns.localizedColumnsExplanation(appLocale)",
            "ContactColumns.localizedIgnoreMeaning(appLocale)",
            "ContactColumns.localizedColumnsHeading(appLocale)",
            "ContactColumns.answeredLine(",
            "ignoreRestButton",
            "ContactColumns.ignoreRestLabel(unansweredColumns, locale: appLocale)",
            "action.localizedLabel(appLocale)",
            "ContactImport.guessedAnswers(",
            "blocker.localizedTitle(appLocale)",
            "blocker.localizedDetail(appLocale)",
            "ContactImport.mayImport(",
            "ContactImport.gateReason(",
        ] {
            XCTAssertTrue(
                code.contains(where: { $0.contains(drawn) }),
                "the consent sheet must draw \(drawn) — a column this app found and did not "
                    + "show is the silent drop #248 exists to end"
            )
        }
        // CALLED, asserted on the function's name rather than on its argument's.
        // Both of these bind a differently-named local — `blockedCard(unreadable)`
        // and `gateLine(reason)` — because the right-hand side is a computed
        // property on self, and the `if let x` shorthand's name lookup through an
        // implicit self inside a ViewBuilder is not a thing to learn about from a
        // CI log. This list used to pin the ARGUMENT name, so that rename left two
        // assertions demanding text nobody ships, on the one client whose tests
        // only run in CI. `drawnAt` skips the declaration, so a view that is
        // declared and never called still fails.
        for called in ["blockedCard(", "gateLine("] {
            XCTAssertNotNil(
                drawnAt(called, in: code),
                "\(called) is declared and never called — a refusal this sheet works out and "
                    + "does not draw is the silent refusal #248 exists to end"
            )
        }
    }

    /// And the vCard door's half of the same screen.
    func testTheConsentSheetDrawsEveryVCardPropertyAndAWayToAnswer() throws {
        let file = try repoPath("apps/ios/Loonext/Features/Contacts/ContactImport.swift")
        let code = try codeLines(of: file)
        for drawn in [
            "candidate.properties",
            "propertyRow(property)",
            "property.localizedTitle(appLocale)",
            "property.line(showingAll: showingAll, locale: appLocale)",
            "propertyMenu(property)",
            "property.total > property.samples.count",
            "showAllValuesButton(total: property.total",
            "VCardPropertyAction.allCases",
            "VCardProperties.localizedHeading(appLocale)",
            "VCardProperties.localizedExplanation(appLocale)",
            "VCardProperties.ignoreRestLabel(unansweredProperties, locale: appLocale)",
            "ignoreRestPropertiesButton",
        ] {
            XCTAssertTrue(
                code.contains(where: { $0.contains(drawn) }),
                "the consent sheet must draw \(drawn) — the vCard door had no gate at all"
            )
        }
    }

    /// EVERY COLUMN REACHES THE SCREEN, not just the ones still unanswered.
    ///
    /// #248 H1's first fault, in the shape this client could take it. The web
    /// wizard drew only the columns its detector had NOT answered, so an
    /// auto-detected column's values were never seen by anybody and "DO NOT
    /// CALL" was dismissed by a machine. Here that is one `.filter` inside the
    /// `ForEach`, and the scan above cannot see it — the mutated line still
    /// contains `candidate.columns` and passes every token it looks for.
    ///
    /// So the SEQUENCE is pinned rather than the mention: whatever a row is
    /// drawn from, what it is drawn over is the whole list.
    func testTheSheetDrawsTheWholeListRatherThanWhatIsLeftOfIt() throws {
        let code = try consentSheetCode()
        assertDrawnWhole("ForEach(candidate.columns", "column", in: code)
        assertDrawnWhole("ForEach(candidate.properties", "property", in: code)
    }

    /// THE BULK ANSWER SITS BELOW THE LIST IT ANSWERS FOR, and the position is
    /// the whole permission for it existing.
    ///
    /// Reaching it means having scrolled past every remaining column and the
    /// values under it, which is this screen's version of "the columns are on
    /// screen when it is pressed". The same button above the list is a way to
    /// SKIP the screen — one tap dismissing columns nobody scrolled to — which
    /// is the screen's exact opposite.
    ///
    /// Pinned rather than left to the docblock that asks for it because the web
    /// wizard's twin of this move survived all 2972 of its tests: a rule written
    /// down and asserted nowhere is a rule the next tidy-up moves.
    func testTheBulkAnswerSitsBelowTheListItAnswersFor() throws {
        let code = try consentSheetCode()
        assertDrawnBelow(
            "ignoreRestButton",
            list: "ForEach(candidate.columns",
            in: code
        )
        assertDrawnBelow(
            "ignoreRestPropertiesButton",
            list: "ForEach(candidate.properties",
            in: code
        )
    }

    /// AND EVERY COLUMN IS ABOVE THE BOX THAT SWEARS TO THEM.
    ///
    /// The same rule one level up, and the one that decides whether any of this
    /// is real. "Everyone in this file agreed to be texted by this business" is
    /// a claim nobody can honestly make about a file with a "Do Not Call" column
    /// in it, and that unticked box is the last thing between this file and the
    /// wire. Below the list, reaching it means scrolling past every column and
    /// its values; above the list, somebody ticks and imports having seen none
    /// of them — which is #248 exactly, with a nicer screen.
    ///
    /// It was written in `columnsCard`'s docblock and asserted nowhere, so
    /// reordering two lines of a `VStack` silently removed the reason the
    /// attestation is worth collecting.
    func testEveryColumnIsOnScreenAboveTheBoxThatSwearsToThem() throws {
        let code = try consentSheetCode()
        var previous = -1
        var previousName = "the top of the sheet"
        for card in ["fileCard", "columnsCard", "propertiesCard", "attestationCard"] {
            guard let at = drawnAt(card, in: code) else {
                XCTFail("\(card) is never drawn on the consent sheet")
                return
            }
            XCTAssertGreaterThan(
                at,
                previous,
                "\(card) has to be drawn after \(previousName) — a column below the attestation "
                    + "is a column nobody had to scroll past before swearing to it"
            )
            previous = at
            previousName = card
        }
    }

    /// The file is read BEFORE the upload, both doors, and the answers reach
    /// the wire.
    func testTheTabReadsTheFileItPickedAndPostsWhatWasDeclared() throws {
        let file = try repoPath("apps/ios/Loonext/Features/Contacts/ContactsTab.swift")
        let code = try codeLines(of: file)
        for wired in [
            "ContactColumns.reviewFile(bytes)",
            "candidate.columns = review.columns",
            "VCardProperties.scanFile(bytes)",
            "columns: candidate.declaredColumns",
            "properties: candidate.declaredProperties",
        ] {
            XCTAssertTrue(
                code.contains(where: { $0.contains(wired) }),
                "ContactsTab must \(wired)"
            )
        }
    }

    /// A refused import goes on PAPER, not into the five-second notice line.
    ///
    /// The refusal that matters names the columns and asks for a person to look
    /// at them, which is an instruction rather than a status. An instruction
    /// that deletes itself after five seconds is an instruction nobody
    /// followed — and the file is still sitting in somebody's Files app with a
    /// "Do Not Call" column in it.
    func testARefusedImportIsPutOnPaperRatherThanIntoTheNoticeLine() throws {
        let file = try repoPath("apps/ios/Loonext/Features/Contacts/ContactsTab.swift")
        let code = try codeLines(of: file)
        for drawn in [
            "importRefusal = ImportRefusal(",
            "ImportRefusedSheet(refusal: refusal)",
            "Text(refusal.message)",
        ] {
            XCTAssertTrue(
                code.contains(where: { $0.contains(drawn) }),
                "a refused import must reach ImportRefusedSheet: missing \(drawn)"
            )
        }
        XCTAssertTrue(
            code.contains(where: { $0.contains("ApiErrorCode.validationFailed") }),
            "the branch has to be on the structural code, never on the message text"
        )
    }

    /// And the report sheet says how many refusals it was not given.
    func testTheImportReportPrintsTheRefusalsItWasNotHanded() throws {
        let file = try repoPath("apps/ios/Loonext/Features/Contacts/ContactsTab.swift")
        let code = try codeLines(of: file)
        XCTAssertTrue(
            code.contains(where: { $0.contains("consent.unlistedLine") }),
            "a count larger than its list must be said out loud, or the heading reads as wrong"
        )
    }

    // MARK: - #248 B8: a count larger than its list

    /// A heading reading "40 people" over five rows.
    func testARefusalCountLargerThanItsListSaysSoOutLoud() throws {
        let result = try importResult(
            """
            {"imported": 1, "updated": 0, "skipped": 0, "errors": [],
             "consent_refused": 40,
             "consent_refusals": [{"row": 2, "reason": "OPAQUE-REFUSAL-A"}]}
            """
        )
        let outcome = ImportConsentOutcome(result)
        XCTAssertEqual(outcome.refused, 40)
        XCTAssertEqual(outcome.unlisted, 39)
        let line = try XCTUnwrap(outcome.unlistedLine)
        XCTAssertTrue(line.contains(outcome.unlisted.formatted()), "got \(line)")
    }

    func testAnAnswerThatNamedEveryRefusalSaysNothingExtra() throws {
        let result = try importResult(
            """
            {"imported": 1, "updated": 0, "skipped": 0, "errors": [],
             "consent_refused": 2,
             "consent_refusals": [{"row": 2, "reason": "A"}, {"row": 3, "reason": "B"}]}
            """
        )
        let outcome = ImportConsentOutcome(result)
        XCTAssertEqual(outcome.unlisted, 0)
        XCTAssertNil(outcome.unlistedLine)
    }

    // MARK: - Fixtures

    private func staged(columns: [ContactImportColumn]) -> ContactImportCandidate {
        ContactImportCandidate(
            kind: .csv,
            fileName: "customers.csv",
            bytes: Data(),
            columns: columns
        )
    }

    private func mayImport(
        _ candidate: ContactImportCandidate,
        attested: Bool,
        columns: [Int: ContactImportColumnAction] = [:],
        properties: [String: VCardPropertyAction] = [:]
    ) -> Bool {
        ContactImport.mayImport(
            candidate,
            attested: attested,
            columnAnswers: columns,
            propertyAnswers: properties
        )
    }

    private func importResult(_ json: String) throws -> ImportResult {
        try JSONDecoder().decode(ImportResult.self, from: Data(json.utf8))
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

    private func swiftFiles(under directory: URL) throws -> [URL] {
        let names = try FileManager.default.contentsOfDirectory(atPath: directory.path)
        return names.sorted()
            .filter { $0.hasSuffix(".swift") }
            .map { directory.appendingPathComponent($0) }
    }

    /// Source lines with whole-line comments removed, so documenting a rule in
    /// the file the rule protects does not fail the scan that asked for the
    /// documentation.
    private func codeLines(of file: URL) throws -> [String] {
        let text = try String(contentsOf: file, encoding: .utf8)
        return text.components(separatedBy: .newlines)
            .filter { !columnScanTrim($0).hasPrefix("//") }
    }

    private func consentSheetCode() throws -> [String] {
        try codeLines(of: repoPath("apps/ios/Loonext/Features/Contacts/ContactImport.swift"))
    }

    /// Where a private view is DRAWN, which is never where it is declared.
    ///
    /// Every view this is asked about is declared further down the file than it
    /// is used, and it is the DRAWING order a reader scrolls through. Both
    /// declaration forms are skipped — `var fileCard` and `func blockedCard(` —
    /// so a view that is declared and never called reads as absent rather than
    /// as drawn, which is the whole question being asked.
    ///
    /// Written as a plain loop rather than `indices.first(where:)` because this
    /// client has no compiler outside CI, and a `for` cannot be read two ways.
    private func drawnAt(_ view: String, in code: [String]) -> Int? {
        for (index, line) in code.enumerated() where line.contains(view) {
            if !line.contains("var \(view)"), !line.contains("func \(view)") { return index }
        }
        return nil
    }

    /// One list, drawn over the whole of itself.
    ///
    /// EXACTLY ONE loop per subject, so a second narrowed one cannot be added
    /// beside the honest one, and its argument is the collection itself — a
    /// `.filter`, a `.prefix` or a `where` between the parentheses would leave
    /// somebody dismissing values they were never shown.
    private func assertDrawnWhole(_ token: String, _ subject: String, in code: [String]) {
        let loops = code.filter { $0.contains(token) }
        XCTAssertEqual(loops.count, 1, "expected exactly one \(subject) list; got \(loops)")
        for loop in loops {
            XCTAssertTrue(
                columnScanTrim(loop).hasPrefix(token + ") {"),
                "the \(subject) list must be drawn over the WHOLE list — a narrowed one shows "
                    + "nobody the values they are about to dismiss. Got: \(columnScanTrim(loop))"
            )
        }
    }

    private func assertDrawnBelow(_ button: String, list: String, in code: [String]) {
        guard let listAt = drawnAt(list, in: code) else {
            XCTFail("there is no \(list) loop for \(button) to sit under")
            return
        }
        guard let buttonAt = drawnAt(button, in: code) else {
            XCTFail("\(button) is declared and never drawn")
            return
        }
        XCTAssertGreaterThan(
            buttonAt,
            listAt,
            "\(button) has to be drawn AFTER the list it answers for — above it, one tap "
                + "dismisses columns nobody scrolled to, which is the screen's whole opposite"
        )
    }

    // MARK: - Reading the TypeScript

    private func sharedHeadersSource() throws -> String {
        let url = try repoPath("packages/shared/src/contact-import-headers.ts")
        return try String(contentsOf: url, encoding: .utf8)
    }

    private func sharedContractSource() throws -> String {
        let url = try repoPath("packages/shared/src/contact-import.ts")
        return try String(contentsOf: url, encoding: .utf8)
    }

    /// TypeScript with its comment lines removed.
    ///
    /// Without this, the paragraph explaining why the shape test was deleted
    /// would fail the test asserting it is deleted — which would leave an author
    /// choosing between explaining the change and passing the check.
    private func tsCode(_ source: String) -> String {
        source.components(separatedBy: .newlines)
            .filter { raw in
                let line = columnScanTrim(raw)
                return !line.hasPrefix("//") && !line.hasPrefix("*") && !line.hasPrefix("/*")
            }
            .joined(separator: "\n")
    }

    /// The declaration's text, comments stripped, up to its closing `];`.
    private func declarationBlock(_ name: String, in source: String) throws -> String {
        let lines = tsCode(source).components(separatedBy: .newlines)
        guard let start = lines.firstIndex(where: { $0.contains("const \(name)") }) else {
            XCTFail("\(name) is not declared in the shared contract")
            throw MissingSource.at(name)
        }
        guard let end = lines[start...].firstIndex(where: { columnScanTrim($0) == "];" }) else {
            XCTFail("\(name) has no closing `];`, which this reader depends on")
            throw MissingSource.at(name)
        }
        return lines[start ... end].joined(separator: "\n")
    }

    /// One member's DECLARED TYPE out of a shared `export interface`.
    ///
    /// The type is the assertion here rather than the body, because that is
    /// where round three put the rule: a guess whose `action` cannot be spelled
    /// `ignore` cannot manufacture a dismissal however it is later rewritten.
    private func tsInterfaceMember(
        _ member: String,
        of interface: String,
        in source: String
    ) throws -> String {
        let lines = tsCode(source).components(separatedBy: .newlines)
        guard let start = lines.firstIndex(where: { $0.contains("interface \(interface) {") })
        else {
            XCTFail("\(interface) is not declared in the shared contract")
            throw MissingSource.at(interface)
        }
        guard let end = lines[start...].firstIndex(where: { columnScanTrim($0) == "}" }) else {
            XCTFail("\(interface) has no closing brace, which this reader depends on")
            throw MissingSource.at(interface)
        }
        guard
            let line = lines[start ... end]
                .first(where: { columnScanTrim($0).hasPrefix(member + ":") })
        else {
            XCTFail("\(interface) has no `\(member)` member")
            throw MissingSource.at(interface)
        }
        return columnScanTrim(line)
    }

    /// Every quoted string in a multi-line array declaration, in order.
    private func tsStringArray(_ name: String, in source: String) throws -> [String] {
        let block = try declarationBlock(name, in: source)
        var values: [String] = []
        var value: String? = nil
        for char in block {
            if char == "\"" {
                if let open = value {
                    values.append(open)
                    value = nil
                } else {
                    value = ""
                }
            } else if value != nil {
                value?.append(char)
            }
        }
        guard !values.isEmpty else {
            XCTFail("\(name) holds no quoted values")
            throw MissingSource.at(name)
        }
        return values
    }

    /// FIELD_PATTERNS, as pairs of field name and regex sources.
    ///
    /// Read by walking the block: a quoted string opens a new group, and every
    /// regex literal after it joins that group. That handles both shapes the
    /// table is written in — the one-per-line form `opted_out` uses and the
    /// single-line form the rest use — without either one having to stay
    /// formatted the way it is today.
    private func sharedFieldPatterns() throws -> [(field: String, patterns: [String])] {
        let source = try sharedHeadersSource()
        let text = try declarationBlock("FIELD_PATTERNS", in: source)
        let block = Array(text)
        var groups: [(field: String, patterns: [String])] = []
        var index = 0
        while index < block.count {
            let char = block[index]
            if char == "\"" {
                index += 1
                var value = ""
                while index < block.count, block[index] != "\"" {
                    value.append(block[index])
                    index += 1
                }
                index += 1
                groups.append((field: value, patterns: []))
            } else if char == "/" {
                index += 1
                var value = ""
                while index < block.count, block[index] != "/" {
                    value.append(block[index])
                    index += 1
                }
                index += 1
                guard !groups.isEmpty else {
                    XCTFail("a regex literal appears in FIELD_PATTERNS before any field name")
                    throw MissingSource.at("FIELD_PATTERNS")
                }
                groups[groups.count - 1].patterns.append(value)
            } else {
                index += 1
            }
        }
        guard !groups.isEmpty else {
            XCTFail("FIELD_PATTERNS read as empty — the reader no longer understands the table")
            throw MissingSource.at("FIELD_PATTERNS")
        }
        return groups
    }

    /// `const NAME = new Set(["a", "b"]);` — the quoted values, in order.
    private func sharedStringList(_ name: String, in source: String) throws -> [String] {
        guard let line = source.components(separatedBy: .newlines)
            .first(where: { $0.contains("const \(name) ") })
        else {
            XCTFail("\(name) is not declared on one line of contact-import-headers.ts")
            throw MissingSource.at(name)
        }
        var values: [String] = []
        var value: String? = nil
        for char in line {
            if char == "\"" {
                if let open = value {
                    values.append(open)
                    value = nil
                } else {
                    value = ""
                }
            } else if value != nil {
                value?.append(char)
            }
        }
        guard !values.isEmpty else {
            XCTFail("\(name) holds no quoted values: \(line)")
            throw MissingSource.at(name)
        }
        return values
    }

    /// One plain string literal, out of the shared contract.
    private func tsString(_ name: String, in source: String) throws -> String {
        let pattern = "export const \(name) =([^;]+);"
        guard
            let regex = try? NSRegularExpression(pattern: pattern),
            let match = regex.firstMatch(
                in: source,
                range: NSRange(source.startIndex ..< source.endIndex, in: source)
            ),
            let captured = Range(match.range(at: 1), in: source)
        else {
            XCTFail("\(name) is not declared in packages/shared/src/contact-import.ts")
            throw MissingSource.at(name)
        }
        let raw = columnScanTrim(source[captured])
        guard raw.hasPrefix("\""), raw.hasSuffix("\""), raw.count >= 2 else {
            XCTFail("\(name) is not a plain string literal: \(raw)")
            throw MissingSource.at(name)
        }
        return String(raw.dropFirst().dropLast())
    }

    /// The first backtick template literal inside a named shared function.
    ///
    /// Searched from AFTER the `function <name>` token, so the docblock above
    /// it — which writes the same format in prose, inside backticks — cannot be
    /// mistaken for the shipped one.
    private func tsTemplate(_ function: String, in source: String) throws -> String {
        guard let declaration = source.range(of: "function \(function)") else {
            XCTFail("\(function) is not declared in packages/shared/src/contact-import.ts")
            throw MissingSource.at(function)
        }
        let body = source[declaration.upperBound...]
        guard let open = body.firstIndex(of: "`") else {
            XCTFail("\(function) has no template literal in it")
            throw MissingSource.at(function)
        }
        let rest = body[body.index(after: open)...]
        guard let close = rest.firstIndex(of: "`") else {
            XCTFail("\(function)'s template literal is not closed")
            throw MissingSource.at(function)
        }
        return String(rest[rest.startIndex ..< close])
    }

    // MARK: - #528 the values a column does not print

    /// Every column answered for from one pass, distinct and in file order.
    func testEveryColumnIsAnsweredForFromOnePass() {
        let held = ContactColumns.allColumnValues(
            rows: [
                ["+14165550101", "Subscribed"],
                ["+14165550102", "DO NOT CALL"],
                ["+14165550103", "subscribed"],
                ["+14165550104", "   "],
                ["+14165550105", "Pending"],
            ],
            columnCount: 2
        )
        XCTAssertEqual(held[0].total, 5)
        XCTAssertEqual(held[1].values, ["Subscribed", "DO NOT CALL", "Pending"])
        XCTAssertEqual(held[1].total, 3)
    }

    /// The count is of ANSWERS, not of rows.
    ///
    /// A column of four hundred `Subscribed`s has one answer, and reporting
    /// "and 399 more" would be a new way of saying nothing.
    func testTheCountIsOfAnswersNotOfRows() {
        var rows = [[String]](repeating: ["Subscribed"], count: 400)
        rows.append(["DO NOT CALL"])
        let held = ContactColumns.allColumnValues(rows: rows, columnCount: 1)
        XCTAssertEqual(held[0].values, ["Subscribed", "DO NOT CALL"])
        XCTAssertEqual(held[0].total, 2)
    }

    /// The count stays true past the ceiling that bounds the list.
    ///
    /// The list is bounded because a screen cannot draw 50,000 values. The COUNT
    /// is not, because "and 40 more" is only worth printing if the 40 is real —
    /// and a total that quietly equalled the ceiling would read, to everybody who
    /// saw it, as a list with nothing left out.
    func testTheCountStaysTruePastTheCeiling() {
        let size = ContactColumns.valueCeiling + 40
        let rows = (0 ..< size).map { ["v\($0)"] }
        let held = ContactColumns.allColumnValues(rows: rows, columnCount: 1)
        XCTAssertEqual(held[0].values.count, ContactColumns.valueCeiling)
        XCTAssertEqual(held[0].total, size)
    }

    /// The line names how many answers it left out, and offers them.
    ///
    /// ", and more" was the whole defect: it stood equally for one hidden answer
    /// and four hundred, and the line was the last place that admitted a hidden
    /// one existed.
    func testTheLineNamesHowManyAnswersItLeftOut() {
        let csv = (["Status"] + (0 ..< 20).map { "v\($0)" }).joined(separator: "\n")
        let review = ContactColumns.review(csv)
        let column = review.columns[0]
        XCTAssertEqual(column.samples.count, ContactColumns.sampleLimit)
        XCTAssertEqual(column.total, 20)
        XCTAssertTrue(
            column.sampleLine.hasSuffix(", and 15 more"),
            "got \(column.sampleLine)"
        )
        XCTAssertEqual(
            ContactColumns.showAllValuesLabel(total: column.total),
            "Show all 20 values"
        )
        // Expanded, every value is listed and nothing claims a remainder.
        let expanded = column.line(showingAll: true)
        XCTAssertTrue(expanded.contains("v19"), "got \(expanded)")
        XCTAssertFalse(expanded.contains("more"), "got \(expanded)")
    }

    /// A column with nothing left out says nothing about a remainder.
    func testAColumnWithNothingLeftOutSaysNothingAboutARemainder() {
        let review = ContactColumns.review("Status\nDNC\nOK\nHOLD")
        XCTAssertFalse(
            review.columns[0].sampleLine.contains("more"),
            "got \(review.columns[0].sampleLine)"
        )
    }

    /// A .vcf property can say how many values it really carries.
    ///
    /// The collector used to stop inserting into its distinct SET at the sample
    /// limit, so the total could never exceed five however many values a property
    /// had — and "and more" was the only thing it could honestly print.
    func testAVCardPropertyCountsPastTheValuesItPrints() throws {
        var lines: [String] = []
        for index in 0 ..< 9 {
            lines += [
                "BEGIN:VCARD",
                "VERSION:3.0",
                "FN:Person \(index)",
                "TEL:+1416555010\(index)",
                index == 8 ? "X-STATUS:DO NOT CALL" : "X-STATUS:s\(index)",
                "END:VCARD",
            ]
        }
        let found = VCardProperties.scan(lines.joined(separator: "\r\n"))
        let status = try XCTUnwrap(found.first(where: { $0.name == "X-STATUS" }))
        XCTAssertEqual(status.total, 9)
        XCTAssertEqual(status.samples.count, ContactColumns.sampleLimit)
        // The value that matters is the ninth, and it is REACHABLE.
        XCTAssertTrue(status.values.contains("DO NOT CALL"))
        XCTAssertTrue(
            status.sampleLine.hasSuffix(", and 4 more"),
            "got \(status.sampleLine)"
        )
    }
}

/// Deliberately not `extension String { var trimmed }`, and deliberately not
/// sharing a name with the twin in `ContactImportConsentTests`: a private
/// top-level function that later grows an INTERNAL twin in the app module is an
/// invalid redeclaration across `@testable import`, and the trap reads as safe
/// right up until it does not compile.
private func columnScanTrim(_ value: some StringProtocol) -> String {
    value.trimmingCharacters(in: .whitespacesAndNewlines)
}
