package com.loonext.android.features.tasks

/**
 * #690: the words that point at a task, a contact or a conversation.
 *
 *   #T-142            task number 142 in this workspace
 *   #contact-1a2b3c4d a contact (the first eight hex digits of its id)
 *   #conv-1a2b3c4d    a conversation (the same)
 *
 * Hand port of `packages/shared/src/task-references.ts`, run against
 * `packages/shared/vectors/task-references.json`. They are plain text in a note,
 * a task description or a task comment, so a client that knows nothing about
 * references shows them as typed. The rule is the server's: the token starts the
 * text or follows a character that is not a letter, a digit or `#`, and it is
 * not followed by a letter or a digit.
 *
 * There is no look-behind and no word-boundary escape here on purpose: `\b` is a
 * backspace in a Kotlin string. The text is scanned by hand.
 *
 * Customer-facing texts are NEVER read for references: nothing in the SMS
 * composer calls into this file.
 */
enum class ReferenceKind { Task, Contact, Conversation }

data class ReferenceToken(
    val kind: ReferenceKind,
    /** The task number, or the lower-case eight hex digits. */
    val key: String,
    /** Where the token starts and ends in the text, `#` included. */
    val start: Int,
    val end: Int,
    val raw: String,
)

private const val TASK_DIGITS_MAX = 9
private const val PREFIX_LENGTH = 8

private fun isWordChar(ch: Char?): Boolean =
    ch != null && ((ch in 'A'..'Z') || (ch in 'a'..'z') || (ch in '0'..'9'))

private fun isHex(ch: Char): Boolean =
    (ch in '0'..'9') || (ch in 'a'..'f') || (ch in 'A'..'F')

private fun startsWithIgnoreCase(text: String, at: Int, word: String): Boolean =
    text.regionMatches(at, word, 0, word.length, ignoreCase = true)

/** Every reference in the text, in order. */
fun parseReferenceTokens(text: String): List<ReferenceToken> {
    val out = mutableListOf<ReferenceToken>()
    var i = 0
    while (i < text.length) {
        if (text[i] != '#') {
            i += 1
            continue
        }
        val before = if (i > 0) text[i - 1] else null
        if (before != null && (isWordChar(before) || before == '#')) {
            i += 1
            continue
        }
        val body = i + 1
        var end = -1
        var kind = ReferenceKind.Task
        var key = ""
        if (startsWithIgnoreCase(text, body, "t-")) {
            var j = body + 2
            while (j < text.length && j - (body + 2) < TASK_DIGITS_MAX && text[j] in '0'..'9') j += 1
            if (j > body + 2) {
                end = j
                kind = ReferenceKind.Task
                key = text.substring(body + 2, j).toLong().toString()
            }
        } else if (startsWithIgnoreCase(text, body, "contact-")) {
            val digits = body + "contact-".length
            if (hasPrefixAt(text, digits)) {
                end = digits + PREFIX_LENGTH
                kind = ReferenceKind.Contact
                key = text.substring(digits, end).lowercase()
            }
        } else if (startsWithIgnoreCase(text, body, "conv-")) {
            val digits = body + "conv-".length
            if (hasPrefixAt(text, digits)) {
                end = digits + PREFIX_LENGTH
                kind = ReferenceKind.Conversation
                key = text.substring(digits, end).lowercase()
            }
        }
        if (end < 0) {
            i += 1
            continue
        }
        if (isWordChar(text.getOrNull(end))) {
            i = end
            continue
        }
        out += ReferenceToken(kind, key, i, end, text.substring(i, end))
        i = end
    }
    return out
}

private fun hasPrefixAt(text: String, at: Int): Boolean {
    if (at + PREFIX_LENGTH > text.length) return false
    for (k in at until at + PREFIX_LENGTH) if (!isHex(text[k])) return false
    return true
}

/** "T-142", the way a task number is shown and spoken. */
fun taskNumberLabel(number: Int): String = "T-$number"

/** The text a picker inserts for a task. */
fun taskReferenceText(number: Int): String = "#T-$number"

/** The text a picker inserts for a contact or a conversation. */
fun recordReferenceText(kind: ReferenceKind, id: String): String {
    val prefix = id.replace("-", "").take(PREFIX_LENGTH).lowercase()
    return "#" + (if (kind == ReferenceKind.Contact) "contact" else "conv") + "-" + prefix
}

/** The `#word` the caret sits at the end of: where it starts, and the query after it. */
data class ReferenceQuery(val start: Int, val query: String)

/**
 * The "#" the member just typed, if the caret sits at the end of one: the
 * query after it. A picker opens on this. Null when the caret is not in a
 * `#word`, or the `#` follows a letter or digit (a URL fragment, "No.#4").
 */
fun referenceQueryAt(text: String, caret: Int): ReferenceQuery? {
    val end = caret.coerceIn(0, text.length)
    var i = end
    while (i > 0 && (isWordChar(text[i - 1]) || text[i - 1] == '-')) i -= 1
    if (i == 0 || text[i - 1] != '#') return null
    val hash = i - 1
    val before = if (hash > 0) text[hash - 1] else null
    if (isWordChar(before) || before == '#') return null
    return ReferenceQuery(hash, text.substring(i, end))
}

/**
 * Put a picked reference where the `#word` was. Returns the new text and the
 * caret after the inserted token and its trailing space.
 */
fun insertReference(text: String, query: ReferenceQuery, caret: Int, insert: String): Pair<String, Int> {
    val end = caret.coerceIn(query.start, text.length)
    val tail = text.substring(end)
    val spaced = if (tail.startsWith(" ")) insert else "$insert "
    val next = text.substring(0, query.start) + spaced + tail
    return next to (query.start + spaced.length)
}

/**
 * The one rule that decides whether the reference picker may open for a draft.
 *
 * It opens in an internal NOTE only. A text to a customer keeps a `#` as a
 * `#`: no picker, no chip, nothing read out of the words.
 */
fun composerReferenceQuery(isInternalNote: Boolean, text: String, caret: Int = text.length): ReferenceQuery? =
    if (isInternalNote) referenceQueryAt(text, caret) else null
