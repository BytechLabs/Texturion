package com.loonext.android.core.auth

import com.loonext.android.core.net.ApiErrorCode
import com.loonext.android.core.net.ApiException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withContext
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import kotlinx.serialization.json.putJsonObject
import okhttp3.Call
import okhttp3.Callback
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.Response
import java.io.IOException
import java.net.URLEncoder
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException

private val JSON_MEDIA = "application/json; charset=utf-8".toMediaType()

@Serializable
data class AuthUser(val id: String, val email: String? = null)

@Serializable
data class AuthSession(
    val access_token: String,
    val refresh_token: String,
    val expires_in: Long,
    val expires_at: Long? = null,
    val user: AuthUser,
) {
    fun toSession(): Session = Session(
        accessToken = access_token,
        refreshToken = refresh_token,
        expiresAt = expires_at ?: (System.currentTimeMillis() / 1000 + expires_in),
        userId = user.id,
        email = user.email ?: "",
    )
}

/** Signup may return a user with no session when email confirmation is on. */
sealed interface SignUpResult {
    data class SignedIn(val session: AuthSession) : SignUpResult
    data object ConfirmationEmailSent : SignUpResult
}

/**
 * Direct GoTrue REST client (no Supabase SDK dependency — the auth surface we
 * use is four endpoints and the official Kotlin SDK would drag in Ktor).
 */
