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
 *
 * An interface so the composer's persistence can be driven on the JVM: what a
 * draft write must survive (#269 — the screen going away mid-debounce) is
 * exactly the kind of thing a device test would never catch reliably.
 */
interface ComposerDrafts {
    suspend fun load(conversationId: String): String
    suspend fun save(conversationId: String, text: String)
    suspend fun loadMode(conversationId: String): ComposerMode = ComposerMode.Text
    suspend fun saveMode(conversationId: String, mode: ComposerMode) = Unit
    suspend fun loadWithMode(conversationId: String): Pair<String, ComposerMode> =
        load(conversationId) to loadMode(conversationId)

    suspend fun saveWithMode(conversationId: String, text: String, mode: ComposerMode) {
        save(conversationId, text)
        saveMode(conversationId, mode)
    }
    suspend fun clear(conversationId: String)
    suspend fun loadMentions(conversationId: String): List<PickedMention>
    suspend fun saveMentions(conversationId: String, mentions: List<PickedMention>)

    /** The new-conversation screen's draft rides a fixed slot. */
    companion object {
        const val NEW_CONVERSATION = "new"
        const val MODE_KEY_PREFIX = "loonext:composer-draft-mode:"
    }
}

/** The real thing, backed by the `composer-drafts` DataStore. */
@Suppress("FunctionName")
fun ComposerDrafts(context: Context): ComposerDrafts = DataStoreComposerDrafts(context)

private class DataStoreComposerDrafts(private val context: Context) : ComposerDrafts {

    private fun key(conversationId: String) = stringPreferencesKey("draft:$conversationId")
    private fun modeKey(conversationId: String) =
        stringPreferencesKey(ComposerDrafts.MODE_KEY_PREFIX + conversationId)

    override suspend fun load(conversationId: String): String =
        context.composerDraftStore.data.first()[key(conversationId)].orEmpty()

    override suspend fun save(conversationId: String, text: String) {
        context.composerDraftStore.edit { prefs ->
            if (text.isBlank()) prefs.remove(key(conversationId))
            else prefs[key(conversationId)] = text
        }
    }

    override suspend fun loadWithMode(conversationId: String): Pair<String, ComposerMode> {
        val prefs = context.composerDraftStore.data.first()
        val mode = if (prefs[modeKey(conversationId)] == "note") ComposerMode.Note else ComposerMode.Text
        return prefs[key(conversationId)].orEmpty() to mode
    }

    override suspend fun saveWithMode(conversationId: String, text: String, mode: ComposerMode) {
        context.composerDraftStore.edit { prefs ->
            prefs[key(conversationId)] = text
            prefs[modeKey(conversationId)] = if (mode == ComposerMode.Note) "note" else "sms"
        }
    }

    override suspend fun clear(conversationId: String) {
        context.composerDraftStore.edit {
            it.remove(key(conversationId))
            it.remove(modeKey(conversationId))
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

    override suspend fun loadMentions(conversationId: String): List<PickedMention> {
        val raw = context.composerDraftStore.data.first()[mentionKey(conversationId)]
        if (raw.isNullOrEmpty()) return emptyList()
        return runCatching { Json.decodeFromString<List<PickedMention>>(raw) }
            .getOrDefault(emptyList())
    }

    override suspend fun saveMentions(conversationId: String, mentions: List<PickedMention>) {
        context.composerDraftStore.edit { prefs ->
            if (mentions.isEmpty()) {
                prefs.remove(mentionKey(conversationId))
            } else {
                prefs[mentionKey(conversationId)] = Json.encodeToString(mentions)
            }
        }
    }
}
