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
import com.loonext.android.features.calls.formatCallDuration

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

/**
 * A locally-queued outbound send awaiting the server's queued row.
 *
 * #234 gave this row two more lives. It used to mean only "in flight, waiting
 * for the server" — and a send that could not REACH the server dropped the row
 * entirely, restored the draft and showed a toast, which is how a message
 * typed in a basement went nowhere while the person believed it had gone.
 *
 * The three states are deliberately one type rather than three, because they
 * are one message at different moments and the timeline has to keep its place
 * in the thread throughout.
 */
data class PendingSend(
    val localId: String,
    val body: String,
    val mediaCount: Int,
    val createdAt: String,
    val idempotencyKey: String,
    /**
     * #234: written to the durable outbox and waiting for signal, rather than
     * in flight right now. It MUST read differently from "Sending…" — a
     * queued message presented as on-its-way is the failure this exists to
     * prevent.
     */
    val queued: Boolean = false,
    /**
     * #234: the server answered NO at flush (a STOP arrived while this sat
     * queued, the cap was reached, registration lapsed). Not retried
     * automatically — an answer is not an outage — so the row waits for the
     * person and says why.
     */
    val blockedReason: String? = null,
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
 * What a voicemail on this timeline line SAYS, when it was transcribed. Null
 * for every other event, for an older line written before transcription
 * existed, and whenever there was nothing worth writing down.
 */
fun voicemailTranscriptOf(event: ConversationEvent): String? {
    if (event.type != "call_completed") return null
    if (event.payloadString("kind") != "voicemail") return null
    return event.payloadString("transcript")?.takeIf { it.isNotBlank() }
}

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
        // #225: names the FACT (a send landed in the customer's quiet window), not
        // an attestation. With the confirmation switched off the same event is
        // written and nobody confirmed anything, so "confirmed" would be a lie —
        // and web has always said it this way, so this is parity too.
        "quiet_hours_confirmed" -> "$actor sent during this customer's quiet hours"
        "spam_marked" -> "$actor marked this as spam"
        "spam_unmarked" -> "$actor marked this as not spam"
        "message_done" -> "$actor marked a message done"
        "message_undone" -> "$actor reopened a message"
        "task_created" -> "$actor created a task"
        "task_assigned" -> "$actor assigned a task"
        "task_due_set" -> "$actor set a task due date"
        "task_deleted" -> "$actor deleted a task"
        // #317 — a file this customer sent that we would not store. Same copy
        // as web (system-line.tsx) and iOS (Timeline.swift), word for word: a
        // crew comparing the phone and the laptop must not read two different
        // histories for one conversation.
        "media_refused" -> mediaRefusedLine(event)
        "note_attachment_added" -> "$actor attached a file to a note"
        "note_attachment_removed" -> "$actor removed a file from a note"
        "task_attachment_added" -> "$actor attached a file to a task"
        "task_attachment_removed" -> "$actor removed a file from a task"
        "missed_call" -> "Missed call from $contactName"
        // #273: the server puts direction, outcome, forward_seconds and a
        // transfer pair on this payload, and this arm read ONE of them. Every
        // shape that was not a voicemail collapsed to "Call with X ended", so a
        // 4:32 outbound call, a missed call and a transfer were indistinguishable
        // on the phone while web showed all three. A crew comparing web and
        // mobile saw two different histories for one conversation.
        //
        // Branch order matters and mirrors web exactly (system-line.tsx): a
        // voicemail is also an inbound call with an outcome, so the specific
        // shapes have to be tested before the generic ones.
        "call_completed" -> callCompletedLine(event, memberNames)
        "auto_reply_sent" -> "Away auto-reply sent"
        else -> event.type.replace('_', ' ').replaceFirstChar { it.uppercase() }
    }
}

/**
 * The #317 refused-attachment line.
 *
 * There is no attachment row to render — that is the point — so this stands in
 * its place. Without it the crew sees a text with no picture and concludes the
 * customer forgot to attach one. Every arm ends in what to DO about it, which is
 * the only part they can act on between jobs.
 */
private fun mediaRefusedLine(event: ConversationEvent): String =
    when (event.payloadString("reason")) {
        "too_large" ->
            "A file this customer sent was too big to save — ask them to send a smaller one"

        "empty" ->
            "A file this customer sent arrived empty — ask them to send it again"

        "type_mismatch" ->
            "A file this customer sent wasn't the kind of file it claimed to be, so it wasn't saved"

        "too_many_items" -> {
            val kept = event.payloadString("index")?.toIntOrNull() ?: 0
            if (kept > 0) {
                "This message came with more files than we can save — the first $kept were kept"
            } else {
                "This message came with more files than we can save"
            }
        }
        // unsupported_type, and anything a later server adds: the honest general
        // case, still ending in the thing that works.
        else ->
            "A file this customer sent can't be shown here — ask them to send a photo or a PDF"
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

/**
 * #273 — one call event, six honest readings.
 *
 * A direct port of the web arm in `apps/web/src/components/thread/system-line.tsx`
 * so a thread reads identically wherever it is opened. Order is load-bearing:
 * a voicemail carries an `outcome` too, and a transfer carries a `direction`,
 * so testing the generic fields first would swallow the specific shapes.
 */
private fun callCompletedLine(
    event: ConversationEvent,
    memberNames: Map<String, String>,
): String {
    val outcome = event.payloadString("outcome")
    val seconds = event.payloadString("forward_seconds")?.toIntOrNull() ?: 0

    // D38: an outbound bridge call speaks from the crew's side.
    if (event.payloadString("direction") == "outbound") {
        if (outcome == "missed") return "Called, no answer"
        return if (seconds > 0) {
            "You called · ${formatCallDuration(seconds)}"
        } else {
            "You called"
        }
    }

    // D43 phase 3: who handed the call to whom. A transfer that never ended
    // was previously described as a call that did.
    if (event.payloadString("kind") == "transferred") {
        val to = event.payloadString("to_user_id")?.let { memberNames[it] }
        val from = event.payloadString("from_user_id")?.let { memberNames[it] }
        if (to != null && from != null) return "$from transferred the call to $to"
        return if (to != null) "Call transferred to $to" else "Call transferred"
    }

    // D43: the voicemail line carries the MESSAGE duration, not the call's.
    if (event.payloadString("kind") == "voicemail") {
        val vmSeconds = event.payloadString("voicemail_seconds")?.toIntOrNull() ?: 0
        return if (vmSeconds > 0) {
            "Left a voicemail · ${formatCallDuration(vmSeconds)}"
        } else {
            "Left a voicemail"
        }
    }

    if (outcome == "voicemail") return "Call went to voicemail"
    if (outcome == "missed") return "Missed call"
    return if (seconds > 0) {
        "Call answered · ${formatCallDuration(seconds)}"
    } else {
        "Call answered"
    }
}
