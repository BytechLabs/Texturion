package com.loonext.android.features.contacts

import com.loonext.android.core.model.Call
import com.loonext.android.core.model.Page
import java.time.LocalDate
import java.time.ZoneId
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

private val utc: ZoneId = ZoneId.of("UTC")
private val today: LocalDate = LocalDate.of(2026, 7, 15)

private fun call(
    id: String = "c1",
    startedAt: String = "2026-07-15T12:00:00Z",
    outcome: String? = null,
    direction: String = "inbound",
    forwardSeconds: Int = 0,
    answeredByName: String? = null,
) = Call(
    id = id,
    call_session_id = "sess-$id",
    outcome = outcome,
    direction = direction,
    forward_seconds = forwardSeconds,
    answered_by_name = answeredByName,
    started_at = startedAt,
)

private fun page(calls: List<Call>, cursor: String? = null) =
    Page(data = calls, next_cursor = cursor)

class ContactCallsLogicTest {

    @Test
    fun `day grouping buckets today, yesterday, same year, other year, and bad iso`() {
        val calls = listOf(
            call(id = "a", startedAt = "2026-07-15T18:00:00Z"),
            call(id = "b", startedAt = "2026-07-15T09:00:00Z"),
            call(id = "c", startedAt = "2026-07-14T22:00:00Z"),
            call(id = "d", startedAt = "2026-07-08T10:00:00Z"),
            call(id = "e", startedAt = "2025-12-31T10:00:00Z"),
            call(id = "f", startedAt = "not-a-date"),
        )
        val groups = groupContactCallsByDay(calls, zone = utc, today = today)
        assertEquals(
            listOf("Today", "Yesterday", "Jul 8", "Dec 31 2025", "Earlier"),
            groups.map { it.first },
        )
        // Order within a bucket is preserved (the API is newest-first).
        assertEquals(listOf("a", "b"), groups.first().second.map { it.id })
    }

    @Test
    fun `day labels resolve in the given zone`() {
        // 2026-07-15T03:00Z is still 2026-07-14 in UTC-5 — Yesterday there.
        assertEquals(
            "Yesterday",
            contactCallDayLabel("2026-07-15T03:00:00Z", ZoneId.of("-05:00"), today),
        )
        assertEquals("Today", contactCallDayLabel("2026-07-15T03:00:00Z", utc, today))
        assertEquals("Earlier", contactCallDayLabel("garbage", utc, today))
    }

    @Test
    fun `outcome labels match the call log's plain language`() {
        assertEquals("Missed", contactCallOutcomeLabel(call(outcome = "missed")))
        assertEquals(
            "No answer",
            contactCallOutcomeLabel(call(outcome = "missed", direction = "outbound")),
        )
        assertEquals("Voicemail", contactCallOutcomeLabel(call(outcome = "voicemail")))
        assertEquals("Answered", contactCallOutcomeLabel(call(outcome = "answered")))
        assertEquals(
            "Answered · 4m 32s",
            contactCallOutcomeLabel(call(outcome = "answered", forwardSeconds = 272)),
        )
        assertEquals(
            "You called · 58s",
            contactCallOutcomeLabel(
                call(outcome = "answered", direction = "outbound", forwardSeconds = 58),
            ),
        )
        assertEquals(
            "You called",
            contactCallOutcomeLabel(call(outcome = "answered", direction = "outbound")),
        )
        assertEquals("In progress", contactCallOutcomeLabel(call(outcome = null)))
        assertEquals(
            "Calling…",
            contactCallOutcomeLabel(call(outcome = null, direction = "outbound")),
        )
        // Unknown future outcomes degrade to the in-flight copy, never crash.
        assertEquals("In progress", contactCallOutcomeLabel(call(outcome = "some_new_state")))
    }

