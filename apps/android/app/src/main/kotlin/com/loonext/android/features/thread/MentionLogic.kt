package com.loonext.android.features.thread

import kotlinx.serialization.Serializable

/** A teammate the author picked from the mention list, with the text inserted. */
@Serializable
data class PickedMention(
    val userId: String,
    /** The display name as written into the draft, without the "@". */
    val name: String,
)

/** Where the caret lands after a mention is written into the draft. */
data class MentionInsertion(val text: String, val caret: Int)

/**
 * Mention rules for the note composer, ported byte-for-byte from the web
 * client's `components/thread/mentions.ts`. Both clients POST the same
 * `mention_user_ids`, so a difference here is a difference in who gets told.
 */
object MentionLogic {

    /**
     * Which picks survive to the send.
     *
     * Each pick must claim its OWN "@Name" in the draft, and a claimed span is
     * consumed so nothing else can match inside it. A plain "contains" test
     * looks equivalent and is not: display names are neither unique nor
     * prefix-free, so with "Sam" and "Sam Rivera" both picked, deleting "@Sam"
     * left "@Sam Rivera" behind, which still contains "@Sam" and notified the
     * withdrawn person. Two teammates who share a name had the same problem.
     *
     * Longest name first, because "@Sam Rivera" must take that span before
     * "@Sam" can look at it.
     */
    fun resolveMentions(text: String, picked: List<PickedMention>): List<String> {
        val claimed = mutableListOf<IntRange>()
        val ids = LinkedHashSet<String>()
        for (mention in picked.sortedByDescending { it.name.length }) {
            val token = "@${mention.name}"
            var from = 0
            while (true) {
                val at = text.indexOf(token, from)
                if (at < 0) break
                val end = at + token.length
                val overlaps = claimed.any { at < it.last && end > it.first }
                if (!overlaps) {
                    claimed.add(at until end)
                    ids.add(mention.userId)
                    break
                }
                from = at + 1
            }
        }
        return ids.toList()
    }

    /**
     * Whether an "@" typed at this position is asking for the picker.
     *
     * Only at the start of the draft or after whitespace. Mid-word it is part
     * of something being written: an email address, a rate like "2 hrs @ $95",
     * a handle. Opening a teammate picker there makes an ordinary internal note
     * impossible to type.
     */
    fun isMentionTrigger(text: String, caret: Int): Boolean {
        if (caret <= 0 || caret > text.length) return false
        if (text[caret - 1] != '@') return false
        if (caret == 1) return true
        return text[caret - 2].isWhitespace()
    }

    /**
     * Insert a mention at the caret, swallowing the "@" that opened the picker
     * so the draft never reads "@@Sam".
     */
    fun insertMention(text: String, caret: Int, name: String): MentionInsertion {
        val safeCaret = caret.coerceIn(0, text.length)
        val trigger =
            if (safeCaret > 0 && text[safeCaret - 1] == '@') safeCaret - 1 else safeCaret
        val before = text.substring(0, trigger)
        val after = text.substring(safeCaret)
        // A trailing space keeps typing natural, but not a second one.
        val spacer = if (after.startsWith(" ")) "" else " "
        val inserted = "@$name$spacer"
        return MentionInsertion(before + inserted + after, before.length + inserted.length)
    }
}
