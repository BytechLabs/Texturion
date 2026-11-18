package com.loonext.android.push

import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.util.Log
import androidx.core.app.NotificationCompat
import com.loonext.android.LoonextApp
import com.loonext.android.core.i18n.AppStrings
import com.loonext.android.core.model.MessageLocale
import com.loonext.android.features.thread.MessagingRepository
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch
import kotlinx.coroutines.withTimeout
import java.util.UUID

private const val TAG = "LoonextPushAction"
private const val ALERT_EXTRA = "com.loonext.android.push.ALERT"
private const val TAG_EXTRA = "com.loonext.android.push.TAG"
private const val ACKNOWLEDGE_TIMEOUT_MS = 7_000L

data class OnCallPushAction(
    val alertId: String,
    val companyId: String,
    val userId: String,
    val locale: String,
)

fun parseOnCallAction(data: Map<String, String>): OnCallPushAction? =
    parseActionScope(
        data["alert_id"],
        data["action_company_id"],
        data["action_user_id"],
        data["action_locale"] ?: MessageLocale.DEFAULT,
    )

private fun parseActionScope(
    alertId: String?,
    companyId: String?,
    userId: String?,
    locale: String = MessageLocale.DEFAULT,
): OnCallPushAction? {
    if (alertId == null || companyId == null || userId == null) return null
    val idsAreValid = listOf(alertId, companyId, userId).all { value ->
        runCatching { UUID.fromString(value).toString().equals(value, ignoreCase = true) }
            .getOrDefault(false)
    }
    if (!idsAreValid) return null
    return OnCallPushAction(alertId, companyId, userId, locale)
}

internal fun OnCallPushAction.addTo(
    builder: NotificationCompat.Builder,
    context: Context,
    tag: String,
) {
    val intent = Intent(context, OnCallActionReceiver::class.java).apply {
        data = Uri.Builder()
            .scheme("loonext")
            .authority("on-call")
            .appendPath(alertId)
            .appendPath(companyId)
            .appendPath(userId)
            .build()
        putExtra(TAG_EXTRA, tag)
    }
    val pending = PendingIntent.getBroadcast(
        context,
        0,
        intent,
        PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
    )
    builder.extras.putString(ALERT_EXTRA, alertId)
    builder.addAction(0, AppStrings.translate(locale, "domain.onCallBannerClaim"), pending)
}

class OnCallActionReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val path = intent.data?.pathSegments ?: return
        if (path.size != 3) return
        val action = parseActionScope(path[0], path[1], path[2]) ?: return
        val tag = intent.getStringExtra(TAG_EXTRA) ?: return
        val graph = (context.applicationContext as? LoonextApp)?.graph ?: return
        val pending = goAsync()
        graph.appScope.launch {
            try {
                withTimeout(ACKNOWLEDGE_TIMEOUT_MS) {
                    MessagingRepository(graph.api).acknowledgeAlert(
                        action.companyId,
                        action.alertId,
                        expectedUserId = action.userId,
                    )
                }
                val manager = context.getSystemService(NotificationManager::class.java)
                val stillShown = manager.activeNotifications.any {
                    it.tag == tag && it.id == PUSH_NOTIFICATION_ID &&
                        it.notification.extras.getString(ALERT_EXTRA) == action.alertId
                }
                if (stillShown) manager.cancel(tag, PUSH_NOTIFICATION_ID)
            } catch (err: CancellationException) {
                throw err
            } catch (err: Exception) {
                Log.w(TAG, "On-call acknowledgement did not complete", err)
            } finally {
                pending.finish()
            }
        }
    }
}
