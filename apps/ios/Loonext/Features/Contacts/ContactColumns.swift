import Foundation

/// A field the importer knows how to fill from a CSV column.
///
/// The raw values are the shared contract's own names, because the guard in
/// `ContactImportColumnsTests` reads them straight out of the TypeScript.
enum ContactImportField: String, CaseIterable, Sendable {
    case phone
    case name
    case firstName = "first_name"
    case lastName = "last_name"
    case address
    case notes
    case optedOut = "opted_out"

    /// What a person picking this off a menu reads.
    ///
    /// Deliberately NOT the raw value prettified. `opted_out` is the wire name
    /// and "Do not text" is the sentence somebody has to recognise as the thing
    /// their "Do Not Call" column means; a menu offering "Opted out" asks them
    /// to translate, and this is the one choice on the screen where a
    /// translation error texts somebody who said stop.
    /// English-default forwarding API for model tests and non-UI callers.
    var label: String { localizedLabel(nil) }

    /// The label as the current reader sees it.
    func localizedLabel(_ locale: String?) -> String {
        switch self {
        case .phone: return AppStrings.translate(locale, "contactsTasks.phoneField")
        case .name: return AppStrings.translate(locale, "contactsTasks.nameField")
        case .firstName:
            return AppStrings.translate(locale, "contactsTasks.importActionFirstName")
        case .lastName:
            return AppStrings.translate(locale, "contactsTasks.importActionLastName")
        case .address: return AppStrings.translate(locale, "contactsTasks.address")
        case .notes: return AppStrings.translate(locale, "contactsTasks.notesField")
        case .optedOut:
            return AppStrings.translate(locale, "contactsTasks.importActionOptedOut")
        }
    }

    var icon: String {
        switch self {
        case .phone: return "phone"
        case .name, .firstName, .lastName: return "person"
        case .address: return "mappin.and.ellipse"
        case .notes: return "text.alignleft"
        case .optedOut: return "hand.raised"
        }
    }
}

/// What a caller may say about ONE column: which contact field it is, or that
/// it is not one.
///
/// A two-case enum rather than a `String` enum with an `ignore` member, because
/// `ignore` is not a contact field and a type that let it be assigned to one
/// would make `mappingFromDeclarations`' Swift twin a runtime question.
enum ContactImportColumnAction: Hashable, Sendable {
    case field(ContactImportField)
    case ignore

    /// The token this becomes on the wire — every one of them off a shipped
    /// constant, never retyped here.
    var wire: String {
        switch self {
        case .field(let field): return field.rawValue
        case .ignore: return ContactImport.ignoreAction
        }
    }

    /// English-default forwarding API for existing pure callers.
    var label: String { localizedLabel(nil) }

    func localizedLabel(_ locale: String?) -> String {
        switch self {
        case .field(let field): return field.localizedLabel(locale)
        case .ignore: return ContactColumns.localizedIgnoreLabel(locale)
        }
    }

    var icon: String {
        switch self {
        case .field(let field): return field.icon
        case .ignore: return "minus.circle"
        }
    }

    /// Every answer a person may give, in menu order: the fields this importer
    /// fills, then the one that says it fills none of them.
    ///
    /// Built from `allCases` rather than typed out, so a field added to the
    /// contract appears on the menu instead of becoming a column nobody can
    /// answer for.
    static let answers: [ContactImportColumnAction] =
        ContactImportField.allCases.map { .field($0) } + [.ignore]
}

/// One column's answer, exactly as it goes on the wire.
///
/// See `CONTACT_IMPORT_COLUMN_FIELD` in `packages/shared/src/contact-import.ts`
/// for why the INDEX is the identity: round two matched on the normalised
/// header, which strips everything but `[a-z0-9]`, so every header with no
/// ASCII alphanumerics ("", "—", "#") collapsed to one empty string and two of
/// them could not be told apart. A position cannot collide with a position.
struct ContactImportColumnDeclaration: Hashable, Sendable {
    /// 0-based position in the row.
    let index: Int

    /// The field it fills, or `ignore`.
    let action: ContactImportColumnAction

    /// The header as the file spells it, `""` for a column with no heading.
    ///
    /// Carried AND checked by the server: it is what catches a declaration
    /// built from some other file — yesterday's export, the wrong branch of an
    /// integration — against the one actually attached.
    let header: String

    /// `<index>:<action>:<header>`, the shared contract's format.
    ///
    /// Assembled here rather than at the call site so the ORDER lives in one
    /// place. `ContactImportColumnsTests` reads the template out of
    /// `formatContactImportColumn` and rebuilds this string from it, so a
    /// reordering on either side fails rather than posting a header where the
    /// server expects an action.
    var wire: String {
        "\(index):\(action.wire):\(header)"
    }
}

