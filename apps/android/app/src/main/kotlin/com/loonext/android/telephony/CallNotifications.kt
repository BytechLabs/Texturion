package com.loonext.android.telephony

import android.Manifest
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.app.Person
import com.loonext.android.LoonextApp
import com.loonext.android.features.calls.CallActivity
import com.loonext.android.R
import com.loonext.android.push.ChannelIds
import com.loonext.android.push.ensureChannels

/**
 * Call notifications for the softphone (#171). Jetpack Telecom owns the call
 * SESSION — audio mode, the `phoneCall` mic FGS, routing — but it registers a
 * SELF-MANAGED call, and Android draws NO system incoming UI for a self-managed
 * call (verified against `core-telecom` 1.0.1: it posts no notification and
 * creates a self-managed connection). So the incoming RING surface is the app's:
 *  - [showIncoming]: the `CallStyle.forIncomingCall` ring — heads-up when
 *    unlocked, full-screen over the keyguard via a `fullScreenIntent`
 *    ([CallActivity]). Its Answer/Decline DRIVE the Telecom call
 *    ([CallActionReceiver] → [SoftphoneManager] → the registry's answer/decline).
 *    `CallStyle` is legal here ONLY because of the `fullScreenIntent` (the #168A
 *    precondition: a `CallStyle` notification must be a foreground service OR
 *    carry a full-screen intent).
 *  - [showConnecting]: a plain silent notification for an OUTBOUND dial.
 *
 * The ONGOING-call notification is deliberately NOT here — it belongs to
 * [CallForegroundService], which owns it for exactly as long as the service runs.
 * A foreground service's notification cannot be removed with
 * `NotificationManager.cancel()`, so an app-posted twin sharing its id left an
 * "ongoing call" row stranded after hang-up.
 */
