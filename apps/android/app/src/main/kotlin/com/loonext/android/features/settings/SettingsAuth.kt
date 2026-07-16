package com.loonext.android.features.settings

import com.loonext.android.core.auth.await
import com.loonext.android.core.net.ApiErrorCode
import com.loonext.android.core.net.ApiException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import java.io.IOException

private val JSON_MEDIA = "application/json; charset=utf-8".toMediaType()

/** GoTrue's structural code for "confirm it's you before this change". */
const val REAUTHENTICATION_NEEDED = "reauthentication_needed"

/**
 * The two GoTrue account operations the settings surface needs beyond
 * core/auth/SupabaseAuth (which owns sign-in/up/out/refresh): PUT
 * /auth/v1/user for email + password changes, and POST /auth/v1/reauthenticate
 * for the stale-session nonce flow. Same direct-REST posture as SupabaseAuth —
 * defensive error parsing, structural codes only (never message sniffing).
 *
 * Email change is Supabase's double-confirm flow: links go to both the old
 * and new address, nothing changes until confirmed. Password change on a
 * stale session returns [REAUTHENTICATION_NEEDED]; the caller then requests a
 * nonce (emailed to the user) and retries with it.
 */
class SettingsAuthClient(
    private val client: OkHttpClient,
    private val supabaseUrl: String,
    private val publishableKey: String,
) {
    private val json = Json { ignoreUnknownKeys = true }

    suspend fun updateEmail(accessToken: String, newEmail: String) {
        request(
            method = "PUT",
            path = "user",
            body = buildJsonObject { put("email", newEmail) },
            bearer = accessToken,
        )
    }

    /**
     * Change (or first-set, for OAuth-only accounts) the password. Throws
     * [ApiException] with code [REAUTHENTICATION_NEEDED] when the session is
     * too stale — request a nonce and retry with it.
     */
    suspend fun updatePassword(accessToken: String, password: String, nonce: String? = null) {
        request(
            method = "PUT",
            path = "user",
            body = buildJsonObject {
                put("password", password)
                if (nonce != null) put("nonce", nonce)
            },
            bearer = accessToken,
        )
    }

    /** Emails the signed-in user a one-time nonce for the retry above. */
    suspend fun requestReauthenticationNonce(accessToken: String) {
        request(
            method = "POST",
            path = "reauthenticate",
            body = buildJsonObject {},
            bearer = accessToken,
        )
    }

    private suspend fun request(
        method: String,
        path: String,
        body: JsonObject,
        bearer: String,
    ): String = withContext(Dispatchers.IO) {
        val request = Request.Builder()
            .url("$supabaseUrl/auth/v1/$path")
            .header("apikey", publishableKey)
            .header("Authorization", "Bearer $bearer")
            .method(method, body.toString().toRequestBody(JSON_MEDIA))
            .build()
        val response = try {
            client.newCall(request).await()
        } catch (_: IOException) {
            throw ApiException(
                ApiErrorCode.NETWORK,
                "Can't reach the sign-in service. Check your connection.",
                0,
            )
        }
        response.use {
            val text = it.body.string()
            if (!it.isSuccessful) throw parseAuthError(text, it.code)
            text
        }
    }

    /** GoTrue error shapes vary ({error_code,msg} vs {error,error_description}). */
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
            ?: "Something went wrong ($status)."
        return ApiException(code, message, status)
    }
}
