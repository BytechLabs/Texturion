package com.loonext.android.push

import android.content.Context
import android.util.Log
import com.google.firebase.FirebaseApp
import com.google.firebase.messaging.FirebaseMessaging
import com.loonext.android.core.net.ApiClient
import com.loonext.android.core.net.ApiErrorCode
import com.loonext.android.core.net.ApiException
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull
import kotlin.coroutines.resume

private const val TAG = "LoonextPush"

/** POST /v1/device-push-tokens body (#151 backend contract). */
@Serializable
data class DeviceTokenBody(
    val platform: String,
    val token: String,
)

/**
 * FCM device-token lifecycle against POST/DELETE /v1/device-push-tokens
 * (#151 — the backend may deploy after this build, so a 404 degrades to a
 * log and the next app-start re-upsert self-heals, mirroring web #143).
 *
 * Firebase is OPTIONAL in this build: there is no google-services plugin, so
 * [FirebaseApp.initializeApp] returns null until the founder adds the
 * google-services resources. Every entry point here no-ops (with one log)
 * in that state — the app never crashes over missing push config.
 */
class PushRegistrar(context: Context, private val api: ApiClient) {
    private val appContext = context.applicationContext

    companion object {
        @Volatile
        private var loggedUnavailable = false

        /**
         * Guarded Firebase init: reuse the default app when present, else try
         * a resource-driven init. Null result = this build ships without
         * Firebase config — log once and treat push as unavailable.
         */
        fun isFirebaseAvailable(context: Context): Boolean {
            val appContext = context.applicationContext
            if (FirebaseApp.getApps(appContext).isNotEmpty()) return true
            val initialized = try {
                FirebaseApp.initializeApp(appContext)
            } catch (cause: Exception) {
                Log.w(TAG, "Firebase init failed; push disabled for this run.", cause)
                null
            }
            if (initialized == null && !loggedUnavailable) {
                loggedUnavailable = true
                Log.i(TAG, "No Firebase config in this build — push unavailable, app fine.")
            }
            return initialized != null
        }
    }

    /**
     * Fetch the current FCM token and upsert it server-side for [companyId].
     * Call on every app start once a workspace is active (self-healing
     * re-upsert, #143) and after the user grants notification permission.
     */
    suspend fun register(companyId: String) {
        if (!isFirebaseAvailable(appContext)) return
        // Remember the workspace first so a token refresh that races this
        // call still knows where to re-upsert.
        PushPrefs.saveCompanyId(appContext, companyId)
        val token = fetchToken() ?: return
        upload(companyId, token)
    }

    /**
     * FCM rotated the token ([LoonextMessagingService.onNewToken]) — re-upsert
     * against the last registered workspace. Before any registration ever
     * happened there is nothing to update; the first [register] call uploads.
     */
    suspend fun onTokenRefresh(token: String) {
        val companyId = PushPrefs.companyId(appContext)
        if (companyId == null) {
            Log.i(TAG, "FCM token refreshed before first registration; deferring to app start.")
            return
        }
        upload(companyId, token)
    }

    /**
     * Sign-out teardown: delete the server row (by remembered id, else by
     * re-upserting to learn it — the web unsubscribe does the same dance),
     * then invalidate the device token so this phone stops receiving.
     * Call BEFORE the session is cleared; every step is best-effort.
     */
    suspend fun unregister() {
        val companyId = PushPrefs.companyId(appContext)
        val token = PushPrefs.token(appContext)
        var rowId = PushPrefs.rowId(appContext)
        try {
            if (rowId == null && companyId != null && token != null) {
                rowId = postToken(companyId, token)
            }
            if (rowId != null) {
                api.delete("/v1/device-push-tokens/$rowId", companyId = companyId)
                Log.i(TAG, "Deleted device push token registration.")
            }
        } catch (cause: ApiException) {
            if (cause.code == ApiErrorCode.NOT_FOUND || cause.httpStatus == 404) {
                Log.i(TAG, "Device push token already gone server-side.")
            } else {
                Log.w(TAG, "Device push token delete failed (${cause.code}); signing out anyway.")
            }
        } catch (cause: Exception) {
            Log.w(TAG, "Device push token delete failed; signing out anyway.", cause)
        }
        if (isFirebaseAvailable(appContext)) {
            deleteFcmToken()
        }
        PushPrefs.clearRegistration(appContext)
    }

