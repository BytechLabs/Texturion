package com.loonext.android.features.compose

import android.content.Context
import android.media.MediaRecorder
import android.os.Build
import android.os.SystemClock
import com.loonext.android.core.auth.await
import com.loonext.android.core.net.ApiClient
import com.loonext.android.core.net.ApiErrorCode
import com.loonext.android.core.net.ApiException
import java.io.File
import java.io.IOException
import java.util.Locale
import kotlinx.serialization.Serializable
import okhttp3.MediaType.Companion.toMediaTypeOrNull
import okhttp3.MultipartBody
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody

/**
 * #507 Phase 1 — the wrap-up a crew member speaks after hanging up.
 *
 * They hold a button, say "quoted him $2,400 for the tank, parts Thursday, he's
 * confirming with his wife", and get those words back as text to check and post
 * as an internal note.
 *
 * # Whose voice, and why the answer is the whole feature
 *
 * The member's own, into their own handset, about a call that has ENDED. Never
 * the call, never the customer. D117 is why that line is load-bearing rather
 * than a nicety: every interception statute attaches to the moment the other
 * party's voice is ACQUIRED, so a live-call version is a different feature with
 * a consent architecture this one does not need and does not have. Nothing in
 * this file — and no string it prints — may suggest otherwise.
 *
 * # The audio does not survive the upload
 *
 * That is the promise the feature is sold on, so it is enforced in the one
 * place the client controls: [WrapUpRecorder.finish] reads the cache file into
 * memory and deletes it before it returns, and [WrapUpRecorder.discard] deletes
 * it on every path that does not upload. The bytes then live only as a local in
 * the calling coroutine. The server side of the same promise is in
 * `apps/api/src/ai/call-wrapup.ts`: the audio never reaches R2 and no id exists
 * that could fetch it back.
 *
 * # It is a shortcut, never a precondition
 *
 * Every failure — no permission, no microphone, the toggle off, the monthly cap,
 * a model that said nothing usable — leaves the member exactly where they were:
 * the note composer, with a keyboard. That is why [wrapUpDictationMessage]
 * names what happened and every sentence ends somewhere the member can still
 * act.
 */
object WrapUpDictation {

    /**
     * Longest dictation we record, in seconds. Mirrors CALL_WRAPUP_MAX_SECONDS
     * in `apps/api/src/ai/call-wrapup.ts`, which is the gate that counts —
     * this one exists so a phone left in a pocket is never uploaded at all.
     */
    const val MAX_SECONDS = 120

    /**
     * Largest upload we attempt, in bytes. Mirrors CALL_WRAPUP_MAX_BYTES. The
     * encoder settings below put two minutes at a few hundred KB, so this only
     * ever catches something already wrong.
     */
    const val MAX_BYTES = 8 * 1024 * 1024

    /**
     * Below this the hold was a mis-tap, not a wrap-up.
     *
     * Enforced here rather than left to the server because the server's version
     * of this check happens after the request: a stray brush of the button must
     * not cost a round trip, and it must never cost an audio minute.
     */
    const val MIN_SECONDS = 1

    /**
     * Whole seconds of audio for an elapsed hold.
     *
     * Floored, because a partial second is not a second of speech, and clamped
     * to [MAX_SECONDS] because MediaRecorder's own max-duration stop means the
     * file cannot be longer than that however long the finger stayed down. Both
     * directions are the honest number rather than a flattering one — `seconds`
     * is the client's CLAIM about the audio and the server checks the bytes
     * separately.
     */
    fun elapsedSeconds(elapsedMs: Long): Int {
        if (elapsedMs <= 0L) return 0
        val whole = (elapsedMs / 1000L).toInt()
        return if (whole > MAX_SECONDS) MAX_SECONDS else whole
    }

    /**
     * Is this recording worth spending a request on? The client twin of
     * `shouldTranscribeWrapUp` — same two gates, same reasoning: a recording of
     * nothing, or one that ran away, must not spend.
     */
    fun worthSending(seconds: Int, bytes: Int): Boolean =
        bytes > 0 && bytes <= MAX_BYTES && seconds >= MIN_SECONDS && seconds <= MAX_SECONDS

    /** The running counter shown while the button is held: "0:07", "1:53". */
    fun elapsedLabel(seconds: Int): String =
        String.format(Locale.US, "%d:%02d", seconds / 60, seconds % 60)
}

/**
 * POST /v1/conversations/:id/wrap-up-transcript — what came back.
 *
 * A 200 either carries the words or says why there are none; both are normal
 * answers, so the refusal is DATA rather than an error. See
 * [wrapUpDictationMessage] for the sentence each reason earns.
 */
@Serializable
data class WrapUpTranscript(
    /** The member's words, verbatim. Null means nothing usable came back. */
    val text: String? = null,
    /** Why there are no words; absent on success. */
    val reason: String? = null,
)

