import Foundation

/// What a caller may say about ONE vCard property.
///
/// TWO ANSWERS, not the CSV's eight. A vCard property is not a column of values
/// to route into a field — it is present on a card or it is not — so the
/// answers that mean anything are "this says nothing about who may be texted"
/// and "a card carrying this must not be texted".
enum VCardPropertyAction: Hashable, Sendable, CaseIterable {
    case ignore
    case optedOut

    /// Both tokens off shipped constants: the CSV door's `ignore`, and the
    /// contact field's own wire name. Retyping either here is how the two doors
    /// come to disagree about a word the server matches exactly.
    var wire: String {
        switch self {
        case .ignore: return ContactImport.ignoreAction
        case .optedOut: return ContactImportField.optedOut.rawValue
        }
    }

    var label: String {
        switch self {
        case .ignore: return ContactColumns.ignoreLabel
        // Deliberately blunt about how COARSE this is: declaring it blocks
        // every card carrying the property at all, a `CATEGORIES` of "Friends"
        // alongside one of "DNC". Coarse in the direction of not texting
        // somebody is the only direction this feature may be wrong in, and the
        // person choosing it can see which cards carry it.
        case .optedOut: return "Don't text any card with it"
        }
    }

    var icon: String {
        switch self {
        case .ignore: return "minus.circle"
        case .optedOut: return ContactImportField.optedOut.icon
        }
    }
}

/// One property's answer, exactly as it goes on the wire.
struct VCardPropertyDeclaration: Hashable, Sendable {
    /// Upper-cased property name, as the scan reports it.
    let property: String
    let action: VCardPropertyAction

    /// `<PROPERTY>:<action>`, the shared contract's format. Assembled here so
    /// the order lives in one place — `ContactImportColumnsTests` rebuilds this
    /// from the template it reads out of `formatVCardProperty`.
    var wire: String {
        "\(property):\(action.wire)"
    }
}

/// One property these cards actually carry, and what a person needs to answer
/// for it.
struct VCardProperty: Identifiable, Hashable, Sendable {
    /// Upper-cased with any group prefix dropped — the shape the server reports
    /// and matches on.
    ///
    /// A PARAMETER IS ONE OF THESE TOO, named `TEL;TYPE` (see
    /// `VCardProperties.parameterProperty`). It used to say "parameters stripped",
    /// and that was the defect: the server demands a declaration for each one, so
    /// stripping them meant every real Apple export was refused for a token this
    /// app had never put on the screen.
    let name: String

    /// How many cards carry it. "3 of 60 cards" is the difference between a
    /// stray field and a suppression marker somebody has to look at.
    let cards: Int

    /// A few distinct values, so `DNC` is on the screen before it is dismissed.
    ///
    /// Not in the shared contract, and deliberately: the server names a
    /// property back to a program, which can only pass the name on. A person
    /// cannot decide whether `CATEGORIES` restricts texting without seeing that
    /// it says `DNC`.
    let samples: [String]

    /// Every distinct value held for this property, for somebody who asks to see
    /// them. Bounded only by `ContactColumns.valueCeiling`.
    let values: [String]

    /// How many distinct values these cards really carry for it.
    let total: Int

    var id: String { name }

    var title: String { name.isEmpty ? "A property with no name" : name }

    var cardLine: String {
        cards == 1 ? "on 1 card" : "on \(cards.formatted()) cards"
    }

    /// Its values, said out loud, bounded — and the count of the ones left out.
    var sampleLine: String { line(showingAll: false) }

    /// The same line in either state. Expanded, it reports the length of what it
    /// actually listed, so it does not end in ", and 40 more" while
    /// `ContactColumns.valueCeilingNote` says the same thing a second way.
    func line(showingAll: Bool) -> String {
        let listed = showingAll ? values : samples
        if listed.isEmpty { return cardLine }
        let hidden = (showingAll ? values.count : total) - listed.count
        let more = hidden > 0 ? ", and \(hidden) more" : ""
        return cardLine + " · " + listed.joined(separator: " · ") + more
    }
}

