package com.loonext.android.features.activity

import com.loonext.android.core.i18n.AppStrings
import com.loonext.android.core.time.TimestampFormat
import com.loonext.android.features.calls.callEndReason
import com.loonext.android.features.calls.callRoutingReason
import com.loonext.android.features.calls.formatCallDuration
import com.loonext.android.features.thread.messageAutomationName
import java.time.Instant
import java.time.LocalDate
import java.time.OffsetDateTime
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.time.format.FormatStyle
import java.util.Locale
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.doubleOrNull

/**
 * #714: what one activity row says, and where it points. Pure, so every
 * surface (contact, job, thread, call) reads one event the same way and the
 * sentences are testable on the JVM. A port of
 * `apps/web/src/components/activity/activity-line.ts`; the words are
 * `activity.*` in the catalogue, copied from web's `activity.ts`.
 */

/** The four records that have an activity timeline. */
enum class ActivityRecordType {
    CONTACT, TASK, CONVERSATION, CALL;

    /** A task's activity is at `/record-activity`: `/activity` is the #689 feed with comments. */
    fun path(recordId: String): String = when (this) {
        CONTACT -> "/v1/contacts/$recordId/activity"
        CONVERSATION -> "/v1/conversations/$recordId/activity"
        CALL -> "/v1/calls/$recordId/activity"
        TASK -> "/v1/tasks/$recordId/record-activity"
    }
}

/** The server's filter, so paging stays right under it. Null is All. */
enum class ActivityCategory(val wire: String) {
    MESSAGE("message"), CALL("call"), CHANGE("change")
}

@Serializable
data class ActivityActor(
    /** member | customer | automation | system. */
    val type: String,
    val user_id: String? = null,
    val display_name: String? = null,
)

/** What the event came from, so the row can open it. */
@Serializable
data class ActivitySource(
    val type: String,
    val id: String,
    val conversation_id: String? = null,
)

@Serializable
data class ActivityItem(
    val id: String,
    val kind: String,
    val category: String,
    val occurred_at: String,
    val actor: ActivityActor,
    val payload: JsonObject = JsonObject(emptyMap()),
    val source: ActivitySource? = null,
)

enum class ActivityIcon {
    TEXT, CALL, VOICEMAIL, EDIT, TAG, PERSON, LINK, STOP, CHECK, MERGE, TRASH, MENTION, CLOCK
}

/** Where a row goes when tapped. */
sealed interface ActivityOpen {
    data class Thread(val conversationId: String, val messageId: String? = null) : ActivityOpen
    data class Task(val taskId: String) : ActivityOpen
    data class Contact(val contactId: String) : ActivityOpen
}

data class ActivityLine(
    val text: String,
    val icon: ActivityIcon,
    /** Null when nothing is there to open. */
    val open: ActivityOpen?,
)

private const val VALUE_MAX = 80

private val TIME_FIELDS = setOf("due", "confirmation")

/** The field edit keys the server sends, as catalogue keys. */
private val FIELD_KEYS = mapOf(
    "name" to "activity.fieldName",
    "email" to "activity.fieldEmail",
    "business_name" to "activity.fieldBusiness",
    "address" to "activity.fieldAddress",
    "notes" to "activity.fieldNotes",
    "timezone" to "activity.fieldTimezone",
    "locale" to "activity.fieldLocale",
    "phone" to "activity.fieldPhone",
    "custom_fields" to "activity.fieldCustom",
    "other_phone" to "activity.fieldOtherPhone",
    "other_address" to "activity.fieldOtherAddress",
    "status" to "activity.fieldStatus",
    "spam" to "activity.fieldSpam",
    "title" to "activity.fieldTitle",
    "description" to "activity.fieldDescription",
    "due" to "activity.fieldDue",
    "reminders" to "activity.fieldReminders",
    "confirmation" to "activity.fieldConfirmation",
    "priority" to "activity.fieldPriority",
    "repeat" to "activity.fieldRepeat",
    "link_added" to "activity.fieldLink",
    "link_removed" to "activity.fieldLink",
)

private fun JsonObject.text(key: String): String? =
    (this[key] as? JsonPrimitive)
        ?.takeIf { it.isString }
        ?.content
        ?.takeIf { it.isNotBlank() }

private fun JsonObject.number(key: String): Double? =
    (this[key] as? JsonPrimitive)?.takeIf { !it.isString }?.doubleOrNull

private fun JsonObject.flag(key: String): Boolean? =
    (this[key] as? JsonPrimitive)?.takeIf { !it.isString }?.booleanOrNull

private fun present(value: JsonElement?): Boolean = when (value) {
    null, JsonNull -> false
    is JsonPrimitive -> !(value.isString && value.content.isEmpty())
    else -> true
}

