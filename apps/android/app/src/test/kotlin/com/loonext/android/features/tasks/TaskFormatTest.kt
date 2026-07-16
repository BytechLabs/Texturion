package com.loonext.android.features.tasks

import com.loonext.android.core.model.Task
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.Clock
import java.time.Instant
import java.time.LocalDateTime
import java.time.OffsetDateTime
import java.time.ZoneId
import java.time.ZoneOffset

/**
 * The due_at offset-ISO encoder (the API requires ISO 8601 WITH offset) plus
 * the pure overdue/label helpers, all on fixed clocks.
 */
class TaskFormatTest {

    private val toronto = ZoneId.of("America/Toronto")

    // 2026-07-15 noon in Toronto.
    private val clock: Clock =
        Clock.fixed(Instant.parse("2026-07-15T16:00:00Z"), toronto)

    private fun task(done: Boolean = false, dueAt: String? = null) = Task(
        id = "t1",
        company_id = "c1",
        message_id = "m1",
        conversation_id = "cv1",
        title = "Send the quote",
        created_by_user_id = "u1",
        created_at = "2026-07-01T00:00:00Z",
        updated_at = "2026-07-01T00:00:00Z",
        done = done,
        status = if (done) TaskStatus.DONE else TaskStatus.OPEN,
        due_at = dueAt,
    )

    // ---- encodeDueAt -------------------------------------------------------

    @Test
    fun `summer Toronto pick carries the EDT offset`() {
        assertEquals(
            "2026-07-15T15:00:00-04:00",
            encodeDueAt(LocalDateTime.of(2026, 7, 15, 15, 0), toronto),
        )
    }

    @Test
    fun `winter Toronto pick carries the EST offset`() {
        assertEquals(
            "2026-01-15T09:30:00-05:00",
            encodeDueAt(LocalDateTime.of(2026, 1, 15, 9, 30), toronto),
        )
    }

    @Test
    fun `half-hour zones encode their exact offset`() {
        assertEquals(
            "2026-07-15T08:00:00-02:30",
            encodeDueAt(LocalDateTime.of(2026, 7, 15, 8, 0), ZoneId.of("America/St_Johns")),
        )
    }

    @Test
    fun `UTC encodes as Z`() {
        assertEquals(
            "2026-07-15T15:00:00Z",
            encodeDueAt(LocalDateTime.of(2026, 7, 15, 15, 0), ZoneId.of("UTC")),
        )
    }

    @Test
    fun `encoded value round-trips to the picked instant`() {
        val local = LocalDateTime.of(2026, 11, 3, 7, 45)
        val encoded = encodeDueAt(local, toronto)
        assertEquals(
            local.atZone(toronto).toInstant(),
            OffsetDateTime.parse(encoded).toInstant(),
        )
    }

    @Test
    fun `a pick inside the spring-forward gap still encodes with a real offset`() {
        // 2026-03-08 02:30 does not exist in Toronto — java.time pushes it
        // forward into EDT; whatever the wall time, the output must parse.
        val encoded = encodeDueAt(LocalDateTime.of(2026, 3, 8, 2, 30), toronto)
        val parsed = OffsetDateTime.parse(encoded)
        assertEquals(ZoneOffset.ofHours(-4), parsed.offset)
    }

    // ---- parseInstant ------------------------------------------------------

    @Test
    fun `parses zulu and offset-bearing wire timestamps to the same instant`() {
        val zulu = parseInstant("2026-07-15T12:00:00Z")
        val offset = parseInstant("2026-07-15T08:00:00-04:00")
        assertEquals(Instant.parse("2026-07-15T12:00:00Z"), zulu)
        assertEquals(zulu, offset)
    }

    @Test
    fun `unparseable and missing timestamps are null, never a crash`() {
        assertNull(parseInstant(null))
        assertNull(parseInstant("not-a-date"))
        assertNull(parseInstant(""))
    }

    // ---- isOverdue ---------------------------------------------------------

    @Test
    fun `overdue means past-due AND not done`() {
        assertTrue(isOverdue(task(done = false, dueAt = "2026-07-15T15:00:00Z"), clock))
        assertFalse(isOverdue(task(done = true, dueAt = "2026-07-15T15:00:00Z"), clock))
        assertFalse(isOverdue(task(done = false, dueAt = "2026-07-15T17:00:00Z"), clock))
        assertFalse(isOverdue(task(done = false, dueAt = null), clock))
        assertFalse(isOverdue(task(done = false, dueAt = "garbage"), clock))
    }

    // ---- formatDue ---------------------------------------------------------

    @Test
    fun `due labels humanize as Today, Tomorrow, month-day, and year-qualified`() {
        assertEquals("Today", formatDue("2026-07-15T18:00:00-04:00", clock))
        assertEquals("Tomorrow", formatDue("2026-07-16T09:00:00-04:00", clock))
        assertEquals("Jul 20", formatDue("2026-07-20T09:00:00-04:00", clock))
        assertEquals("Jan 5 2027", formatDue("2027-01-05T09:00:00-05:00", clock))
        assertEquals("", formatDue(null, clock))
        assertEquals("", formatDue("garbage", clock))
    }

    @Test
    fun `due day is judged in the viewer's zone, not UTC`() {
        // 03:00Z on Jul 16 is still 23:00 on Jul 15 in Toronto — Today.
        assertEquals("Today", formatDue("2026-07-16T03:00:00Z", clock))
    }
}
