package com.loonext.android.features.thread

import com.loonext.android.core.i18n.AppStrings
import com.loonext.android.core.model.Message
import com.loonext.android.core.model.MessageDirection

/**
 * #725: which automation sent a text, so a thread reads "Sent automatically ·
 * Away reply" where it would otherwise carry the owner's name. Mirrors
 * `apps/web/src/lib/format/message-automation.ts` and
 * `packages/shared/src/message-automations.ts`.
 */
val MESSAGE_AUTOMATIONS: List<String> = listOf(
    "away_reply",
    "help_reply",
    "off_ramp",
    "emergency_ack",
    "missed_call_text",
    "job_rating",
    "reminder",
)

/** Each automation's catalogue key. A `when` over the wire value keeps the list and the words together. */
private fun automationKey(automation: String?): String? = when (automation) {
    "away_reply" -> "thread.automationAwayReply"
    "help_reply" -> "thread.automationHelpReply"
    "off_ramp" -> "thread.automationOffRamp"
    "emergency_ack" -> "thread.automationEmergencyAck"
    "missed_call_text" -> "thread.automationMissedCallText"
    "job_rating" -> "thread.automationJobRating"
    "reminder" -> "thread.automationReminder"
    else -> null
}

/** The automation's own name ("Away reply"), or null when the text does not say. */
fun messageAutomationName(automation: String?, locale: String? = null): String? =
    automationKey(automation)?.let { AppStrings.translate(locale, it) }

/** "Sent automatically · Away reply", or just "Sent automatically" for a text sent before the automation was recorded. */
fun sentAutomaticallyLabel(automation: String?, locale: String? = null): String {
    val name = messageAutomationName(automation, locale)
    return if (name != null) {
        AppStrings.translate(locale, "thread.sentAutomaticallyBy", mapOf("automation" to name))
    } else {
        AppStrings.translate(locale, "thread.sentAutomatically")
    }
}

/**
 * Who an outbound text or note is credited to, the line under its bubble.
 * An automated text is written in the owner's name and is still not theirs, so
 * it is named for the automation and never for [Message.sent_by_user_id] (web
 * `clusters.ts` keeps it out of the owner's run for the same reason).
 */
fun messageSenderLabel(
    message: Message,
    names: Map<String, String>,
    locale: String? = null,
): String? = when {
    message.direction == MessageDirection.OUTBOUND && message.automated ->
        sentAutomaticallyLabel(message.automation, locale)
    else -> message.sent_by_user_id?.let { names[it] }
}
