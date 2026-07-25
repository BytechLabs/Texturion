package com.loonext.android.push

import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Context
import android.media.AudioAttributes
import android.media.RingtoneManager

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
}

/**
 * Create (or update in place) the Loonext notification channels.
 * Idempotent — createNotificationChannel is a no-op for an existing id — so
 * the integrator calls this once at app start and the messaging service calls
 * it defensively before posting (a push can arrive before first launch UI).
 *
 * Importance mirrors the web push behavior: messages, missed calls and task
 * reminders are normal notifications; incoming calls are high-importance with
 * the device ringtone and a vibration pattern (the 30s push-to-wake ring,
 * #135).
 */
fun ensureChannels(context: Context) {
    val manager = context.getSystemService(NotificationManager::class.java) ?: return

    val messages = NotificationChannel(
        ChannelIds.MESSAGES,
        "Messages",
        NotificationManager.IMPORTANCE_DEFAULT,
    ).apply {
        description = "New texts from customers."
    }

    val missedCalls = NotificationChannel(
        ChannelIds.MISSED_CALLS,
        "Missed calls",
        NotificationManager.IMPORTANCE_DEFAULT,
    ).apply {
        description = "Calls to your business number that nobody picked up."
    }

    val taskReminders = NotificationChannel(
        ChannelIds.TASK_REMINDERS,
        "Task reminders",
        NotificationManager.IMPORTANCE_DEFAULT,
    ).apply {
        description = "Jobs you are assigned, shortly before they are due."
    }

    val incomingCalls = NotificationChannel(
        ChannelIds.INCOMING_CALLS,
        "Incoming calls",
        NotificationManager.IMPORTANCE_HIGH,
    ).apply {
        description = "Ringing calls to your business number."
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
        listOf(messages, missedCalls, taskReminders, incomingCalls),
    )
}
