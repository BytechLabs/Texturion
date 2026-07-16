package com.loonext.android.features.notifications

import com.loonext.android.core.model.NotificationItem
import java.time.Instant
import java.time.OffsetDateTime

/**
 * Pure watermark semantics for the derived feed (D24) — unit-tested on the
 * JVM. The server keeps ONE per-user/per-company last-seen timestamp; an item
 * is unread iff `created_at > watermark`. Marking one item read advances the
 * watermark to its `created_at`, which also marks everything older read while
 * newer items stay unread. The RPC keeps the greatest value, so the watermark
 * only ever moves forward — [advanceWatermark] mirrors that client-side.
 */

/**
 * Parse a wire timestamp. Postgres/RPC emits ISO-8601 with an offset
 * (`+00:00`), JS `toISOString()` emits `Z` — accept both.
 */
internal fun parseTimestamp(iso: String): Instant? =
    runCatching { OffsetDateTime.parse(iso).toInstant() }.getOrNull()
        ?: runCatching { Instant.parse(iso) }.getOrNull()

/**
 * Optimistically apply a watermark advance to loaded items: everything at or
 * before [lastSeenAt] flips read; newer items keep their unread dot. Items
 * with unparseable timestamps (or an unparseable watermark) are left as the
 * server sent them — never guess read state.
 */
internal fun applyWatermark(
    items: List<NotificationItem>,
    lastSeenAt: String,
): List<NotificationItem> {
    val watermark = parseTimestamp(lastSeenAt) ?: return items
    return items.map { item ->
        if (!item.unread) return@map item
        val createdAt = parseTimestamp(item.created_at) ?: return@map item
        if (createdAt.isAfter(watermark)) item else item.copy(unread = false)
    }
}

/**
 * Forward-only merge of watermark candidates: returns the later of the two
 * (server semantics — the RPC keeps the greatest, never moves backwards).
 * An unparseable candidate never displaces a valid current value.
 */
internal fun advanceWatermark(current: String?, candidate: String): String {
    val currentInstant = current?.let(::parseTimestamp)
        ?: return candidate
    val candidateInstant = parseTimestamp(candidate)
        ?: return current
    return if (candidateInstant.isAfter(currentInstant)) candidate else current
}