extension VCardProperty {
    /// A property whose values are all on screen — the hand-built case.
    ///
    /// In an EXTENSION rather than the body for the same reason
    /// `ContactImportColumn`'s is: an initializer inside the struct suppresses the
    /// memberwise one, and the memberwise one is what `read` uses to fill all five
    /// fields. `values` and `total` come from `samples`, which is what every
    /// caller of this init means by a property built by hand.
    init(name: String, cards: Int, samples: [String]) {
        self.init(
            name: name,
            cards: cards,
            samples: samples,
            values: samples,
            total: samples.count
        )
    }
}

/// THE SAME RULE AT THE vCARD DOOR, in the shape that format allows.
///
/// # A hand-port of the property half of `apps/api/src/routes/core/vcard.ts`
///
/// #248 round 3. That door had no gate of ANY kind. `CATEGORIES:DNC` and
/// `NOTE:DO NOT CONTACT - asked us to stop` are the only two places a .vcf can
/// say do-not-text, they are what Apple and Google actually export, and both
/// were dropped by the parser without a word while the file's consent
/// attestation was written over the top.
///
/// A .vcf has no columns to count, so what is enumerated is the PROPERTIES the
/// cards actually carry. Everything the importer does not read has to be
/// declared `ignore` or `opted_out` — and this app is where the person who can
/// see the values sits, exactly as it is for a CSV column.
///
/// # What this scan is and is not
///
/// It reads property NAMES and a few of their values. It does not extract
/// names, phones, or anything else — the server does that, and duplicating it
/// here would be two parsers that have to agree about a person. What these two
/// must agree about is a much smaller thing: which property names are present.
enum VCardProperties {

    /// The properties the importer reads. Everything else must be declared.
    ///
    /// `FN`, `N` and `TEL` are mapped; `BEGIN`, `END` and `VERSION` are the
    /// format's own furniture and carry nothing about a person. Read out of
    /// `VCARD_MAPPED_PROPERTIES` by the guard, so a property the server starts
    /// reading cannot go on being asked about here.
    static let mapped = ["FN", "N", "TEL", "BEGIN", "END", "VERSION"]

    /// How a PARAMETER is named as a thing to be declared: `TEL;TYPE`.
    ///
    /// The server's spelling, from the shared contract, and it has to match
    /// exactly: a token spelled differently is a declaration answering a question
    /// nobody asked, and the upload is refused for the one still outstanding.
    ///
    /// `TEL` is mapped and `TEL;TYPE` is NOT, which is the whole point. The
    /// exemption belongs to a property name, never to the parameters hanging off
    /// it — `TEL;TYPE=CELL;X-ABLabel=DO NOT CALL:+1613…` is Apple's inline shape,
    /// and the one sentence on that line saying not to text this person lives in a
    /// parameter of a mapped property.
    static func parameterProperty(_ property: String, _ parameter: String) -> String {
        "\(property);\(parameter)"
    }