    @Test
    fun `#191 an answered call names the acting placer or answerer`() {
        assertEquals(
            "Sam called · 3m 12s",
            contactCallOutcomeLabel(
                call(
                    outcome = "answered",
                    direction = "outbound",
                    forwardSeconds = 192,
                    answeredByName = "Sam",
                ),
            ),
        )
        assertEquals(
            "Answered by Sam · 4m 32s",
            contactCallOutcomeLabel(
                call(
                    outcome = "answered",
                    direction = "inbound",
                    forwardSeconds = 272,
                    answeredByName = "Sam",
                ),
            ),
        )
        // Falls back to the crew-side copy when the actor is unknown (legacy rows).
        assertEquals(
            "You called",
            contactCallOutcomeLabel(call(outcome = "answered", direction = "outbound")),
        )
        assertEquals(
            "Answered",
            contactCallOutcomeLabel(call(outcome = "answered", direction = "inbound")),
        )
    }

    @Test
    fun `only an inbound miss is the coral urgency`() {
        assertTrue(isContactActionableMiss(call(outcome = "missed")))
        assertFalse(isContactActionableMiss(call(outcome = "missed", direction = "outbound")))
        assertFalse(isContactActionableMiss(call(outcome = "answered")))
        assertFalse(isContactActionableMiss(call(outcome = null)))
    }

    @Test
    fun `durations and timers format like the call log`() {
        assertEquals("58s", contactCallDuration(58))
        assertEquals("4m 32s", contactCallDuration(272))
        assertEquals("2m", contactCallDuration(120))
        assertEquals("0s", contactCallDuration(-5))
        assertEquals("0:00", contactCallTimer(0))
        assertEquals("0:42", contactCallTimer(42_000))
        assertEquals("12:04", contactCallTimer((12 * 60 + 4) * 1000L))
        assertEquals("1:02:33", contactCallTimer((3600 + 2 * 60 + 33) * 1000L))
        assertEquals("0:42", contactVoicemailLength(42))
    }

    @Test
    fun `first page merge with no cache is just the page`() {
        val merged = mergeContactCallsFirstPage(null, page(listOf(call(id = "a")), "cur1"))
        assertEquals(listOf("a"), merged.calls.map { it.id })
        assertEquals("cur1", merged.nextCursor)
    }

    @Test
    fun `first page merge keeps the accumulated tail deduped and the cached cursor`() {
        val cached = ContactCallsLog(
            calls = listOf(call(id = "a"), call(id = "b"), call(id = "c")),
            nextCursor = "deep",
        )
        // The fresh first page has a new call and overlaps the old head.
        val merged = mergeContactCallsFirstPage(
            cached,
            page(listOf(call(id = "new"), call(id = "a")), "fresh"),
        )
        assertEquals(listOf("new", "a", "b", "c"), merged.calls.map { it.id })
        assertEquals("deep", merged.nextCursor)
    }

    @Test
    fun `first page merge with an equal or larger page replaces the cache`() {
        val cached = ContactCallsLog(listOf(call(id = "a")), nextCursor = "deep")
        val merged = mergeContactCallsFirstPage(
            cached,
            page(listOf(call(id = "a"), call(id = "b")), null),
        )
        assertEquals(listOf("a", "b"), merged.calls.map { it.id })
        assertNull(merged.nextCursor)
    }

    @Test
    fun `show more appends deduped and adopts the new cursor`() {
        val base = ContactCallsLog(listOf(call(id = "a"), call(id = "b")), "cur1")
        val appended = appendContactCallsPage(
            base,
            page(listOf(call(id = "b"), call(id = "c")), "cur2"),
        )
        assertEquals(listOf("a", "b", "c"), appended.calls.map { it.id })
        assertEquals("cur2", appended.nextCursor)

        val last = appendContactCallsPage(appended, page(listOf(call(id = "d")), null))
        assertEquals(listOf("a", "b", "c", "d"), last.calls.map { it.id })
        assertNull(last.nextCursor)
    }
}