/**
 * Plain-language copy for a wrap-up that produced no words.
 *
 * One blanket "something went wrong" would hide a workspace toggle and an
 * exhausted monthly budget behind what reads as a glitch, so each reason says
 * what happened and where the member goes next — and every one of them ends at
 * the keyboard they already have. Mirrors [replyDraftMessage]'s shape, and the
 * reasons themselves are `AiRunFailure` in `apps/api/src/ai/run.ts` plus the
 * route's own `too_long` and `unusable_output`.
 */
fun wrapUpDictationMessage(reason: String?): String = when (reason) {
    "too_long" -> "That was longer than two minutes. Say the short version, or type the note."
    "disabled" -> "Dictated wrap-ups are turned off for this workspace. Settings, AI turns them back on."
    "over_cap" -> "This month's dictation is used up. It starts again next month — type the note for now."
    "model_error", "unavailable" -> "Couldn't write that down just now. Try again, or type the note."
    "unusable_output" -> "Couldn't make out any words. Try again somewhere quieter, or type the note."
    else -> "Couldn't write that down. Type the note instead."
}

/**
 * The one multipart door #507 needs.
 *
 * [ApiClient] speaks JSON bodies and keeps its base URL private, so this
 * borrows its OkHttp client, its fresh-session refresh and its SPEC §7 envelope
 * decoding — exactly as [NoteFileUploader] does next door, and for the same
 * reason.
 *
 * Throws [ApiException] on a non-2xx like every other write in the app, so a
 * signed-out session or a refused capability keeps the server's own sentence
 * instead of being flattened into a reason it does not have. A 200 that carries
 * a `reason` is a refusal the member should read, not a failure, and comes back
 * as data.
 */
class WrapUpTranscriber(private val api: ApiClient, private val baseUrl: String) {

    suspend fun transcribe(
        companyId: String,
        conversationId: String,
        audio: ByteArray,
        seconds: Int,
    ): WrapUpTranscript {
        val session = api.freshSession() ?: throw ApiException(
            ApiErrorCode.UNAUTHORIZED,
            "You're signed out.",
            401,
        )
        val body = MultipartBody.Builder().setType(MultipartBody.FORM)
            .addFormDataPart("seconds", seconds.toString())
            .addFormDataPart(
                "audio",
                WRAP_UP_FILE_NAME,
                audio.toRequestBody(WRAP_UP_CONTENT_TYPE.toMediaTypeOrNull()),
            )
            .build()
        val request = Request.Builder()
            .url("$baseUrl/v1/conversations/$conversationId/wrap-up-transcript")
            .header("Authorization", "Bearer ${session.accessToken}")
            .header("X-Company-Id", companyId)
            .post(body)
            .build()
        val response = try {
            api.http.newCall(request).await()
        } catch (_: IOException) {
            throw ApiException(
                ApiErrorCode.NETWORK,
                "Can't reach Loonext. Check your connection.",
                0,
            )
        }
        val (status, text) = response.use { it.code to it.body?.string().orEmpty() }
        val payload = ApiClient.RawResponse(status, text).expectSuccess(api.json)
        return api.json.decodeFromString(payload)
    }
}

/** AAC in an MPEG-4 container: what MediaRecorder writes below. */
private const val WRAP_UP_CONTENT_TYPE = "audio/mp4"
private const val WRAP_UP_FILE_NAME = "wrap-up.m4a"

/** One finished dictation: the bytes to upload and how long it ran. */
class WrapUpRecording(val audio: ByteArray, val seconds: Int)

/**
 * How a hold ended.
 *
 * Three outcomes rather than a nullable recording, because two of them read
 * identically to the caller and want opposite answers. A brush of the button is
 * a non-event and must be silent — a sentence after every mis-tap is noise. A
 * recorder that died mid-hold, because a call seized the microphone or the
 * permission was revoked from the settings shade, is somebody who watched a
 * counter tick for thirty seconds and then got nothing, and telling them
 * nothing is the worst answer available.
 */
sealed interface WrapUpFinish {
    /** Words worth sending. */
    class Ready(val recording: WrapUpRecording) : WrapUpFinish
    /** Too short or too small to be a wrap-up. Say nothing. */
    data object TooShort : WrapUpFinish
    /** It was running and it broke. Say so. */
    data object Failed : WrapUpFinish
}

/**
 * Records one wrap-up to a cache file and hands back its bytes.
 *
 * NOT thread-safe and not reusable across concurrent holds — one composer, one
 * finger, one recording at a time. Every method is safe to call in the wrong
 * order (a double release, a discard with nothing running); the button is a
 * physical gesture and the states race by nature, so the recorder absorbs that
 * rather than asking the UI to be perfect about it.
 */
class WrapUpRecorder(private val context: Context) {

    private var recorder: MediaRecorder? = null
    private var file: File? = null
    private var startedAtMs = 0L

    /** True between a successful [start] and the [finish]/[discard] that ends it. */
    val isRecording: Boolean get() = recorder != null

