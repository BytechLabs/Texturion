package com.loonext.android.telephony

import android.Manifest
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import com.loonext.android.R
import com.loonext.android.push.ChannelIds
import com.loonext.android.push.ensureChannels

/**
 * Post-answer + within-5s call notifications for the softphone (#171). The
 * OS — Android Telecom — now owns the incoming ring surface entirely (§4/§6):
 * the lock-screen / heads-up / Bluetooth incoming UI, its answer/decline
 * actions, the ringtone, and the vibration. This class no longer posts ANY
 * `CallStyle` incoming ring (the #168A `CallStyle.forIncomingCall` precondition
 * minefield is deleted with it, §6) and there is no `CallActionReceiver`.
 *
 * What remains is two plain (never `CallStyle`) notifications:
 *  - [showConnecting]: the within-5s foreground notification [TelecomCallRegistry]
 *    posts on `addCall` to keep foreground priority — and thus the `phoneCall`
 *    mic FGS that makes "caller can't hear me" impossible (§3.1/I4);
 *  - [showOngoing]: the quiet persistent notification while a call is live.
 */
internal class CallNotifier(private val context: Context) {
    companion object {
        private const val ONGOING_ID = 2102
        private const val ONGOING_TAG = "loonext.call.ongoing"
        private const val CONNECTING_ID = 2103
    }

    init {
        // Channels are cheap + idempotent; a call can arrive before any UI ran.
        ensureChannels(context)
    }

    private fun canPost(): Boolean {
        val granted = android.os.Build.VERSION.SDK_INT < 33 ||
            context.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) ==
            PackageManager.PERMISSION_GRANTED
        return granted && NotificationManagerCompat.from(context).areNotificationsEnabled()
    }

    /**
     * The within-5s foreground call notification (§3.1/I4). Keyed per session
     * (`call:<session>` tag) so a cold FCM wake builds it inside the framework's
     * budget and a `call_end`/end tears it down. Plain + silent — the OS owns
     * the ring; this only holds foreground priority for the mic FGS.
     */
    fun showConnecting(session: String, callerName: String) {
        if (!canPost()) return
        ensureChannels(context)
        val builder = NotificationCompat.Builder(context, ChannelIds.INCOMING_CALLS)
            .setSmallIcon(R.drawable.ic_launcher_foreground)
            .setContentTitle(callerName.ifBlank { "Incoming call" })
            .setContentText("Connecting…")
            .setCategory(NotificationCompat.CATEGORY_CALL)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setSilent(true)
            .setContentIntent(openAppIntent(requestCode = 7))
        runCatching {
            NotificationManagerCompat.from(context)
                .notify("call:$session", CONNECTING_ID, builder.build())
        }
    }

    fun cancelConnecting(session: String) {
        runCatching {
            NotificationManagerCompat.from(context).cancel("call:$session", CONNECTING_ID)
        }
    }

    /**
     * The quiet persistent notification while any call is live.
     *
     * #168A ROOT CAUSE lived in the old ongoing surface: it used
     * `CallStyle.forOngoingCall` with no foreground service and no
     * fullScreenIntent — API 31+ `Notification.Builder.build()` throws
     * `IllegalArgumentException` for that combination. This is a plain
     * notification with a hang-up action — no `CallStyle`, no platform
     * preconditions; an ongoing surface must never full-screen.
     */
    fun showOngoing(call: CallSnapshot) {
        if (!canPost()) return
        ensureChannels(context)
        val builder = NotificationCompat.Builder(context, ChannelIds.MISSED_CALLS)
            .setSmallIcon(R.drawable.ic_launcher_foreground)
            .setContentTitle(call.peerName)
            .setContentText(if (call.phase == CallPhase.HELD) "On hold" else "On a call")
            .setCategory(NotificationCompat.CATEGORY_CALL)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setSilent(true)
            .setContentIntent(openAppIntent(requestCode = 6))
        call.activeSinceMs?.let { since ->
            builder.setWhen(since).setUsesChronometer(true).setShowWhen(true)
        }
        runCatching {
            NotificationManagerCompat.from(context)
                .notify(ONGOING_TAG, ONGOING_ID, builder.build())
        }
    }

    fun cancelOngoing() {
        runCatching { NotificationManagerCompat.from(context).cancel(ONGOING_TAG, ONGOING_ID) }
    }

    private fun openAppIntent(requestCode: Int): PendingIntent {
        val launch = context.packageManager.getLaunchIntentForPackage(context.packageName)
            ?.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
            ?: Intent()
        return PendingIntent.getActivity(
            context,
            requestCode,
            launch,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
    }
}
