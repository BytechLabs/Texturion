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
import com.loonext.android.R
import com.loonext.android.push.ChannelIds
import com.loonext.android.push.ensureChannels
import com.loonext.android.ui.common.formatPhone

/**
 * Ring + ongoing-call notifications for the softphone (#155). Self-managed
 * telecom means WE own the incoming-call surface: a high-importance CallStyle
 * notification with a full-screen intent (the lock-screen ring), and a quiet
 * ongoing one while a call is live. Channels come from push/Channels.kt so
 * the wake push (#156) and the live SDK ring share one user-facing switch.
 */
internal class CallNotifier(private val context: Context) {
    companion object {
        const val ACTION_ANSWER = "com.loonext.android.telephony.action.ANSWER"
        const val ACTION_DECLINE = "com.loonext.android.telephony.action.DECLINE"
        const val ACTION_HANGUP = "com.loonext.android.telephony.action.HANGUP"
        const val EXTRA_CALL_ID = "call_id"

        private const val INCOMING_ID = 2101
        private const val ONGOING_ID = 2102
        private const val ONGOING_TAG = "loonext.call.ongoing"
        private const val INCOMING_TAG_PREFIX = "loonext.call.incoming:"
    }

    private fun canPost(): Boolean {
        // POST_NOTIFICATIONS is runtime-gated only from API 33; on older
        // platforms the permission string doesn't exist and must not gate.
        val granted = android.os.Build.VERSION.SDK_INT < 33 ||
            context.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) ==
            PackageManager.PERMISSION_GRANTED
        return granted && NotificationManagerCompat.from(context).areNotificationsEnabled()
    }

    /** The lock-screen/heads-up ring for one inbound call. Idempotent per call. */
    fun showIncoming(call: CallSnapshot) {
        if (!canPost()) return
        ensureChannels(context)
        val person = person(call)
        val answer = actionIntent(ACTION_ANSWER, call.id, requestCode = 1)
        val decline = actionIntent(ACTION_DECLINE, call.id, requestCode = 2)
        val notification = NotificationCompat.Builder(context, ChannelIds.INCOMING_CALLS)
            .setSmallIcon(R.drawable.ic_launcher_foreground)
            .setContentTitle(call.peerName)
            .setContentText(
                if (call.peerNumber.isBlank()) "Incoming call"
                else "Incoming call · ${formatPhone(call.peerNumber)}",
            )
            .setStyle(NotificationCompat.CallStyle.forIncomingCall(person, decline, answer))
            .setCategory(NotificationCompat.CATEGORY_CALL)
            .setPriority(NotificationCompat.PRIORITY_MAX)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setFullScreenIntent(openAppIntent(requestCode = 3), true)
            .setContentIntent(openAppIntent(requestCode = 4))
            .build()
        NotificationManagerCompat.from(context)
            .notify(INCOMING_TAG_PREFIX + call.id, INCOMING_ID, notification)
    }

    fun cancelIncoming(callId: String) {
        NotificationManagerCompat.from(context)
            .cancel(INCOMING_TAG_PREFIX + callId, INCOMING_ID)
    }

    /** The quiet persistent notification while any call is live. */
    fun showOngoing(call: CallSnapshot) {
        if (!canPost()) return
        ensureChannels(context)
        val hangup = actionIntent(ACTION_HANGUP, call.id, requestCode = 5)
        val builder = NotificationCompat.Builder(context, ChannelIds.MISSED_CALLS)
            .setSmallIcon(R.drawable.ic_launcher_foreground)
            .setContentTitle(call.peerName)
            .setContentText(if (call.phase == CallPhase.HELD) "On hold" else "On a call")
            .setStyle(NotificationCompat.CallStyle.forOngoingCall(person(call), hangup))
            .setCategory(NotificationCompat.CATEGORY_CALL)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setSilent(true)
            .setContentIntent(openAppIntent(requestCode = 6))
        call.activeSinceMs?.let { since ->
            builder.setWhen(since).setUsesChronometer(true).setShowWhen(true)
        }
        NotificationManagerCompat.from(context).notify(ONGOING_TAG, ONGOING_ID, builder.build())
    }

    fun cancelOngoing() {
        NotificationManagerCompat.from(context).cancel(ONGOING_TAG, ONGOING_ID)
    }

    private fun person(call: CallSnapshot): Person = Person.Builder()
        .setName(call.peerName.ifBlank { "Unknown caller" })
        .setImportant(true)
        .build()

    private fun actionIntent(action: String, callId: String, requestCode: Int): PendingIntent {
        val intent = Intent(context, CallActionReceiver::class.java)
            .setAction(action)
            .putExtra(EXTRA_CALL_ID, callId)
        return PendingIntent.getBroadcast(
            context,
            requestCode,
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
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

    init {
        // Channels are cheap and idempotent; make sure they exist before the
        // first ring (a call can arrive before any UI ran ensureChannels).
        ensureChannels(context)
    }
}

/**
 * Notification action receiver (manifest-declared, never exported — see the
 * integrator's manifest entry). Answer from the shade only proceeds when the
 * mic permission is already granted; otherwise it opens the app, where the
 * in-app answer button runs the permission preflight (a call must never be
 * answered into a mic-less session).
 */
class CallActionReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val manager = SoftphoneManager.peek() ?: return
        val callId = intent.getStringExtra(CallNotifier.EXTRA_CALL_ID) ?: return
        when (intent.action) {
            CallNotifier.ACTION_ANSWER -> {
                val micGranted =
                    context.checkSelfPermission(Manifest.permission.RECORD_AUDIO) ==
                        PackageManager.PERMISSION_GRANTED
                if (micGranted) {
                    manager.answer(callId)
                } else {
                    context.packageManager.getLaunchIntentForPackage(context.packageName)
                        ?.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                        ?.let { context.startActivity(it) }
                }
            }

            CallNotifier.ACTION_DECLINE, CallNotifier.ACTION_HANGUP ->
                manager.hangup(callId)
        }
    }
}
