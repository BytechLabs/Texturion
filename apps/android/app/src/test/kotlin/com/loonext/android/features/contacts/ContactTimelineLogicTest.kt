package com.loonext.android.features.contacts

import java.time.LocalDate
import java.time.ZoneId
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * #324 — the contact history's pure logic.
 *
 * The interleaving is the feature, so this pins the merge, the dedup key and
 * the row copy. Mirrors the web component's tests so a divergence in what a
 * row SAYS is caught on the platform it happens on.
 */
class ContactTimelineLogicTest {
    private fun entry(
        kind: String = "conversation",
        id: String = "1",
        at: String = "2026-07-20T10:00:00Z",
        status: String? = null,
        detail: String? = null,
        talk: Int? = null,
        due: String? = null,
        done: Boolean? = null,
    ) = TimelineEntry(
        kind = kind,
        id = id,
        occurred_at = at,
        conversation_id = "conv-1",
        status = status,
        detail = detail,
        talk_seconds = talk,
        due_at = due,
        done = done,
    )

    @Test
    fun `dedup is by kind AND id, because the tables have separate id spaces`() {
        // A conversation and a job could carry the same id; keying on id alone
        // would silently drop one from the history.
        val cached = ContactTimelineLog(
            listOf(entry(kind = "task", id = "same"), entry(id = "older")),
            "cursor",
        )
        val merged = mergeTimelineFirstPage(
            cached,
            ContactTimelinePage(listOf(entry(kind = "conversation", id = "same")), null),
        )
        assertEquals(3, merged.entries.size)
        assertTrue(merged.entries.any { it.kind == "task" && it.id == "same" })
        assertTrue(merged.entries.any { it.kind == "conversation" && it.id == "same" })
    }

    @Test
    fun `a silent revalidate never collapses what the user paged to`() {
        val cached = ContactTimelineLog(
            (1..10).map { entry(id = "e$it") },
            "cursor",
        )
        val merged = mergeTimelineFirstPage(
            cached,
            ContactTimelinePage(listOf(entry(id = "e1")), "fresh"),
        )
        assertEquals(10, merged.entries.size)
        // The deeper cursor survives: the fresh first page does not know about
        // the tail the user already loaded.
        assertEquals("cursor", merged.nextBefore)
    }

    @Test
    fun `a fresh page wins outright when nothing deeper was loaded`() {
        val merged = mergeTimelineFirstPage(
            null,
            ContactTimelinePage(listOf(entry(id = "a")), "next"),
        )
        assertEquals(1, merged.entries.size)
        assertEquals("next", merged.nextBefore)
    }

    @Test
    fun `appending a page drops repeats and advances the cursor`() {
        val current = ContactTimelineLog(listOf(entry(id = "a")), "c1")
        val appended = appendTimelinePage(
            current,
            ContactTimelinePage(listOf(entry(id = "a"), entry(id = "b")), null),
        )
        assertEquals(listOf("a", "b"), appended.entries.map { it.id })
        assertEquals(null, appended.nextBefore)
    }

    @Test
    fun `days are grouped in the local zone, not UTC`() {
        // An evening call in Vancouver falls on the NEXT UTC day. Grouping on
        // the UTC prefix would file it under a date the crew does not remember
        // it happening on.
        val vancouver = ZoneId.of("America/Vancouver")
        val groups = groupTimelineByDay(
            listOf(entry(at = "2026-07-21T04:00:00Z")),
            vancouver,
        )
        assertEquals(LocalDate.of(2026, 7, 20), groups.single().first)
    }

    @Test
    fun `a call says its talk time, and a missed one says no answer`() {
        // "0s" on a missed call reads as a fault rather than as an absence.
        assertEquals(
            "Talked for 4m 5s",
            timelineDetail(entry(kind = "call", status = "answered", talk = 245)),
        )
        assertEquals(
            "No answer",
            timelineDetail(entry(kind = "call", status = "missed", talk = 0)),
        )
        assertEquals("Call answered", timelineTitle(entry(kind = "call", status = "answered")))
        assertEquals("Voicemail", timelineTitle(entry(kind = "call", status = "voicemail")))
        assertEquals("Missed call", timelineTitle(entry(kind = "call", status = "missed")))
    }

    @Test
    fun `a finished job reads done rather than showing its due date`() {
        assertEquals(
            "Done",
            timelineDetail(entry(kind = "task", done = true, due = "2026-07-25T00:00:00Z")),
        )
        assertEquals("Open", timelineDetail(entry(kind = "task", done = false)))
        assertEquals(
            "Replace the blower",
            timelineTitle(entry(kind = "task", detail = "Replace the blower")),
        )
    }

    @Test
    fun `a conversation carries its open or closed state`() {
        assertEquals("Closed", timelineDetail(entry(status = "closed")))
        assertEquals("Open", timelineDetail(entry(status = "open")))
        assertEquals("Conversation", timelineTitle(entry()))
    }

    @Test
    fun `today and yesterday are named rather than dated`() {
        val today = LocalDate.of(2026, 7, 20)
        assertEquals("Today", timelineDayLabel(today, today))
        assertEquals("Yesterday", timelineDayLabel(today.minusDays(1), today))
        assertTrue(timelineDayLabel(today.minusDays(9), today).contains("2026"))
    }
}