/// One column of a picked file, and everything a person needs to answer for it.
struct ContactImportColumn: Identifiable, Hashable, Sendable {
    /// 0-based position. Present for EVERY column the data implies, including
    /// one that exists only because some row is longer than the header row.
    let index: Int

    /// The header exactly as the file spelled it, trimmed. `""` when this
    /// column runs past the end of the header row — which is a column with a
    /// blank name, not a column that may be skipped.
    let header: String

    /// Its distinct values, in the order the file first used them.
    ///
    /// The whole design rests on somebody SEEING "DO NOT CALL" before they
    /// dismiss the column holding it, which is why the shared contract carries
    /// `contactImportColumnSamples` rather than leaving each client to invent
    /// one. A phone that showed only header names would be asking the question
    /// without showing the answer.
    let samples: [String]

    /// The detector's guess, or nil when it recognised nothing.
    ///
    /// A GUESS and never a gate — see `ContactColumns.fieldPatterns`. It is the
    /// answer this column starts on, and a person may change it.
    let guess: ContactImportField?

    /// The first few distinct values in this column that `readFlag` cannot read
    /// as yes or no, and how many there are altogether.
    ///
    /// Computed for every column rather than for the detected one, because
    /// which column decides who may be texted is now the PERSON's answer: a
    /// `Description` column somebody declares `opted_out` has to be checked the
    /// same way, and the review runs long before that answer exists.
    let unreadable: [String]
    let unreadableCount: Int

    /// Every distinct value held for this column, for somebody who asks to see
    /// them. `samples` is its first few; this is bounded only by
    /// `ContactColumns.valueCeiling`.
    let values: [String]

    /// How many distinct values the column really has, counted past the ceiling.
    ///
    /// The point of counting past it: "and 12 more" tells somebody they have not
    /// seen everything, and a total that quietly equalled the length of the list
    /// beside it would read as a list with nothing left out.
    let total: Int

    var id: Int { index }

    /// What the row is headed. A column with no heading is named by its
    /// position — "column 4" is something a person can find in a spreadsheet,
    /// and a pair of quotes around nothing reads as a bug.
    var title: String { localizedTitle(nil) }

    func localizedTitle(_ locale: String?) -> String {
        guard header.isEmpty else { return header }
        return AppStrings.translate(
            locale,
            "contactsTasks.importColumnNoHeading",
            ["number": ContactColumns.formattedCount(index + 1, locale: locale)]
        )
    }

    /// Its values, said out loud, bounded — and the count of the ones left out.
    ///
    /// ", and 12 more" rather than the old bare list, because a person deciding
    /// whether to dismiss a column needs to know whether they have seen it. A list
    /// that simply stopped read as complete, so a value at the sixth was on screen
    /// in the sense that matters legally and absent in the sense that matters to
    /// the person about to skip the column holding it.
    var sampleLine: String { line(showingAll: false) }

    /// The same line in either state. Expanded, it reports the length of what it
    /// actually listed, so it does not end in ", and 40 more" while
    /// `ContactColumns.valueCeilingNote` says the same thing a second way.
    func line(showingAll: Bool, locale: String? = nil) -> String {
        let listed = showingAll ? values : samples
        if listed.isEmpty { return ContactColumns.localizedEmptyColumnNote(locale) }
        let hidden = (showingAll ? values.count : total) - listed.count
        let more = hidden > 0
            ? ", " + AppStrings.translate(
                locale,
                "contactsTasks.importHiddenValues",
                ["count": ContactColumns.formattedCount(hidden, locale: locale)]
            )
            : ""
        return listed.joined(separator: " · ") + more
    }
}

extension ContactImportColumn {
    /// A column with nothing unreadable in it — the ordinary case.
    ///
    /// In an EXTENSION rather than the body, which is the whole trick: an
    /// initializer declared inside a struct suppresses the memberwise one, and
    /// the memberwise one is what `review` uses to fill all eight fields. Here it
    /// is a convenience beside it rather than instead of it.
    ///
    /// `values` and `total` come from `samples`, so a column built by hand is one
    /// with nothing hidden — which is what every caller of this init means.
    init(index: Int, header: String, samples: [String], guess: ContactImportField? = nil) {
        self.init(
            index: index,
            header: header,
            samples: samples,
            guess: guess,
            unreadable: [],
            unreadableCount: 0,
            values: samples,
            total: samples.count
        )
    }
}