private fun clip(text: String): String {
    val one = text.replace(Regex("\\s+"), " ").trim()
    return if (one.length > VALUE_MAX) "${one.take(VALUE_MAX - 1)}…" else one
}

private fun say(locale: String?, key: String, vararg vars: Pair<String, String>): String =
    AppStrings.translate(locale, key, vars.toMap())

/** A before or after value, as a reader would say it. */
fun activityValue(field: String, value: JsonElement?, locale: String? = null): String {
    if (!present(value)) return say(locale, "activity.valueNone")
    return when (value) {
        is JsonPrimitive -> when {
            value.isString ->
                if (field in TIME_FIELDS) {
                    TimestampFormat.label(value.content, TimestampFormat.Style.LONG, locale)
                } else {
                    clip(value.content)
                }
            value.booleanOrNull != null ->
                say(locale, if (value.booleanOrNull == true) "activity.valueYes" else "activity.valueNo")
            else -> value.content
        }
        is JsonObject -> clip(partsOf(value.values))
        is JsonArray -> clip(partsOf(value))
        else -> say(locale, "activity.valueNone")
    }
}

private fun partsOf(values: Collection<JsonElement>): String =
    values
        .filterIsInstance<JsonPrimitive>()
        .filter { it.isString && it.content.isNotEmpty() }
        .joinToString(", ") { it.content }

private fun fieldLabel(field: String, locale: String?): String =
    FIELD_KEYS[field]?.let { say(locale, it) } ?: field

private fun editSentence(item: ActivityItem, locale: String?): String {
    val payload = item.payload
    val field = payload.text("field").orEmpty()
    val label = fieldLabel(field, locale)
    val from = payload["from"]
    val to = payload["to"]
    return when (payload.text("change")) {
        "added" -> say(locale, "activity.fieldAdded", "field" to label, "to" to activityValue(field, to, locale))
        "updated" -> say(locale, "activity.fieldUpdated", "field" to label, "to" to activityValue(field, to, locale))
        "removed" -> say(locale, "activity.fieldRemoved", "field" to label)
        else -> when {
            present(from) && present(to) -> say(
                locale,
                "activity.editedFromTo",
                "field" to label,
                "from" to activityValue(field, from, locale),
                "to" to activityValue(field, to, locale),
            )
            present(to) -> say(locale, "activity.editedTo", "field" to label, "to" to activityValue(field, to, locale))
            present(from) -> say(
                locale,
                "activity.editedCleared",
                "field" to label,
                "from" to activityValue(field, from, locale),
            )
            else -> say(locale, "activity.editedBare", "field" to label)
        }
    }
}

private fun callSentence(item: ActivityItem, locale: String?): String {
    val payload = item.payload
    val direction = say(
        locale,
        if (payload.text("direction") == "outbound") "activity.callOutgoing" else "activity.callIncoming",
    )
    val outcome = say(
        locale,
        when (payload.text("outcome")) {
            "answered" -> "activity.outcomeAnswered"
            "voicemail" -> "activity.outcomeVoicemail"
            else -> "activity.outcomeMissed"
        },
    )
    val parts = mutableListOf(say(locale, "activity.callLine", "direction" to direction, "outcome" to outcome))
    val talked = payload.number("talk_seconds")?.toInt() ?: 0
    if (talked > 0) parts += say(locale, "activity.callTalked", "duration" to formatCallDuration(talked))
    callEndReason(payload.text("ended_reason"), locale)?.let { parts += it }
    return parts.joinToString(" · ")
}

/** #725: why the call went to voicemail, from the machine or from the arrival route. */
private fun voicemailCause(cause: String?, locale: String?): String? =
    callEndReason(cause, locale) ?: callRoutingReason(cause, locale)

private fun withWhy(text: String, why: String?): String = if (why != null) "$text · $why" else text

/** #725: a step on a call's own timeline, or null when the kind is not one. */
private fun callStepSentence(
    item: ActivityItem,
    locale: String?,
    person: (JsonElement) -> String,
): String? {
    val payload = item.payload
    return when (item.kind) {
        "call_arrived" -> withWhy(
            say(locale, "activity.stepArrived"),
            callRoutingReason(payload.text("routing"), locale),
        )
        "call_placed" -> say(locale, "activity.stepPlaced")
        "call_rang" -> {
            val names = ((payload["user_ids"] as? JsonArray) ?: JsonArray(emptyList()))
                .joinToString(", ") { person(it) }
            say(
                locale,
                if (payload.flag("asked") == true) "activity.stepAskedToRing" else "activity.stepRang",
                "names" to names,
            )
        }
        "call_declined" -> say(locale, "activity.stepDeclined")
        "call_answered" -> say(locale, "activity.stepAnswered")
        "call_voicemail" -> withWhy(
            say(locale, "activity.stepVoicemail"),
            voicemailCause(payload.text("cause"), locale),
        )
        "call_ended" -> {
            val seconds = payload.number("seconds")?.toInt() ?: 0
            val parts = mutableListOf(say(locale, "activity.stepEnded"))
            if (seconds > 0) parts += say(locale, "activity.stepLasted", "duration" to formatCallDuration(seconds))
            callEndReason(payload.text("reason"), locale)?.let { parts += it }
            parts.joinToString(" · ")
        }
        else -> null
    }
}

