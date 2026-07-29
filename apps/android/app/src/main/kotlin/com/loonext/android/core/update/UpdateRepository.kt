package com.loonext.android.core.update

import com.loonext.android.BuildConfig
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.Json
import okhttp3.OkHttpClient
import okhttp3.Request
import java.io.IOException

/** What the app knows about its own currency, and why. */
data class UpdateState(
    val requirement: UpdateRequirement = UpdateRequirement.NONE,
    val policy: AppReleasePolicy? = null,
)

/**
 * #339 — reads the public update policy.
 *
 * DELIBERATELY NOT THROUGH [com.loonext.android.core.net.ApiClient]. That
 * client injects a bearer token and refreshes it on the way; this endpoint is
 * public precisely because the reason to demand an update may be that auth is
 * broken in this very build (#268 signs the user out on a transient refresh
 * failure). A policy that only a working session can fetch cannot reach the
 * builds that need it.
 *
 * EVERY failure resolves to "no policy", which resolves to NONE. A blip on the
 * network must never become an update wall on somebody's business phone.
 */
class UpdateRepository(
    private val http: OkHttpClient,
    private val baseUrl: String,
    private val json: Json = Json { ignoreUnknownKeys = true },
) {
    private val _state = MutableStateFlow(UpdateState())
    val state: StateFlow<UpdateState> = _state.asStateFlow()

    /**
     * Ask once per app start (and on resume, which is when a store update
     * would have landed). Cheap: the endpoint is edge-cached for five minutes.
     */
    suspend fun refresh() {
        val policy = fetch()
        _state.value = UpdateState(
            requirement = updateRequirement(BuildConfig.VERSION_NAME, policy),
            policy = policy,
        )
    }

    private suspend fun fetch(): AppReleasePolicy? = withContext(Dispatchers.IO) {
        val url = baseUrl.trimEnd('/') + "/app-release?platform=android"
        try {
            http.newCall(Request.Builder().url(url).get().build()).execute().use { response ->
                if (!response.isSuccessful) return@withContext null
                val body = response.body?.string() ?: return@withContext null
                json.decodeFromString<AppReleasePolicy>(body)
            }
        } catch (_: IOException) {
            null
        } catch (_: IllegalArgumentException) {
            // Unparseable body. Same conclusion as no answer: ask nothing.
            null
        }
    }
}
