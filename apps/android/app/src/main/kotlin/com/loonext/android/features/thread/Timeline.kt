package com.loonext.android.features.thread

import com.loonext.android.core.model.ConversationEvent
import com.loonext.android.core.model.Member
import com.loonext.android.core.model.Message
import com.loonext.android.core.model.MessageDirection
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import kotlinx.serialization.json.JsonPrimitive

/**
 * Pure thread-timeline assembly: messages + optimistic pending sends + audit
 * events interleaved newest-first (the LazyColumn renders with
 * `reverseLayout = true`, so index 0 is the bottom of the screen) with day
 * dividers appended after each day's oldest item so they paint ABOVE the day.
 */

/** The in-thread Messages · Notes · Events toggles; the last one can't turn off. */
data class ThreadFilter(
    val messages: Boolean = true,
    val notes: Boolean = true,
    val events: Boolean = true,
) {
    val enabledCount: Int get() = listOf(messages, notes, events).count { it }

    fun toggledMessages(): ThreadFilter =
        if (messages && enabledCount == 1) this else copy(messages = !messages)

    fun toggledNotes(): ThreadFilter =
        if (notes && enabledCount == 1) this else copy(notes = !notes)

    fun toggledEvents(): ThreadFilter =
        if (events && enabledCount == 1) this else copy(events = !events)
}

/** A locally-queued outbound send awaiting the server's queued row. */
data class PendingSend(
    val localId: String,
    val body: String,
    val mediaCount: Int,
    val createdAt: String,
    val idempotencyKey: String,
)

sealed interface TimelineItem {
    val key: String
    val createdAt: String

    data class MessageItem(val message: Message) : TimelineItem {
        override val key: String get() = "m:${message.id}"
        override val createdAt: String get() = message.created_at
    }

    data class PendingItem(val pending: PendingSend) : TimelineItem {
        override val key: String get() = "p:${pending.localId}"
        override val createdAt: String get() = pending.createdAt
    }

    data class EventItem(val event: ConversationEvent) : TimelineItem {
        override val key: String get() = "e:${event.id}"
        override val createdAt: String get() = event.created_at
    }

    data class DayDivider(val label: String, val isoDay: String) : TimelineItem {
        override val key: String get() = "d:$isoDay"
        override val createdAt: String get() = isoDay
    }
}

private fun matchesFilter(message: Message, filter: ThreadFilter): Boolean =
    if (message.direction == MessageDirection.NOTE) filter.notes else filter.messages

/**
 * Events older than the oldest loaded message would interleave at the wrong
 * place, so they stay hidden until the message history is at least that deep
 * (the web applies the same rule). Once all messages are loaded, everything
 * shows.
 */
fun visibleEvents(
    events: List<ConversationEvent>,
    oldestLoadedMessageAt: String?,
    allMessagesLoaded: Boolean,
): List<ConversationEvent> = when {
    allMessagesLoaded -> events
    oldestLoadedMessageAt == null -> emptyList()
    else -> events.filter { it.created_at >= oldestLoadedMessageAt }
}

/**
 * Build the newest-first item list. [messages] and [events] arrive in server
 * DESC order; [pending] rows always render newest (they were typed just now).
 */
fun buildTimeline(
    messages: List<Message>,
    events: List<ConversationEvent>,
    pending: List<PendingSend>,
    filter: ThreadFilter,
    allMessagesLoaded: Boolean,
    zone: ZoneId,
    today: LocalDate,
): List<TimelineItem> {
    val oldestMessageAt = messages.lastOrNull()?.created_at
    val shownEvents =
        if (filter.events) visibleEvents(events, oldestMessageAt, allMessagesLoaded)
        else emptyList()
    val shownMessages = messages.filter { matchesFilter(it, filter) }

    // Merge two DESC streams by (created_at, id) DESC.
    val merged = ArrayList<TimelineItem>(shownMessages.size + shownEvents.size)
    var mi = 0
    var ei = 0
    while (mi < shownMessages.size || ei < shownEvents.size) {
        val m = shownMessages.getOrNull(mi)
        val e = shownEvents.getOrNull(ei)
        val takeMessage = when {
            m == null -> false
            e == null -> true
            m.created_at != e.created_at -> m.created_at > e.created_at
            else -> m.id >= e.id
        }
        if (takeMessage) {
            merged.add(TimelineItem.MessageItem(m!!))
            mi++
        } else {
            merged.add(TimelineItem.EventItem(e!!))
            ei++
        }
    }

    // Pending sends sit at the very bottom (newest) — newest pending first.
    val withPending = ArrayList<TimelineItem>(merged.size + pending.size + 8)
    pending.sortedByDescending { it.createdAt }.forEach {
        withPending.add(TimelineItem.PendingItem(it))
    }
    withPending.addAll(merged)

    // Day dividers: in a newest-first list a day's divider must come AFTER the
    // day's oldest item so it renders above the day with reverseLayout.
    val out = ArrayList<TimelineItem>(withPending.size + 8)
    var currentDay: LocalDate? = null
    for (item in withPending) {
        val day = localDayOf(item.createdAt, zone) ?: continue
        if (currentDay != null && day != currentDay) {
            out.add(TimelineItem.DayDivider(dayLabel(currentDay, today), currentDay.toString()))
        }
        currentDay = day
        out.add(item)
    }
    if (currentDay != null) {
        out.add(TimelineItem.DayDivider(dayLabel(currentDay, today), currentDay.toString()))
    }
    return out
}

