package com.loonext.android.telephony

import android.Manifest
import android.app.KeyguardManager
import android.app.NotificationManager
import android.app.usage.UsageStatsManager
import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import android.os.PowerManager
import androidx.core.app.NotificationManagerCompat
import com.loonext.android.BuildConfig
import com.loonext.android.core.net.ApiClient
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineExceptionHandler
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import kotlinx.serialization.json.putJsonObject
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import java.time.Instant
import java.time.temporal.ChronoUnit

/**
 * Ring beacons (D142): what this phone says happened to one ring. Only the
 * phone knows whether the push arrived, whether Telecom took the call, whether
 * a ring was on screen and what the member did with it.
 *
 * Each stage is one POST of the server's session id, a stage word and the
 * device state that decides whether a ring can show: permissions, standby
 * bucket, battery saver, Doze and the keyguard. Never the caller, the number,
 * or anything else from the call.
 *
 * Fire and forget, on its own scope and HTTP path: nothing on the ring path
 * waits for it, every failure is dropped, and an undeliverable beacon never
 * reaches the recent-errors list a support report shares. Each stage is sent
 * at most once per session, because several callbacks converge on the same
 * moment (an answer from the notification, the lock screen and a headset all
 * end in the same accept).
 */
enum class RingBeaconStage(val wire: String) {
    PUSH_RECEIVED("push_received"),
    OS_REPORTED("os_reported"),
    RING_ME_SENT("ring_me_sent"),
    RINGING_SHOWN("ringing_shown"),
    ANSWERED("answered"),
    DECLINED("declined"),
}

/** The permission names the server keeps; anything else it drops. */
object RingBeaconPermission {
    const val NOTIFICATIONS = "notifications"
    const val MICROPHONE = "microphone"
    const val FULL_SCREEN_INTENT = "full_screen_intent"
    const val BATTERY_UNRESTRICTED = "battery_unrestricted"
}

/**
 * Android's app standby bucket by name. The integers are the framework's
 * `UsageStatsManager.STANDBY_BUCKET_*` values; `exempted` is a system-only
 * constant with no public name, and `restricted` arrived in API 30, so both are
 * spelled as numbers rather than referenced.
 */
fun standbyBucketName(bucket: Int): String = when (bucket) {
    5 -> "exempted"
    10 -> "active"
    20 -> "working_set"
    30 -> "frequent"
    40 -> "rare"
    45 -> "restricted"
    else -> "unknown"
}

/** What decides whether a ring can show, read at the moment of the stage. */
data class RingBeaconDevice(
    val os: String,
    val permissions: Map<String, Boolean> = emptyMap(),
    val standbyBucket: String? = null,
    val powerSave: Boolean? = null,
    val deviceIdle: Boolean? = null,
    val screenLocked: Boolean? = null,
)

/** The request body. Unknown device facts are left out rather than guessed. */
fun ringBeaconBody(
    sessionId: String,
    stage: RingBeaconStage,
    occurredAt: String,
    device: RingBeaconDevice,
): String = buildJsonObject {
    put("call_session_id", sessionId)
    put("stage", stage.wire)
    put("occurred_at", occurredAt)
    put("os", device.os)
    if (device.permissions.isNotEmpty()) {
        putJsonObject("permissions") {
            for ((name, granted) in device.permissions) {
                put(name, if (granted) "granted" else "denied")
            }
        }
    }
    device.standbyBucket?.let { put("standby_bucket", it) }
    device.powerSave?.let { put("power_save", it) }
    device.deviceIdle?.let { put("device_idle", it) }
    device.screenLocked?.let { put("screen_locked", it) }
}.toString()

/**
 * Remembers which (session, stage) pairs were already sent, for the most recent
 * [capacity] of them. A ring lasts under a minute, so a small window is enough
 * and the set never grows with the life of the process.
 */
class RingBeaconLedger(private val capacity: Int = 64) {
    private val seen = LinkedHashSet<String>()

    @Synchronized
    fun firstTime(sessionId: String, stage: RingBeaconStage): Boolean {
        val key = "$sessionId|${stage.wire}"
        if (!seen.add(key)) return false
        while (seen.size > capacity) {
            val oldest = seen.iterator()
            oldest.next()
            oldest.remove()
        }
        return true
    }
}