private fun optOutSentence(item: ActivityItem, locale: String?): String = say(
    locale,
    when (item.payload.text("source")) {
        "stop_keyword" -> "activity.optedOutStop"
        "manual" -> "activity.optedOutManual"
        "carrier" -> "activity.optedOutCarrier"
        "import" -> "activity.optedOutImport"
        else -> "activity.optedOut"
    },
)

/** Where a row's source lives, or null. */
fun activityOpen(item: ActivityItem, recordType: ActivityRecordType, recordId: String): ActivityOpen? {
    val source = item.source ?: return null
    return when (source.type) {
        "message" -> source.conversation_id?.let { ActivityOpen.Thread(it, messageId = source.id) }
        "call", "conversation_event", "scheduled_message" ->
            source.conversation_id?.let { ActivityOpen.Thread(it) }
        "task" ->
            if (source.id == recordId && recordType == ActivityRecordType.TASK) null
            else ActivityOpen.Task(source.id)
        "contact" -> if (source.id == recordId) null else ActivityOpen.Contact(source.id)
        else -> null
    }
}

/**
 * @param nameOf resolves a member's user id to a display name, or null when
 *               the member has left or is not loaded.
 */
fun activityLine(
    item: ActivityItem,
    recordType: ActivityRecordType,
    recordId: String,
    nameOf: (String?) -> String?,
    locale: String? = null,
): ActivityLine {
    val open = activityOpen(item, recordType, recordId)
    val someone = say(locale, "activity.someone")
    val payload = item.payload
    fun person(id: JsonElement): String =
        ((id as? JsonPrimitive)?.takeIf { it.isString }?.content?.let(nameOf)) ?: someone
    fun personOf(key: String): String = payload[key]?.let(::person) ?: someone
    fun line(text: String, icon: ActivityIcon) = ActivityLine(text, icon, open)
    val title = payload.text("title")

    return when (item.kind) {
        "text_in" -> line(say(locale, "activity.textIn"), ActivityIcon.TEXT)
        "text_out" -> {
            if (payload.flag("automated") != true) {
                line(say(locale, "activity.textOut"), ActivityIcon.TEXT)
            } else {
                val which = messageAutomationName(payload.text("automation"), locale)
                val sent = say(locale, "activity.textOutAutomated")
                line(if (which != null) "$sent · $which" else sent, ActivityIcon.TEXT)
            }
        }
        "scheduled_queued" -> line(say(locale, "activity.scheduledQueued"), ActivityIcon.CLOCK)
        "scheduled_sent" -> line(say(locale, "activity.scheduledSent"), ActivityIcon.CLOCK)
        "scheduled_cancelled" -> line(say(locale, "activity.scheduledCancelled"), ActivityIcon.CLOCK)
        "call" -> line(callSentence(item, locale), ActivityIcon.CALL)
        "call_arrived", "call_placed", "call_rang", "call_declined", "call_answered", "call_ended" ->
            line(
                callStepSentence(item, locale, ::person) ?: say(locale, "activity.unknownKind"),
                ActivityIcon.CALL,
            )
        "call_voicemail" -> line(
            callStepSentence(item, locale, ::person) ?: say(locale, "activity.unknownKind"),
            ActivityIcon.VOICEMAIL,
        )
        "voicemail" -> {
            val seconds = payload.number("voicemail_seconds")?.toInt() ?: 0
            line(
                if (seconds > 0) {
                    say(locale, "activity.voicemailLeftFor", "duration" to formatCallDuration(seconds))
                } else {
                    say(locale, "activity.voicemailLeft")
                },
                ActivityIcon.VOICEMAIL,
            )
        }
        "created" -> line(
            if (title != null) say(locale, "activity.createdNamed", "title" to title)
            else say(locale, "activity.created"),
            ActivityIcon.CHECK,
        )
        "edited" -> line(editSentence(item, locale), ActivityIcon.EDIT)
        "tagged" -> line(say(locale, "activity.tagged", "name" to payload.text("name").orEmpty()), ActivityIcon.TAG)
        "untagged" -> line(say(locale, "activity.untagged", "name" to payload.text("name").orEmpty()), ActivityIcon.TAG)
        "merged" -> line(
            say(
                locale,
                if (payload.text("role") == "merged_away") "activity.mergedAway" else "activity.mergedSurvivor",
                "name" to (payload.text("other_name") ?: someone),
            ),
            ActivityIcon.MERGE,
        )
        "unmerged" -> line(say(locale, "activity.unmerged"), ActivityIcon.MERGE)
        "deleted" -> line(say(locale, "activity.deleted"), ActivityIcon.TRASH)
        "restored" -> line(say(locale, "activity.restored"), ActivityIcon.TRASH)
        "assigned" -> line(say(locale, "activity.assignedTo", "name" to personOf("to_user_id")), ActivityIcon.PERSON)
        "unassigned" -> line(
            if (present(payload["from_user_id"])) {
                say(locale, "activity.unassignedFrom", "name" to personOf("from_user_id"))
            } else {
                say(locale, "activity.unassigned")
            },
            ActivityIcon.PERSON,
        )
        "mentioned" -> line(say(locale, "activity.mentioned", "name" to personOf("user_id")), ActivityIcon.MENTION)
        "referenced" -> line(
            say(
                locale,
                when (item.source?.type) {
                    "message" -> "activity.referencedNote"
                    "task" -> "activity.referencedTask"
                    "task_comment" -> "activity.referencedComment"
                    else -> "activity.referenced"
                },
            ),
            ActivityIcon.LINK,
        )
        "opted_out" -> line(optOutSentence(item, locale), ActivityIcon.STOP)
        "opted_in" -> line(say(locale, "activity.optedIn"), ActivityIcon.STOP)
        "blocked" -> line(say(locale, "activity.blocked"), ActivityIcon.STOP)
        "unblocked" -> line(say(locale, "activity.unblocked"), ActivityIcon.STOP)
        "task_created" -> line(
            if (title != null) say(locale, "activity.taskCreated", "title" to title)
            else say(locale, "activity.taskCreatedBare"),
            ActivityIcon.CHECK,
        )
        "task_completed" -> line(
            if (title != null) say(locale, "activity.taskCompleted", "title" to title)
            else say(locale, "activity.taskCompletedBare"),
            ActivityIcon.CHECK,
        )
        "completed" -> line(say(locale, "activity.completed"), ActivityIcon.CHECK)
        "reopened" -> line(say(locale, "activity.reopened"), ActivityIcon.CHECK)
        else -> line(say(locale, "activity.unknownKind"), ActivityIcon.EDIT)
    }
}

