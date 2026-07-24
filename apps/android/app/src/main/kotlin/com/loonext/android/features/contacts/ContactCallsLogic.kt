package com.loonext.android.features.contacts

import com.loonext.android.core.model.Call
import com.loonext.android.core.model.CallOutcome
import com.loonext.android.core.model.Page
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import java.time.format.DateTimeFormatter

/**
 * Pure logic for the contact detail's Calls section (#205), REPLICATED from
 * the calls feature so the parallel-owned files stay untouched:
 *  - day grouping ← features/calls/CallsScreen.kt (private groupByDay/dayLabel)
 *  - outcome labels/durations ← features/calls/CallsLogic.kt
 *  - page merge/append ← features/calls/CallsScreen.kt (fetchCallsLog + load-more)
 * A later consolidation pass may extract a shared component; until then any
 * copy change must land in both files. Kept free of Android/Compose imports so
 * it unit-tests on the JVM.
 */

/**
 * The cached per-contact call aggregate (#176): the ACCUMULATED pages plus the
 * cursor to fetch more, so reopening the contact restores everything the user
 * had loaded. Keyed by [com.loonext.android.core.data.CacheKeys.contactCalls].
 */
internal data class ContactCallsLog(
    val calls: List<Call>,
    val nextCursor: String?,
)

/**
 * First-page fetch merged with the already-cached deeper tail: the fresh first
 * page wins, then the older accumulated tail is kept (deduped by id), so a
 * silent revalidate never collapses what the user paged to. Source semantics:
 * features/calls/CallsScreen.kt fetchCallsLog.
 */
internal fun mergeContactCallsFirstPage(
    cached: ContactCallsLog?,
    page: Page<Call>,
): ContactCallsLog {
    if (cached == null || cached.calls.size <= page.data.size) {
        return ContactCallsLog(page.data, page.next_cursor)
    }
    val fresh = page.data.map { it.id }.toSet()
    return ContactCallsLog(
        page.data + cached.calls.filter { it.id !in fresh },
        cached.nextCursor,
    )
}

/** "Show more" append: dedupe by id, adopt the new page's cursor. */
internal fun appendContactCallsPage(
    base: ContactCallsLog,
    page: Page<Call>,
): ContactCallsLog {
    val seen = base.calls.map { it.id }.toSet()
    return ContactCallsLog(
        base.calls + page.data.filter { it.id !in seen },
        page.next_cursor,
    )
}

/**
 * Newest-first list → ordered day buckets ("Today", "Yesterday", "Jul 8").
 * Source: features/calls/CallsScreen.kt private groupByDay/dayLabel, with the
 * zone/today injectable for JVM tests.
 */
internal fun groupContactCallsByDay(
    calls: List<Call>,
    zone: ZoneId = ZoneId.systemDefault(),
    today: LocalDate = LocalDate.now(zone),
): List<Pair<String, List<Call>>> {
    val groups = LinkedHashMap<String, MutableList<Call>>()
    calls.forEach { call ->
        groups.getOrPut(contactCallDayLabel(call.started_at, zone, today)) {
            mutableListOf()
        }.add(call)
    }
    return groups.map { (label, list) -> label to list }
}

internal fun contactCallDayLabel(iso: String, zone: ZoneId, today: LocalDate): String {
    val date = runCatching {
        Instant.parse(iso).atZone(zone).toLocalDate()
    }.getOrNull() ?: return "Earlier"
    return when {
        date == today -> "Today"
        date == today.minusDays(1) -> "Yesterday"
        date.year == today.year -> date.format(DateTimeFormatter.ofPattern("MMM d"))
        else -> date.format(DateTimeFormatter.ofPattern("MMM d yyyy"))
    }
}

/** "4m 32s" / "58s" — talk time. Source: features/calls/CallsLogic.kt. */
internal fun contactCallDuration(seconds: Int): String {
    val whole = maxOf(0, seconds)
    val minutes = whole / 60
    val rest = whole % 60
    if (minutes == 0) return "${rest}s"
    return if (rest == 0) "${minutes}m" else "${minutes}m ${rest}s"
}

/**
 * The row's plain-language outcome line. Outbound speaks from the crew's side
 * ("You called…", "No answer"). An answered call NAMES the acting member (#191):
 * the placer of an outbound call, the answerer of an inbound one; the bare
 * "You called"/"Answered" is the fallback for legacy rows with no actor. A null
 * outcome is a session still in flight.
 * Source: features/calls/CallsLogic.kt callOutcomeLabel.
 */
internal fun contactCallOutcomeLabel(call: Call): String {
    val outbound = call.direction == "outbound"
    val dur =
        if (call.forward_seconds > 0) " · ${contactCallDuration(call.forward_seconds)}" else ""
    val actor = call.answered_by_name?.takeIf { it.isNotBlank() }
    return when (call.outcome) {
        CallOutcome.MISSED -> if (outbound) "No answer" else "Missed"
        CallOutcome.VOICEMAIL -> "Voicemail"
        CallOutcome.ANSWERED ->
            if (outbound) {
                "${if (actor != null) "$actor called" else "You called"}$dur"
            } else {
                "${if (actor != null) "Answered by $actor" else "Answered"}$dur"
            }

        else -> if (outbound) "Calling…" else "In progress"
    }
}

/**
 * An INBOUND miss is the row's one urgent (coral) element; nothing else is.
 * Source: features/calls/CallsLogic.kt isActionableMiss.
 */
internal fun isContactActionableMiss(call: Call): Boolean =
    call.outcome == CallOutcome.MISSED && call.direction != "outbound"

/** "0:42" / "12:04" / "1:02:33". Source: features/calls/CallsLogic.kt formatTimer. */
internal fun contactCallTimer(elapsedMs: Long): String {
    val total = maxOf(0L, elapsedMs / 1000)
    val hours = total / 3600
    val minutes = (total % 3600) / 60
    val seconds = total % 60
    return if (hours > 0) {
        "%d:%02d:%02d".format(hours, minutes, seconds)
    } else {
        "%d:%02d".format(minutes, seconds)
    }
}

/** "0:42" for a voicemail length. Source: features/calls/CallsLogic.kt. */
internal fun contactVoicemailLength(seconds: Int): String =
    contactCallTimer(seconds * 1000L)