    /// Every property these cards carry that the importer does not read, in the
    /// order the file first used them.
    static func scan(_ text: String) -> [VCardProperty] {
        let skip = Set(mapped)
        var order: [String] = []
        var cards: [String: Int] = [:]
        var samples: [String: [String]] = [:]
        var seen: [String: Set<String>] = [:]
        var inCard = false
        var onThisCard = Set<String>()

        // Counted PER CARD rather than per line: a card with three `EMAIL`
        // lines carries the property once, and "on 60 cards" has to mean sixty
        // people rather than sixty lines.
        func flush() {
            guard inCard else { return }
            for name in onThisCard { cards[name, default: 0] += 1 }
            onThisCard.removeAll()
            inCard = false
        }

        for line in unfold(text) {
            let trimmed = line.trimmingCharacters(in: .whitespacesAndNewlines)
            if isBoundary(trimmed, "BEGIN") {
                // A nested or duplicate BEGIN starts a fresh card, exactly as
                // the server's parser does, so the two count the same cards.
                flush()
                inCard = true
                continue
            }
            if isBoundary(trimmed, "END") {
                flush()
                continue
            }
            guard inCard, let parsed = contentLine(line) else { continue }

            // EVERY token the server will demand a declaration for: the property
            // AND each of its parameters, each carrying the text a person needs to
            // read. The mapped exemption is applied PER TOKEN rather than per
            // line, which is the fix — `TEL` is mapped and `TEL;TYPE` is not, so
            // skipping the whole line because its property was mapped left every
            // parameter of every mapped property out of the declaration. Real
            // Apple and Google exports put `TEL;TYPE=CELL` on nearly every card,
            // so the server refused the upload for a token this app had never
            // shown, and no answer on the screen could satisfy it.
            var tokens: [(name: String, value: String)] = [
                (parsed.name, parsed.value ?? "")
            ]
            for param in parsed.params {
                tokens.append(
                    (parameterProperty(parsed.name, param.name), param.value)
                )
            }

            for token in tokens {
                if skip.contains(token.name) { continue }
                if !order.contains(token.name) { order.append(token.name) }
                onThisCard.insert(token.name)

                let value = token.value.trimmingCharacters(in: .whitespacesAndNewlines)
                if value.isEmpty { continue }
                var distinct = seen[token.name] ?? []
                // ALWAYS counted, bounded only for showing. This used to stop
                // inserting at `sampleLimit`, which meant the set could never say
                // how many values a property really carried — so "and more" was
                // the only thing it could honestly print.
                if distinct.insert(value.lowercased()).inserted,
                    (samples[token.name]?.count ?? 0) < ContactColumns.valueCeiling {
                    samples[token.name, default: []].append(value)
                }
                seen[token.name] = distinct
            }
        }
        flush()

        return order.map { name in
            let held = samples[name] ?? []
            return VCardProperty(
                name: name,
                cards: cards[name] ?? 0,
                samples: Array(held.prefix(ContactColumns.sampleLimit)),
                values: held,
                total: seen[name]?.count ?? 0
            )
        }
    }

    /// The same answer, off the main actor — a .vcf may be five megabytes.
    static func scanFile(_ bytes: Data) async -> [VCardProperty] {
        await Task.detached(priority: .userInitiated) {
            VCardProperties.scan(String(decoding: bytes, as: UTF8.self))
        }.value
    }

    // MARK: - The format

    /// `BEGIN:VCARD` / `END:VCARD`, case-insensitively and nothing else on the
    /// line — the server anchors both, and a line merely starting with them is
    /// an ordinary property.
    private static func isBoundary(_ line: String, _ word: String) -> Bool {
        line.caseInsensitiveCompare(word + ":VCARD") == .orderedSame
    }

    /// Unfold RFC 6350 / 2426 folded lines: a line starting with SPACE or TAB
    /// continues the one before it.
    ///
    /// Folding is not decoration — Google exports a long `NOTE` wrapped across
    /// four lines, and a reader that did not join them would see three property
    /// lines with no colon and drop the note that says they asked us to stop.
    private static func unfold(_ text: String) -> [String] {
        let normalized = text
            .replacingOccurrences(of: "\r\n", with: "\n")
            .replacingOccurrences(of: "\r", with: "\n")
        var lines: [String] = []
        for line in normalized.components(separatedBy: "\n") {
            if (line.hasPrefix(" ") || line.hasPrefix("\t")), !lines.isEmpty {
                lines[lines.count - 1] += String(line.dropFirst())
            } else {
                lines.append(line)
            }
        }
        return lines
    }

