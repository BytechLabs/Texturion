package com.loonext.android.features.contacts.device

import com.loonext.android.features.contacts.Nanp

/**
 * Live dialer correlation (#183, part 2) — typed digits → the best matching
 * contact NAME, drawn from the app's own contacts AND the device address book.
 * Pure and Android-free so every precedence and edge case unit-tests on the JVM.
 *
 * The rule the founder set: a device contact SUPPLEMENTS the app's own contacts;
 * on a tie the app contact wins (the crew's shared book is the source of truth,
 * a personal phone entry only fills the gaps).
 */

/** Which book a dialer name came from. On an equal-quality match APP beats DEVICE. */
enum class MatchSource { APP, DEVICE }

/**
 * A correlation candidate: a display name (may be blank — a number-only contact)
 * and its raw number. App contacts (server) and device contacts collapse to this
 * one shape so the matcher is source-agnostic.
 */
data class DialerCandidate(
    val name: String?,
    val number: String,
    val source: MatchSource,
)

/** The resolved match shown next to the typed number. */
data class DialerMatch(val name: String, val source: MatchSource)

/** National digits: the bare digits with a single leading NANP country code
 *  (1) dropped, so "+14165550123", "14165550123" and "4165550123" compare equal. */
private fun nationalDigits(value: String): String {
    val digits = value.filter(Char::isDigit)
    return if (digits.length == 11 && digits.startsWith("1")) digits.drop(1) else digits
}

/**
 * Score a candidate against the typed national digits. Higher is a tighter
 * match; 0 means no match:
 *  - 3  exact national-number equality,
 *  - 2  the candidate's number ends with what was typed (a real prefix of the
 *       full number — the common "still typing the tail" case),
 *  - 1  the typed digits appear somewhere inside the candidate's number.
 */
private fun matchScore(typedNational: String, candidateNumber: String): Int {
    val candNational = nationalDigits(candidateNumber)
    if (candNational.isEmpty()) return 0
    return when {
        candNational == typedNational -> 3
        candNational.endsWith(typedNational) -> 2
        candNational.contains(typedNational) -> 1
        else -> 0
    }
}

/**
 * The best contact match for the typed digits, or null when nothing meets the
 * bar. Selection:
 *  - fewer than [minDigits] typed → null (too little to correlate confidently),
 *  - the highest-scoring candidate wins,
 *  - on a score tie an APP candidate beats a DEVICE one,
 *  - on a further tie the first candidate in list order wins (callers pass app
 *    candidates first, so this preserves the app-first intent).
 *
 * The displayed name is the candidate's name, or its number formatted NANP-style
 * when the contact is number-only.
 */
fun correlateDialedNumber(
    typed: String,
    candidates: List<DialerCandidate>,
    minDigits: Int = 4,
): DialerMatch? {
    val typedNational = nationalDigits(typed)
    if (typedNational.length < minDigits) return null

    var best: DialerCandidate? = null
    var bestScore = 0
    for (candidate in candidates) {
        val score = matchScore(typedNational, candidate.number)
        if (score == 0) continue
        val better = score > bestScore ||
            // Equal score: promote APP over an incumbent DEVICE match. A same
            // -source equal score keeps the incumbent (earlier list position).
            (score == bestScore && candidate.source == MatchSource.APP &&
                best?.source == MatchSource.DEVICE)
        if (better) {
            best = candidate
            bestScore = score
        }
    }

    val winner = best ?: return null
    val name = winner.name?.trim()?.takeIf { it.isNotEmpty() }
        ?: Nanp.formatAsYouType(winner.number)
    return DialerMatch(name = name, source = winner.source)
}

/**
 * Flatten loaded device contacts into dialer candidates — one per phone number,
 * carrying the contact's display name. The dialer merges these AFTER the app's
 * own candidates so app contacts keep tie precedence.
 */
fun deviceDialerCandidates(contacts: List<DeviceContact>): List<DialerCandidate> =
    contacts.flatMap { contact ->
        contact.numbers.map { number ->
            DialerCandidate(
                name = contact.displayName,
                number = number.e164 ?: number.raw,
                source = MatchSource.DEVICE,
            )
        }
    }
