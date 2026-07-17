package com.loonext.android.telephony

import android.content.Context
import android.media.AudioAttributes
import android.media.AudioManager
import android.media.Ringtone
import android.media.RingtoneManager
import android.os.Build
import android.os.VibrationAttributes
import android.os.VibrationEffect
import android.os.Vibrator
import android.os.VibratorManager

/**
 * The device ringer switch, abstracted from [AudioManager]'s int constants so
 * [RingerPolicy] stays a pure JVM-testable reducer (#167).
 */
enum class RingMode { SILENT, VIBRATE, NORMAL }

/** What the incoming-ring surface should be doing right now. */
enum class RingerCommand { STOP, VIBRATE_ONLY, RING_AND_VIBRATE }

/**
 * The pure ring decision (#167): while ANY inbound call is ringing, ring +
 * vibrate on a normal device, vibrate only on vibrate, nothing on silent —
 * and stop the instant nothing rings, always. Free of Android imports so the
 * state machine unit-tests on the JVM; [SoftphoneManager] evaluates it on
 * every softphone state emission (answer/decline/remote-end/timeout all land
 * as state transitions, so every stop path flows through here).
 */
object RingerPolicy {
    fun decide(mode: RingMode, ringingInboundCount: Int): RingerCommand = when {
        ringingInboundCount <= 0 -> RingerCommand.STOP
        mode == RingMode.SILENT -> RingerCommand.STOP
        mode == RingMode.VIBRATE -> RingerCommand.VIBRATE_ONLY
        else -> RingerCommand.RING_AND_VIBRATE
    }
}

/**
 * The platform ringer: the looped default ringtone (USAGE_NOTIFICATION_RINGTONE)
 * plus a repeating vibration waveform. [sync] is idempotent — it's driven from
 * every softphone state emission — and each side is guarded against a double
 * start. [silence] (telecom's onSilence: the user pressed a volume key while
 * ringing) quiets THIS ring without touching call state; the latch clears once
 * the ring surface stops, so the next call rings normally.
 */
internal class Ringer(private val context: Context) {
    private var ringtone: Ringtone? = null
    private var vibrating = false
    private var current = RingerCommand.STOP
    private var silenced = false

    private val vibrator: Vibrator? by lazy {
        if (Build.VERSION.SDK_INT >= 31) {
            context.getSystemService(VibratorManager::class.java)?.defaultVibrator
        } else {
            @Suppress("DEPRECATION")
            context.getSystemService(Vibrator::class.java)
        }
    }

    /** Apply the policy's verdict. Same command twice = no-op. */
    fun sync(command: RingerCommand) {
        if (command == RingerCommand.STOP) silenced = false
        val effective = if (silenced) RingerCommand.STOP else command
        if (effective == current) return
        current = effective
        when (effective) {
            RingerCommand.STOP -> {
                stopSound()
                stopVibration()
            }

            RingerCommand.VIBRATE_ONLY -> {
                stopSound()
                startVibration()
            }

            RingerCommand.RING_AND_VIBRATE -> {
                startSound()
                startVibration()
            }
        }
    }

    /** The user asked THIS ring to hush (volume key via telecom's onSilence). */
    fun silence() {
        silenced = true
        current = RingerCommand.STOP
        stopSound()
        stopVibration()
    }

    private fun startSound() {
        if (ringtone != null) return
        val uri = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE) ?: return
        ringtone = runCatching {
            RingtoneManager.getRingtone(context, uri)?.apply {
                audioAttributes = AudioAttributes.Builder()
                    .setUsage(AudioAttributes.USAGE_NOTIFICATION_RINGTONE)
                    .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                    .build()
                isLooping = true
                play()
            }
        }.getOrNull()
    }

    private fun stopSound() {
        runCatching { ringtone?.stop() }
        ringtone = null
    }

    private fun startVibration() {
        if (vibrating) return
        val device = vibrator?.takeIf { it.hasVibrator() } ?: return
        // ring-ring … pause — repeats from index 0 until cancelled.
        val effect = VibrationEffect.createWaveform(
            longArrayOf(0, 400, 250, 400, 1_200),
            0,
        )
        vibrating = runCatching {
            if (Build.VERSION.SDK_INT >= 33) {
                device.vibrate(
                    effect,
                    VibrationAttributes.createForUsage(VibrationAttributes.USAGE_RINGTONE),
                )
            } else {
                @Suppress("DEPRECATION")
                device.vibrate(
                    effect,
                    AudioAttributes.Builder()
                        .setUsage(AudioAttributes.USAGE_NOTIFICATION_RINGTONE)
                        .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                        .build(),
                )
            }
        }.isSuccess
    }

    private fun stopVibration() {
        if (!vibrating) return
        vibrating = false
        runCatching { vibrator?.cancel() }
    }
}
