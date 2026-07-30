package com.loonext.android.features.contacts

import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import kotlinx.serialization.Serializable

/**
 * #324 — pure logic for the contact detail's History section.
 *
 * D7 threads by recency, so a customer who returns after 31 days starts a NEW
 * conversation: a homeowner serviced once a year for six years is six threads.
 * That is the right call for an annual furnace service, and it is why "what
 * have we done for this customer?" had no answer surface — the
 * prior-conversations list (G6) and the per-contact call history (#205) both
 * existed as separate blocks, with tasks nowhere.
 *
 * Kept free of Android/Compose imports so it unit-tests on the JVM, matching
 * ContactCallsLogic.kt next door.
 */

/** One entry, whatever kind of record it came from. */
@Serializable
internal data class TimelineEntry(
    val kind: String,
    val id: String,
    val occurred_at: String,
    /** Where tapping goes. Null only for a call that never threaded. */
    val conversation_id: String? = null,
    /** Conversation status, or call outcome. Null on a job. */
    val status: String? = null,
    /** Job title, or the caller's name. Null on a conversation. */
    val detail: String? = null,
    val started_at: String? = null,
    /** Talk time on a call: the forward leg's seconds, never ring time. */
    val talk_seconds: Int? = null,
    val due_at: String? = null,
    val done: Boolean? = null,
)

@Serializable
internal data class ContactTimelinePage(
    val entries: List<TimelineEntry> = emptyList(),
    /**
     * The shared opaque cursor (SPEC §7/D10), encoding the full
     * `(occurred_at, id)` sort key. Null at the end of the history.
     */
    val next_cursor: String? = null,
)

/**
 * The cached aggregate: accumulated entries plus the cursor, so reopening the
 * contact restores everything the user had paged to (#176). Same shape as
 * [ContactCallsLog] and for the same reason.
 */
internal data class ContactTimelineLog(
    val entries: List<TimelineEntry>,
    val nextCursor: String?,
)

/**
 * First-page fetch merged with the already-cached deeper tail: the fresh page
 * wins, then the older accumulated tail is kept, deduped, so a silent
 * revalidate never collapses what the user paged to.
 *
 * Deduped by kind AND id, not by id alone: the three source tables have
 * independent id spaces, so a conversation and a job could in principle collide
 * and one would silently vanish from the history.
 */
internal fun mergeTimelineFirstPage(
    cached: ContactTimelineLog?,
    page: ContactTimelinePage,
): ContactTimelineLog {
    if (cached == null || cached.entries.size <= page.entries.size) {
        return ContactTimelineLog(page.entries, page.next_cursor)
    }
    val fresh = page.entries.map { it.kind to it.id }.toSet()
    val tail = cached.entries.filterNot { (it.kind to it.id) in fresh }
    return ContactTimelineLog(page.entries + tail, cached.nextCursor)
}

/** Append a later page, keeping the accumulated order and dropping repeats. */
internal fun appendTimelinePage(
    current: ContactTimelineLog,
    page: ContactTimelinePage,
): ContactTimelineLog {
    val seen = current.entries.map { it.kind to it.id }.toSet()
    val added = page.entries.filterNot { (it.kind to it.id) in seen }
    return ContactTimelineLog(current.entries + added, page.next_cursor)
}

/**
 * Day buckets, newest first; the entries already arrive in that order.
 *
 * Grouped by the LOCAL date rather than the UTC prefix of the timestamp: an
 * evening call in Vancouver falls on the next UTC day, so a UTC grouping would
 * file it under a date the crew does not remember it happening on.
 */
internal fun groupTimelineByDay(
    entries: List<TimelineEntry>,
    zone: ZoneId = ZoneId.systemDefault(),
): List<Pair<LocalDate, List<TimelineEntry>>> =
    entries
        .groupBy { Instant.parse(it.occurred_at).atZone(zone).toLocalDate() }
        .toList()

private val DAY_LABEL: DateTimeFormatter = DateTimeFormatter.ofPattern("d MMM yyyy")

internal fun timelineDayLabel(
    day: LocalDate,
    today: LocalDate = LocalDate.now(),
): String = when (day) {
    today -> "Today"
    today.minusDays(1) -> "Yesterday"
    else -> DAY_LABEL.format(day)
}

/** The headline for a row: what happened. */
internal fun timelineTitle(entry: TimelineEntry): String = when (entry.kind) {
    "task" -> entry.detail ?: "Job"
    "call" -> when (entry.status) {
        "answered" -> "Call answered"
        "voicemail" -> "Voicemail"
        else -> "Missed call"
    }
    else -> "Conversation"
}

/** The second line: the one detail worth carrying at a glance. */
internal fun timelineDetail(entry: TimelineEntry): String = when (entry.kind) {
    "task" -> when {
        entry.done == true -> "Done"
        entry.due_at != null -> "Due ${dueLabel(entry.due_at)}"
        else -> "Open"
    }
    // Talk time only, and only when there was any: "0s" on a missed call reads
    // as a fault rather than as an absence.
    "call" -> (entry.talk_seconds ?: 0).let { seconds ->
        if (seconds > 0) "Talked for ${talkTime(seconds)}" else "No answer"
    }
    else -> if (entry.status == "closed") "Closed" else "Open"
}

private fun talkTime(seconds: Int): String {
    val minutes = seconds / 60
    val rest = seconds % 60
    return if (minutes > 0) "${minutes}m ${rest}s" else "${rest}s"
}

private val DUE_LABEL: DateTimeFormatter = DateTimeFormatter.ofPattern("d MMM")

private fun dueLabel(iso: String, zone: ZoneId = ZoneId.systemDefault()): String =
    DUE_LABEL.format(Instant.parse(iso).atZone(zone).toLocalDate())
