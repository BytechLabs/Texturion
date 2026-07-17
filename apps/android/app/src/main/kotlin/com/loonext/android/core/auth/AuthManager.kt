package com.loonext.android.core.auth

import android.content.Context
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.longPreferencesKey
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.map

private val Context.appPrefs by preferencesDataStore(name = "app-prefs")

/**
 * A Google sign-in handoff waiting for the browser to redirect back (#166).
 * Persisted (not in-memory) because the browser may kill this process before
 * the custom-scheme redirect relaunches it.
 */
data class PendingOAuth(
    val state: String,
    val verifier: String,
    val createdAtMillis: Long,
)

/**
 * Small app-level preferences: the active workspace (the web keeps this in a
 * cookie) and the theme choice.
 */
class AppPrefs(private val context: Context) {
    private object Keys {
        val ACTIVE_COMPANY = stringPreferencesKey("active_company_id")
        val THEME = stringPreferencesKey("theme") // system | light | dark
        val OAUTH_STATE = stringPreferencesKey("pending_oauth_state")
        val OAUTH_VERIFIER = stringPreferencesKey("pending_oauth_verifier")
        val OAUTH_CREATED_AT = longPreferencesKey("pending_oauth_created_at")
    }

    val activeCompanyId: Flow<String?> =
        context.appPrefs.data.map { it[Keys.ACTIVE_COMPANY] }

    val theme: Flow<String> =
        context.appPrefs.data.map { it[Keys.THEME] ?: "system" }

    suspend fun currentCompanyId(): String? = activeCompanyId.first()

    suspend fun setActiveCompany(companyId: String?) {
        context.appPrefs.edit { prefs ->
            if (companyId == null) prefs.remove(Keys.ACTIVE_COMPANY)
            else prefs[Keys.ACTIVE_COMPANY] = companyId
        }
    }

    suspend fun setTheme(theme: String) {
        context.appPrefs.edit { it[Keys.THEME] = theme }
    }

    suspend fun savePendingOAuth(pending: PendingOAuth) {
        context.appPrefs.edit { prefs ->
            prefs[Keys.OAUTH_STATE] = pending.state
            prefs[Keys.OAUTH_VERIFIER] = pending.verifier
            prefs[Keys.OAUTH_CREATED_AT] = pending.createdAtMillis
        }
    }

    suspend fun pendingOAuth(): PendingOAuth? {
        val prefs = context.appPrefs.data.first()
        return PendingOAuth(
            state = prefs[Keys.OAUTH_STATE] ?: return null,
            verifier = prefs[Keys.OAUTH_VERIFIER] ?: return null,
            createdAtMillis = prefs[Keys.OAUTH_CREATED_AT] ?: return null,
        )
    }

    suspend fun clearPendingOAuth() {
        context.appPrefs.edit { prefs ->
            prefs.remove(Keys.OAUTH_STATE)
            prefs.remove(Keys.OAUTH_VERIFIER)
            prefs.remove(Keys.OAUTH_CREATED_AT)
        }
    }
}

/**
 * Sign-in/out orchestration over [SupabaseAuth] + [SessionStore]: the auth
 * screens call this, never the raw pieces.
 */
class AuthManager(
    private val auth: SupabaseAuth,
    private val sessionStore: SessionSource,
    private val prefs: AppPrefs,
) {
    suspend fun signIn(email: String, password: String, captchaToken: String? = null) {
        val session = auth.signInWithPassword(email, password, captchaToken).toSession()
        sessionStore.save(session)
    }

    /** Returns true when a session exists now; false = confirmation email sent. */
    suspend fun signUp(
        email: String,
        password: String,
        displayName: String,
        captchaToken: String? = null,
    ): Boolean = when (val result = auth.signUp(email, password, displayName, captchaToken)) {
        is SignUpResult.SignedIn -> {
            sessionStore.save(result.session.toSession())
            true
        }

        SignUpResult.ConfirmationEmailSent -> false
    }

    suspend fun sendPasswordReset(email: String, captchaToken: String? = null) {
        auth.sendPasswordReset(email, captchaToken)
    }

    // --- Google sign-in (#166): PKCE authorize handoff through the browser ---

    /** Stash the verifier before the browser leaves (process may die). */
    suspend fun stashPendingOAuth(state: String, verifier: String) {
        prefs.savePendingOAuth(PendingOAuth(state, verifier, System.currentTimeMillis()))
    }

    /** Read AND clear the pending handoff — a redirect is single-use. */
    suspend fun takePendingOAuth(): PendingOAuth? {
        val pending = prefs.pendingOAuth()
        if (pending != null) prefs.clearPendingOAuth()
        return pending
    }

    /** Non-consuming read — the stranded-handoff guard peeks without racing
     *  a redirect that may still be in flight. */
    suspend fun peekPendingOAuth(): PendingOAuth? = prefs.pendingOAuth()

    suspend fun clearPendingOAuth() = prefs.clearPendingOAuth()

    /** Preflighted authorize URL (throws the honest unprovisioned error). */
    suspend fun oauthAuthorizeUrl(
        provider: String,
        redirectTo: String,
        codeChallenge: String,
    ): String = auth.beginOAuthAuthorize(provider, redirectTo, codeChallenge)

    suspend fun signInWithPkce(authCode: String, codeVerifier: String) {
        val session = auth.exchangePkce(authCode, codeVerifier).toSession()
        sessionStore.save(session)
    }

    suspend fun signOut() {
        val session = sessionStore.current()
        if (session != null) auth.signOut(session.accessToken)
        sessionStore.clear()
        prefs.setActiveCompany(null)
    }
}
