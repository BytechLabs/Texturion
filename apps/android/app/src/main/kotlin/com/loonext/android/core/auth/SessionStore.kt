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
    }
}