/// Why a picked file cannot be imported from this app at all.
///
/// Fixed in the FILE rather than in this app, and that is what makes it
/// different from a column with no answer: a column with no answer is a
/// question a person can answer, and this is not.
///
/// The column somebody declared as the do-not-text column carries values this
/// importer cannot read as yes or no. Not resolvable by any further
/// declaration, and the server refuses it the same way for the same reason: we
/// already know this column decides who may be texted — that is what it was
/// declared as. Reading `Unsubscribed` as a blank would text somebody who asked
/// this business to stop.
struct ContactImportBlocker: Equatable, Sendable {
    let header: String

    /// The unreadable values, bounded for printing.
    let values: [String]

    /// How many more there were than `values` holds.
    let more: Int

    var title: String { localizedTitle(nil) }

    func localizedTitle(_ locale: String?) -> String {
        AppStrings.translate(locale, "contactsTasks.importBlockerTitle")
    }

    var detail: String { localizedDetail(nil) }

    func localizedDetail(_ locale: String?) -> String {
        let shown = values.map {
            AppStrings.translate(
                locale,
                "contactsTasks.importColumnQuoted",
                ["header": $0]
            )
        }.joined(separator: ", ")
        let rest = more > 0
            ? ", " + AppStrings.translate(
                locale,
                "contactsTasks.importHiddenValues",
                ["count": ContactColumns.formattedCount(more, locale: locale)]
            )
            : ""
        return AppStrings.translate(
            locale,
            "contactsTasks.importBlockerDetail",
            [
                "column": ContactColumns.quoted(header, locale: locale),
                "shown": shown,
                "rest": rest,
                "ignore": ContactColumns.localizedIgnoreLabel(locale),
                "vocabulary": ContactColumns.localizedFlagVocabulary(locale),
            ]
        )
    }

    /// The one line printed under a disabled Import button.
    var wayOut: String { localizedWayOut(nil) }

    func localizedWayOut(_ locale: String?) -> String {
        AppStrings.translate(locale, "contactsTasks.importBlockerWayOut")
    }
}

/// Everything this app worked out about a picked CSV before uploading a byte.
struct ContactImportReview: Sendable {
    /// Rows after the header, blank lines dropped — the figure the server caps.
    let rowCount: Int

    /// EVERY column the file's data implies, in order, with no gaps.
    let columns: [ContactImportColumn]
}

/// Which column of a contacts CSV holds what — and, the reason this file
/// exists, the rule that nothing is ever dropped without somebody saying so.
///
/// # A hand-port of `packages/shared/src/contact-import-headers.ts`
///
/// # #248 ROUND 3 — THERE IS NO CLASSIFIER HERE ANY MORE
///
/// Two rounds tried to answer "does this dropped column mean do-not-contact".
/// Round one asked it of WORDS — `optout`, `unsubscribe`, `^dnc$` — and a file
/// headed "Do Not Call" imported attested while a real text reached somebody
/// that file said not to contact. Round two asked it of SHAPE — few distinct
/// values, short values, repeated across rows — and lost the same way, because
/// a vocabulary of numbers is still a vocabulary: four distinct answers walked
/// through, a 25-character value walked through, the same answer on all sixty
/// rows walked through, a four-row file walked through, and a cell PAST THE END
/// of the header row was never looked at at all. Each ended in a delivered
/// message.
///
/// The question has no reliable answer, so it is not asked. `unmappedFlagColumns`
/// and its three thresholds are DELETED rather than tuned — a shape test kept
/// "as a hint" is the defect kept.
///
/// NOTHING IS SILENTLY DROPPED. Every column of the file is either mapped to a
/// field or explicitly dismissed by somebody who could see its values, and this
/// app's job is to be the place that person sits.
///
/// # Why a port is safe here even though a port always drifts
///
/// It cannot drift into a defect any more, only into a nuisance, and the
/// asymmetry is now structural rather than argued: the SERVER demands an answer
/// for every column it counts, whatever this app thinks. A detector that
/// disagreed with the server's would put a different default on one menu, and
/// the count of questions would be the same either way.
///
/// What is NOT safe is an app that answers on somebody's behalf. That property
/// is held structurally: see `ContactImport.declarations`, which can only
/// return columns a person answered, and the guard in
/// `ContactImportColumnsTests` that no other line in the feature builds that
/// list.
enum ContactColumns {

    // MARK: - Headers

    /// Case, spaces, and punctuation are noise: "Phone Number" → "phonenumber".
    static func normalizeHeader(_ header: String) -> String {
        header
            .lowercased()
            .replacingOccurrences(of: "[^a-z0-9]", with: "", options: .regularExpression)
    }

