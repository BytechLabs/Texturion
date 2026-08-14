package com.loonext.android.core.reminders

import com.loonext.android.core.i18n.AppStrings

/**
 * #237 — appointment reminders, as this phone understands them.
 *
 * A hand-port of the parts of packages/shared/src/appointment-reminders.ts a
 * SETTINGS screen needs: the cap, the offsets on offer, and how an offset is
 * said out loud. The reminder bodies themselves are not here — they come from
 * the API, because they are the workspace's own words rather than the
 * product's, and the two suggestions arrive with the rules.
 *
 * The confirmation vocabulary is deliberately absent too: which replies count
 * as a yes is decided on the SERVER, at the moment an inbound message arrives,
 * and a phone that also held an opinion about it would be a second answer to a
 * question only one side gets to answer.
 */
object AppointmentReminders {
    /**
     * How many rules one workspace may hold. Mirrors `REMINDER_RULES_CAP` and
     * the SQL cap.
     *
     * Two, not five: a crew that texts a customer five times before arriving is
     * a crew whose customers stop reading their texts, and that cost lands on
     * the next message that actually matters.
     */
    const val RULES_CAP = 2

    /**
     * The offsets an owner may pick between, furthest out first.
     *
     * A fixed list rather than a free number field. "How many minutes before?"
     * is a question nobody in a van wants to answer, and the two that matter
     * are already the industry's — the day before, so the customer can still
     * move it, and a couple of hours out, so somebody is home.
     */
    val OFFSET_CHOICES = listOf(2880, 1440, 240, 120, 60)

    /**
     * "The day before", "2 hours before" — the offset, said the way a person
     * would.
     *
     * #228: [locale] is last and defaulted, so the settings card that knows the
     * reader can pass it while every other caller keeps its English.
     */
    fun offsetLabel(minutes: Int, locale: String? = null): String {
        fun say(key: String, count: Int) =
            AppStrings.translate(locale, key, mapOf("count" to count.toString()))
        return when {
            minutes % 1440 == 0 -> {
                val days = minutes / 1440
                if (days == 1) {
                    AppStrings.translate(locale, "domain.reminderOffsetDayBefore")
                } else {
                    say("domain.reminderOffsetDays", days)
                }
            }
            minutes % 60 == 0 -> {
                val hours = minutes / 60
                if (hours == 1) {
                    AppStrings.translate(locale, "domain.reminderOffsetHour")
                } else {
                    say("domain.reminderOffsetHours", hours)
                }
            }
            else -> say("domain.reminderOffsetMinutes", minutes)
        }
    }
}
