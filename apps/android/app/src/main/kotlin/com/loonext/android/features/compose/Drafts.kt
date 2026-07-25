package com.loonext.android.features.compose

import android.content.Context
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import com.loonext.android.features.thread.PickedMention
import kotlinx.coroutines.flow.first
import kotlinx.serialization.json.Json

private val Context.composerDraftStore by preferencesDataStore(name = "composer-drafts")

/**
 * Client-side composer drafts, one per conversation (SPEC: the server keeps NO
 * drafts — restore-on-failure and cross-open persistence are purely ours).
 * Text only: staged photos/files are content URIs whose read permission does
 * not survive the process, so persisting them would restore dead chips.
 */
class ComposerDrafts(private val context: Context) {

    private fun key(conversationId: String) = stringPreferencesKey("draft:$conversationId")

    /** The new-conversation screen's draft rides a fixed slot. */
    companion object {
        const val NEW_CONVERSATION = "new"
    }

    suspend fun load(conversationId: String): String =
        context.composerDraftStore.data.first()[key(conversationId)].orEmpty()

    suspend fun save(conversationId: String, text: String) {
        context.composerDraftStore.edit { prefs ->
            if (text.isBlank()) prefs.remove(key(conversationId))
            else prefs[key(conversationId)] = text
        }
    }

    suspend fun clear(conversationId: String) {
        context.composerDraftStore.edit {
            it.remove(key(conversationId))
            it.remove(mentionKey(conversationId))
        }
    }

    // --- Note mentions ------------------------------------------------------
    //
    // The teammates named on a note draft ride WITH the text. Persisting only
    // the words restored a draft that still read "@Sam" and notified nobody,
    // which is worse than losing the draft: the note on screen was evidence of
    // something that would not happen.
    //
    // JSON under a separate key, so a draft written by an older build still
    // loads and a value we cannot parse costs the picks rather than the draft.

    private fun mentionKey(conversationId: String) =
        stringPreferencesKey("draft-mentions:$conversationId")

    suspend fun loadMentions(conversationId: String): List<PickedMention> {
        val raw = context.composerDraftStore.data.first()[mentionKey(conversationId)]
        if (raw.isNullOrEmpty()) return emptyList()
        return runCatching { Json.decodeFromString<List<PickedMention>>(raw) }
            .getOrDefault(emptyList())
    }

    suspend fun saveMentions(conversationId: String, mentions: List<PickedMention>) {
        context.composerDraftStore.edit { prefs ->
            if (mentions.isEmpty()) {
                prefs.remove(mentionKey(conversationId))
            } else {
                prefs[mentionKey(conversationId)] = Json.encodeToString(mentions)
            }
        }
    }
}