fun localDayOf(iso: String, zone: ZoneId): LocalDate? =
    runCatching { Instant.parse(iso).atZone(zone).toLocalDate() }.getOrNull()

private val SAME_YEAR_DAY = DateTimeFormatter.ofPattern("EEE, MMM d")
private val OTHER_YEAR_DAY = DateTimeFormatter.ofPattern("MMM d, yyyy")

fun dayLabel(day: LocalDate, today: LocalDate): String = when {
    day == today -> "Today"
    day == today.minusDays(1) -> "Yesterday"
    day.year == today.year -> day.format(SAME_YEAR_DAY)
    else -> day.format(OTHER_YEAR_DAY)
}

// ---------------------------------------------------------------------------
// System event lines
// ---------------------------------------------------------------------------

private fun ConversationEvent.payloadString(key: String): String? =
    (payload[key] as? JsonPrimitive)?.content

/**
 * Human line for an audit event. Unknown types fall back to a plain reading of
 * the type name so a lagging app build never renders raw snake_case.
 */
fun eventLine(
    event: ConversationEvent,
    memberNames: Map<String, String>,
    contactName: String,
): String {
    val actor = event.actor_user_id?.let { memberNames[it] } ?: "Someone"
    val system = event.actor_user_id == null
    return when (event.type) {
        "status_changed" -> {
            val to = event.payloadString("to")
            if (to != null) "$actor moved this to ${statusLabel(to)}"
            else "$actor changed the status"
        }

        "assigned" -> {
            val to = event.payloadString("to")
            when {
                to == null -> "$actor unassigned this conversation"
                else -> "$actor assigned this to ${memberNames[to] ?: "a teammate"}"
            }
        }

        "tag_added" -> {
            val name = event.payloadString("name")
            if (name != null) "$actor added the tag \"$name\"" else "$actor added a tag"
        }

        "tag_removed" -> "$actor removed a tag"
        "opted_out" ->
            if (system) "$contactName opted out of texts" else "$actor opted $contactName out"

        "opt_out_revoked" ->
            if (system) "$contactName opted back in" else "$actor removed the opt-out"

        "consent_attested" -> "$actor attested consent to text $contactName"
        "quiet_hours_confirmed" -> "$actor confirmed sending during quiet hours"
        "spam_marked" -> "$actor marked this as spam"
        "spam_unmarked" -> "$actor marked this as not spam"
        "message_done" -> "$actor marked a message done"
        "message_undone" -> "$actor reopened a message"
        "task_created" -> "$actor created a task"
        "task_assigned" -> "$actor assigned a task"
        "task_due_set" -> "$actor set a task due date"
        "task_deleted" -> "$actor deleted a task"
        "note_attachment_added" -> "$actor attached a file to a note"
        "note_attachment_removed" -> "$actor removed a file from a note"
        "task_attachment_added" -> "$actor attached a file to a task"
        "task_attachment_removed" -> "$actor removed a file from a task"
        "missed_call" -> "Missed call from $contactName"
        "call_completed" -> "Call with $contactName ended"
        "auto_reply_sent" -> "Away auto-reply sent"
        else -> event.type.replace('_', ' ').replaceFirstChar { it.uppercase() }
    }
}

fun statusLabel(status: String): String = when (status) {
    "new" -> "New"
    "open" -> "Open"
    "waiting" -> "Waiting"
    "closed" -> "Closed"
    else -> status.replaceFirstChar { it.uppercase() }
}

/** display_name lookup for event lines + assignee UI. */
fun memberNames(members: List<Member>): Map<String, String> =
    members.associate { member ->
        member.user_id to member.display_name.ifBlank { "Teammate" }
    }
