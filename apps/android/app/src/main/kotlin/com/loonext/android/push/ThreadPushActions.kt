package com.loonext.android.push

import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.util.Log
import androidx.core.app.NotificationCompat
import androidx.core.app.Person
import androidx.core.app.RemoteInput
import com.loonext.android.LoonextApp
import com.loonext.android.MainActivity
import com.loonext.android.core.i18n.AppStrings
import com.loonext.android.core.model.MessageLocale
import com.loonext.android.features.thread.MessagingRepository
import com.loonext.android.features.thread.QueuedSend
import java.time.Instant
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch
import kotlinx.coroutines.withTimeout

private const val REPLY_TEXT = "reply_text"
private const val REPLY = "reply"
private const val MARK_READ = "mark_read"
private const val PUSH_MESSAGE_ID = "com.loonext.android.push.MESSAGE_ID"
private const val ACTION_TIMEOUT_MS = 7_000L
private val UUID_PATTERN = Regex("(?i)[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}")
internal val CALLBACK_PATTERN = Regex("[+][1-9][0-9]{6,14}")

data class ThreadPushScope(val companyId: String, val userId: String, val conversationId: String)

sealed interface ThreadPushActions {
    val scope: ThreadPushScope
    val locale: String

    data class Message(
        override val scope: ThreadPushScope,
        override val locale: String,
        val id: String,
        val sender: String,
        val canReply: Boolean,
    ) : ThreadPushActions

    data class MissedCall(
        override val scope: ThreadPushScope,
        override val locale: String,
        val number: String,
    ) : ThreadPushActions
}

private fun scopeOf(company: String?, user: String?, conversation: String?): ThreadPushScope? {
    if (company == null || user == null || conversation == null) return null
    if (!listOf(company, user, conversation).all(UUID_PATTERN::matches)) return null
    return ThreadPushScope(company, user, conversation)
}

fun parseThreadPushActions(data: Map<String, String>): ThreadPushActions? {
    val scope = scopeOf(data["action_company_id"], data["action_user_id"], data["action_conversation_id"])
        ?: return null
    val locale = data["action_locale"] ?: MessageLocale.DEFAULT
    return when (data["thread_action"]) {
        "message" -> {
            val id = data["action_message_id"]?.takeIf(UUID_PATTERN::matches) ?: return null
            val sender = data["action_sender"]?.takeIf { it.isNotBlank() } ?: return null
            ThreadPushActions.Message(scope, locale, id, sender, data["can_reply"] == "true")
        }
        "missed_call" -> {
            val number = data["action_callback_number"]?.takeIf(CALLBACK_PATTERN::matches) ?: return null
            ThreadPushActions.MissedCall(scope, locale, number)
        }
        else -> null
    }
}

internal fun ThreadPushActions.addTo(
    context: Context,
    builder: NotificationCompat.Builder,
    content: PushContent,
    threadIntent: PendingIntent,
) {
    when (this) {
        is ThreadPushActions.Message -> {
            builder.extras.putString(PUSH_MESSAGE_ID, id)
            val reader = Person.Builder().setName(AppStrings.translate(locale, "contactsTasks.you")).build()
            val author = Person.Builder().setName(sender).build()
            builder.setStyle(NotificationCompat.MessagingStyle(reader)
                .addMessage(content.body, System.currentTimeMillis(), author))
            if (canReply) {
                val label = AppStrings.translate(locale, "push.reply")
                builder.addAction(NotificationCompat.Action.Builder(0, label, actionIntent(context, REPLY))
                    .addRemoteInput(RemoteInput.Builder(REPLY_TEXT).setLabel(label).build())
                    .setSemanticAction(NotificationCompat.Action.SEMANTIC_ACTION_REPLY)
                    .setShowsUserInterface(false)
                    .build())
            }
            val readLabel = AppStrings.translate(locale, "recordMenu.markRead")
            builder.addAction(NotificationCompat.Action.Builder(0, readLabel, actionIntent(context, MARK_READ))
                .setSemanticAction(NotificationCompat.Action.SEMANTIC_ACTION_MARK_AS_READ)
                .setShowsUserInterface(false)
                .build())
        }
        is ThreadPushActions.MissedCall -> {
            builder.addAction(0, AppStrings.translate(locale, "contactsTasks.callBack"), dialIntent(context))
            builder.addAction(0, AppStrings.translate(locale, "contactsTasks.textAction"), threadIntent)
        }
    }
}

private fun ThreadPushActions.Message.actionIntent(context: Context, action: String): PendingIntent {
    val link = Uri.Builder().scheme("loonext").authority("thread-action")
        .appendPath(action).appendPath(scope.companyId).appendPath(scope.userId)
        .appendPath(scope.conversationId).appendPath(id).build()
    val intent = Intent(context, ThreadPushActionReceiver::class.java).setData(link)
    val flags = if (action == REPLY) PendingIntent.FLAG_MUTABLE else PendingIntent.FLAG_IMMUTABLE
    return PendingIntent.getBroadcast(context, 0, intent, PendingIntent.FLAG_UPDATE_CURRENT or flags)
}

private fun ThreadPushActions.MissedCall.dialIntent(context: Context): PendingIntent {
    val link = Uri.parse(APP_ORIGIN).buildUpon().appendPath("calls")
        .appendQueryParameter("dial", number)
        .appendQueryParameter("workspace", scope.companyId)
        .appendQueryParameter("member", scope.userId)
        .build()
    val intent = Intent(context, MainActivity::class.java).apply {
        action = Intent.ACTION_VIEW
        data = link
        addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP)
    }
    return PendingIntent.getActivity(context, 0, intent, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
}

class ThreadPushActionReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val path = intent.data?.pathSegments ?: return
        if (path.size != 5) return
        val action = path[0]
        if (action != REPLY && action != MARK_READ) return
        val scope = scopeOf(path[1], path[2], path[3]) ?: return
        val messageId = path[4].takeIf(UUID_PATTERN::matches) ?: return
        val reply = RemoteInput.getResultsFromIntent(intent)?.getCharSequence(REPLY_TEXT)?.toString()?.trim()
        if (action == REPLY && reply.isNullOrEmpty()) return
        val graph = (context.applicationContext as? LoonextApp)?.graph ?: return
        val pending = goAsync()
        graph.appScope.launch {
            try {
                withTimeout(ACTION_TIMEOUT_MS) {
                    if (graph.sessionStore.current()?.userId != scope.userId) return@withTimeout
                    if (action == REPLY && reply != null) {
                        val key = "push-reply-$messageId-${scope.userId}"
                        val row = QueuedSend(
                            localId = key,
                            companyId = scope.companyId,
                            conversationId = scope.conversationId,
                            body = reply,
                            createdAt = Instant.now().toString(),
                            ownerUserId = scope.userId,
                        )
                        if (!graph.outbox.enqueue(row, emptyList())) return@withTimeout
                        graph.flushOutbox()
                        val manager = context.getSystemService(NotificationManager::class.java)
                        val matching = manager.activeNotifications.firstOrNull {
                            it.notification.extras.getString(PUSH_MESSAGE_ID) == messageId
                        }
                        if (matching != null) manager.cancel(matching.tag, matching.id)
                    } else {
                        MessagingRepository(graph.api).markRead(
                            scope.companyId, scope.conversationId, expectedUserId = scope.userId,
                        )
                        clearConversationNotifications(context, scope.conversationId)
                    }
                }
            } catch (cancelled: CancellationException) {
                throw cancelled
            } catch (cause: Exception) {
                Log.w("LoonextPush", "Thread notification action did not complete", cause)
            } finally {
                pending.finish()
            }
        }
    }
}
