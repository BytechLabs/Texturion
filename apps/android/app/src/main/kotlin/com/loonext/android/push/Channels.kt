package com.loonext.android.push

import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Context
import android.media.AudioAttributes
import android.media.RingtoneManager
import com.loonext.android.core.i18n.AppStrings
import com.loonext.android.core.i18n.UiLocale

/**
 * Notification channel ids. Kept in their own pure object so payload parsing
 * (and its JVM unit tests) can reference them without touching the Android
 * framework classes in this file.
 */
object ChannelIds {
    const val MESSAGES = "messages"
    const val MISSED_CALLS = "missed_calls"
    const val INCOMING_CALLS = "incoming_calls"

    /**
     * Task reminders get their own channel because a busy inbox is the first
     * thing someone mutes, and a due-date reminder is time-critical in a way
     * an inbox notification is not. Sharing the Messages channel would mean
     * silencing one silences the other.
     */
    const val TASK_REMINDERS = "task_reminders"

    /**
     * Being HANDED work, as distinct from being reminded about work you
     * already had (#515). Its own channel for the same reason task reminders
     * have one: the inbox is the first thing a busy crew mutes, and somebody
     * putting a job on your name is the message that must survive that. It is
     * also the only channel here a crew member can silence without losing a
     * customer's text, which is what "notifications for other things" has to
     * mean if it is going to be kept switched on.
     */
    const val ASSIGNMENTS = "assignments"

    /**
     * #564: a customer replying URGENT. Its own channel at HIGH importance,
     * because the reply we send that customer says the crew has been alerted and
     * on the Messages channel that was not true — an urgent text buzzed exactly
     * as loudly as "on my way?" and was silenced by the same switch.
     *
     * Separate from INCOMING_CALLS rather than borrowed: a ringtone for a text
     * would be a phone call that isn't one, and somebody who mutes ringing
     * should not thereby mute this.
     */
    const val EMERGENCY = "emergency"

    /**
     * #607: money moving on a job — paid, refunded, or pulled back by a bank.
     *
     * Its own channel rather than Messages for the reason the others have one:
     * the inbox is what a crew mutes on a busy afternoon, and a deposit landing
     * is the one alert somebody is actively waiting on while they decide
     * whether to start work.
     */
    const val PAYMENTS = "payments"
}

/**
 * Create (or update in place) the Loonext notification channels.
 * Idempotent — createNotificationChannel is a no-op for an existing id — so
 * the integrator calls this once at app start and the messaging service calls
 * it defensively before posting (a push can arrive before first launch UI).
 *
 * Importance mirrors the web push behavior: messages, missed calls and task
 * reminders are normal notifications; urgent texts (#564) are high-importance
 * with a vibration; incoming calls are high-importance with the device ringtone
 * and a vibration pattern (the 30s push-to-wake ring, #135).
 */
fun ensureChannels(context: Context, locale: String? = null) {
    val manager = context.getSystemService(NotificationManager::class.java) ?: return

    /*
     * #228 — the reader's language, with a default that is right rather than
     * merely convenient.
     *
     * These strings are rendered by SYSTEM SETTINGS, not by us, so the honest
     * fallback when nobody has told us the app's language is the DEVICE's.
     * A caller that knows better — the Activity, which has resolved the app
     * locale from the member's own setting — passes it and wins.
     *
     * Android updates a channel's name and description in place when the same
     * id is registered again, so switching language and re-running this is
     * enough; the importance a member has since changed is theirs and is not
     * touched. That is why [MainActivity] calls this again once the locale
     * resolves rather than only at process start, where the preference has not
     * been read yet.
     */
    val reader = locale ?: UiLocale.normalizeDevice(UiLocale.deviceTag())
    fun say(key: String): String = AppStrings.translate(reader, key)

    val messages = NotificationChannel(
        ChannelIds.MESSAGES,
        say("push.channelMessagesName"),
        NotificationManager.IMPORTANCE_DEFAULT,
    ).apply {
        description = say("push.channelMessagesDesc")
    }

    val missedCalls = NotificationChannel(
        ChannelIds.MISSED_CALLS,
        say("push.channelMissedCallsName"),
        NotificationManager.IMPORTANCE_DEFAULT,
    ).apply {
        description = say("push.channelMissedCallsDesc")
    }

    val taskReminders = NotificationChannel(
        ChannelIds.TASK_REMINDERS,
        say("push.channelTaskRemindersName"),
        NotificationManager.IMPORTANCE_DEFAULT,
    ).apply {
        description = say("push.channelTaskRemindersDesc")
    }

    val assignments = NotificationChannel(
        ChannelIds.ASSIGNMENTS,
        say("push.channelAssignmentsName"),
        NotificationManager.IMPORTANCE_DEFAULT,
    ).apply {
        description = say("push.channelAssignmentsDesc")
    }

    val emergency = NotificationChannel(
        ChannelIds.EMERGENCY,
        say("push.channelUrgentName"),
        NotificationManager.IMPORTANCE_HIGH,
    ).apply {
        description = say("push.channelUrgentDesc")
        // HIGH alone heads-up and sounds; the vibration is what reaches a phone
        // in a pocket on a job site. Shorter and plainer than the ring pattern —
        // this is an alert to read, not a call to answer.
        enableVibration(true)
        vibrationPattern = longArrayOf(0, 350, 200, 350)
    }

    val payments = NotificationChannel(
        ChannelIds.PAYMENTS,
        say("push.channelPaymentsName"),
        NotificationManager.IMPORTANCE_DEFAULT,
    ).apply {
        description = say("push.channelPaymentsDesc")
    }

    val incomingCalls = NotificationChannel(
        ChannelIds.INCOMING_CALLS,
        say("push.channelIncomingCallsName"),
        NotificationManager.IMPORTANCE_HIGH,
    ).apply {
        description = say("push.channelIncomingCallsDesc")
        setSound(
            RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE),
            AudioAttributes.Builder()
                .setUsage(AudioAttributes.USAGE_NOTIFICATION_RINGTONE)
                .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                .build(),
        )
        enableVibration(true)
        vibrationPattern = longArrayOf(200, 100, 200, 100, 200)
    }

    manager.createNotificationChannels(
        listOf(
            messages,
            missedCalls,
            taskReminders,
            assignments,
            emergency,
            payments,
            incomingCalls,
        ),
    )
}
