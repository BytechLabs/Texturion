package com.loonext.android.features.settings

import android.content.Context
import android.media.MediaRecorder
import android.os.Build
import com.loonext.android.core.auth.await
import com.loonext.android.core.i18n.AppStrings
import com.loonext.android.core.net.ApiClient
import com.loonext.android.core.net.ApiErrorCode
import com.loonext.android.core.net.ApiException
import java.io.File
import java.io.IOException
import kotlinx.serialization.Serializable
import okhttp3.MediaType.Companion.toMediaTypeOrNull
import okhttp3.MultipartBody
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody

/**
 * #309 — a greeting recorded in the owner's own voice.
 *
 * A two-person outfit competing with a franchise sells on being a real, local,
 * reachable person. Then nobody answers and the product hands the caller a
 * synthetic voice reading a company name, which in 2026 is what a spam call
 * sounds like.
 *
 * The recorder below is deliberately close to [com.loonext.android.features
 * .compose.WrapUpDictation]'s, because that one has already been through the
 * OEM edge cases. It differs in one way that matters: a dictation is heard once
 * by a transcriber, and a greeting is heard by every customer who calls. So the
 * bitrate is set for LISTENING rather than for intelligibility — still under a
 * megabyte for two minutes, which the 2 MB ceiling covers comfortably.
 */
@Serializable
data class VoicemailGreeting(
    val id: String,
    val name: String,
    val duration_ms: Int,
    val mime_type: String = "",
    val byte_size: Int = 0,
    val created_at: String = "",
)

/** AAC in an MPEG-4 container: what [GreetingRecorder] writes. */
private const val GREETING_CONTENT_TYPE = "audio/mp4"
private const val GREETING_FILE_NAME = "greeting.m4a"

/** Two minutes, the same ceiling the API and the column enforce. */
const val MAX_GREETING_MS = 120_000

/** "0:08" — a duration a person reads, not 8200. */
fun formatGreetingDuration(ms: Int): String {
    val total = (ms / 1000).coerceAtLeast(0)
    return "${total / 60}:${(total % 60).toString().padStart(2, '0')}"
}

/**
 * The multipart door for a greeting.
 *
 * Borrows [ApiClient]'s OkHttp client, its fresh-session refresh and its
 * envelope decoding, exactly as the wrap-up transcriber next door does and for
 * the same reason: ApiClient speaks JSON bodies and keeps its base URL private.
 */
class GreetingUploader(private val api: ApiClient, private val baseUrl: String) {

    /**
     * [locale] is the READER's, carried in because this is not a composable and
     * the two refusals below are ours rather than the server's. Null asks for
     * the English table, which is what every caller had before it existed.
     */
    suspend fun upload(
        companyId: String,
        name: String,
        durationMs: Int,
        audio: ByteArray,
        locale: String? = null,
    ): VoicemailGreeting {
        val session = api.freshSession() ?: throw ApiException(
            ApiErrorCode.UNAUTHORIZED,
            AppStrings.translate(locale, "settingsMore.signedOut"),
            401,
        )
        val body = MultipartBody.Builder().setType(MultipartBody.FORM)
            .addFormDataPart("name", name)
            .addFormDataPart("duration_ms", durationMs.toString())
            .addFormDataPart(
                "file",
                GREETING_FILE_NAME,
                audio.toRequestBody(GREETING_CONTENT_TYPE.toMediaTypeOrNull()),
            )
            .build()
        val request = Request.Builder()
            .url("$baseUrl/v1/voicemail-greetings")
            .header("Authorization", "Bearer ${session.accessToken}")
            .header("X-Company-Id", companyId)
            .post(body)
            .build()
        val response = try {
            api.http.newCall(request).await()
        } catch (_: IOException) {
            throw ApiException(
                ApiErrorCode.NETWORK,
                AppStrings.translate(locale, "settingsMore.cantReachLoonext"),
                0,
            )
        }
        val (status, text) = response.use { it.code to it.body?.string().orEmpty() }
        val payload = ApiClient.RawResponse(status, text).expectSuccess(api.json)
        return api.json.decodeFromString(payload)
    }
}

/** What [GreetingRecorder.finish] hands back. */
data class GreetingTake(val bytes: ByteArray, val durationMs: Int, val file: File) {
    // Kotlin warns on a data class holding a ByteArray, and it is right: two
    // takes with identical audio are not the same take. Identity is the file.
    override fun equals(other: Any?) = this === other
    override fun hashCode() = System.identityHashCode(this)
}

/**
 * Records one take to the cache directory.
 *
 * cacheDir, deliberately: until the owner saves it this is the most disposable
 * thing on the device, and if the process dies mid-record the system reclaiming
 * it is the correct outcome for audio nobody promised to keep.
 */
class GreetingRecorder(private val context: Context) {
    private var recorder: MediaRecorder? = null
    private var file: File? = null
    private var startedAtMs = 0L

    val isRecording: Boolean get() = recorder != null

    /**
     * Begin. Returns false when the platform refused — a microphone held by a
     * call, an OEM that rejects the encoder, a permission revoked between the
     * check and here. Nothing is left running on a false.
     */
    fun start(): Boolean {
        if (recorder != null) return true
        val target = try {
            File.createTempFile("greeting-", ".m4a", context.cacheDir)
        } catch (_: IOException) {
            return false
        }
        // Published BEFORE arming, so a discard() racing prepare()/start() on
        // the main thread finds the file and can honour its own cancellation.
        file = target
        val next = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            MediaRecorder(context)
        } else {
            @Suppress("DEPRECATION")
            MediaRecorder()
        }
        return try {
            next.setAudioSource(MediaRecorder.AudioSource.MIC)
            next.setOutputFormat(MediaRecorder.OutputFormat.MPEG_4)
            next.setAudioEncoder(MediaRecorder.AudioEncoder.AAC)
            // Sized for LISTENING, not for a transcript: a customer hears this,
            // and the owner hears it back before saving. Mono 44.1 kHz at
            // 64 kbps puts two minutes near 950 KB, inside the 2 MB ceiling.
            next.setAudioChannels(1)
            next.setAudioSamplingRate(44_100)
            next.setAudioEncodingBitRate(64_000)
            // The platform's own stop, under the UI's timer rather than instead
            // of it: a composition that misses its tick must not leave a
            // microphone open, and neither cap may be the only one.
            next.setMaxDuration(MAX_GREETING_MS)
            next.setOutputFile(target.absolutePath)
            next.prepare()
            next.start()
            if (file !== target) {
                runCatching { next.release() }
                target.delete()
                return false
            }
            recorder = next
            startedAtMs = System.currentTimeMillis()
            true
        } catch (_: Exception) {
            runCatching { next.release() }
            target.delete()
            if (file === target) file = null
            false
        }
    }

    fun elapsedMs(): Int =
        if (recorder == null) 0 else (System.currentTimeMillis() - startedAtMs).toInt()

    /** Stop and read the take back. Null when nothing usable was captured. */
    fun finish(): GreetingTake? {
        val active = recorder ?: return null
        val target = file
        recorder = null
        val elapsed = (System.currentTimeMillis() - startedAtMs).toInt()
        runCatching { active.stop() }
        runCatching { active.release() }
        if (target == null || !target.exists() || target.length() == 0L) {
            target?.delete()
            file = null
            return null
        }
        return GreetingTake(target.readBytes(), elapsed, target)
    }

    /** Throw the take away, and the bytes with it. */
    fun discard() {
        val active = recorder
        recorder = null
        if (active != null) {
            runCatching { active.stop() }
            runCatching { active.release() }
        }
        file?.delete()
        file = null
    }
}