    /// Header patterns per target field, most specific first — THE DEFAULT
    /// GUESS, and never a gate.
    ///
    /// The strings are the shared contract's regex sources, character for
    /// character, and the guard reads them out of the TypeScript to compare.
    /// They contain no backslash escapes, which is the only reason a literal
    /// copy is portable at all — `\b` means backspace in Kotlin and does not
    /// compile in Swift, and this repo has already been bitten by that.
    ///
    /// Order matters: `opted_out` is matched before `phone` so a do-not-text
    /// column is never claimed by phone's broad `number` pattern, and the split
    /// name fields before `name` so "First Name" is not read as the whole name.
    ///
    /// The list is WIDER than it was — `donotcall`, `suppress`, `^stop$` — and
    /// that width buys convenience and nothing else. No import is allowed to
    /// proceed on the strength of this list matching, and none is refused on
    /// the strength of it failing to.
    static let fieldPatterns: [(field: ContactImportField, patterns: [String])] = [
        (
            .optedOut,
            [
                "^optedout$",
                "optout",
                "unsubscribe",
                "donottext|donotcontact|donotcall|donotmail",
                "suppress",
                "^dnc$|^dncflag$|^dnclist$",
                "^stop$|^stopped$",
                "blocked",
            ]
        ),
        // #248: the paired form outranks the loose `phone` on purpose. A Google
        // Contacts export writes every repeatable field as a PAIR — `Phone 1 -
        // Type` holding "Mobile", then `Phone 1 - Value` holding the number — and
        // the label comes FIRST. Patterns are tried in order and each scans the
        // columns left to right, so the loose one claimed the labels: every row's
        // number read "Mobile" and every row was unusable.
        (
            .phone,
            [
                "^phone$",
                "^phone[0-9]*value$",
                "phone",
                "mobile",
                "^cell",
                "^tel",
                "number",
            ]
        ),
        (.firstName, ["^firstname$", "^givenname$", "^first$", "^fname$", "firstname|givenname"]),
        (
            .lastName,
            [
                "^lastname$",
                "^surname$",
                "^familyname$",
                "^last$",
                "^lname$",
                "lastname|surname|familyname",
            ]
        ),
        (
            .name,
            [
                "^name$",
                "^fullname$",
                "^contactname$|^customername$|^clientname$",
                "^contact$|^customer$|^client$",
            ]
        ),
        (.address, ["^address$", "address", "^addr", "street"]),
        (.notes, ["^notes?$", "comment", "memo", "description"]),
    ]

    /// `name`'s last resort — any header merely CONTAINING "name", and only
    /// when the file carried no split-name columns. In a `First Name, Last
    /// Name, Company Name, Phone` export it would otherwise claim "Company
    /// Name" as the person's name.
    static let nameLastResort = "name"

    /// Detect a column mapping from the header row. Each column is claimed by
    /// at most one field; per field the most specific pattern wins, scanning
    /// columns left to right.
    static func detect(_ headers: [String]) -> [ContactImportField: Int] {
        let normalized = headers.map(normalizeHeader)
        var claimed = Set<Int>()
        var mapping: [ContactImportField: Int] = [:]

        func claim(_ field: ContactImportField, _ patterns: [String]) {
            for pattern in patterns {
                for index in normalized.indices where !claimed.contains(index) {
                    if matches(normalized[index], pattern) {
                        mapping[field] = index
                        claimed.insert(index)
                        return
                    }
                }
            }
        }

        for entry in fieldPatterns { claim(entry.field, entry.patterns) }
        if mapping[.name] == nil, mapping[.firstName] == nil, mapping[.lastName] == nil {
            claim(.name, [nameLastResort])
        }
        return mapping
    }

    /// `^` and `$` anchor to the whole string here, which is what the shared
    /// patterns assume — the headers are already normalised to one line of
    /// lowercase letters and digits, so there is nothing else to anchor to.
    private static func matches(_ text: String, _ pattern: String) -> Bool {
        text.range(of: pattern, options: .regularExpression) != nil
    }

    // MARK: - How many columns this file has

    /// HOW MANY COLUMNS THIS FILE HAS — which is not `headers.count`.
    ///
    /// #248 round 3. Every loop in the importer was bounded by the header row,
    /// so a cell PAST the end of it was not merely misread — it was never
    /// looked at. `Phone,Name` over a row reading `+1206…,Ann,DO NOT CALL`
    /// dropped the third cell before any rule could see it, and hand-edited
    /// files do this constantly: somebody adds a note to one row and does not
    /// touch the header.
    ///
    /// So the count comes from the DATA, and NO COLUMN IS EXEMPT — not even an
    /// entirely empty one left behind by a stray trailing comma. "A column with
    /// nothing in it decides nothing" is a rule about which columns may be
    /// skipped, and a rule about which columns may be skipped is exactly what
    /// two rounds of this issue lost to. One tap on a malformed file is the
    /// whole cost.
    static func columnCount(headers: [String], rows: [[String]]) -> Int {
        var count = headers.count
        for row in rows where row.count > count {
            count = row.count
        }
        return count
    }