/** Who did it: a member by name, or the customer, an automation, or Loonext itself. */
fun activityActor(
    item: ActivityItem,
    nameOf: (String?) -> String?,
    locale: String? = null,
): String = when (item.actor.type) {
    "member" -> item.actor.display_name?.takeIf { it.isNotBlank() }
        ?: nameOf(item.actor.user_id)
        ?: say(locale, "activity.actorTeammate")
    "customer" -> say(locale, "activity.actorCustomer")
    "automation" -> say(locale, "activity.actorAutomation")
    else -> say(locale, "activity.actorSystem")
}

/** The server sends Z, and a Postgres timestamp can come back with an offset. */
private fun parseInstant(iso: String): Instant =
    runCatching { Instant.parse(iso) }.getOrElse { OffsetDateTime.parse(iso).toInstant() }

/**
 * Day groups in the order given, keyed by the LOCAL date: an evening call in
 * Vancouver falls on the next UTC day, and the crew remembers the day it was.
 */
fun <T> groupActivityByDay(
    entries: List<T>,
    occurredAt: (T) -> String,
    zone: ZoneId = ZoneId.systemDefault(),
): List<Pair<LocalDate, List<T>>> {
    val groups = mutableListOf<Pair<LocalDate, MutableList<T>>>()
    for (entry in entries) {
        val day = parseInstant(occurredAt(entry)).atZone(zone).toLocalDate()
        val last = groups.lastOrNull()
        if (last != null && last.first == day) {
            last.second.add(entry)
        } else {
            groups.add(day to mutableListOf(entry))
        }
    }
    return groups
}

/** "November 10, 2026" / "10 novembre 2026": a calendar day, never a time. */
fun activityDayLabel(day: LocalDate, locale: String? = null): String =
    DateTimeFormatter.ofLocalizedDate(FormatStyle.LONG)
        .withLocale(Locale.forLanguageTag(locale ?: TimestampFormat.readerLocale))
        .format(day)

/** The server's four-way filter: All, Messages, Calls, Changes. */
val ACTIVITY_FILTERS: List<Pair<ActivityCategory?, String>> = listOf(
    null to "activity.filterAll",
    ActivityCategory.MESSAGE to "activity.filterMessages",
    ActivityCategory.CALL to "activity.filterCalls",
    ActivityCategory.CHANGE to "activity.filterChanges",
)
