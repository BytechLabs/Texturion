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
        /**
         * This service OWNS the one ongoing-call notification. It deliberately does
         * NOT share an id with an app-posted notification: a foreground service's
         * notification cannot be removed by `NotificationManager.cancel()` while the
         * service runs, so sharing the id made the "call ended" cancel a silent
         * no-op and stranded an "ongoing call" row after hang-up.
         */
        private const val NOTIFICATION_ID = 2105
        private const val ACTION_START = "com.loonext.android.telephony.fgs.START"
        private const val EXTRA_TITLE = "title"
        private const val EXTRA_TEXT = "text"
        private const val EXTRA_SINCE = "since"

        /** Hold the process + mic for a call, and post/UPDATE its notification.
         *  Idempotent — call it again to change the title/status. */
        fun start(context: Context, title: String, text: String = "Call in progress", sinceMs: Long? = null) {
            runCatching {
                val intent = Intent(context, CallForegroundService::class.java)
                    .setAction(ACTION_START)
                    .putExtra(EXTRA_TITLE, title)
                    .putExtra(EXTRA_TEXT, text)
                    .putExtra(EXTRA_SINCE, sinceMs ?: 0L)
                context.startForegroundService(intent)
            }
        }

        /**
         * Release it — no call is live any more. `stopService` is the primary path
         * ON PURPOSE: it is always permitted, whereas `startService` (to deliver a
         * STOP action) is blocked when the app is in the background — which is
         * exactly the state after hanging up on a locked phone, so the stop was
         * being dropped and the notification stuck. Destroying the service removes
         * its foreground notification.
         */
        fun stop(context: Context) {
            runCatching { context.stopService(Intent(context, CallForegroundService::class.java)) }
        }
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onDestroy() {
        // Belt and braces: make sure the row goes with the service.
        runCatching { ServiceCompat.stopForeground(this, ServiceCompat.STOP_FOREGROUND_REMOVE) }
        super.onDestroy()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val title = intent?.getStringExtra(EXTRA_TITLE).orEmpty().ifBlank { "Ongoing call" }
        val text = intent?.getStringExtra(EXTRA_TEXT).orEmpty().ifBlank { "Call in progress" }
        val since = intent?.getLongExtra(EXTRA_SINCE, 0L) ?: 0L
        val notification = buildNotification(title, text, since.takeIf { it > 0L })
        // We were started with startForegroundService, so we MUST reach a successful
        // startForeground or the system kills the app ("did not then call
        // Service.startForeground"). Declaring the `microphone` type REQUIRES
        // RECORD_AUDIO to already be granted — and this service starts at RING time,
        // before the mic preflight — so a device that hasn't granted mic yet would
        // throw. Degrade instead of dying: microphone → phoneCall → none.
        val attempts = buildList {
            if (Build.VERSION.SDK_INT >= 30) {
                if (micGranted()) {
                    add(
                        ServiceInfo.FOREGROUND_SERVICE_TYPE_PHONE_CALL or
                            ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE,
                    )
                }
                add(ServiceInfo.FOREGROUND_SERVICE_TYPE_PHONE_CALL)
            }
            add(0)
        }
        val started = attempts.any { type ->
            runCatching { ServiceCompat.startForeground(this, NOTIFICATION_ID, notification, type) }
                .isSuccess
        }
        if (!started) stopSelf()
        // START_STICKY would resurrect us with a null intent after a kill; the call
        // is gone by then, so don't.
        return START_NOT_STICKY
    }

    private fun micGranted(): Boolean =
        checkSelfPermission(android.Manifest.permission.RECORD_AUDIO) ==
            android.content.pm.PackageManager.PERMISSION_GRANTED

    /**
     * Task swiped away. Deliberately does NOT stop the service: a live call must
     * survive the app being removed from recents (a real phone app does). The
     * registry stops us when the call actually ends.
     */
    override fun onTaskRemoved(rootIntent: Intent?) {
        // no-op by design (see class docs); stopWithTask="false" backs this up.
    }

    private fun buildNotification(title: String, text: String, sinceMs: Long?): Notification {
        ensureChannels(this)
        val builder = NotificationCompat.Builder(this, ChannelIds.MISSED_CALLS)
            .setSmallIcon(R.drawable.ic_launcher_foreground)
            .setContentTitle(title)
            .setContentText(text)
            .setCategory(NotificationCompat.CATEGORY_CALL)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setSilent(true)
            .setContentIntent(CallNotifier.openCallScreenIntent(this))
        if (sinceMs != null) {
            builder.setWhen(sinceMs).setUsesChronometer(true).setShowWhen(true)
        }
        return builder.build()
    }
}
