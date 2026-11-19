package com.loonext.android.core.auth

import android.content.Context
import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.longPreferencesKey
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import com.loonext.android.core.model.Me
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.withContext
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import java.io.IOException

/** The persisted Supabase session. */
data class Session(
    val accessToken: String,
    val refreshToken: String,
    /** Epoch seconds when the access token expires. */
    val expiresAt: Long,
    val userId: String,
    val email: String,
) {
    fun isExpired(nowEpochSeconds: Long = System.currentTimeMillis() / 1000): Boolean =
        // 60s early so a token never dies mid-request.
        nowEpochSeconds >= expiresAt - 60
}

private val Context.sessionDataStore by preferencesDataStore(name = "session")

@Serializable
private data class CachedWorkspace(val companyId: String, val me: Me)

/** Session persistence seam — [SessionStore] in the app, in-memory in tests. */
interface SessionSource {
    val session: Flow<Session?>
    suspend fun current(): Session?
    suspend fun save(session: Session)
    suspend fun clear()
}

/**
 * #330 — everything of the customer's that lives outside the session, wiped when the
 * session ends.
 *
 * ## Why it hangs off the STORE rather than off sign-out
 *
 * A session ends two ways: somebody taps Sign out, or the server refuses the refresh
 * token because the session was revoked. Only the first went through
 * `AuthManager.signOut`, so only the first cleared the render cache, the unread
 * counts and the Connected-Apps rows. The second — a member deactivated, or an owner
 * signing a departed tech's phone out from Devices (#236) — dropped the token and
 * left the customer data sitting on a phone the company does not own and cannot ask
 * back. That is the case #330 says matters most.
 *
 * Attaching it to [SessionSource.clear] rather than to either call site means a third
 * way for a session to end cannot forget: whatever kills the session runs this.
 *
 * ## Every listener must tolerate being wrong about the reason
 *
 * A revocation arrives on a background refresh with a screen open. Failing here must
 * not throw — the token is already gone and the person is on their way to the sign-in
 * screen either way, so a failed cache eviction has to be swallowed and never turned
 * into a crash on the way out.
 */
object SessionEnded {
    private val listeners = mutableListOf<() -> Unit>()

    /** Registered once, by the composition root. */
    fun onEnded(listener: () -> Unit) {
        listeners += listener
    }

    /** Called by every [SessionSource.clear] implementation. Never throws. */
    fun fire() {
        for (listener in listeners) runCatching { listener() }
    }

    /** Tests only: the app registers at startup and never unregisters. */
    internal fun reset() = listeners.clear()
}

/**
 * App-private DataStore persistence for the Supabase session. Android's app
 * sandbox is the protection boundary (current platform guidance — the old
 * security-crypto wrappers are deprecated).
 */
class SessionStore(
    context: Context,
    private val discardOfflineReads: suspend () -> Unit = {},
    preferences: DataStore<Preferences>? = null,
) : SessionSource {
    private object Keys {
        val ACCESS = stringPreferencesKey("access_token")
        val REFRESH = stringPreferencesKey("refresh_token")
        val EXPIRES_AT = longPreferencesKey("expires_at")
        val USER_ID = stringPreferencesKey("user_id")
        val EMAIL = stringPreferencesKey("email")
        val CACHED_WORKSPACE = stringPreferencesKey("cached_workspace")
    }

    private val dataStore = preferences ?: context.sessionDataStore

    override val session: Flow<Session?> = dataStore.data.map { prefs ->
        val access = prefs[Keys.ACCESS] ?: return@map null
        val refresh = prefs[Keys.REFRESH] ?: return@map null
        Session(
            accessToken = access,
            refreshToken = refresh,
            expiresAt = prefs[Keys.EXPIRES_AT] ?: 0L,
            userId = prefs[Keys.USER_ID] ?: "",
            email = prefs[Keys.EMAIL] ?: "",
        )
    }.distinctUntilChanged()

    override suspend fun current(): Session? = session.first()

    override suspend fun save(session: Session) {
        var accountChanged = false
        dataStore.edit { prefs ->
            val previous = prefs[Keys.USER_ID]
            accountChanged = previous != null && previous != session.userId
            if (previous != session.userId) prefs.remove(Keys.CACHED_WORKSPACE)
            prefs[Keys.ACCESS] = session.accessToken
            prefs[Keys.REFRESH] = session.refreshToken
            prefs[Keys.EXPIRES_AT] = session.expiresAt
            prefs[Keys.USER_ID] = session.userId
            prefs[Keys.EMAIL] = session.email
        }
        if (accountChanged) discardOfflineReads()
    }

    suspend fun rememberReadyWorkspace(companyId: String, me: Me) {
        withContext(Dispatchers.IO) {
            try {
                dataStore.edit { prefs ->
                    if (prefs[Keys.USER_ID] != me.user_id || prefs[Keys.ACCESS].isNullOrBlank()) return@edit
                    runCatching { WorkspaceCacheCipher.encrypt(Json.encodeToString(CachedWorkspace(companyId, me))) }
                        .onSuccess { prefs[Keys.CACHED_WORKSPACE] = it }
                }
            } catch (_: IOException) {
                // The live workspace remains available if saving its offline copy fails.
            }
        }
    }

    suspend fun cachedWorkspace(companyId: String): Me? = withContext(Dispatchers.IO) {
        val prefs = dataStore.data.first()
        if (prefs[Keys.ACCESS].isNullOrBlank()) return@withContext null
        val encrypted = prefs[Keys.CACHED_WORKSPACE] ?: return@withContext null
        val cached = runCatching {
            WorkspaceCacheCipher.decrypt(encrypted)?.let { Json.decodeFromString<CachedWorkspace>(it) }
        }.getOrNull()
        cached?.me?.takeIf { cached.companyId == companyId && it.user_id == prefs[Keys.USER_ID] }
    }

    suspend fun forgetReadyWorkspace() {
        dataStore.edit { it.remove(Keys.CACHED_WORKSPACE) }
    }

    override suspend fun clear() {
        dataStore.edit { it.clear() }
        discardOfflineReads()
        // #330: the customer's data goes with the session, however it ended.
        SessionEnded.fire()
    }
}
