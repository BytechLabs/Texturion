import Foundation

struct SettingsSearchResult: Equatable, Sendable {
    let entry: SettingsIndexEntry
    /// The text to show: the entry's first word in the viewer's language.
    let label: String
    /// 0 when the query matched the label, 1 for a synonym.
    let rank: Int
}

/// Lowercase, accents and punctuation removed, one space between words.
func normalizeSettingsQuery(_ value: String) -> String {
    var out = ""
    var lastWasSpace = true
    for scalar in value.decomposedStringWithCanonicalMapping.unicodeScalars {
        if (0x300...0x36F).contains(scalar.value) { continue }
        let upper = (0x41...0x5A).contains(scalar.value)
        let lowered = upper ? scalar.value + 32 : scalar.value
        if (0x61...0x7A).contains(lowered) || (0x30...0x39).contains(lowered) {
            out.unicodeScalars.append(Unicode.Scalar(lowered) ?? scalar)
            lastWasSpace = false
        } else if !lastWasSpace {
            out += " "
            lastWasSpace = true
        }
    }
    return out.trimmingCharacters(in: .whitespaces)
}

private func tail(_ chars: [Character], from index: Int) -> [Character] {
    index >= chars.count ? [] : Array(chars[index...])
}

/// Is `a` within one edit (insert, delete, replace, swap) of `b`?
private func withinOneEdit(_ a: [Character], _ b: [Character]) -> Bool {
    if a == b { return true }
    let gap = a.count - b.count
    if abs(gap) > 1 { return false }
    var i = 0
    while i < a.count, i < b.count, a[i] == b[i] { i += 1 }
    if gap == 0 {
        if tail(a, from: i + 1) == tail(b, from: i + 1) { return true }
        let aAtI: Character? = i < a.count ? a[i] : nil
        let bNext: Character? = i + 1 < b.count ? b[i + 1] : nil
        let aNext: Character? = i + 1 < a.count ? a[i + 1] : nil
        let bAtI: Character? = i < b.count ? b[i] : nil
        return aAtI == bNext && aNext == bAtI && tail(a, from: i + 2) == tail(b, from: i + 2)
    }
    return gap > 0
        ? tail(a, from: i + 1) == tail(b, from: i)
        : tail(b, from: i + 1) == tail(a, from: i)
}

/// Does `word` start with `token`, give or take one typo in a long token?
private func wordMatches(_ token: String, _ word: String, allowTypo: Bool) -> Bool {
    if word.hasPrefix(token) { return true }
    if !allowTypo || token.count < 4 { return false }
    let t = Array(token)
    let w = Array(word)
    for length in [t.count - 1, t.count, t.count + 1] where length > 0 {
        if withinOneEdit(t, Array(w.prefix(length))) { return true }
    }
    return false
}

private func splitWords(_ value: String) -> [String] {
    value.split(separator: " ", omittingEmptySubsequences: false).map(String.init)
}

private func phraseMatches(_ query: String, _ phrase: String) -> Bool {
    let words = splitWords(phrase)
    let tokens = splitWords(query)
    // A typo is forgiven only in a one-word query; across two words it lets
    // "zone" find "one" and the list fills with noise.
    let allowTypo = tokens.count == 1
    if tokens.allSatisfy({ token in words.contains { wordMatches(token, $0, allowTypo: allowTypo) } }) {
        return true
    }
    // "timezone" typed for "time zone", and the other way round.
    let joined = query.replacingOccurrences(of: " ", with: "")
    return joined.count >= 3
        && phrase.replacingOccurrences(of: " ", with: "").hasPrefix(joined)
}

/// The settings that match `query`, label matches first, then synonyms, each
/// group in index order. Only sections `canSee` allows are searched.
func searchSettings(
    _ query: String,
    locale: String?,
    canSee: (_ section: String) -> Bool
) -> [SettingsSearchResult] {
    let q = normalizeSettingsQuery(query)
    if q.isEmpty { return [] }
    let french = locale?.hasPrefix("fr") == true
    var results: [SettingsSearchResult] = []
    for item in SettingsSearchIndex.entries {
        if !canSee(item.section) { continue }
        let words = french ? item.fr : item.en
        guard let label = words.first else { continue }
        let rank: Int
        if phraseMatches(q, normalizeSettingsQuery(label)) {
            rank = 0
        } else if words.dropFirst().contains(where: { phraseMatches(q, normalizeSettingsQuery($0)) }) {
            rank = 1
        } else {
            rank = -1
        }
        if rank >= 0 { results.append(SettingsSearchResult(entry: item, label: label, rank: rank)) }
    }
    // Stable by construction: index order inside each rank.
    return results.filter { $0.rank == 0 } + results.filter { $0.rank == 1 }
}

/// The phone section an entry opens, or nil when this phone has no such screen.
func phoneSection(of entry: SettingsIndexEntry) -> SettingsSection? {
    switch entry.section {
    case "hours":
        return entry.page == "automatic-texts" ? .automaticTexts : .hours
    // Sign-in, password, two-factor and account deletion live under Profile here.
    case "account":
        return .profile
    default:
        return SettingsSection.allCases.first { $0.sharedId == entry.section }
    }
}

/// A result on this phone: the setting, where it sits, and what opening it does.
struct PhoneSettingResult: Identifiable, Equatable {
    let entry: SettingsIndexEntry
    let label: String
    let group: SettingsGroup
    let section: SettingsSection

    var id: String { entry.id }
}

/// Search for this role. A setting is offered only when its section is one the
/// role can open (the same rule as the list) and this phone has a screen for it.
func searchPhoneSettings(
    _ query: String,
    locale: String?,
    visible: [SettingsSection]
) -> [PhoneSettingResult] {
    searchSettings(query, locale: locale) { shared in
        (shared == "account" && visible.contains(.profile))
            || visible.contains { $0.sharedId == shared }
    }.compactMap { result in
        guard let section = phoneSection(of: result.entry), visible.contains(section) else {
            return nil
        }
        return PhoneSettingResult(
            entry: result.entry,
            label: result.label,
            group: section.group,
            section: section
        )
    }
}
