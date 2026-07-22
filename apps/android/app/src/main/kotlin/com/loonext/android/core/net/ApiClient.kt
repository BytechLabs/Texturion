package com.loonext.android.core.net

import com.loonext.android.core.auth.Session
import com.loonext.android.core.auth.SessionSource
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
 * The /v1 API client: bearer injection from [SessionStore], X-Company-Id
 * tenancy header, proactive token refresh, single-flight refresh on 401,
 * SPEC §7 envelope decoding, and Idempotency-Key passthrough for the send
 * paths that require it.
 */
class ApiClient(
    val http: OkHttpClient,
    private val baseUrl: String,
    private val sessionStore: SessionSource,
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

    /** Fires with every fresh access token — realtime re-auths from this. */
    private val _tokenRefreshed = MutableSharedFlow<String>(extraBufferCapacity = 1)
    val tokenRefreshed: SharedFlow<String> = _tokenRefreshed

    suspend inline fun <reified T> get(
        path: String,
        query: Map<String, String?> = emptyMap(),
        companyId: String? = null,
    ): T = decodeBody(path, raw("GET", path, query = query, companyId = companyId))

    suspend inline fun <reified T, reified B> post(
        path: String,
        body: B,
        companyId: String? = null,
        idempotencyKey: String? = null,
    ): T = decodeBody(
        path,
        raw(
            "POST",
            path,
            body = json.encodeToString(body),
            companyId = companyId,
            idempotencyKey = idempotencyKey,
        ),
    )

    suspend inline fun <reified T> post(
        path: String,
        companyId: String? = null,
    ): T = decodeBody(path, raw("POST", path, body = "{}", companyId = companyId))

    suspend inline fun <reified T, reified B> patch(
        path: String,
        body: B,
        companyId: String? = null,
    ): T = decodeBody(
        path,
        raw("PATCH", path, body = json.encodeToString(body), companyId = companyId),
    )

    suspend inline fun <reified T, reified B> put(
        path: String,
        body: B,
        companyId: String? = null,
    ): T = decodeBody(
        path,
        raw("PUT", path, body = json.encodeToString(body), companyId = companyId),
    )

    /**
     * Decode a SUCCESSFUL (2xx) response body. A mismatch between the client
     * model and what the server sent throws [ApiDecodeException] — distinct
     * from [ApiException] because the ACTION ALREADY SUCCEEDED server-side.
     * Mutation callers must treat it as success (toast success + refetch),
     * never as a failed action: conflating the two is how "task created but
     * 'Something went wrong' shown" happened (and the decline-mine crash
     * before it). The mismatch itself is a client-model bug to report, not a
     * user-facing failure.
     */
    inline fun <reified T> decodeBody(path: String, bodyText: String): T = try {
        json.decodeFromString(bodyText)
    } catch (cause: Exception) {
        throw ApiDecodeException(path, cause)
    }

    suspend fun delete(path: String, companyId: String? = null) {
        raw("DELETE", path, companyId = companyId)
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
        companyId: String? = null,
        idempotencyKey: String? = null,
    ): String {
        val session = freshSession() ?: throw ApiException(
            ApiErrorCode.UNAUTHORIZED,
            "You're signed out.",
            401,
        )
        val first =
            execute(method, path, query, body, session.accessToken, companyId, idempotencyKey)
        if (first.status != 401) return first.expectSuccess(json)

        // Access token rejected — refresh once (single-flight) and retry.
        // Force past the expiry check: the server just told us it's dead.
        val refreshed = refreshNow(staleToken = session.accessToken)
        if (refreshed == null) {
            _signedOut.tryEmit(Unit)
            throw ApiException(ApiErrorCode.UNAUTHORIZED, "Session expired.", 401)
        }
        val second =
            execute(method, path, query, body, refreshed.accessToken, companyId, idempotencyKey)
        if (second.status == 401) {
            _signedOut.tryEmit(Unit)
        }
        return second.expectSuccess(json)
    }

    /** Returns a session whose access token is not (about to be) expired. */
    suspend fun freshSession(): Session? {
        val session = sessionStore.current() ?: return null
        if (!session.isExpired()) return session
        return refreshNow()
    }

    /**
     * Single-flight refresh. [staleToken] is the access token the server just
     * rejected — when the stored token still equals it, refresh even if the
     * clock says it's fine; when it differs, someone already refreshed.
     */
    private suspend fun refreshNow(staleToken: String? = null): Session? =
        refreshMutex.withLock {
        val current = sessionStore.current() ?: return null
        val alreadyReplaced = staleToken != null && current.accessToken != staleToken
        if ((staleToken == null || alreadyReplaced) && !current.isExpired()) return current
        return try {
            val next = supabaseAuth.refresh(current.refreshToken).toSession()
            sessionStore.save(next)
            _tokenRefreshed.tryEmit(next.accessToken)
            next
        } catch (cause: ApiException) {
            if (cause.code == ApiErrorCode.NETWORK) throw cause
            // Refresh token rejected — the session is truly dead.
            sessionStore.clear()
            null
        }
    }

    class RawResponse(val status: Int, val bodyText: String) {
        fun expectSuccess(json: Json): String {
            if (status in 200..299) return bodyText
            val parsed = try {
                json.decodeFromString<ErrorEnvelope>(bodyText)
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
        companyId: String?,
        idempotencyKey: String?,
    ): RawResponse {
        val url = (baseUrl + path).toHttpUrl().newBuilder().apply {
            query.forEach { (k, v) -> if (v != null) addQueryParameter(k, v) }
        }.build()
        val requestBody: RequestBody? = body?.toRequestBody(JSON_MEDIA)
        val request = Request.Builder()
            .url(url)
            .header("Authorization", "Bearer $accessToken")
            .apply {
                if (companyId != null) header("X-Company-Id", companyId)
                if (idempotencyKey != null) header("Idempotency-Key", idempotencyKey)
            }
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