    // MARK: - Flag cells

    /// The values a flag column may carry, in both directions.
    ///
    /// `x` is here because a hand-kept spreadsheet marks the blocked rows with
    /// one, and the API's own truthy set left it out — an x-marked opt-out
    /// column imported as nobody having opted out at all.
    static let flagTrue = ["true", "t", "yes", "y", "1", "x"]
    static let flagFalse = ["false", "f", "no", "n", "0"]

    /// Read one flag cell: true, false, or NIL for "I do not know what this
    /// says".
    ///
    /// The third answer is the point. Anything-that-is-not-true-is-false is how
    /// a column of `Subscribed`/`Unsubscribed` becomes a column of nobody
    /// having opted out. A caller that gets nil must refuse rather than pick a
    /// direction, because the two directions are "text somebody who said stop"
    /// and "block somebody who agreed", and no default is right for both.
    ///
    /// An EMPTY cell is a genuine false: a flag column marks the rows it means.
    static func readFlag(_ value: String?) -> Bool? {
        let token = (value ?? "")
            .trimmingCharacters(in: .whitespacesAndNewlines)
            .lowercased()
        if token.isEmpty { return false }
        if flagTrue.contains(token) { return true }
        if flagFalse.contains(token) { return false }
        return nil
    }

    /// The accepted spellings, said out loud.
    ///
    /// Derived from the two sets rather than typed beside them, so the sentence
    /// cannot outlive the vocabulary it describes — a value added to `flagTrue`
    /// and not to this line would be a column somebody was told to fix in a way
    /// that was already fine.
    static var flagVocabulary: String { localizedFlagVocabulary(nil) }

    static func localizedFlagVocabulary(_ locale: String?) -> String {
        let pairs = zip(flagTrue, flagFalse).map { pair in "\(pair.0)/\(pair.1)" }
        // Whatever has no opposite. `x` marks the rows to block, and its
        // opposite is an empty cell rather than another word.
        let unpaired = flagTrue.dropFirst(flagFalse.count).map {
            AppStrings.translate(
                locale,
                "contactsTasks.importFlagBlockRows",
                ["value": $0]
            )
        }
        let parts = pairs + unpaired
        guard let last = parts.last else { return "" }
        if parts.count == 1 { return last }
        return parts.dropLast().joined(separator: ", ")
            + ", " + AppStrings.translate(locale, "contactsTasks.importFlagOr")
            + " " + last
    }

    // MARK: - What a column holds

    /// How many distinct values are printed beside a column, and how many
    /// unreadable ones are printed in a refusal.
    ///
    /// The shared contract's own default for `contactImportColumnSamples`, and
    /// the same figure the server's unreadable-flag sentence slices to, so the
    /// two doors show a reader the same amount.
    static let sampleLimit = 5

    /// The most distinct values kept per column for showing on request.
    ///
    /// A do-not-text column holds a handful. A name column holds one per row, and
    /// laying out 50,000 of them is how a review screen stops opening. Past this,
    /// `ColumnValues.total` still reports the truth, so the count on screen is
    /// right even when the list is cut.
    ///
    /// This bounds what is DRAWN. Counting distinct values means remembering every
    /// one seen, so what a column costs in memory is set by the file.
    static let valueCeiling = 200

    /// What one column holds, and how much of it is being shown.
    struct ColumnValues: Sendable {
        /// Distinct non-blank values in file order, at most `valueCeiling`.
        let values: [String]
        /// How many distinct values the column really has.
        let total: Int
    }

    /// What every column of a file holds, from one pass over the rows.
    ///
    /// One pass rather than one per column because knowing how many distinct
    /// values a column REALLY has means reading every row of it — there is no
    /// early exit from a count. Answering for all columns at once costs what the
    /// old per-column `samples` loop cost, and answers honestly.
    static func allColumnValues(rows: [[String]], columnCount: Int) -> [ColumnValues] {
        var seen = [Set<String>](repeating: [], count: columnCount)
        var kept = [[String]](repeating: [], count: columnCount)
        for row in rows {
            for index in 0 ..< columnCount {
                let value = cell(row, index)
                if value.isEmpty { continue }
                // The set counts, the array shows. Only the second one is bounded,
                // and it keeps the file's own spelling rather than the key.
                guard seen[index].insert(value.lowercased()).inserted else { continue }
                if kept[index].count < valueCeiling { kept[index].append(value) }
            }
        }
        return (0 ..< columnCount).map {
            ColumnValues(values: kept[$0], total: seen[$0].count)
        }
    }

