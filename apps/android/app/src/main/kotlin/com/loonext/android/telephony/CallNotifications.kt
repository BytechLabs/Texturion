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
import com.loonext.android.R
import com.loonext.android.features.calls.IncomingCallActivity
import com.loonext.android.push.PushPrefs
import com.loonext.android.push.ChannelIds
import com.loonext.android.push.ensureChannels
import com.loonext.android.ui.common.formatPhone
import kotlinx.coroutines.launch

/**
 * Ring + ongoing-call notifications for the softphone (#155). Self-managed
 * telecom means WE own the incoming-call surface: a high-importance CallStyle
 * notification with a full-screen intent (the lock-screen ring), and a quiet
 * ongoing one while a call is live. Channels come from push/Channels.kt so
 * the wake push (#156) and the live SDK ring share one user-facing switch.
 *
 * #167: the incoming notification is posted ONLY while the app is not in the
 * foreground ([SoftphoneManager] gates it) — in-app, the animated banner +
 * [Ringer] are the presentation.
 *
 * #171: the full-screen intent now targets the dedicated
 * [IncomingCallActivity] (setShowWhenLocked/turnScreenOn) so the answer/decline
 * surface renders over the keyguard — NEVER MainActivity's tab shell, which
 * has no lock-screen flags and bounced answer into the app. The shade
 * Answer/Decline actions act DIRECTLY (see [CallActionReceiver]).
 */
internal class CallNotifier(private val context: Context) {
    companion object {
        const val ACTION_ANSWER = "com.loonext.android.telephony.action.ANSWER"
        const val ACTION_DECLINE = "com.loonext.android.telephony.action.DECLINE"
        const val ACTION_HANGUP = "com.loonext.android.telephony.action.HANGUP"
        const val EXTRA_CALL_ID = "call_id"

        /** The customer call_session_id (§8.1) — the decline endpoint's key and
         *  the incoming-ring notification's session tag. Carried so a shade
         *  Decline reaches the server even when the app process is dead. */
        const val EXTRA_CALL_SESSION = "call_session"
        const val EXTRA_COMPANY_ID = "company_id"
        const val EXTRA_CALLER_NAME = "caller_name"
        const val EXTRA_CALLER_NUMBER = "caller_number"

        private const val INCOMING_ID = 2101
        private const val ONGOING_ID = 2102
        private const val ONGOING_TAG = "loonext.call.ongoing"
        private const val INCOMING_TAG_PREFIX = "loonext.call.incoming:"

        /** The incoming-ring notification tag. When the session is known it is
         *  `call:<session>` — identical to the push coalescing tag and the
         *  `call_end` revocation key (§9.2), so the push-immediate ring and the
         *  later INVITE-driven ring collapse into ONE notification and
         *  `call_end` cancels it. Otherwise a per-leg tag (pure foreground
         *  INVITE with no wake session). */
        fun incomingTag(session: String?, callId: String): String =
            if (!session.isNullOrBlank()) "call:$session" else INCOMING_TAG_PREFIX + callId

        /** Cancel the incoming ring for a session (`call_end`, §9.2 — the ONLY
         *  Android dismissal; data-only FCM carries no collapse key). Static so
         *  the messaging service can call it without a softphone. */
        fun cancelIncomingForSession(context: Context, session: String) {
            runCatching {
                NotificationManagerCompat.from(context).cancel("call:$session", INCOMING_ID)
            }
        }
    }

