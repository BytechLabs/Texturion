package com.loonext.android.push

import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.util.Log
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.net.toUri
import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage
import com.loonext.android.LoonextApp
import com.loonext.android.MainActivity
import com.loonext.android.R
import com.loonext.android.telephony.SoftphoneManager
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch

private const val TAG = "LoonextPush"

/**
 * The fixed notify() id every tray push shares — coalescing is keyed on the
 * TAG, not the id (a call_end revocation cancels by `call:<session>`).
 */
const val PUSH_NOTIFICATION_ID = 0

/**
 * FCM entry point. Only instantiated by the system when Firebase is actually
 * configured (no google-services resources = no token = no messages), so
 * everything here can assume Firebase exists.
 *
 * onMessageReceived expects the server data contract `{title, body, url}` +
 * `kind:'call'` for push-to-wake (#135). Call pushes go to the installed
 * [PushHooks.callWakeHandler] (SoftphoneManager, #155); without one they fall
 * back to a high-importance ringing notification. Everything else posts on
 * its channel with per-conversation tag coalescing and a deep-link
 * PendingIntent into [MainActivity] (ACTION_VIEW + the normalized url as
 * intent data).
 */
class LoonextMessagingService : FirebaseMessagingService() {
    private val serviceScope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    override fun onDestroy() {
        serviceScope.cancel()
        super.onDestroy()
    }

    override fun onNewToken(token: String) {
        val graph = (applicationContext as? LoonextApp)?.graph
        if (graph == null) {
            Log.w(TAG, "Token refresh before app graph was ready; next start re-upserts.")
            return
        }
        serviceScope.launch {
            PushRegistrar(applicationContext, graph.api).onTokenRefresh(token)
        }
    }

    override fun onMessageReceived(message: RemoteMessage) {
        // Data messages are the contract; a notification-only message (e.g.
        // a console test send) still renders through the same parser.
        val data: Map<String, String> = message.data.takeIf { it.isNotEmpty() }
            ?: buildMap {
                message.notification?.title?.let { put("title", it) }
                message.notification?.body?.let { put("body", it) }
            }
        val content = parsePush(data)

        // `kind:'call_end'` revocation (calls-v3 §9.2): Android FCM sends are
        // data-only with NO collapse key, so the tray is never replaced by the
        // OS — this explicit cancel-by-tag of the `call:<session>` entry is the
        // ONLY dismissal mechanism. Bring the in-app ring surfaces down through
        // the softphone (constructing it if a cold process must), then render
        // NOTHING (a call_end is a revocation, never a notification).
        if (content.isCallEnd) {
            runCatching {
                NotificationManagerCompat.from(this).cancel(content.tag, PUSH_NOTIFICATION_ID)
            }
            ensureCallWakePath()
            PushHooks.callEndHandler?.onCallEnd(content)
            return
        }

        if (content.isCall) {
            // Cold-process wake (§10.2): in an FCM-woken process with no UI,
            // nobody built the softphone yet — build it now so the wake handler
            // is installed and this ring reaches ring-me instead of the tray.
            ensureCallWakePath()
            val handler = PushHooks.callWakeHandler
            if (handler != null) {
                handler.onIncomingCallPush(content)
                return
            }
            // No softphone wired (no workspace known yet) — never drop a ring
            // silently; fall through to the high-importance tray notification.
        }
        postPushNotification(this, content)
    }

    /**
     * Ensure the process-wide softphone exists and is registering (calls-v3
     * §10.2 cold-process wake path). Constructing [SoftphoneManager] from the
     * APPLICATION context installs [PushHooks.callWakeHandler] /
     * [PushHooks.callEndHandler] (its init is the ONE installer); starting it
     * on the last-known workspace gives ring-me a company and a live SDK.
     * Idempotent and best-effort — a no-op when the app is already running,
     * silently skipped before any workspace has ever been registered.
     */
    private fun ensureCallWakePath() {
        val graph = (applicationContext as? LoonextApp)?.graph ?: return
        val softphone = SoftphoneManager.get(applicationContext, graph.api)
        PushPrefs.companyId(applicationContext)?.let { company ->
            runCatching { softphone.start(company) }
        }
    }
}

/**
 * Post one parsed push to the tray. Tag-keyed notify() gives the coalescing
 * contract: repeats for one conversation (or one call session) replace the
 * previous notification and re-alert; distinct threads/calls stack (#149).
 */
fun postPushNotification(context: Context, content: PushContent) {
    if (!NotificationManagerCompat.from(context).areNotificationsEnabled()) {
        Log.i(TAG, "Notifications disabled for the app; push not shown.")
        return
    }
    ensureChannels(context)

    val intent = Intent(context, MainActivity::class.java).apply {
        action = Intent.ACTION_VIEW
        data = content.url.toUri()
        addFlags(
            Intent.FLAG_ACTIVITY_NEW_TASK or
                Intent.FLAG_ACTIVITY_CLEAR_TOP or
                Intent.FLAG_ACTIVITY_SINGLE_TOP,
        )
    }
    val pending = PendingIntent.getActivity(
        context,
        content.tag.hashCode(),
        intent,
        PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
    )

    val builder = NotificationCompat.Builder(context, content.channelId)
        .setSmallIcon(R.drawable.ic_launcher_foreground)
        .setContentTitle(content.title)
        .setContentText(content.body)
        .setStyle(NotificationCompat.BigTextStyle().bigText(content.body))
        .setContentIntent(pending)
        .setAutoCancel(true)
        // Coalesced repeats re-alert (web `renotify: true` parity).
        .setOnlyAlertOnce(false)

    if (content.isCall) {
        builder
            .setCategory(NotificationCompat.CATEGORY_CALL)
            .setPriority(NotificationCompat.PRIORITY_MAX)
            // The server ring window is 45s (calls-v3 §5) and the wake push
            // TTL is 45s to match (§9.2) — align the tray timeout so a real
            // ring is never cut short; a stale one still removes itself.
            .setTimeoutAfter(45_000)
    } else {
        builder
            .setCategory(NotificationCompat.CATEGORY_MESSAGE)
            .setPriority(NotificationCompat.PRIORITY_DEFAULT)
    }

    NotificationManagerCompat.from(context).notify(content.tag, PUSH_NOTIFICATION_ID, builder.build())
}