    /// The control that puts every value a column holds on the screen.
    ///
    /// #228: the locale is optional and nil-defaulted, which is this app's
    /// established shape for pure copy APIs (see `AppStrings.translate`) — nil
    /// preserves the existing English result for tests and non-UI callers. The
    /// forwarding guard is what makes sure views pass the reader's app locale.
    static func showAllValuesLabel(total: Int, locale: String? = nil) -> String {
        AppStrings.translate(
            locale,
            "contactsTasks.importShowAllValues",
            ["count": String(total)]
        )
    }

    /// The control that puts an expanded column back to its first few values.
    static func showFewerValuesLabel(locale: String? = nil) -> String {
        AppStrings.translate(locale, "contactsTasks.importShowFewerValues")
    }

    /// What an expanded column says when even the full list is cut.
    ///
    /// Said rather than left to be inferred, because somebody believing a list is
    /// complete when it is not is the same defect as ", and more" wearing a longer
    /// list. It states the two numbers and stops: how many answers a column has is
    /// NOT a rule about what the column means.
    static func valueCeilingNote(shown: Int, total: Int, locale: String? = nil) -> String {
        AppStrings.translate(
            locale,
            "contactsTasks.importValueCeiling",
            ["shown": String(shown), "total": String(total)]
        )
    }

    /// The distinct values one column carries, for showing a person what they
    /// are being asked about.
    ///
    /// Distinct and in file order, blanks dropped — a column of 400
    /// `Subscribed`s says one thing, and printing it 400 times says it worse.
    static func samples(rows: [[String]], index: Int, limit: Int = sampleLimit) -> [String] {
        var seen = Set<String>()
        var values: [String] = []
        for row in rows {
            let value = cell(row, index)
            if value.isEmpty { continue }
            if seen.insert(value.lowercased()).inserted { values.append(value) }
            if values.count >= limit { break }
        }
        return values
    }

    /// The distinct values in one column that `readFlag` cannot read, bounded
    /// for printing, with the true total beside them.
    ///
    /// The other half of the same defect, one level down: a column CORRECTLY
    /// identified as the do-not-text column is still a silent drop if its cells
    /// say `Subscribed` and the reader only knows `yes`.
    ///
    /// The TOTAL is counted even past the bound, because "and 12 more" is the
    /// difference between a reader believing they have seen the problem and a
    /// reader knowing they have not.
    static func unreadableValues(
        rows: [[String]],
        index: Int,
        limit: Int = sampleLimit
    ) -> (shown: [String], total: Int) {
        var seen = Set<String>()
        var shown: [String] = []
        for row in rows {
            let raw = cell(row, index)
            if readFlag(raw) != nil { continue }
            guard seen.insert(raw.lowercased()).inserted else { continue }
            if shown.count < limit { shown.append(raw) }
        }
        return (shown: shown, total: seen.count)
    }

    /// One cell, trimmed, or the empty string when the row is short — a ragged
    /// row is ordinary in an export and must not read as a missing answer being
    /// something other than blank.
    private static func cell(_ row: [String], _ index: Int) -> String {
        guard row.indices.contains(index) else { return "" }
        return row[index].trimmingCharacters(in: .whitespacesAndNewlines)
    }

    // MARK: - Parsing

    /// A hand-port of `apps/api/src/routes/core/csv.ts` — RFC 4180 enough:
    /// quoted fields, embedded commas and newlines, escaped quotes (`""`),
    /// CRLF or LF, and a UTF-8 BOM. Entirely blank rows are dropped, exactly as
    /// the server drops them, so the two agree on which row is the header.
    ///
    /// Walks UNICODE SCALARS rather than `Character`s on purpose. Swift treats
    /// CRLF as a single grapheme cluster, so a `Character`-by-`Character` port
    /// of this loop never sees a `\r` at all in a Windows-authored file — it
    /// falls through to the default branch and appends the line break into the
    /// field, turning a spreadsheet export into one enormous row. Every CSV a
    /// crew exports from Excel is that file.
    static func parse(_ text: String) -> (headers: [String], rows: [[String]]) {
        var scalars = Array(text.unicodeScalars)
        if scalars.first?.value == 0xFEFF { scalars.removeFirst() }

        var parsed: [[String]] = []
        var row: [String] = []
        var field = ""
        var inQuotes = false
        var index = 0

        func endField() {
            row.append(field)
            field = ""
        }
        func endRow() {
            endField()
            parsed.append(row)
            row = []
        }

        while index < scalars.count {
            let char = scalars[index]
            if inQuotes {
                if char == "\"" {
                    if index + 1 < scalars.count, scalars[index + 1] == "\"" {
                        field.unicodeScalars.append("\"")
                        index += 2
                    } else {
                        inQuotes = false
                        index += 1
                    }
                } else {
                    field.unicodeScalars.append(char)
                    index += 1
                }
                continue
            }
            if char == "\"", field.isEmpty {
                inQuotes = true
                index += 1
            } else if char == "," {
                endField()
                index += 1
            } else if char == "\n" {
                endRow()
                index += 1
            } else if char == "\r" {
                endRow()
                index += (index + 1 < scalars.count && scalars[index + 1] == "\n") ? 2 : 1
            } else {
                field.unicodeScalars.append(char)
                index += 1
            }
        }
        if !field.isEmpty || !row.isEmpty { endRow() }

        let kept = parsed.filter { cells in
            cells.contains { !$0.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }
        }
        guard let header = kept.first else { return (headers: [], rows: []) }
        return (
            headers: header.map { $0.trimmingCharacters(in: .whitespacesAndNewlines) },
            rows: Array(kept.dropFirst())
        )
    }

