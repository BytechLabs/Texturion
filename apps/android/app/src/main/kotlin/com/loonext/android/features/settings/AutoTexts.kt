package com.loonext.android.features.settings

import com.loonext.android.core.i18n.AppStrings
import com.loonext.android.core.model.CompanyView
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

/**
 * #689: the pure half of the "Automatic texts" section. Which values each
 * picker offers, how a duration reads, and what the PATCH carries.
 *
 * Integers are picked from a fixed list, never typed. The list always contains
 * the CURRENT value even when it is not one of the presets (a value set through
 * the API), so opening a picker never hides what is in force.
 */
internal object AutoTexts {

    /** The unit the server stores a field in. */
    enum class Unit(val minutes: Int) { Minutes(1), Hours(60), Days(1440) }

    /** One integer setting: its wire key, unit, preset choices and default. */
    class IntField(
        val key: String,
        val labelKey: String,
        val unit: Unit,
        val choices: List<Int>,
        val default: Int,
        val read: (CompanyView) -> Int,
    )

    val ratingDelay = IntField(
        "rating_ask_delay_hours", "domain.autoTextsRatingDelay", Unit.Hours,
        listOf(0, 1, 2, 4, 8, 12, 24, 48), 4,
    ) { it.rating_ask_delay_hours }

    val ratingExpiry = IntField(
        "rating_ask_expiry_hours", "domain.autoTextsRatingExpiry", Unit.Hours,
        listOf(6, 12, 24, 48, 72, 168), 24,
    ) { it.rating_ask_expiry_hours }

    val ratingCooldown = IntField(
        "rating_ask_cooldown_days", "domain.autoTextsRatingCooldown", Unit.Days,
        listOf(7, 14, 30, 60, 90, 180), 30,
    ) { it.rating_ask_cooldown_days }

    val scheduledExpiry = IntField(
        "scheduled_text_expiry_hours", "domain.autoTextsScheduledExpiry", Unit.Hours,
        listOf(6, 12, 24, 48, 72, 168, 720), 24,
    ) { it.scheduled_text_expiry_hours }

    val reminderExpiry = IntField(
        "reminder_expiry_hours", "domain.autoTextsReminderExpiry", Unit.Hours,
        listOf(1, 2, 6, 12, 24, 72), 2,
    ) { it.reminder_expiry_hours }

    val replyCooldown = IntField(
        "auto_reply_cooldown_minutes", "domain.autoTextsReplyCooldown", Unit.Minutes,
        listOf(30, 60, 180, 360, 720, 1440), 180,
    ) { it.auto_reply_cooldown_minutes }

    /** One boolean setting; every boolean defaults on. */
    class BoolField(
        val key: String,
        val labelKey: String,
        val read: (CompanyView) -> Boolean,
        val captionKey: String? = null,
        /** Whether to say what on / off does (the hold switches only). */
        val explainsOutcome: Boolean = false,
    )

    val holdScheduled = BoolField(
        "hold_scheduled_on_reply", "domain.autoTextsHoldScheduled",
        { it.hold_scheduled_on_reply }, explainsOutcome = true,
    )
    val holdReminders = BoolField(
        "hold_reminders_on_reply", "domain.autoTextsHoldReminders",
        { it.hold_reminders_on_reply }, explainsOutcome = true,
    )
    val holdRating = BoolField(
        "hold_rating_ask_on_reply", "domain.autoTextsHoldRating",
        { it.hold_rating_ask_on_reply }, explainsOutcome = true,
    )
    val holdUnverified = BoolField(
        "hold_reminders_unverified_calendar", "domain.autoTextsHoldUnverified",
        { it.hold_reminders_unverified_calendar },
        captionKey = "domain.autoTextsHoldUnverifiedCaption",
    )
    val ratingEnabled = BoolField(
        "rating_ask_enabled", "domain.autoTextsRatingEnabled",
        { it.rating_ask_enabled },
    )

    val holdGroup = listOf(holdScheduled, holdReminders, holdRating, holdUnverified)
    val ratingGroup = listOf(ratingDelay, ratingExpiry, ratingCooldown)
    val waitGroup = listOf(scheduledExpiry, reminderExpiry, replyCooldown)

    /** The preset list with [current] folded in, ascending, no duplicates. */
    fun choicesWithCurrent(field: IntField, current: Int): List<Int> =
        (field.choices + current).distinct().sorted()

    /**
     * "Right away" for 0, else the largest whole unit: 180 min is "3 hours",
     * 1440 min "1 day", 48 h "2 days", 30 min "30 minutes". French reads 1 as
     * singular ("1 heure") and every other count as plural.
     */
    fun durationLabel(value: Int, unit: Unit, locale: String?): String {
        if (value == 0) return AppStrings.translate(locale, "domain.autoTextsRightAway")
        val minutes = value * unit.minutes
        val (count, name) = when {
            minutes % 1440 == 0 -> minutes / 1440 to "Day"
            minutes % 60 == 0 -> minutes / 60 to "Hour"
            else -> minutes to "Minute"
        }
        val key = "domain.autoTexts$name${if (count == 1) "" else "s"}"
        return AppStrings.translate(locale, key, mapOf("count" to count.toString()))
    }

    fun valueLabel(field: IntField, value: Int, locale: String?): String =
        durationLabel(value, field.unit, locale)

    /** "Default: 4 hours" / "Par défaut : 4 heures". */
    fun defaultCaption(field: IntField, locale: String?): String =
        AppStrings.translate(
            locale,
            "domain.autoTextsDefault",
            mapOf("value" to valueLabel(field, field.default, locale)),
        )

    /** Every boolean here defaults on. */
    fun defaultCaption(locale: String?): String =
        AppStrings.translate(
            locale,
            "domain.autoTextsDefault",
            mapOf("value" to AppStrings.translate(locale, "domain.autoTextsOn")),
        )

    /** The line under a switch: what its position does, then its default. */
    fun switchCaption(field: BoolField, checked: Boolean, locale: String?): String {
        val parts = buildList {
            field.captionKey?.let { add(AppStrings.translate(locale, it)) }
            if (field.explainsOutcome) {
                add(
                    AppStrings.translate(
                        locale,
                        if (checked) "domain.autoTextsHoldOn" else "domain.autoTextsHoldOff",
                    ),
                )
            }
            add(defaultCaption(locale))
        }
        return parts.joinToString(" ")
    }

    /** One change, one PATCH: only the field that moved goes on the wire. */
    fun patch(field: BoolField, value: Boolean): JsonObject =
        buildJsonObject { put(field.key, value) }

    fun patch(field: IntField, value: Int): JsonObject =
        buildJsonObject { put(field.key, value) }
}
