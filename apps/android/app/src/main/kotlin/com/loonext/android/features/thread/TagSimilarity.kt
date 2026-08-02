package com.loonext.android.features.thread

import com.loonext.android.core.model.Tag
import kotlin.math.abs

/**
 * #298 — catching a near-duplicate tag before it exists.
 *
 * Hand-ported from packages/shared/src/tag-similarity.ts and covered by the
 * same vectors (TagSimilarityTest). Prevention rather than repair: sprawl is
 * invisible while it happens — each act is reasonable on its own, a tech typing
 * "warranty" instead of "Warranty" — and only becomes visible once a filter has
 * been quietly under-returning for months.
 *
 * The create-on-attach RPC already keys on `lower(name)`, so exact case
 * collisions cannot happen. What it cannot catch is "warranty" against
 * "Warranty claim" against "wrnty", which is the actual failure.
 *
 * It SUGGESTS; it never refuses. A crew that genuinely wants "Warranty" and
 * "Warranty claim" as separate tags gets both, on the second tap.
 */

private val NON_ALPHANUMERIC = Regex("[^a-z0-9]")

/**
 * Strip a name to what it MEANS, for comparison only. The stored name is
 * untouched — the crew's spelling is theirs.
 */
fun normalizeTagName(raw: String): String =
    NON_ALPHANUMERIC.replace(raw.lowercase(), "")

/**
 * Levenshtein distance, capped. Bails as soon as the best possible result
 * exceeds [cap] — the answer is only ever compared against a small threshold,
 * so an uncapped distance is work spent on a number that gets discarded.
 */
fun editDistance(a: String, b: String, cap: Int = 3): Int {
    if (a == b) return 0
    if (abs(a.length - b.length) > cap) return cap + 1

    var previous = IntArray(b.length + 1) { it }
    for (i in 1..a.length) {
        val current = IntArray(b.length + 1)
        current[0] = i
        var rowBest = i
        for (j in 1..b.length) {
            val cost = if (a[i - 1] == b[j - 1]) 0 else 1
            val value = minOf(
                current[j - 1] + 1,
                previous[j] + 1,
                previous[j - 1] + cost,
            )
            current[j] = value
            if (value < rowBest) rowBest = value
        }
        // Every remaining row can only add to the best value in this one, so
        // once that exceeds the cap the answer is settled.
        if (rowBest > cap) return cap + 1
        previous = current
    }
    return previous[b.length]
}

/** How close two typed names are, as a distance on the normalised forms. */
fun tagNameDistance(a: String, b: String): Int =
    editDistance(normalizeTagName(a), normalizeTagName(b))

/**
 * The edit distance at which two names are worth questioning. Two is a typo;
 * three starts matching genuinely different short words, and the false offers
 * would train people to dismiss the prompt.
 */
const val TAG_SUGGEST_DISTANCE = 2

/**
 * The shortest name that gets fuzzy matching at all. Below five characters an
 * edit distance of two is most of the word, so "gas" would suggest "was".
 */
private const val FUZZY_MIN_LENGTH = 5

/** The existing tag a typed name probably means, and whether it is the same idea. */
data class TagSuggestion(val tag: Tag, val exact: Boolean)

/**
 * The existing tag a typed name probably means, if there is one. Exact
 * normalised matches beat fuzzy ones; among fuzzy matches the closest wins.
 * Null when nothing is close enough — the caller then creates the tag, which is
 * the common path and must stay frictionless.
 */
fun suggestExistingTag(typed: String, existing: List<Tag>): TagSuggestion? {
    val target = normalizeTagName(typed)
    if (target.isEmpty()) return null

    var best: TagSuggestion? = null
    var bestDistance = Int.MAX_VALUE

    for (tag in existing) {
        val candidate = normalizeTagName(tag.name)
        if (candidate.isEmpty()) continue
        if (candidate == target) return TagSuggestion(tag, exact = true)
        // Fuzzy only above the length floor, and only against names that are
        // themselves long enough for a two-edit gap to mean something.
        if (target.length < FUZZY_MIN_LENGTH || candidate.length < FUZZY_MIN_LENGTH) {
            continue
        }
        val distance = editDistance(target, candidate, TAG_SUGGEST_DISTANCE)
        if (distance <= TAG_SUGGEST_DISTANCE && distance < bestDistance) {
            bestDistance = distance
            best = TagSuggestion(tag, exact = false)
        }
    }
    return best
}
