package com.loonext.android.core.auth

import android.content.Context
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.longPreferencesKey
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.map

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
class SessionStore(private val context: Context) : SessionSource {
    private object Keys {
        val ACCESS = stringPreferencesKey("access_token")
        val REFRESH = stringPreferencesKey("refresh_token")
        val EXPIRES_AT = longPreferencesKey("expires_at")
        val USER_ID = stringPreferencesKey("user_id")
        val EMAIL = stringPreferencesKey("email")
    }

    override val session: Flow<Session?> = context.sessionDataStore.data.map { prefs ->
        val access = prefs[Keys.ACCESS] ?: return@map null
        val refresh = prefs[Keys.REFRESH] ?: return@map null
        Session(
            accessToken = access,
            refreshToken = refresh,
            expiresAt = prefs[Keys.EXPIRES_AT] ?: 0L,
            userId = prefs[Keys.USER_ID] ?: "",
            email = prefs[Keys.EMAIL] ?: "",
        )
    }

    override suspend fun current(): Session? = session.first()

    override suspend fun save(session: Session) {
        context.sessionDataStore.edit { prefs ->
            prefs[Keys.ACCESS] = session.accessToken
            prefs[Keys.REFRESH] = session.refreshToken
            prefs[Keys.EXPIRES_AT] = session.expiresAt
            prefs[Keys.USER_ID] = session.userId
            prefs[Keys.EMAIL] = session.email
        }
    }

    override suspend fun clear() {
        context.sessionDataStore.edit { it.clear() }
        // #330: the customer's data goes with the session, however it ended.
        SessionEnded.fire()
    }
}