/** One beacon POST. Returns whether the server took it; never throws. */
class RingBeaconSender(
    private val http: OkHttpClient,
    private val baseUrl: String,
    private val accessToken: suspend () -> String?,
    private val appVersion: String,
) {
    suspend fun send(companyId: String, body: String): Boolean {
        return try {
            val token = accessToken() ?: return false
            val request = Request.Builder()
                .url(baseUrl.trimEnd('/') + "/v1/ring-beacons")
                .header("Authorization", "Bearer $token")
                .header("X-Client", "android")
                .header("X-App-Version", appVersion)
                .header("X-Company-Id", companyId)
                .post(body.toRequestBody(JSON_MEDIA))
                .build()
            withContext(Dispatchers.IO) {
                http.newCall(request).execute().use { it.isSuccessful }
            }
        } catch (cause: CancellationException) {
            throw cause
        } catch (_: Exception) {
            false
        }
    }

    private companion object {
        val JSON_MEDIA = "application/json; charset=utf-8".toMediaType()
    }
}

/** Reads [RingBeaconDevice] from the platform; each fact is dropped on failure. */
internal fun collectRingBeaconDevice(context: Context): RingBeaconDevice {
    val app = context.applicationContext
    val power = runCatching { app.getSystemService(PowerManager::class.java) }.getOrNull()
    val permissions = buildMap<String, Boolean> {
        runCatching {
            val runtime = Build.VERSION.SDK_INT < 33 ||
                app.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) ==
                PackageManager.PERMISSION_GRANTED
            runtime && NotificationManagerCompat.from(app).areNotificationsEnabled()
        }.getOrNull()?.let { put(RingBeaconPermission.NOTIFICATIONS, it) }
        runCatching {
            app.checkSelfPermission(Manifest.permission.RECORD_AUDIO) ==
                PackageManager.PERMISSION_GRANTED
        }.getOrNull()?.let { put(RingBeaconPermission.MICROPHONE, it) }
        runCatching {
            if (Build.VERSION.SDK_INT >= 34) {
                app.getSystemService(NotificationManager::class.java)?.canUseFullScreenIntent()
            } else {
                true
            }
        }.getOrNull()?.let { put(RingBeaconPermission.FULL_SCREEN_INTENT, it) }
        runCatching { power?.isIgnoringBatteryOptimizations(app.packageName) }
            .getOrNull()?.let { put(RingBeaconPermission.BATTERY_UNRESTRICTED, it) }
    }
    return RingBeaconDevice(
        os = "android-${Build.VERSION.SDK_INT}",
        permissions = permissions,
        standbyBucket = runCatching {
            app.getSystemService(UsageStatsManager::class.java)?.appStandbyBucket
        }.getOrNull()?.let(::standbyBucketName),
        powerSave = runCatching { power?.isPowerSaveMode }.getOrNull(),
        deviceIdle = runCatching { power?.isDeviceIdleMode }.getOrNull(),
        screenLocked = runCatching {
            app.getSystemService(KeyguardManager::class.java)?.isKeyguardLocked
        }.getOrNull(),
    )
}

object RingBeacons {
    private val ledger = RingBeaconLedger()

    private val scope = CoroutineScope(
        SupervisorJob() + Dispatchers.IO + CoroutineExceptionHandler { _, _ -> },
    )

    /**
     * Record [stage] for [sessionId]. Returns at once; a missing workspace or
     * session, or a stage already sent for this session, sends nothing.
     */
    fun emit(
        context: Context,
        api: ApiClient,
        companyId: String?,
        sessionId: String?,
        stage: RingBeaconStage,
    ) {
        if (companyId.isNullOrBlank() || sessionId.isNullOrBlank()) return
        if (!ledger.firstTime(sessionId, stage)) return
        // Stamped before the hop to IO, so the time is the stage's, not the send's.
        val occurredAt = Instant.now().truncatedTo(ChronoUnit.MILLIS).toString()
        val app = context.applicationContext
        scope.launch {
            val sender = RingBeaconSender(
                http = api.http,
                baseUrl = BuildConfig.API_URL,
                accessToken = { api.freshSession()?.accessToken },
                appVersion = BuildConfig.VERSION_NAME,
            )
            sender.send(
                companyId,
                ringBeaconBody(sessionId, stage, occurredAt, collectRingBeaconDevice(app)),
            )
        }
    }
}
