package com.loonext.android.features.notifications

import com.loonext.android.core.model.NotificationItem
import com.loonext.android.core.model.NotificationType
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class NotificationsFeedLogicTest {
    private fun item(id: String, createdAt: String, unread: Boolean = true) = NotificationItem(
        id = id,
        type = NotificationType.INBOUND_MESSAGE,
        conversation_id = "conv-$id",
        created_at = createdAt,
        unread = unread,
    )

    @Test
    fun `applyWatermark flips the tapped item and everything older, keeps newer unread`() {
        val items = listOf(
            item("newest", "2026-07-15T12:00:00Z"),
            item("tapped", "2026-07-15T11:00:00Z"),
            item("older", "2026-07-15T10:00:00Z"),
        )

        val result = applyWatermark(items, "2026-07-15T11:00:00Z")

        assertTrue(result.first { it.id == "newest" }.unread)
        assertFalse(result.first { it.id == "tapped" }.unread)
        assertFalse(result.first { it.id == "older" }.unread)
    }

    @Test
    fun `applyWatermark accepts offset timestamps against Z timestamps`() {
        // Postgres emits +00:00 offsets; JS toISOString emits Z — same instant.
        val items = listOf(
            item("offset", "2026-07-15T11:00:00+00:00"),
            item("newer", "2026-07-15T11:00:01+00:00"),
        )

        val result = applyWatermark(items, "2026-07-15T11:00:00Z")

        assertFalse(result.first { it.id == "offset" }.unread)
        assertTrue(result.first { it.id == "newer" }.unread)
    }

    @Test
    fun `applyWatermark respects non-UTC offsets`() {
        // 07:00-04:00 == 11:00Z: at the watermark, so read.
        val items = listOf(item("eastern", "2026-07-15T07:00:00-04:00"))

        val result = applyWatermark(items, "2026-07-15T11:00:00Z")

        assertFalse(result.single().unread)
    }

    @Test
    fun `applyWatermark leaves read items and unparseable timestamps alone`() {
        val items = listOf(
            item("already-read", "2026-07-15T09:00:00Z", unread = false),
            item("garbage-ts", "not-a-timestamp"),
        )

        val result = applyWatermark(items, "2026-07-15T12:00:00Z")

        assertFalse(result.first { it.id == "already-read" }.unread)
        // Never guess read state off a timestamp we can't compare.
        assertTrue(result.first { it.id == "garbage-ts" }.unread)
    }

    @Test
    fun `applyWatermark with unparseable watermark changes nothing`() {
        val items = listOf(item("a", "2026-07-15T09:00:00Z"))

        assertEquals(items, applyWatermark(items, "garbage"))
    }

    @Test
    fun `advanceWatermark is forward-only`() {
        val current = "2026-07-15T12:00:00Z"
        val older = "2026-07-15T10:00:00Z"
        val newer = "2026-07-15T13:00:00Z"

        assertEquals(current, advanceWatermark(current, older))
        assertEquals(newer, advanceWatermark(current, newer))
    }

    @Test
    fun `advanceWatermark from null takes the candidate`() {
        assertEquals("2026-07-15T12:00:00Z", advanceWatermark(null, "2026-07-15T12:00:00Z"))
    }

    @Test
    fun `advanceWatermark never lets garbage displace a valid watermark`() {
        assertEquals(
            "2026-07-15T12:00:00Z",
            advanceWatermark("2026-07-15T12:00:00Z", "garbage"),
        )
    }

    @Test
    fun `equal offset and Z watermarks do not regress each other`() {
        // Same instant spelled two ways — either spelling is an acceptable
        // "kept" value; the instant must not move.
        val kept = advanceWatermark("2026-07-15T12:00:00+00:00", "2026-07-15T12:00:00Z")
        assertEquals(
            parseTimestamp("2026-07-15T12:00:00Z"),
            parseTimestamp(kept),
        )
    }
}
