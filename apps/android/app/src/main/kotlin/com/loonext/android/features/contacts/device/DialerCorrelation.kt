package com.loonext.android.features.contacts.device

import com.loonext.android.features.contacts.Nanp

/**
 * Live dialer correlation — typed digits → who you might mean, drawn from the
 * app's own contacts AND the device address book. Pure and Android-free so
 * every precedence and edge case unit-tests on the JVM.
 *
 * The rule the founder set: a device contact SUPPLEMENTS the app's own
 * contacts; on a tie the app contact wins (the crew's shared book is the source
 * of truth, a personal phone entry only fills the gaps).
 *
 * #459 — the keypad is also a NAME search. The letters printed on the keys are
 * not decoration: 2 is ABC, so 2-6-2 spells BOB. The server does this for the
 * app's own contacts (`t9=1` on /v1/contacts, backed by the `name_t9` generated
 * column); this file does it for the device address book, which never leaves
 * the phone. Both feed the same ranking so one list comes out.
 *
 * Hand-port of `packages/shared/src/dialer.ts`. The scores, the two-digit name
 * floor, the four-digit number floor and the tie-breaks are that file's, and
 * `DialerCorrelationTest` asserts the same cases its vitest twin does. Word
 * splitting is done by hand rather than with a regex word boundary because `\b`
 * is a BACKSPACE character in a Kotlin string literal, not a boundary — it
 * would compile and silently match nothing.
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
    /** Our contact id when this came from our own book; null for device rows. */
    val contactId: String? = null,
)

/** One resolved match: what to show, what to dial, and where it came from. */
data class DialerMatch(
    val name: String,
    val number: String,
    val source: MatchSource,
    val contactId: String? = null,
    val score: Int = 0,
)

/** Fewest digits before a NUMBER match runs. Below this, the whole book matches. */
const val MIN_NUMBER_DIGITS = 4

/** Fewest digits before a NAME match runs. Two letters is how people reach. */
const val MIN_NAME_DIGITS = 2

/** How many matches the dialer shows. Four is a glance; ten is a directory. */
const val MAX_DIALER_MATCHES = 4

/** Digit for a keypad letter, or null when the character is not a letter. */
private fun t9Digit(character: Char): Char? = when (character) {
    in 'a'..'c' -> '2'
    in 'd'..'f' -> '3'
    in 'g'..'i' -> '4'
    in 'j'..'l' -> '5'
    in 'm'..'o' -> '6'
    in 'p'..'s' -> '7'
    in 't'..'v' -> '8'
    in 'w'..'z' -> '9'
    else -> null
}

/**
 * A name as its keypad digits, one entry per word: "Bob Vance" → [262, 82623].
 *
 * Per word because the match rule is per word — typing the start of a surname
 * has to find it, and letters buried mid-word must not.
 */
fun t9Words(name: String): List<String> {
    val words = mutableListOf<String>()
    val current = StringBuilder()
    for (raw in name.lowercase()) {
        val digit = t9Digit(raw)
        when {
            digit != null -> current.append(digit)
            raw.isDigit() -> current.append(raw) // "A1 Plumbing" is already keypad-shaped
            else -> {
                if (current.isNotEmpty()) words.add(current.toString())
                current.clear()
            }
        }
    }
    if (current.isNotEmpty()) words.add(current.toString())
    return words
}

/** National digits: the bare digits with a single leading NANP country code
 *  (1) dropped, so "+14165550123", "14165550123" and "4165550123" compare equal. */
fun nationalDigits(value: String): String {
    val digits = value.filter(Char::isDigit)
    return if (digits.length == 11 && digits.startsWith("1")) digits.drop(1) else digits
}

/**
 * Score a candidate against the typed digits. Zero means no match.
 *
 * The scale is spread out rather than 1-2-3 so a number match and a name match
 * can be compared without either category swallowing the other: an exact number
 * always wins, a name that STARTS with what you typed beats a number that
 * merely contains it, and a surname beats nothing but noise.
 */
fun scoreDialerCandidate(typed: String, candidate: DialerCandidate): Int {
    val typedDigits = nationalDigits(typed)
    if (typedDigits.isEmpty()) return 0

    var best = 0

    val candidateDigits = nationalDigits(candidate.number)
    if (candidateDigits.isNotEmpty() && typedDigits.length >= MIN_NUMBER_DIGITS) {
        best = when {
            candidateDigits == typedDigits -> 100
            candidateDigits.endsWith(typedDigits) -> 80
            candidateDigits.contains(typedDigits) -> 20
            else -> 0
        }
    }

    val name = candidate.name?.trim().orEmpty()
    if (name.isNotEmpty() && typedDigits.length >= MIN_NAME_DIGITS) {
        val words = t9Words(name)
        for (index in words.indices) {
            if (!words[index].startsWith(typedDigits)) continue
            // The first word is the one people reach for, so it ranks above a
            // match on a surname or the second half of a business name.
            val nameScore = if (index == 0) 60 else 40
            if (nameScore > best) best = nameScore
        }
    }

    return best
}

/**
 * The matches for what has been typed, best first, capped at [limit].
 *
 * Ties break toward our own book and then toward the order the caller passed —
 * callers pass app candidates first, so the crew's shared contacts win over a
 * personal phone entry for the same person. Duplicates collapse by number, so
 * somebody in both books appears once.
 */
fun rankDialerCandidates(
    typed: String,
    candidates: List<DialerCandidate>,
    limit: Int = MAX_DIALER_MATCHES,
): List<DialerMatch> {
    val scored = mutableListOf<Pair<Int, DialerMatch>>()

    candidates.forEachIndexed { order, candidate ->
        val score = scoreDialerCandidate(typed, candidate)
        if (score == 0) return@forEachIndexed
        // A candidate with no dialable digits is a dead row.
        if (nationalDigits(candidate.number).isEmpty()) return@forEachIndexed
        val name = candidate.name?.trim().orEmpty()
        scored.add(
            order to DialerMatch(
                name = name.ifEmpty { Nanp.formatAsYouType(candidate.number) },
                number = candidate.number,
                source = candidate.source,
                contactId = candidate.contactId,
                score = score,
            ),
        )
    }

    // Collapse duplicates AFTER sorting, never before. Deduping on the way in
    // keeps whichever row arrived first, which quietly hands the tie to a
    // device contact whenever the caller happens to list it first — and the
    // rule is that our own book wins the tie, not that it is passed first.
    val seen = mutableSetOf<String>()
    return scored
        .sortedWith(
            compareByDescending<Pair<Int, DialerMatch>> { it.second.score }
                .thenBy { if (it.second.source == MatchSource.APP) 0 else 1 }
                .thenBy { it.first },
        )
        .map { it.second }
        .filter { seen.add(nationalDigits(it.number)) }
        .take(limit)
}

/**
 * The single best match — what the readout's name line shows.
 *
 * Kept separate from `rankDialerCandidates(...).first()` because that is what
 * every caller wants, and because the label under the number should not change
 * shape when the list below it does.
 */
fun correlateDialedNumber(
    typed: String,
    candidates: List<DialerCandidate>,
): DialerMatch? = rankDialerCandidates(typed, candidates, limit = 1).firstOrNull()

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