class SupabaseAuth(
    private val client: OkHttpClient,
    private val supabaseUrl: String,
    private val publishableKey: String,
) {
    private val json = Json { ignoreUnknownKeys = true }

    /** /authorize preflight must SEE the 3xx, not follow it to the provider. */
    private val noRedirectClient by lazy {
        client.newBuilder().followRedirects(false).followSslRedirects(false).build()
    }

    suspend fun signInWithPassword(
        email: String,
        password: String,
        captchaToken: String? = null,
    ): AuthSession {
        val body = buildJsonObject {
            put("email", email)
            put("password", password)
            if (captchaToken != null) {
                putJsonObject("gotrue_meta_security") { put("captcha_token", captchaToken) }
            }
        }
        return json.decodeFromString<AuthSession>(
            request("token?grant_type=password", body),
        )
    }

    suspend fun refresh(refreshToken: String): AuthSession {
        val body = buildJsonObject { put("refresh_token", refreshToken) }
        return json.decodeFromString<AuthSession>(
            request("token?grant_type=refresh_token", body),
        )
    }

    /** OAuth PKCE completion (#166): swap the redirect's code for a session. */
    suspend fun exchangePkce(authCode: String, codeVerifier: String): AuthSession {
        val body = buildJsonObject {
            put("auth_code", authCode)
            put("code_verifier", codeVerifier)
        }
        return json.decodeFromString<AuthSession>(
            request("token?grant_type=pkce", body),
        )
    }

    /**
     * Builds the OAuth authorize URL and preflights it (#166). A healthy
     * GoTrue answers /authorize with a 3xx to the provider's consent page;
     * anything else is the provider-not-configured response ("Unsupported
     * provider: provider is not enabled") — caught HERE so the user gets an
     * honest error instead of being dumped on a browser JSON page.
     */
    suspend fun beginOAuthAuthorize(
        provider: String,
        redirectTo: String,
        codeChallenge: String,
    ): String = withContext(Dispatchers.IO) {
        // The challenge is base64url (URL-safe by construction); redirect_to
        // carries a scheme + query and must be encoded.
        val url = "$supabaseUrl/auth/v1/authorize" +
            "?provider=$provider" +
            "&redirect_to=${URLEncoder.encode(redirectTo, "UTF-8")}" +
            "&code_challenge=$codeChallenge" +
            "&code_challenge_method=s256"
        val request = Request.Builder()
            .url(url)
            .header("apikey", publishableKey)
            .get()
            .build()
        val response = try {
            noRedirectClient.newCall(request).await()
        } catch (cause: IOException) {
            throw ApiException(
                ApiErrorCode.NETWORK,
                "Can't reach the sign-in service. Check your connection.",
                0,
            )
        }
        response.use {
            if (it.code !in 300..399) {
                throw ApiException(
                    "oauth_provider_unavailable",
                    "Google sign-in isn't set up for this app yet.",
                    it.code,
                )
            }
        }
        url
    }

    suspend fun signUp(
        email: String,
        password: String,
        displayName: String? = null,
        captchaToken: String? = null,
    ): SignUpResult {
        val body = buildJsonObject {
            put("email", email)
            put("password", password)
            // Mirrors the web: a DB trigger copies data.display_name to profiles.
            if (!displayName.isNullOrBlank()) {
                putJsonObject("data") { put("display_name", displayName) }
            }
            if (captchaToken != null) {
                putJsonObject("gotrue_meta_security") { put("captcha_token", captchaToken) }
            }
        }
        val raw = request("signup", body)
        val obj = json.parseToJsonElement(raw) as? JsonObject
        return if (obj?.containsKey("access_token") == true) {
            SignUpResult.SignedIn(json.decodeFromString<AuthSession>(raw))
        } else {
            SignUpResult.ConfirmationEmailSent
        }
    }

    suspend fun sendPasswordReset(email: String, captchaToken: String? = null) {
        val body = buildJsonObject {
            put("email", email)
            if (captchaToken != null) {
                putJsonObject("gotrue_meta_security") { put("captcha_token", captchaToken) }
            }
        }
        request("recover", body)
    }

    /** Best-effort server-side revocation; local sign-out never depends on it. */
    suspend fun signOut(accessToken: String) {
        try {
            request("logout", buildJsonObject {}, bearer = accessToken)
        } catch (_: ApiException) {
            // Token already dead server-side — that IS signed out.
        }
    }

    private suspend fun request(
        path: String,
        body: JsonObject,
        bearer: String? = null,
    ): String = withContext(Dispatchers.IO) {
        val request = Request.Builder()
            .url("$supabaseUrl/auth/v1/$path")
            .header("apikey", publishableKey)
            .apply { if (bearer != null) header("Authorization", "Bearer $bearer") }
            .post(body.toString().toRequestBody(JSON_MEDIA))
            .build()
        val response = try {
            client.newCall(request).await()
        } catch (cause: IOException) {
            throw ApiException(
                ApiErrorCode.NETWORK,
                "Can't reach the sign-in service. Check your connection.",
                0,
            )
        }
        response.use {
            val text = it.body?.string().orEmpty()
            if (!it.isSuccessful) throw parseAuthError(text, it.code)
            text
        }
    }

    /**
     * GoTrue error shapes vary by endpoint/version ({error_code,msg} vs
     * {error,error_description}) — parse defensively and keep the raw code.
     */
    private fun parseAuthError(body: String, status: Int): ApiException {
        val obj = try {
            json.parseToJsonElement(body) as? JsonObject
        } catch (_: Exception) {
            null
        }
        val code = obj?.get("error_code")?.jsonPrimitive?.content
            ?: obj?.get("error")?.jsonPrimitive?.content
            ?: ApiErrorCode.UNAUTHORIZED
        val message = obj?.get("msg")?.jsonPrimitive?.content
            ?: obj?.get("error_description")?.jsonPrimitive?.content
            ?: "Sign-in failed."
        return ApiException(code, message, status)
    }
}

/** Bridge OkHttp's callback API into coroutines with proper cancellation. */
suspend fun Call.await(): Response = suspendCancellableCoroutine { cont ->
    enqueue(object : Callback {
        override fun onResponse(call: Call, response: Response) {
            cont.resume(response)
        }

        override fun onFailure(call: Call, e: IOException) {
            if (!cont.isCancelled) cont.resumeWithException(e)
        }
    })
    cont.invokeOnCancellation {
        try {
            cancel()
        } catch (_: Throwable) {
        }
    }
}
