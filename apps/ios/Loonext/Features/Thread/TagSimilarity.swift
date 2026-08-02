import Foundation

/// #298 — catching a near-duplicate tag before it exists.
///
/// Hand-ported from packages/shared/src/tag-similarity.ts (and the Android
/// TagSimilarity.kt twin), covered by the same vectors in TagSimilarityTests.
/// Prevention rather than repair: sprawl is invisible while it happens — each
/// act is reasonable on its own, a tech typing "warranty" instead of
/// "Warranty" — and only becomes visible once a filter has been quietly
/// under-returning for months.
///
/// The create-on-attach RPC already keys on `lower(name)`, so exact case
/// collisions cannot happen. What it cannot catch is "warranty" against
/// "Warranty claim" against "wrnty", which is the actual failure.
///
/// It SUGGESTS; it never refuses. A crew that genuinely wants "Warranty" and
/// "Warranty claim" as separate tags gets both, on the second tap.

private let tagAlphabet = Set("abcdefghijklmnopqrstuvwxyz0123456789")

/// Strip a name to what it MEANS, for comparison only. The stored name is
/// untouched — the crew's spelling is theirs.
func normalizeTagName(_ raw: String) -> String {
    String(raw.lowercased().filter { tagAlphabet.contains($0) })
}

/// Levenshtein distance, capped. Bails as soon as the best possible result
/// exceeds `cap` — the answer is only ever compared against a small threshold,
/// so an uncapped distance is work spent on a number that gets discarded.
func editDistance(_ a: String, _ b: String, cap: Int = 3) -> Int {
    if a == b { return 0 }
    let x = Array(a)
    let y = Array(b)
    if abs(x.count - y.count) > cap { return cap + 1 }
    // Past the length guard above, an empty side is within the cap by
    // definition, and its distance is just the other side's length.
    if x.isEmpty { return y.count }
    if y.isEmpty { return x.count }

    var previous = Array(0...y.count)
    for i in 1...x.count {
        var current = [i]
        var rowBest = i
        for j in 1...y.count {
            let cost = x[i - 1] == y[j - 1] ? 0 : 1
            let value = min(
                current[j - 1] + 1,
                previous[j] + 1,
                previous[j - 1] + cost
            )
            current.append(value)
            if value < rowBest { rowBest = value }
        }
        // Every remaining row can only add to the best value in this one, so
        // once that exceeds the cap the answer is settled.
        if rowBest > cap { return cap + 1 }
        previous = current
    }
    return previous[y.count]
}

/// How close two typed names are, as a distance on the normalised forms.
func tagNameDistance(_ a: String, _ b: String) -> Int {
    editDistance(normalizeTagName(a), normalizeTagName(b))
}

/// The edit distance at which two names are worth questioning. Two is a typo;
/// three starts matching genuinely different short words, and the false offers
/// would train people to dismiss the prompt.
let tagSuggestDistance = 2

/// The shortest name that gets fuzzy matching at all. Below five characters an
/// edit distance of two is most of the word, so "gas" would suggest "was".
private let fuzzyMinLength = 5

/// The existing tag a typed name probably means, and whether it is the same idea.
struct TagSuggestion {
    let tag: Tag
    let exact: Bool
}

/// The existing tag a typed name probably means, if there is one. Exact
/// normalised matches beat fuzzy ones; among fuzzy matches the closest wins.
/// Nil when nothing is close enough — the caller then creates the tag, which is
/// the common path and must stay frictionless.
func suggestExistingTag(_ typed: String, existing: [Tag]) -> TagSuggestion? {
    let target = normalizeTagName(typed)
    if target.isEmpty { return nil }

    var best: TagSuggestion?
    var bestDistance = Int.max

    for tag in existing {
        let candidate = normalizeTagName(tag.name)
        if candidate.isEmpty { continue }
        if candidate == target { return TagSuggestion(tag: tag, exact: true) }
        // Fuzzy only above the length floor, and only against names that are
        // themselves long enough for a two-edit gap to mean something.
        if target.count < fuzzyMinLength || candidate.count < fuzzyMinLength {
            continue
        }
        let distance = editDistance(target, candidate, cap: tagSuggestDistance)
        if distance <= tagSuggestDistance && distance < bestDistance {
            bestDistance = distance
            best = TagSuggestion(tag: tag, exact: false)
        }
    }
    return best
}
