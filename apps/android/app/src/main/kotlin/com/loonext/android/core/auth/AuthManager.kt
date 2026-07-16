package com.loonext.android.core.auth

import android.content.Context
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.map

private val Context.appPrefs by preferencesDataStore(name = "app-prefs")

/**
 * Small app-level preferences: the active workspace (the web keeps this in a
 * cookie) and the theme choice.
 */
class AppPrefs(private val context: Context) {
    private object Keys {
        val ACTIVE_COMPANY = stringPreferencesKey("active_company_id")
        val THEME = stringPreferencesKey("theme") // system | light | dark
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

    suspend fun signOut() {
        val session = sessionStore.current()
        if (session != null) auth.signOut(session.accessToken)
        sessionStore.clear()
        prefs.setActiveCompany(null)
    }
}