    private fun canPost(): Boolean {
        // POST_NOTIFICATIONS is runtime-gated only from API 33; on older
        // platforms the permission string doesn't exist and must not gate.
        val granted = android.os.Build.VERSION.SDK_INT < 33 ||
            context.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) ==
            PackageManager.PERMISSION_GRANTED
        return granted && NotificationManagerCompat.from(context).areNotificationsEnabled()
    }

    /**
     * The lock-screen/heads-up ring for one INVITE-bound inbound call.
     * Idempotent per (session|call). [companyId]/[sessionId] thread the decline
     * endpoint coordinates into the shade actions and the full-screen intent.
     */
    fun showIncoming(call: CallSnapshot, companyId: String?, sessionId: String?) {
        if (!canPost()) return
        if (IncomingCallActivity.isPresenting(sessionId)) {
            // The dedicated activity is already the presentation for this ring
            // (launched by a push-immediate full-screen intent) — one
            // presentation per session per device (§10.1.4): do NOT stack a
            // second notification behind it.
            return
        }
        postRing(
            session = sessionId,
            callId = call.id,
            companyId = companyId,
            callerName = call.peerName,
            callerNumber = call.peerNumber,
        )
    }

    /**
     * #171 bug 2 — present the ring IMMEDIATELY from a `kind:'call'` push,
     * BEFORE the WebRTC INVITE binds (the WhatsApp model). The full-screen
     * intent launches [IncomingCallActivity] over the keyguard; the channel's
     * ringtone is the audible ring; the softphone wakes and the real INVITE
     * binds behind it. Tagged `call:<session>` so the later INVITE-driven ring
     * collapses in and `call_end` cancels it.
     */
    fun showIncomingFromPush(
        session: String,
        callerName: String,
        callerNumber: String,
        companyId: String?,
    ) {
        if (!canPost()) return
        postRing(
            session = session,
            callId = session,
            companyId = companyId,
            callerName = callerName,
            callerNumber = callerNumber,
        )
    }

    private fun postRing(
        session: String?,
        callId: String,
        companyId: String?,
        callerName: String,
        callerNumber: String,
    ) {
        ensureChannels(context)
        val person = person(callerName)
        val answer = actionIntent(
            ACTION_ANSWER, callId, session, companyId, callerName, callerNumber,
            requestCode = code(callId, 1),
        )
        val decline = actionIntent(
            ACTION_DECLINE, callId, session, companyId, callerName, callerNumber,
            requestCode = code(callId, 2),
        )
        val fullScreen = incomingCallActivityIntent(
            session, callId, companyId, callerName, callerNumber, autoAnswer = false,
            requestCode = code(callId, 3),
        )
        // CallStyle is legal here ONLY because of the fullScreenIntent below:
        // API 31+ Notification.Builder.build() THROWS IllegalArgumentException
        // for a CallStyle notification that is neither a foreground service
        // nor full-screen (#168A). Never remove the fullScreenIntent without
        // dropping the style with it.
        val notification = NotificationCompat.Builder(context, ChannelIds.INCOMING_CALLS)
            .setSmallIcon(R.drawable.ic_launcher_foreground)
            .setContentTitle(callerName)
            .setContentText(
                if (callerNumber.isBlank()) "Incoming call"
                else "Incoming call · ${formatPhone(callerNumber)}",
            )
            .setStyle(NotificationCompat.CallStyle.forIncomingCall(person, decline, answer))
            .setCategory(NotificationCompat.CATEGORY_CALL)
            .setPriority(NotificationCompat.PRIORITY_MAX)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setFullScreenIntent(fullScreen, true)
            .setContentIntent(fullScreen)
            .build()
        val tag = incomingTag(session, callId)
        // A notification must NEVER kill the call path (#168A hardening) —
        // and a ring must never be dropped silently: fall back to a plain
        // high-priority notification if the styled build/post refuses.
        runCatching {
            NotificationManagerCompat.from(context).notify(tag, INCOMING_ID, notification)
        }.onFailure {
            runCatching {
                val plain = NotificationCompat.Builder(context, ChannelIds.INCOMING_CALLS)
                    .setSmallIcon(R.drawable.ic_launcher_foreground)
                    .setContentTitle(callerName)
                    .setContentText("Incoming call")
                    .setCategory(NotificationCompat.CATEGORY_CALL)
                    .setPriority(NotificationCompat.PRIORITY_MAX)
                    .setOngoing(true)
                    .setContentIntent(fullScreen)
                    .addAction(0, "Decline", decline)
                    .addAction(0, "Answer", answer)
                    .build()
                NotificationManagerCompat.from(context).notify(tag, INCOMING_ID, plain)
            }
        }
    }

    fun cancelIncoming(callId: String, session: String? = null) {
        runCatching {
            NotificationManagerCompat.from(context)
                .cancel(incomingTag(session, callId), INCOMING_ID)
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
        val hangup = actionIntent(
            ACTION_HANGUP, call.id, call.sessionId, null, call.peerName, call.peerNumber,
            requestCode = 5,
        )
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

    private fun person(name: String): Person = Person.Builder()
        .setName(name.ifBlank { "Unknown caller" })
        .setImportant(true)
        .build()

    private fun actionIntent(
        action: String,
        callId: String,
        session: String?,
        companyId: String?,
        callerName: String,
        callerNumber: String,
        requestCode: Int,
    ): PendingIntent {
        val intent = Intent(context, CallActionReceiver::class.java)
            .setAction(action)
            .putExtra(EXTRA_CALL_ID, callId)
            .putExtra(EXTRA_CALL_SESSION, session)
            .putExtra(EXTRA_COMPANY_ID, companyId)
            .putExtra(EXTRA_CALLER_NAME, callerName)
            .putExtra(EXTRA_CALLER_NUMBER, callerNumber)
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

    private fun incomingCallActivityIntent(
        session: String?,
        callId: String,
        companyId: String?,
        callerName: String,
        callerNumber: String,
        autoAnswer: Boolean,
        requestCode: Int,
    ): PendingIntent {
        val intent = IncomingCallActivity.intent(
            context, session, callId, companyId, callerName, callerNumber, autoAnswer,
        )
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
 * integrator's manifest entry). Actions act DIRECTLY (#171 bug 3), never just
 * "open the app":
 *  - Answer: mic-preflight then [SoftphoneManager.answer]; if the mic is
 *    ungranted or the softphone isn't built yet, open [IncomingCallActivity]
 *    (which wakes the softphone, runs the runtime preflight, and answers) —
 *    never the tab shell.
 *  - Decline / Hangup: route through [SoftphoneManager.decline] (server
 *    decline + local leg teardown). When the app process is dead
 *    ([SoftphoneManager.peek] is null) a Decline STILL reaches the server via
 *    a short-lived coroutine reading the session + company from the intent —
 *    a decline is never silently dropped.
 */
class CallActionReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        // A throw out of a BroadcastReceiver kills the process (#168A
        // hardening) — a broken shade action must degrade to a no-op.
        runCatching {
            val callId = intent.getStringExtra(CallNotifier.EXTRA_CALL_ID) ?: return
            val session = intent.getStringExtra(CallNotifier.EXTRA_CALL_SESSION)
            val company = intent.getStringExtra(CallNotifier.EXTRA_COMPANY_ID)
            val callerName = intent.getStringExtra(CallNotifier.EXTRA_CALLER_NAME).orEmpty()
            val callerNumber = intent.getStringExtra(CallNotifier.EXTRA_CALLER_NUMBER).orEmpty()
            val manager = SoftphoneManager.peek()
            val micGranted =
                context.checkSelfPermission(Manifest.permission.RECORD_AUDIO) ==
                    PackageManager.PERMISSION_GRANTED
            when (intent.action) {
                CallNotifier.ACTION_ANSWER -> {
                    val route = IncomingCallPresentation.routeNotificationAction(
                        IncomingCallPresentation.Action.ANSWER,
                        managerAlive = manager != null,
                        micGranted = micGranted,
                    )
                    if (route == IncomingCallPresentation.Route.ANSWER_DIRECT && manager != null) {
                        manager.answer(callId)
                        // Show the in-call controls over the keyguard without
                        // routing through the tab shell.
                        launchIncomingActivity(
                            context, session, callId, company, callerName, callerNumber,
                            autoAnswer = false,
                        )
                    } else {
                        launchIncomingActivity(
                            context, session, callId, company, callerName, callerNumber,
                            autoAnswer = true,
                        )
                    }
                }

                CallNotifier.ACTION_DECLINE -> {
                    if (manager != null) {
                        manager.decline(callId, sessionHint = session)
                    } else {
                        declineFromDeadProcess(context, session, company)
                    }
                    session?.let { CallNotifier.cancelIncomingForSession(context, it) }
                }

                CallNotifier.ACTION_HANGUP -> manager?.hangup(callId)
            }
        }
    }

    private fun launchIncomingActivity(
        context: Context,
        session: String?,
        callId: String,
        company: String?,
        callerName: String,
        callerNumber: String,
        autoAnswer: Boolean,
    ) {
        runCatching {
            context.startActivity(
                IncomingCallActivity.intent(
                    context, session, callId, company, callerName, callerNumber, autoAnswer,
                ).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
            )
        }
    }

    /**
     * Decline with the app process dead (#171): the softphone singleton was
     * never built, so there is no core to route through. POST the server
     * decline directly from the graph's [com.loonext.android.core.net.ApiClient]
     * (built in Application.onCreate, carrying the persisted session) on a
     * short-lived coroutine kept alive by goAsync(). Best-effort; the leg is
     * the server's to reap. NEVER a silent drop.
     */
    private fun declineFromDeadProcess(context: Context, session: String?, company: String?) {
        val sessionId = session?.takeIf { it.isNotBlank() } ?: return
        val app = context.applicationContext as? LoonextApp ?: return
        val graph = app.graph
        val companyId = company?.takeIf { it.isNotBlank() }
            ?: PushPrefs.companyId(context)
            ?: return
        val pending = goAsync()
        graph.appScope.launch {
            try {
                HttpCallsApi(graph.api).decline(companyId, sessionId)
            } catch (_: Exception) {
                // Best-effort — the server's own avenue ladder is the backstop.
            } finally {
                runCatching { pending.finish() }
            }
        }
    }
}
