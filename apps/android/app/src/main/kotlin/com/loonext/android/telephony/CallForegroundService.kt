package com.loonext.android.telephony

import android.app.Notification
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import androidx.core.app.NotificationCompat
import androidx.core.app.ServiceCompat
import com.loonext.android.R
import com.loonext.android.push.ChannelIds
import com.loonext.android.push.ensureChannels

/**
 * The call's foreground service (#171).
 *
 * WHY THIS EXISTS — `androidx.core.telecom` does NOT start one. Verified against
 * core-telecom 1.0.1: `startForeground` appears only in `InCallServiceCompat`
 * (the dialer-replacement path), never on the `CallsManager.addCall` path we use.
 * The rearchitecture deleted our FGS on the design doc's claim that "CallsManager
 * manages the call-scoped foreground service for us" — it does not, and two
 * founder-reported failures came straight from that gap:
 *
 *  1. NO BACKGROUND MIC. Android 12+ blocks microphone capture for a process with
 *     no foreground service of an audio-capable type. Answering from the
 *     notification or the lock screen (app backgrounded) left the call with no
 *     mic — "the other side can't hear me", the exact bug this whole feature was
 *     rebuilt to make impossible.
 *  2. THE CALL DIED WHEN THE APP WAS SWIPED AWAY. Nothing held the process, so
 *     task removal killed it (and the Telnyx WebRTC socket with it) while our
 *     ongoing notification lingered and the server still showed the call
 *     connected — the caller sat on a dead line.
 *
 * `stopWithTask="false"` (manifest) is what survives the swipe; the `phoneCall` +
 * `microphone` service types are what keep the mic legal in the background.
 * Telecom still owns audio routing/mode and the call lifecycle — this service
 * only holds the process and the capture right for as long as a call is live.
 */
class CallForegroundService : Service() {

    companion object {
        private const val NOTIFICATION_ID = 2105
        private const val ACTION_START = "com.loonext.android.telephony.fgs.START"
        private const val ACTION_STOP = "com.loonext.android.telephony.fgs.STOP"
        private const val EXTRA_TITLE = "title"

        /** Hold the process + mic for a live call. Idempotent. */
        fun start(context: Context, title: String) {
            runCatching {
                val intent = Intent(context, CallForegroundService::class.java)
                    .setAction(ACTION_START)
                    .putExtra(EXTRA_TITLE, title)
                context.startForegroundService(intent)
            }
        }

        /** Release it — no call is live any more. Idempotent. */
        fun stop(context: Context) {
            runCatching {
                context.startService(
                    Intent(context, CallForegroundService::class.java).setAction(ACTION_STOP),
                )
            }.onFailure {
                // startService can throw once the app is background-restricted and
                // the service isn't running; there is nothing to stop in that case.
                runCatching { context.stopService(Intent(context, CallForegroundService::class.java)) }
            }
        }
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent?.action == ACTION_STOP) {
            ServiceCompat.stopForeground(this, ServiceCompat.STOP_FOREGROUND_REMOVE)
            stopSelf()
            return START_NOT_STICKY
        }
        val title = intent?.getStringExtra(EXTRA_TITLE).orEmpty().ifBlank { "Ongoing call" }
        runCatching {
            ServiceCompat.startForeground(
                this,
                NOTIFICATION_ID,
                buildNotification(title),
                if (Build.VERSION.SDK_INT >= 30) {
                    ServiceInfo.FOREGROUND_SERVICE_TYPE_PHONE_CALL or
                        ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE
                } else {
                    0
                },
            )
        }
        // START_STICKY would resurrect us with a null intent after a kill; the call
        // is gone by then, so don't.
        return START_NOT_STICKY
    }

    /**
     * Task swiped away. Deliberately does NOT stop the service: a live call must
     * survive the app being removed from recents (a real phone app does). The
     * registry stops us when the call actually ends.
     */
    override fun onTaskRemoved(rootIntent: Intent?) {
        // no-op by design (see class docs); stopWithTask="false" backs this up.
    }

    private fun buildNotification(title: String): Notification {
        ensureChannels(this)
        return NotificationCompat.Builder(this, ChannelIds.MISSED_CALLS)
            .setSmallIcon(R.drawable.ic_launcher_foreground)
            .setContentTitle(title)
            .setContentText("Call in progress")
            .setCategory(NotificationCompat.CATEGORY_CALL)
            .setOngoing(true)
            .setSilent(true)
            .setContentIntent(CallNotifier.openCallScreenIntent(this))
            .build()
    }
}
