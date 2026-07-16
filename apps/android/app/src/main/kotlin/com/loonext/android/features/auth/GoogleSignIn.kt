package com.loonext.android.features.auth

import android.net.Uri
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.width
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.loonext.android.core.auth.AuthManager
import com.loonext.android.core.auth.PendingOAuth
import com.loonext.android.core.net.ApiException

/**
 * Google sign-in via Supabase's PKCE authorize flow (#166) — plain browser
 * ACTION_VIEW handoff (no Custom Tabs dependency, no Google SDK):
 *
 *   1. mint verifier + state, persist them (the browser may kill us),
 *   2. open {SUPABASE_URL}/auth/v1/authorize?provider=google&… in the browser,
 *   3. Google → Supabase → com.loonext.android://auth-callback?state=…&code=…,
 *   4. POST /token?grant_type=pkce {auth_code, code_verifier} → session.
 */
const val OAUTH_REDIRECT_SCHEME = "com.loonext.android"
const val OAUTH_REDIRECT_HOST = "auth-callback"
private const val OAUTH_REDIRECT_URI = "$OAUTH_REDIRECT_SCHEME://$OAUTH_REDIRECT_HOST"

/** A handoff older than this is dead — don't exchange a stale redirect. */
const val OAUTH_PENDING_TTL_MILLIS: Long = 10 * 60 * 1000

/**
 * Seam between the integrator-owned MainActivity and the auth feature: the
 * activity hands every com.loonext.android:// redirect here. Redirects that
 * arrive before AuthFlow mounts (cold start — the browser killed the process)
 * are buffered and replayed on registration. Main thread only.
 */
object AuthCallbacks {
    private var buffered: Uri? = null

    var onOAuthRedirect: ((Uri) -> Unit)? = null
        set(value) {
            field = value
            val pending = buffered
            if (value != null && pending != null) {
                buffered = null
                value(pending)
            }
        }

    fun deliver(uri: Uri) {
        val handler = onOAuthRedirect
        if (handler != null) handler(uri) else buffered = uri
    }
}

/** What to do with an auth-callback redirect, decided from pure inputs. */
sealed interface OAuthReturn {
    data class Exchange(val code: String, val verifier: String) : OAuthReturn
    data class Failed(val message: String) : OAuthReturn
}

/**
 * Validates the redirect against the persisted handoff. Error params map to
 * FIXED copy (never echo intent-supplied text — the scheme is claimable by
 * any app on the device). The state nonce rides redirect_to's query; Supabase
 * preserves it, but a missing state alone doesn't fail the return — the
 * verifier is the cryptographic gate (a foreign code can't survive the
 * exchange against our verifier).
 */
fun resolveOAuthReturn(
    code: String?,
    returnedState: String?,
    error: String?,
    errorDescription: String?,
    pending: PendingOAuth?,
    nowMillis: Long,
): OAuthReturn {
    if (error != null) {
        val description = errorDescription.orEmpty()
        return OAuthReturn.Failed(
            when {
                error == "access_denied" -> "Google sign-in was cancelled."
                description.contains("provider is not enabled", ignoreCase = true) ||
                    description.contains("unsupported provider", ignoreCase = true) ->
                    "Google sign-in isn't set up for this app yet."

                else -> "Google sign-in failed. Try again."
            },
        )
    }
    if (pending == null || nowMillis - pending.createdAtMillis > OAUTH_PENDING_TTL_MILLIS) {
        return OAuthReturn.Failed("That Google sign-in expired. Start it again.")
    }
    if (returnedState != null && returnedState != pending.state) {
        return OAuthReturn.Failed(
            "That sign-in response didn't match the one this app started. Try again.",
        )
    }
    if (code.isNullOrBlank()) {
        return OAuthReturn.Failed("Google sign-in failed. Try again.")
    }
    return OAuthReturn.Exchange(code, pending.verifier)
}

/** Orchestrates begin (browser handoff) and complete (redirect → session). */
class GoogleSignIn(private val authManager: AuthManager) {
    /**
     * Mints + stashes the PKCE pieces and returns the preflighted authorize
     * URL to open in the browser. Throws [ApiException] with honest copy when
     * the provider isn't configured or the network is down.
     */
    suspend fun begin(): String {
        val verifier = Pkce.generateVerifier()
        val state = Pkce.generateState()
        authManager.stashPendingOAuth(state, verifier)
        return authManager.oauthAuthorizeUrl(
            provider = "google",
            redirectTo = "$OAUTH_REDIRECT_URI?state=$state",
            codeChallenge = Pkce.challenge(verifier),
        )
    }

    /**
     * Handles the auth-callback redirect. Returns null when signed in (the
     * session store flips the app), else a user-facing error message.
     */
    suspend fun complete(
        code: String?,
        state: String?,
        error: String?,
        errorDescription: String?,
    ): String? {
        // Read-and-clear: a redirect is single-use even when it fails.
        val pending = authManager.takePendingOAuth()
        val resolved = resolveOAuthReturn(
            code, state, error, errorDescription, pending, System.currentTimeMillis(),
        )
        return when (resolved) {
            is OAuthReturn.Failed -> resolved.message
            is OAuthReturn.Exchange -> try {
                authManager.signInWithPkce(resolved.code, resolved.verifier)
                null
            } catch (cause: ApiException) {
                cause.message.ifBlank { "Google sign-in failed. Try again." }
            } catch (_: Exception) {
                "Google sign-in failed. Try again."
            }
        }
    }
}

/**
 * Brand-neutral Google button: outlined/neutral surface, the G mark drawn as
 * a bold text glyph in Google blue (no Google SDK assets, per D44 posture).
 */
@Composable
fun GoogleSignInButton(
    busy: Boolean,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
) {
    OutlinedButton(
        onClick = onClick,
        enabled = !busy,
        modifier = modifier.fillMaxWidth(),
    ) {
        Text(
            "G",
            style = MaterialTheme.typography.titleMedium,
            fontWeight = FontWeight.Bold,
            color = Color(0xFF4285F4),
        )
        Spacer(Modifier.width(10.dp))
        Text("Continue with Google")
    }
}