    /// Split a content line into its property name, its parameters, and its value.
    ///
    /// The value begins after the first colon that is not inside a quoted
    /// parameter (`TEL;TYPE="work,voice":…`). The name is everything before the
    /// first `;`, each segment after it is a parameter carrying the free text to
    /// its right, with a group prefix (`item1.CATEGORIES`) stripped and the
    /// result upper-cased — all four of those are what the server does, and a
    /// port that skipped any one of them would report a property name the
    /// server never asks about while missing the one it does.
    /// One parameter on a content line: its name, and the free text after the `=`.
    private struct ContentParameter {
        let name: String
        let value: String
    }

    /// A content line split the way the server splits it.
    private struct ContentLine {
        let name: String
        let params: [ContentParameter]
        /// `nil` when the line carried no colon — nothing to read, only something
        /// to declare.
        let value: String?
    }

    private static func contentLine(_ line: String) -> ContentLine? {
        var inQuotes = false
        var found: String.Index? = nil
        var cursor = line.startIndex
        while cursor < line.endIndex {
            let char = line[cursor]
            if char == "\"" {
                inQuotes.toggle()
            } else if char == ":", !inQuotes {
                found = cursor
                break
            }
            cursor = line.index(after: cursor)
        }

        // A LINE WITH NO COLON IS STILL A LINE SOMEBODY WROTE. This used to return
        // nil the moment it could not find one, which dropped `DO-NOT-CALL` and
        // `CATEGORIES;TYPE="a:DNC` before either could be asked about.
        let namePart = found.map { String(line[line.startIndex ..< $0]) } ?? line
        let value = found.map { String(line[line.index(after: $0)...]) }

        let segments = namePart.split(separator: ";", omittingEmptySubsequences: false)
        var name = String(segments.first ?? "")
            .trimmingCharacters(in: .whitespacesAndNewlines)
        if let dot = name.lastIndex(of: ".") {
            name = String(name[name.index(after: dot)...])
        }
        // Nil for one case only, and the server returns it for the same one: a
        // line whose property name is empty. There is no token to declare and
        // nothing a person could answer about it.
        if name.isEmpty { return nil }

        var params: [ContentParameter] = []
        for segment in segments.dropFirst() {
            let text = String(segment)
            let equals = text.firstIndex(of: "=")
            // `TYPE=CELL` is the parameter TYPE; a valueless `PREF` is its own
            // name. Everything to the RIGHT of the `=` is the free text nobody
            // read, and it is the reason the parameter has to be declared at all.
            let rawName = equals.map { String(text[text.startIndex ..< $0]) } ?? text
            let paramName = rawName
                .trimmingCharacters(in: .whitespacesAndNewlines)
                .uppercased()
            if paramName.isEmpty { continue }
            var raw = (equals.map { String(text[text.index(after: $0)...]) } ?? "")
                .trimmingCharacters(in: .whitespacesAndNewlines)
            if raw.hasPrefix("\"") { raw.removeFirst() }
            if raw.hasSuffix("\"") { raw.removeLast() }
            params.append(ContentParameter(name: paramName, value: raw))
        }

        return ContentLine(name: name.uppercased(), params: params, value: value)
    }

    // MARK: - What the sheet says about them

    static let heading = "Every property, accounted for"

    static let explanation = """
        These cards carry fields this import doesn't read. A card's \
        CATEGORIES or a NOTE saying they asked us to stop is the only place a \
        vCard can say do-not-text, so each one needs an answer.
        """

    /// Why the Import button is grey, when it is grey for this reason.
    static func unansweredReason(_ count: Int) -> String {
        count == 1
            ? "1 property still needs an answer."
            : "\(count.formatted()) properties still need an answer."
    }

    /// The bulk answer, at the bottom of the list for the same reason the CSV's
    /// is — see `ContactColumns.ignoreRestLabel`.
    static func ignoreRestLabel(_ count: Int) -> String {
        count == 1
            ? "Ignore the 1 property left"
            : "Ignore the \(count.formatted()) properties left"
    }
}
