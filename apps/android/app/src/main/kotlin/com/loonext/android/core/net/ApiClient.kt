package com.loonext.android.core.net

import com.loonext.android.core.auth.Session
import com.loonext.android.core.auth.SessionStore
import com.loonext.android.core.auth.SupabaseAuth
import com.loonext.android.core.auth.await
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.serialization.json.Json
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody
import okhttp3.RequestBody.Companion.toRequestBody
import java.io.IOException

private val JSON_MEDIA = "application/json; charset=utf-8".toMediaType()

/**
 * The /v1 API client: bearer injection from [SessionStore], proactive token
 * refresh, single-flight refresh on 401, SPEC §7 envelope decoding.
 */
class ApiClient(
    val http: OkHttpClient,
    private val baseUrl: String,
    private val sessionStore: SessionStore,
    private val supabaseAuth: SupabaseAuth,
) {
    val json = Json {
        ignoreUnknownKeys = true
        explicitNulls = false
        encodeDefaults = true
    }

    private val refreshMutex = Mutex()

    private val _signedOut = MutableSharedFlow<Unit>(extraBufferCapacity = 1)

    /** Fires when the refresh token itself is rejected — UI returns to login. */
    val signedOut: SharedFlow<Unit> = _signedOut

    suspend inline fun <reified T> get(path: String, query: Map<String, String?> = emptyMap()): T =
        json.decodeFromString(raw("GET", path, query = query))

    suspend inline fun <reified T, reified B> post(path: String, body: B): T =
        json.decodeFromString(raw("POST", path, body = json.encodeToString(body)))

    suspend inline fun <reified T> post(path: String): T =
        json.decodeFromString(raw("POST", path, body = "{}"))

    suspend inline fun <reified T, reified B> patch(path: String, body: B): T =
        json.decodeFromString(raw("PATCH", path, body = json.encodeToString(body)))

    suspend inline fun <reified B> delete(path: String, body: B? = null) {
        raw("DELETE", path, body = body?.let { json.encodeToString(it) })
    }

    suspend fun delete(path: String) {
        raw("DELETE", path)
    }

    /**
     * Execute a request and return the response body text. 401 triggers ONE
     * single-flight refresh + retry; a second 401 (or a failed refresh) signs
     * the user out.
     */
    suspend fun raw(
        method: String,
        path: String,
        query: Map<String, String?> = emptyMap(),
        body: String? = null,
    ): String {
        val session = freshSession() ?: throw ApiException(
            ApiErrorCode.UNAUTHORIZED,
            "You're signed out.",
            401,
        )
        val first = execute(method, path, query, body, session.accessToken)
        if (first.status != 401) return first.expectSuccess()

        // Access token rejected — refresh once (single-flight) and retry.
        val refreshed = refreshNow()
        if (refreshed == null) {
            _signedOut.tryEmit(Unit)
            throw ApiException(ApiErrorCode.UNAUTHORIZED, "Session expired.", 401)
        }
        val second = execute(method, path, query, body, refreshed.accessToken)
        if (second.status == 401) {
            _signedOut.tryEmit(Unit)
        }
        return second.expectSuccess()
    }

    /** Returns a session whose access token is not (about to be) expired. */
    private suspend fun freshSession(): Session? {
        val session = sessionStore.current() ?: return null
        if (!session.isExpired()) return session
        return refreshNow()
    }

    private suspend fun refreshNow(): Session? = refreshMutex.withLock {
        // Someone may have refreshed while we waited on the lock.
        val current = sessionStore.current() ?: return null
        if (!current.isExpired()) return current
        return try {
            val next = supabaseAuth.refresh(current.refreshToken).toSession()
            sessionStore.save(next)
            next
        } catch (cause: ApiException) {
            if (cause.code == ApiErrorCode.NETWORK) throw cause
            // Refresh token rejected — the session is truly dead.
            sessionStore.clear()
            null
        }
    }

    private class RawResponse(val status: Int, val bodyText: String) {
        fun expectSuccess(): String {
            if (status in 200..299) return bodyText
            val parsed = try {
                Json { ignoreUnknownKeys = true }
                    .decodeFromString<ErrorEnvelope>(bodyText)
            } catch (_: Exception) {
                null
            }
            throw ApiException(
                code = parsed?.error?.code ?: ApiErrorCode.INTERNAL_ERROR,
                message = parsed?.error?.message ?: "Something went wrong ($status).",
                httpStatus = status,
            )
        }
    }

    private suspend fun execute(
        method: String,
        path: String,
        query: Map<String, String?>,
        body: String?,
        accessToken: String,
    ): RawResponse {
        val url = (baseUrl + path).toHttpUrl().newBuilder().apply {
            query.forEach { (k, v) -> if (v != null) addQueryParameter(k, v) }
        }.build()
        val requestBody: RequestBody? = body?.toRequestBody(JSON_MEDIA)
        val request = Request.Builder()
            .url(url)
            .header("Authorization", "Bearer $accessToken")
            .method(method, requestBody)
            .build()
        val response = try {
            http.newCall(request).await()
        } catch (cause: IOException) {
            throw ApiException(
                ApiErrorCode.NETWORK,
                "Can't reach Loonext. Check your connection.",
                0,
            )
        }
        return response.use { RawResponse(it.code, it.body?.string().orEmpty()) }
    }
}
