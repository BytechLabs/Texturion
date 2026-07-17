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
import androidx.core.net.toUri
import com.loonext.android.MainActivity
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
 *
 * #167: the incoming notification is posted ONLY while the app is not in the
 * foreground ([SoftphoneManager] gates it) — in-app, the animated banner +
 * [Ringer] are the presentation. Its content/full-screen intents carry the
 * calls deep link (`https://app.loonext.com/calls?call={session}`) so a tap
 * or a locked-screen ring lands on the calls surface, same as a push tap.
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
        // Request codes are derived per call — two concurrently ringing calls
        // must not overwrite each other's answer/decline PendingIntents.
        val answer = actionIntent(ACTION_ANSWER, call.id, requestCode = code(call.id, 1))
        val decline = actionIntent(ACTION_DECLINE, call.id, requestCode = code(call.id, 2))
        val open = openCallsIntent(call, requestCode = code(call.id, 3))
        // CallStyle is legal here ONLY because of the fullScreenIntent below:
        // API 31+ Notification.Builder.build() THROWS IllegalArgumentException
        // for a CallStyle notification that is neither a foreground service
        // nor full-screen (#168A). Never remove the fullScreenIntent without
        // dropping the style with it.
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
            .setFullScreenIntent(open, true)
            .setContentIntent(open)
            .build()
        // A notification must NEVER kill the call path (#168A hardening) —
        // and a ring must never be dropped silently: fall back to a plain
        // high-priority notification if the styled build/post refuses.
        runCatching {
            NotificationManagerCompat.from(context)
                .notify(INCOMING_TAG_PREFIX + call.id, INCOMING_ID, notification)
        }.onFailure {
            runCatching {
                val plain = NotificationCompat.Builder(context, ChannelIds.INCOMING_CALLS)
                    .setSmallIcon(R.drawable.ic_launcher_foreground)
                    .setContentTitle(call.peerName)
                    .setContentText("Incoming call")
                    .setCategory(NotificationCompat.CATEGORY_CALL)
                    .setPriority(NotificationCompat.PRIORITY_MAX)
                    .setOngoing(true)
                    .setContentIntent(open)
                    .addAction(0, "Decline", decline)
                    .addAction(0, "Answer", answer)
                    .build()
                NotificationManagerCompat.from(context)
                    .notify(INCOMING_TAG_PREFIX + call.id, INCOMING_ID, plain)
            }
        }
    }

    fun cancelIncoming(callId: String) {
        runCatching {
            NotificationManagerCompat.from(context)
                .cancel(INCOMING_TAG_PREFIX + callId, INCOMING_ID)
        }
    }

    /**
     * The quiet persistent notification while any call is live.
     *
     * #168A ROOT CAUSE lived here: this used CallStyle.forOngoingCall with no
     * foreground service and no fullScreenIntent — on API 31+ the platform's
     * Notification.Builder.build() throws IllegalArgumentException
     * ("CallStyle notifications must either be for a foreground service or
     * use a fullScreenIntent."). It ran inside the state-collect coroutine
     * the instant an answered call went ACTIVE — after the Telnyx ANSWER was
     * already on the wire — so the server leg connected while the app died.
     * The fix: a plain notification with a hang-up action (no CallStyle, no
     * platform preconditions); an ongoing surface must never full-screen.
     */
    fun showOngoing(call: CallSnapshot) {
        if (!canPost()) return
        ensureChannels(context)
        val hangup = actionIntent(ACTION_HANGUP, call.id, requestCode = 5)
        val builder = NotificationCompat.Builder(context, ChannelIds.MISSED_CALLS)
            .setSmallIcon(R.drawable.ic_launcher_foreground)
            .setContentTitle(call.peerName)
            .setContentText(if (call.phase == CallPhase.HELD) "On hold" else "On a call")
            .setCategory(NotificationCompat.CATEGORY_CALL)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setSilent(true)
            .setContentIntent(openAppIntent(requestCode = 6))
            .addAction(0, "Hang up", hangup)
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

    /**
     * Open the app on the calls surface via the existing deep-link contract
     * (MainActivity parses `/calls?call=…` from notification taps). Used for
     * both the tap intent and the full-screen (locked-device) ring intent.
     * A still-ringing inbound leg may not know its customer session yet — the
     * SDK call id rides along instead; the parser only routes on the path.
     */
    private fun openCallsIntent(call: CallSnapshot, requestCode: Int): PendingIntent {
        val uri = "https://app.loonext.com/calls?call=${call.sessionId ?: call.id}".toUri()
        val intent = Intent(Intent.ACTION_VIEW, uri, context, MainActivity::class.java)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
        return PendingIntent.getActivity(
            context,
            requestCode,
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
    }

    /** Stable per-call request code so PendingIntents never collide. */
    private fun code(callId: String, slot: Int): Int = callId.hashCode() * 31 + slot

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
        // A throw out of a BroadcastReceiver kills the process (#168A
        // hardening) — a broken shade action must degrade to a no-op.
        runCatching {
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
}
