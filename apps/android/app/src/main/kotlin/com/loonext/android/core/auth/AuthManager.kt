package com.loonext.android.core.auth

import android.content.Context
import androidx.datastore.preferences.core.booleanPreferencesKey
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
        val DEV_MODE = booleanPreferencesKey("dev_mode")
        // #289: full-size photos wait for Wi-Fi. Device-scoped, not
        // workspace-scoped — it is about THIS phone's data plan, and the same
        // person on a laptop has a different answer.
        val WIFI_ONLY_ORIGINALS = booleanPreferencesKey("wifi_only_originals")
        // #330: the app lock, device-scoped for the same reason as the line
        // above — it is about THIS phone, which is the tech's own and gets
        // handed to whoever is covering the weekend. A workspace-wide setting
        // would put a lock on a sole operator's phone to protect a truck
        // phone in a different van.
        val APP_LOCK = booleanPreferencesKey("app_lock_enabled")
        val OAUTH_STATE = stringPreferencesKey("pending_oauth_state")
        val OAUTH_VERIFIER = stringPreferencesKey("pending_oauth_verifier")
        val OAUTH_CREATED_AT = longPreferencesKey("pending_oauth_created_at")
    }

    val activeCompanyId: Flow<String?> =
        context.appPrefs.data.map { it[Keys.ACTIVE_COMPANY] }

    val theme: Flow<String> =
        context.appPrefs.data.map { it[Keys.THEME] ?: "system" }

    /** The Diagnostics easter egg (#198): seven quick taps on the settings
     *  version line flips this; when true the hub shows a Diagnostics row. */
    val devMode: Flow<Boolean> =
        context.appPrefs.data.map { it[Keys.DEV_MODE] ?: false }

    /**
     * #289: wait for Wi-Fi before fetching a FULL-SIZE photo. Default off —
     * most people will never open the setting, and putting a tap between every
     * tradesperson and every photo would solve a problem most of them do not
     * have. Threads and galleries load either way (#240 made them cheap).
     */
    val wifiOnlyOriginals: Flow<Boolean> =
        context.appPrefs.data.map { it[Keys.WIFI_ONLY_ORIGINALS] ?: false }

    /**
     * #330: ask for a fingerprint, face or screen lock before showing the inbox.
     *
     * Default OFF, and that is a decision rather than laziness. This product
     * promises answering a customer inside the five minutes that decide the job,
     * and a lock a sole operator never asked for is friction on the only thing we
     * sell. The crew sharing one truck phone and the person working alone have
     * opposite correct answers, so the phone asks rather than assuming.
     */
    val appLockEnabled: Flow<Boolean> =
        context.appPrefs.data.map { it[Keys.APP_LOCK] ?: false }

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

    suspend fun setDevMode(enabled: Boolean) {
        context.appPrefs.edit { it[Keys.DEV_MODE] = enabled }
    }

    suspend fun setAppLockEnabled(enabled: Boolean) {
        context.appPrefs.edit { it[Keys.APP_LOCK] = enabled }
    }

    suspend fun setWifiOnlyOriginals(enabled: Boolean) {
        context.appPrefs.edit { it[Keys.WIFI_ONLY_ORIGINALS] = enabled }
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

    /** Set by AppGraph — drops the render cache so account data dies with the session. */
    var onSignedOut: (() -> Unit)? = null

    suspend fun signOut() {
        val session = sessionStore.current()
        if (session != null) auth.signOut(session.accessToken)
        sessionStore.clear()
        prefs.setActiveCompany(null)
        onSignedOut?.invoke()
    }
}
