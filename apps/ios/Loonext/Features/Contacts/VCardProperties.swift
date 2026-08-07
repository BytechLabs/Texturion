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
    /// Upper-cased, group prefix and parameters stripped — the shape the server
    /// reports and matches on.
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

    var id: String { name }

    var title: String { name.isEmpty ? "A property with no name" : name }

    var cardLine: String {
        cards == 1 ? "on 1 card" : "on \(cards.formatted()) cards"
    }

    /// Its values, said out loud, bounded.
    var sampleLine: String {
        samples.isEmpty ? cardLine : cardLine + " · " + samples.joined(separator: " · ")
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
            if skip.contains(parsed.name) { continue }
            if !order.contains(parsed.name) { order.append(parsed.name) }
            onThisCard.insert(parsed.name)

            let value = parsed.value.trimmingCharacters(in: .whitespacesAndNewlines)
            if value.isEmpty { continue }
            var distinct = seen[parsed.name] ?? []
            if distinct.count < ContactColumns.sampleLimit,
                distinct.insert(value.lowercased()).inserted {
                samples[parsed.name, default: []].append(value)
            }
            seen[parsed.name] = distinct
        }
        flush()

        return order.map { name in
            VCardProperty(
                name: name,
                cards: cards[name] ?? 0,
                samples: samples[name] ?? []
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

    /// Split a content line into its property name and raw value.
    ///
    /// The value begins after the first colon that is not inside a quoted
    /// parameter (`TEL;TYPE="work,voice":…`). The name is everything before the
    /// first `;`, with a group prefix (`item1.CATEGORIES`) stripped and the
    /// result upper-cased — all four of those are what the server does, and a
    /// port that skipped any one of them would report a property name the
    /// server never asks about while missing the one it does.
    private static func contentLine(_ line: String) -> (name: String, value: String)? {
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
        guard let colon = found else { return nil }

        var name = String(line[line.startIndex ..< colon])
        if let semi = name.firstIndex(of: ";") {
            name = String(name[name.startIndex ..< semi])
        }
        name = name.trimmingCharacters(in: .whitespacesAndNewlines)
        if let dot = name.lastIndex(of: ".") {
            name = String(name[name.index(after: dot)...])
        }
        return (name: name.uppercased(), value: String(line[line.index(after: colon)...]))
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
