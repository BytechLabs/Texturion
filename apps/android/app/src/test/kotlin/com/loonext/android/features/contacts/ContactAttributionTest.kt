package com.loonext.android.features.contacts

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import java.time.Clock
import java.time.Instant
import java.time.ZoneId

/**
 * #191 record attribution — the "Added by / Edited by" caption, ported from
 * the web contact page's RecordAttribution so the clients never phrase it
 * differently. The load-bearing rule: show a line ONLY when the name resolves
 * (older contacts carry null actors and must render nothing).
 */
class ContactAttributionTest {

    private val clock: Clock =
        Clock.fixed(Instant.parse("2026-07-15T12:00:00Z"), ZoneId.of("UTC"))

    @Test
    fun `pre-attribution contact shows nothing`() {
        val result = contactAttribution(
            createdByName = null,
            createdAt = "2026-01-02T15:00:00Z",
            updatedByName = null,
            clock = clock,
        )
        assertNull(result.added)
        assertNull(result.edited)
    }

    @Test
    fun `a blank name is treated as unresolved, not faked`() {
        val result = contactAttribution(
            createdByName = "   ",
            createdAt = "2026-01-02T15:00:00Z",
            updatedByName = "",
            clock = clock,
        )
        assertNull(result.added)
        assertNull(result.edited)
    }

    @Test
    fun `added actor reads with the creation date`() {
        val result = contactAttribution(
            createdByName = "Dana Fields",
            createdAt = "2026-07-08T15:00:00Z",
            updatedByName = null,
            clock = clock,
        )
        assertEquals("Added by Dana Fields on Jul 8, 2026", result.added)
        assertNull(result.edited)
    }

    @Test
    fun `edit by a different member shows both lines`() {
        val result = contactAttribution(
            createdByName = "Dana Fields",
            createdAt = "2026-07-08T15:00:00Z",
            updatedByName = "Sam Rivera",
            clock = clock,
        )
        assertEquals("Added by Dana Fields on Jul 8, 2026", result.added)
        assertEquals("Edited by Sam Rivera", result.edited)
    }

    @Test
    fun `edit by the same member does not echo the added line`() {
        val result = contactAttribution(
            createdByName = "Dana Fields",
            createdAt = "2026-07-08T15:00:00Z",
            updatedByName = "Dana Fields",
            clock = clock,
        )
        assertEquals("Added by Dana Fields on Jul 8, 2026", result.added)
        assertNull(result.edited)
    }

    @Test
    fun `an editor resolves even when the creator is unknown`() {
        val result = contactAttribution(
            createdByName = null,
            createdAt = "2026-07-08T15:00:00Z",
            updatedByName = "Sam Rivera",
            clock = clock,
        )
        assertNull(result.added)
        assertEquals("Edited by Sam Rivera", result.edited)
    }

    @Test
    fun `an unparseable creation date drops the suffix rather than crashing`() {
        val result = contactAttribution(
            createdByName = "Dana Fields",
            createdAt = "garbage",
            updatedByName = null,
            clock = clock,
        )
        assertEquals("Added by Dana Fields", result.added)
    }
}
