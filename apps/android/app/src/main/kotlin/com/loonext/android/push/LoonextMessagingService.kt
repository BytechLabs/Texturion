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
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch

private const val TAG = "LoonextPush"

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

        if (content.isCall) {
            val handler = PushHooks.callWakeHandler
            if (handler != null) {
                handler.onIncomingCallPush(content)
                return
            }
            // No softphone wired — never drop a ring silently.
        }
        postPushNotification(this, content)
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
            // The server ring window is ~30s (TTL-30 push); a stale ringing
            // notification would be a lie, so it removes itself.
            .setTimeoutAfter(30_000)
    } else {
        builder
            .setCategory(NotificationCompat.CATEGORY_MESSAGE)
            .setPriority(NotificationCompat.PRIORITY_DEFAULT)
    }

    NotificationManagerCompat.from(context).notify(content.tag, 0, builder.build())
}