    // MARK: - The whole answer

    /// Everything this app can work out about a file before uploading it.
    ///
    /// EVERY column, with no gaps and no exemptions — the list is
    /// `0 ..< columnCount`, so a column that exists only because one row is
    /// longer than the header row is in it, in its own position, waiting for an
    /// answer like the rest.
    static func review(_ text: String) -> ContactImportReview {
        let file = parse(text)

        // Over the row cap there is nothing to ask about: the server refuses on
        // the cap before it ever looks at the columns, and this app refuses
        // before it uploads. Reading every cell of a file that big to ask a
        // question nobody will be shown is the phone doing exactly the work the
        // cap exists to prevent.
        if file.rows.count > ContactImport.maxRows {
            return ContactImportReview(rowCount: file.rows.count, columns: [])
        }

        var guesses: [Int: ContactImportField] = [:]
        for (field, index) in detect(file.headers) { guesses[index] = field }

        var columns: [ContactImportColumn] = []
        let count = columnCount(headers: file.headers, rows: file.rows)
        let held = allColumnValues(rows: file.rows, columnCount: count)
        for index in 0 ..< count {
            let unreadable = unreadableValues(rows: file.rows, index: index)
            columns.append(
                ContactImportColumn(
                    index: index,
                    header: file.headers.indices.contains(index) ? file.headers[index] : "",
                    samples: Array(held[index].values.prefix(sampleLimit)),
                    guess: guesses[index],
                    unreadable: unreadable.shown,
                    unreadableCount: unreadable.total,
                    values: held[index].values,
                    total: held[index].total
                )
            )
        }
        return ContactImportReview(rowCount: file.rows.count, columns: columns)
    }

    /// The same answer, off the main actor.
    ///
    /// A file at the byte cap is two million scalars, and the review walks every
    /// one of them and then every cell of every column. On the actor that draws
    /// the sheet, that is a stutter between picking a file and being asked about
    /// it.
    static func reviewFile(_ bytes: Data) async -> ContactImportReview {
        await Task.detached(priority: .userInitiated) {
            ContactColumns.review(String(decoding: bytes, as: UTF8.self))
        }.value
    }

    // MARK: - The one column whose values still have to be readable

    /// The file this app refuses to upload, given what a person has answered.
    ///
    /// Derived from the ANSWERS rather than from the detector, and that is the
    /// change: round two only ever checked the column its own patterns had
    /// claimed, so a `Description` column full of prose could be handed to
    /// `opted_out` and nothing would look at it. The column that decides who
    /// may be texted is now whichever one somebody said it was.
    static func blocker(
        _ columns: [ContactImportColumn],
        answers: [Int: ContactImportColumnAction]
    ) -> ContactImportBlocker? {
        // The case is spelled out rather than left as `.field(.optedOut)`:
        // the left side is an OPTIONAL action, and leaning on implicit member
        // lookup through an Optional is exactly the kind of thing that compiles
        // on one Swift version and not the next — on a client whose only
        // compiler is CI.
        let isTheFlag = ContactImportColumnAction.field(.optedOut)
        for column in columns where answers[column.index] == isTheFlag {
            guard column.unreadableCount > 0 else { continue }
            return ContactImportBlocker(
                header: column.header,
                values: column.unreadable,
                more: column.unreadableCount - column.unreadable.count
            )
        }
        return nil
    }

    // MARK: - What the sheet says about them

    /// What choosing `Ignore` asserts.
    ///
    /// Lives HERE, beside the rule that produces the question, rather than on
    /// the sheet: the sheet is `@MainActor`, and a piece of copy that can only
    /// be read from the main actor is a piece of copy a plain unit test cannot
    /// assert against.
    static let ignoreAssertion = localizedIgnoreAssertion(nil)