    private suspend fun upload(companyId: String, token: String) {
        try {
            val rowId = postToken(companyId, token)
            PushPrefs.saveRegistration(appContext, companyId, token, rowId)
            Log.i(TAG, "Device push token registered.")
        } catch (cause: ApiException) {
            if (cause.code == ApiErrorCode.NOT_FOUND || cause.httpStatus == 404) {
                // #151 backend not deployed yet — keep the token locally; the
                // next app-start register() retries automatically.
                PushPrefs.saveRegistration(appContext, companyId, token, rowId = null)
                Log.i(TAG, "device-push-tokens endpoint missing (backend lag); will retry on next start.")
            } else {
                Log.w(TAG, "Device push token registration failed (${cause.code}).")
            }
        } catch (cause: Exception) {
            Log.w(TAG, "Device push token registration failed.", cause)
        }
    }

    /** Upsert the token; returns the server row id when the response has one. */
    private suspend fun postToken(companyId: String, token: String): String? {
        val response: JsonObject = api.post(
            "/v1/device-push-tokens",
            DeviceTokenBody(platform = "android", token = token),
            companyId = companyId,
        )
        return (response["id"] as? JsonPrimitive)?.contentOrNull
    }

    private suspend fun fetchToken(): String? =
        suspendCancellableCoroutine { continuation ->
            FirebaseMessaging.getInstance().token.addOnCompleteListener { task ->
                if (!continuation.isActive) return@addOnCompleteListener
                if (task.isSuccessful) {
                    continuation.resume(task.result)
                } else {
                    Log.w(TAG, "FCM token fetch failed.", task.exception)
                    continuation.resume(null)
                }
            }
        }

    private suspend fun deleteFcmToken() {
        suspendCancellableCoroutine { continuation ->
            FirebaseMessaging.getInstance().deleteToken().addOnCompleteListener { task ->
                if (!continuation.isActive) return@addOnCompleteListener
                if (!task.isSuccessful) {
                    Log.w(TAG, "FCM token invalidation failed.", task.exception)
                }
                continuation.resume(Unit)
            }
        }
    }
}

/**
 * Small synchronous persistence for the push lifecycle (SharedPreferences on
 * purpose: [LoonextMessagingService.onNewToken] runs off the main coroutine
 * world and needs a cheap read). Holds the last registered workspace/token/row
 * and whether we have ever fired the Android 13+ permission prompt (used to
 * tell "not asked yet" from "denied → blocked").
 */
internal object PushPrefs {
    private const val FILE = "loonext_push"
    private const val KEY_COMPANY_ID = "company_id"
    private const val KEY_TOKEN = "token"
    private const val KEY_ROW_ID = "row_id"
    private const val KEY_PERMISSION_REQUESTED = "permission_requested"

    private fun prefs(context: Context) =
        context.applicationContext.getSharedPreferences(FILE, Context.MODE_PRIVATE)

    fun companyId(context: Context): String? = prefs(context).getString(KEY_COMPANY_ID, null)

    fun token(context: Context): String? = prefs(context).getString(KEY_TOKEN, null)

    fun rowId(context: Context): String? = prefs(context).getString(KEY_ROW_ID, null)

    fun saveCompanyId(context: Context, companyId: String) {
        prefs(context).edit().putString(KEY_COMPANY_ID, companyId).apply()
    }

    fun saveRegistration(context: Context, companyId: String, token: String, rowId: String?) {
        prefs(context).edit()
            .putString(KEY_COMPANY_ID, companyId)
            .putString(KEY_TOKEN, token)
            .apply { if (rowId != null) putString(KEY_ROW_ID, rowId) else remove(KEY_ROW_ID) }
            .apply()
    }

    fun clearRegistration(context: Context) {
        prefs(context).edit()
            .remove(KEY_COMPANY_ID)
            .remove(KEY_TOKEN)
            .remove(KEY_ROW_ID)
            .apply()
    }

    fun permissionRequested(context: Context): Boolean =
        prefs(context).getBoolean(KEY_PERMISSION_REQUESTED, false)

    fun setPermissionRequested(context: Context) {
        prefs(context).edit().putBoolean(KEY_PERMISSION_REQUESTED, true).apply()
    }
}
