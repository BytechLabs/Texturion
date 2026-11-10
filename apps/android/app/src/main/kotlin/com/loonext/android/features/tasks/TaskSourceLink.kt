package com.loonext.android.features.tasks

import com.loonext.android.core.i18n.AppStrings
import com.loonext.android.core.model.TaskSource
import com.loonext.android.core.model.TaskSourceCall

enum class TaskSourceKind { TEXT, CALL, NOTE }

/** The thread to open for a task's source: the message, or the call's line. */
data class TaskSourceLink(
    val kind: TaskSourceKind,
    /** Names the source: "From a text from Sam". */
    val label: String,
    val conversationId: String,
    val messageId: String?,
    val callSessionId: String?,
)

/**
 * #718: the link from a task back to where it came from, or null. It exists
 * only when the source does and it names that source, so a standalone task
 * never prints "Open conversation". Mirrors the web's `taskSourceLink`.
 */
fun taskSourceLink(
    conversationId: String?,
    messageId: String?,
    source: TaskSource?,
    call: TaskSourceCall?,
    sourceMessageDirection: String?,
    contactName: String?,
    locale: String? = null,
): TaskSourceLink? {
    if (conversationId == null) return null
    fun say(key: String, vararg vars: Pair<String, String>) =
        AppStrings.translate(locale, key, vars.toMap())

    if (source?.kind == "call" || call != null) {
        val name = call?.let { taskCallerName(it, locale) }
            ?: say("contactsTasks.callUnknownCaller")
        return TaskSourceLink(
            kind = TaskSourceKind.CALL,
            label = say("contactsTasks.linkFromCall", "name" to name),
            conversationId = conversationId,
            messageId = null,
            callSessionId = call?.call_session_id,
        )
    }
    if (messageId == null) return null
    if (sourceMessageDirection == "note" || source?.direction == "note") {
        return TaskSourceLink(
            kind = TaskSourceKind.NOTE,
            label = say("contactsTasks.linkNote"),
            conversationId = conversationId,
            messageId = messageId,
            callSessionId = null,
        )
    }
    val name = contactName?.trim()?.takeIf { it.isNotEmpty() }
    return TaskSourceLink(
        kind = TaskSourceKind.TEXT,
        label = if (name != null) say("contactsTasks.linkFromText", "name" to name)
        else say("contactsTasks.linkFromTextUnnamed"),
        conversationId = conversationId,
        messageId = messageId,
        callSessionId = null,
    )
}
