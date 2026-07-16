package com.loonext.android.features.compose

import android.content.Context
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import kotlinx.coroutines.flow.first

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
        context.composerDraftStore.edit { it.remove(key(conversationId)) }
    }
}
