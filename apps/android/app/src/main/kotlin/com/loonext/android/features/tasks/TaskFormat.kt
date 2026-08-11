package com.loonext.android.features.tasks

import com.loonext.android.core.i18n.AppStrings
import com.loonext.android.core.model.Task
import com.loonext.android.core.model.TaskActivityItem
import java.time.Clock
import java.time.Instant
import java.time.LocalDate
import java.time.LocalDateTime
import java.time.OffsetDateTime
import java.time.ZoneId
import java.time.format.DateTimeFormatter

/**
 * Pure task display/encoding helpers — the Kotlin siblings of the web's
 * task-format.ts and task-activity.ts, kept dependency-free for unit tests.
 * Due dates go amber ONLY when overdue (never a red scare), and only for a
 * not-done task.
 */

const val TASK_TITLE_MAX = 500
const val TASK_DESCRIPTION_MAX = 5000
const val NOTE_BODY_MAX = 4096
const val TASK_SEARCH_MAX = 200

/**
 * Parse a wire timestamp that may be UTC ("…Z"), offset-bearing
 * ("…-04:00" — due_at echoes what clients wrote), or offset-less. Null when
 * unparseable — callers render nothing rather than crash on a new shape.
 */
fun parseInstant(iso: String?): Instant? {
    if (iso == null) return null
    return runCatching { OffsetDateTime.parse(iso).toInstant() }
        .recoverCatching { Instant.parse(iso) }
        .recoverCatching {
            LocalDateTime.parse(iso).atZone(ZoneId.systemDefault()).toInstant()
        }
        .getOrNull()
}

/** A not-done task whose due date is in the past. */
fun isOverdue(task: Task, clock: Clock = Clock.systemDefaultZone()): Boolean {
    if (task.done || task.due_at == null) return false
    val due = parseInstant(task.due_at) ?: return false
    return due.isBefore(clock.instant())
}

/**
 * A short human due label for a chip/cell: "Today", "Tomorrow", "Jul 8",
 * "Jul 8 2027". Null/unparseable due → "" (the caller renders nothing).
 */
fun formatDue(
    dueAt: String?,
    clock: Clock = Clock.systemDefaultZone(),
    // #228: last, and defaulted, so every existing positional call site (and
    // the vectors that pin the English) is untouched while the screens that
    // know the reader's language can pass it.
    locale: String? = null,
): String {
    val instant = parseInstant(dueAt) ?: return ""
    val date = instant.atZone(clock.zone).toLocalDate()
    val today = LocalDate.now(clock)
    return when {
        date == today -> AppStrings.translate(locale, "contactsTasks.today")
        date == today.plusDays(1) -> AppStrings.translate(locale, "contactsTasks.tomorrow")
        date.year == today.year -> date.format(DateTimeFormatter.ofPattern("MMM d"))
        else -> date.format(DateTimeFormatter.ofPattern("MMM d yyyy"))
    }
}

/** "today 3:00 PM" / "Jul 8 9:00 AM" for a due-set activity line. */
fun dueSentenceTime(
    iso: String,
    clock: Clock = Clock.systemDefaultZone(),
    locale: String? = null,
): String {
    val instant = parseInstant(iso) ?: return ""
    val zoned = instant.atZone(clock.zone)
    val time = zoned.format(DateTimeFormatter.ofPattern("h:mm a"))
    return if (zoned.toLocalDate() == LocalDate.now(clock)) {
        AppStrings.translate(locale, "contactsTasks.todayAtTime", mapOf("time" to time))
    } else {
        "${zoned.format(DateTimeFormatter.ofPattern("MMM d"))} $time"
    }
}

/**
 * Encode a picked due date+time as ISO 8601 WITH the zone's UTC offset at
 * that instant (the API requires an offset-bearing string; "Z" only when the
 * zone genuinely is UTC). Example: 2026-07-15 15:00 in America/Toronto →
 * "2026-07-15T15:00:00-04:00".
 */
fun encodeDueAt(local: LocalDateTime, zone: ZoneId): String =
    local.atZone(zone).toOffsetDateTime().format(DUE_AT_FORMAT)

/** Always emits seconds ("…T15:00:00-04:00"); XXX prints Z at offset zero. */
private val DUE_AT_FORMAT = DateTimeFormatter.ofPattern("yyyy-MM-dd'T'HH:mm:ssXXX")

/**
 * A quiet human sentence for one task_* activity event, ported from the
 * web's taskEventSentence so the two clients read identically. [by] is the
 * resolved actor name (fall back to "Loonext" for system); [memberName]
 * resolves the assigned-to user id. Unknown types return null — skip the row.
 */
fun taskEventSentence(
    item: TaskActivityItem,
    by: String,
    memberName: (String?) -> String?,
    clock: Clock = Clock.systemDefaultZone(),
    locale: String? = null,
): String? {
    val payload = item.payload
    fun payloadString(key: String): String? =
        (payload?.get(key) as? kotlinx.serialization.json.JsonPrimitive)
            ?.takeIf { it.isString }?.content

    fun say(key: String, vararg vars: Pair<String, String>) =
        AppStrings.translate(locale, key, mapOf("by" to by) + vars.toMap())

    return when (item.type) {
        "task_created" -> say("contactsTasks.activityCreated")
        "task_assigned" -> {
            val to = payloadString("to_user_id")
            when {
                to == null -> say("contactsTasks.activityUnassigned")
                else -> memberName(to)
                    ?.let { say("contactsTasks.activityAssignedTo", "who" to it) }
                    ?: say("contactsTasks.activityReassigned")
            }
        }

        "task_due_set" -> {
            val due = payloadString("due_at")
            if (due == null) {
                say("contactsTasks.activityDueCleared")
            } else {
                say(
                    "contactsTasks.activityDueSet",
                    "when" to dueSentenceTime(due, clock, locale),
                )
            }
        }

        "task_deleted" -> say("contactsTasks.activityDeleted")
        "task_attachment_added" -> say("contactsTasks.activityAttached")
        "task_attachment_removed" -> say("contactsTasks.activityAttachmentRemoved")
        else -> null
    }
}
