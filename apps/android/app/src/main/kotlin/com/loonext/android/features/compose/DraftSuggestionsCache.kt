package com.loonext.android.features.compose

/**
 * The drafts Lou already wrote for a conversation, kept until it moves on.
 *
 * Asking costs a real AI call, so the answer is worth keeping: closing the
 * strip and opening it again, or leaving the thread and coming back, must not
 * spend again. And there is deliberately no "try again" — re-rolling until a
 * draft looks nice is the one interaction that turns a bounded per-message cost
 * into an unbounded one, for an answer that is only ever a starting point you
 * edit anyway.
 *
 * The key carries the conversation's last activity, so the moment a message is
 * sent or received the old drafts stop applying and the next ask is a fresh
 * one. That is the only thing that should ever buy a new set.
 *
 * In memory on purpose: drafts are a momentary offer, not state worth
 * surviving a process death. Twin of
 * apps/web/src/lib/messaging/draft-suggestions-cache.ts and
 * apps/ios/Loonext/Features/Compose/DraftSuggestionsCache.swift.
 */
object DraftSuggestionsCache {
    /** Bound it so a long session over many threads cannot grow forever. */
    private const val MAX_ENTRIES = 50

    private val entries = object : LinkedHashMap<String, List<String>>(16, 0.75f, true) {
        override fun removeEldestEntry(eldest: MutableMap.MutableEntry<String, List<String>>) =
            size > MAX_ENTRIES
    }

    /** The cache key for a thread at a point in its history. */
    fun keyOf(conversationId: String, lastActivityAt: String?): String =
        "$conversationId:${lastActivityAt ?: "-"}"

    @Synchronized
    fun read(key: String): List<String>? = entries[key]

    @Synchronized
    fun write(key: String, suggestions: List<String>) {
        // "Nothing to suggest" is not worth remembering as an answer.
        if (suggestions.isEmpty()) return
        entries[key] = suggestions
    }

    @Synchronized
    fun clear() = entries.clear()
}