internal class CallNotifier(private val context: Context) {
    companion object {
        private const val CONNECTING_ID = 2103
        private const val INCOMING_ID = 2104

        const val ACTION_DECLINE = "com.loonext.android.telephony.action.DECLINE"
        /** Sent whenever a session's ring is cancelled so the full-screen
         *  [CallActivity] finishes on ANY teardown (remote hangup, ring
         *  window, call_end, teammate answered) — not only a button tap. */
        const val ACTION_INCOMING_GONE = "com.loonext.android.telephony.action.INCOMING_GONE"
        const val EXTRA_SESSION = "session"
        const val EXTRA_CALLER_NAME = "caller_name"
        const val EXTRA_CALLER_NUMBER = "caller_number"

        /** Open THE call surface (no session — it shows whatever call is live).
         *  Used by the ongoing-call notification and the foreground service, so a
         *  tap always lands on the call UI rather than the app's tab shell. */
        fun openCallScreenIntent(context: Context): PendingIntent = PendingIntent.getActivity(
            context,
            14,
            CallActivity.intent(context, session = null),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )

        /** Cancel the incoming ring for [session] from anywhere, and tell the
         *  full-screen activity to finish (same teardown drives both). */
        fun cancelIncomingForSession(context: Context, session: String) {
            runCatching {
                NotificationManagerCompat.from(context).cancel("call:$session", INCOMING_ID)
            }
            runCatching {
                context.sendBroadcast(
                    Intent(ACTION_INCOMING_GONE)
                        .setPackage(context.packageName)
                        .putExtra(EXTRA_SESSION, session),
                )
            }
        }
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
     * The incoming-call RING (§3/§6, self-managed reality). A high-importance
     * `CallStyle.forIncomingCall` on the ringtone channel — the OS rings and
     * vibrates from the channel, shows a heads-up with Answer/Decline when
     * unlocked, and launches [CallActivity] full-screen over the keyguard
     * via the `fullScreenIntent`. Keyed per session so a duplicate push/INVITE
     * collapses onto one ring. Answer/Decline broadcast to [CallActionReceiver],
     * which drives the Telecom call — the OS never sees this as anything but our
     * own ring, but Telecom still owns the audio/FGS once answered.
     */
    fun showIncoming(session: String, callerName: String, callerNumber: String) {
        if (!canPost()) return
        ensureChannels(context)
        val name = callerName.ifBlank { callerNumber.ifBlank { "Incoming call" } }
        val caller = Person.Builder().setName(name).setImportant(true).build()
        // ANSWER opens the call UI (activity), it does NOT answer silently in the
        // background: a BroadcastReceiver cannot request RECORD_AUDIO, so the old
        // broadcast-answer could accept a call with no mic (caller heard nothing),
        // and it left the user with no call screen at all. The activity preflights
        // the mic, dismisses the keyguard, and shows the in-call UI.
        val answer = callScreenIntent(session, name, callerNumber, answer = true, requestCode = 11)
        val decline = actionBroadcast(ACTION_DECLINE, session, name, callerNumber, requestCode = 12)
        val fullScreen = callScreenIntent(session, name, callerNumber, answer = false, requestCode = 13)
        val builder = NotificationCompat.Builder(context, ChannelIds.INCOMING_CALLS)
            .setSmallIcon(R.drawable.ic_launcher_foreground)
            .setContentTitle(name)
            .setContentText("Incoming call")
            .setCategory(NotificationCompat.CATEGORY_CALL)
            .setOngoing(true)
            .setAutoCancel(false)
            // CallStyle is legal here ONLY because of the fullScreenIntent below
            // (the #168A precondition). forIncomingCall renders Answer/Decline.
            .setStyle(NotificationCompat.CallStyle.forIncomingCall(caller, decline, answer))
            .setFullScreenIntent(fullScreen, true)
            .setContentIntent(fullScreen)
        runCatching {
            NotificationManagerCompat.from(context)
                .notify("call:$session", INCOMING_ID, builder.build())
        }
    }

    fun cancelIncoming(session: String) = cancelIncomingForSession(context, session)

    /** Answer/Decline action → [CallActionReceiver] (drives the Telecom call). */
    private fun actionBroadcast(
        action: String,
        session: String,
        callerName: String,
        callerNumber: String,
        requestCode: Int,
    ): PendingIntent {
        val intent = Intent(context, CallActionReceiver::class.java).apply {
            this.action = action
            putExtra(EXTRA_SESSION, session)
            putExtra(EXTRA_CALLER_NAME, callerName)
            putExtra(EXTRA_CALLER_NUMBER, callerNumber)
        }
        return PendingIntent.getBroadcast(
            context,
            requestCode + session.hashCode(),
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
    }

    /** The ONE call surface — used for the full-screen (over-keyguard) ring, the
     *  ANSWER action, and the ongoing-call tap. [answer] answers on open. */
    private fun callScreenIntent(
        session: String,
        callerName: String,
        callerNumber: String,
        answer: Boolean,
        requestCode: Int,
    ): PendingIntent = PendingIntent.getActivity(
        context,
        requestCode + session.hashCode(),
        CallActivity.intent(context, session, callerName, callerNumber, answer),
        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
    )

    /**
     * The within-5s foreground call notification (§3.1/I4) — OUTBOUND dials only
     * ("Connecting…"). Inbound uses [showIncoming]. Plain + silent.
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

/**
 * Answer/Decline from the incoming ring notification (§3/§6). Routes to the
 * Telecom call via [SoftphoneManager] — Answer issues the OS answer + accepts
 * the Telnyx leg (mic FGS engaged); Decline ends the leg + declines to the
 * server + tears the OS call down. A KILLED process still declines: the SDK is
 * rebuilt by SoftphoneManager.get, and even if it isn't, the decline reaches the
 * server via the app-graph fallback. A throw out of a BroadcastReceiver kills
 * the process (#168A), so every path is `runCatching`-guarded.
 */
class CallActionReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        runCatching {
            val session = intent.getStringExtra(CallNotifier.EXTRA_SESSION) ?: return
            when (intent.action) {
                CallNotifier.ACTION_DECLINE -> {
                    softphone(context)?.declineIncoming(session)
                    CallNotifier.cancelIncomingForSession(context, session)
                }
            }
        }
    }

    /** The process-wide softphone via the app graph — built even in a push-woken
     *  process (Application.onCreate always runs first). Null only if the graph
     *  isn't ready yet, in which case the ring's own teardown/server BYE covers it. */
    private fun softphone(context: Context): SoftphoneManager? = runCatching {
        val app = context.applicationContext as? LoonextApp ?: return null
        SoftphoneManager.get(context.applicationContext, app.graph.api)
    }.getOrNull()
}