    /**
     * Begin recording. Returns false when the platform refused — a microphone
     * held by a call, an OEM that rejects the encoder, a permission revoked
     * between the check and here. Nothing is left running on a false.
     */
    fun start(): Boolean {
        if (recorder != null) return true
        val target = try {
            // cacheDir, deliberately: this file must be the most disposable
            // thing on the device. It is deleted below on every path, and if
            // the process dies mid-hold the system is free to reclaim it —
            // which is the correct outcome for audio nobody promised to keep.
            File.createTempFile("wrap-up-", ".m4a", context.cacheDir)
        } catch (_: IOException) {
            return false
        }
        // PUBLISHED BEFORE THE ARMING BELOW, and that ordering is the whole
        // point. `prepare()` and `start()` take a couple of hundred
        // milliseconds, they run on an IO thread, and `discard()` runs on the
        // main thread from the composition's onDispose. Assigning this field
        // last meant a Back press inside that window found both fields null,
        // deleted nothing, and then watched start() finish and adopt a
        // recorder nobody would ever stop — leaving the audio on the device,
        // which is the one thing this feature promises cannot happen.
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
            // Speech into a handset held at the mouth, sized for a transcript
            // rather than for listening: mono, 16 kHz, 32 kbps puts two minutes
            // at roughly 500 KB. Nobody plays this back — it exists for the
            // length of one request — so bitrate spent above intelligibility is
            // upload time on a job site's signal and nothing else.
            next.setAudioChannels(1)
            next.setAudioSamplingRate(16_000)
            next.setAudioEncodingBitRate(32_000)
            // The platform's own stop, under the UI's timer rather than instead
            // of it: a composition that misses its tick must not leave a
            // microphone open, and neither cap may be the only one.
            next.setMaxDuration(WrapUpDictation.MAX_SECONDS * 1000)
            next.setMaxFileSize(WrapUpDictation.MAX_BYTES.toLong())
            next.setOutputFile(target.absolutePath)
            next.prepare()
            next.start()
            // Did a discard() land while we were arming? It clears `file`, so
            // this is how the losing side of that race finds out. Honour it
            // rather than adopting a recorder the composition has already
            // stopped tracking.
            if (file !== target) {
                runCatching { next.release() }
                target.delete()
                return false
            }
            recorder = next
            startedAtMs = SystemClock.elapsedRealtime()
            true
        } catch (_: Exception) {
            // IllegalStateException, IOException, RuntimeException from start()
            // on a busy mic — all one answer to the caller, which then says so
            // and leaves the keyboard where it was.
            runCatching { next.release() }
            target.delete()
            recorder = null
            file = null
            false
        }
    }

    /** Whole seconds recorded so far, for the counter under the member's thumb. */
    fun elapsedSeconds(): Int =
        if (recorder == null) 0
        else WrapUpDictation.elapsedSeconds(SystemClock.elapsedRealtime() - startedAtMs)

    /**
     * Stop and read the audio out, deleting the file before returning.
     *
     * Null when there is nothing worth uploading: no recording running, a stop
     * the encoder refused (too short to have written a valid header), or a hold
     * that does not clear [WrapUpDictation.worthSending]. The file is gone
     * either way — that is the point of doing the read here rather than handing
     * a path to the caller.
     */
    fun finish(): WrapUpFinish {
        val active = recorder
        if (active == null) {
            // Nothing running, but a file from a start that never reached a
            // stop might still be sitting in the cache. Clear it.
            discard()
            return WrapUpFinish.TooShort
        }
        val target = file
        val seconds = elapsedSeconds()
        val stopped = runCatching { active.stop() }.isSuccess
        runCatching { active.release() }
        recorder = null
        file = null
        val audio = if (stopped && target != null) {
            runCatching { target.readBytes() }.getOrNull()
        } else {
            null
        }
        target?.delete()
        // It WAS running and we could not get the bytes out: a call seized the
        // microphone, the permission was revoked mid-hold, the encoder wrote no
        // usable header. Distinct from a mis-tap, because somebody was waiting.
        if (audio == null) return WrapUpFinish.Failed
        return if (WrapUpDictation.worthSending(seconds, audio.size)) {
            WrapUpFinish.Ready(WrapUpRecording(audio, seconds))
        } else {
            WrapUpFinish.TooShort
        }
    }

    /**
     * Abandon whatever is running and delete the file. Safe to call always,
     * from any thread.
     *
     * Deliberately does NOT call `stop()`. `stop()` finalizes the MPEG-4 moov
     * atom synchronously — hundreds of milliseconds of disk and mediaserver
     * IPC — and this runs on the main thread from the composition's onDispose,
     * which is the navigation frame. `release()` alone tears the recorder down,
     * and a container we are about to delete does not need to be valid.
     */
    fun discard() {
        recorder?.let { active -> runCatching { active.release() } }
        recorder = null
        file?.delete()
        file = null
    }
}