    static func localizedIgnoreAssertion(_ locale: String?) -> String {
        AppStrings.translate(locale, "contactsTasks.importIgnoreAssertion")
    }

    /// The menu's word for it. Short, because it sits in a chip beside seven
    /// field names; what it MEANS is spelled out once, above the list, in
    /// `ignoreMeaning`.
    static let ignoreLabel = localizedIgnoreLabel(nil)

    static func localizedIgnoreLabel(_ locale: String?) -> String {
        AppStrings.translate(locale, "contactsTasks.importIgnore")
    }

    /// The instruction over the list, BUILT from the assertion, so the promise
    /// a person makes and the promise they are shown cannot come to differ.
    static let ignoreMeaning = localizedIgnoreMeaning(nil)

    static func localizedIgnoreMeaning(_ locale: String?) -> String {
        AppStrings.translate(
            locale,
            "contactsTasks.importIgnoreMeaning",
            [
                "ignore": localizedIgnoreLabel(locale),
                "assertion": localizedIgnoreAssertion(locale),
            ]
        )
    }

    /// What the card is called. A constant so the two doors' headings sit
    /// beside each other in source and read as the same promise.
    static let columnsHeading = localizedColumnsHeading(nil)

    static func localizedColumnsHeading(_ locale: String?) -> String {
        AppStrings.translate(locale, "contactsTasks.importColumnsHeading")
    }

    static let columnsExplanation = localizedColumnsExplanation(nil)

    static func localizedColumnsExplanation(_ locale: String?) -> String {
        AppStrings.translate(locale, "contactsTasks.importColumnsExplanation")
    }

    /// What a column with nothing in it says for itself.
    ///
    /// It still has to be answered. An empty column is answered in one tap and
    /// costs a person nothing; an exemption for it is a rule about which
    /// columns may be skipped, which is the thing that lost twice.
    static let emptyColumnNote = localizedEmptyColumnNote(nil)

    static func localizedEmptyColumnNote(_ locale: String?) -> String {
        AppStrings.translate(locale, "contactsTasks.importEmptyColumn")
    }

    /// The bulk answer, and the only one this app offers.
    ///
    /// Allowed ONLY because it sits at the BOTTOM of the list: reaching it
    /// means scrolling past every remaining column and its values, which is the
    /// phone's version of "the columns are on screen when it is pressed". A
    /// button at the top of the card would be a way to skip the screen, which
    /// is the screen's whole opposite.
    static func ignoreRestLabel(_ count: Int, locale: String? = nil) -> String {
        AppStrings.translate(
            locale,
            count == 1
                ? "contactsTasks.importIgnoreColumnOne"
                : "contactsTasks.importIgnoreColumnsMany",
            ["count": formattedCount(count, locale: locale)]
        )
    }

    /// How many of them have an answer, said plainly.
    ///
    /// A counter rather than a bar: the number that matters is how many
    /// questions are LEFT, and it never starts at zero on a real file because
    /// the detector has already answered the phone and name columns.
    static func answeredLine(answered: Int, total: Int, locale: String? = nil) -> String {
        AppStrings.translate(
            locale,
            "contactsTasks.importProgress",
            [
                "answered": formattedCount(answered, locale: locale),
                "total": formattedCount(total, locale: locale),
            ]
        )
    }

    /// Why the Import button is grey, when it is grey for this reason.
    static func unansweredReason(_ count: Int, locale: String? = nil) -> String {
        AppStrings.translate(
            locale,
            count == 1
                ? "contactsTasks.importUnansweredColumnOne"
                : "contactsTasks.importUnansweredColumnsMany",
            ["count": formattedCount(count, locale: locale)]
        )
    }

    // MARK: - Small shared shapes

    /// A header in curly quotes, or a plain phrase when it has no name. Typing
    /// `""` around an empty header prints a pair of quotes around nothing,
    /// which reads as a bug rather than as a blank column.
    static func quoted(_ header: String, locale: String? = nil) -> String {
        let trimmed = header.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmed.isEmpty {
            return AppStrings.translate(locale, "contactsTasks.importUnnamedColumn")
        }
        return AppStrings.translate(
            locale,
            "contactsTasks.importColumnQuoted",
            ["header": trimmed]
        )
    }

    /// Counts follow the app's language rather than the device's. The pure APIs
    /// pass nil and therefore preserve their long-standing English default.
    static func formattedCount(_ value: Int, locale: String?) -> String {
        let formatter = NumberFormatter()
        formatter.locale = Locale(
            identifier: locale == MessageLocale.frCA ? "fr_CA" : "en_CA"
        )
        return formatter.string(from: NSNumber(value: value)) ?? String(value)
    }
}
