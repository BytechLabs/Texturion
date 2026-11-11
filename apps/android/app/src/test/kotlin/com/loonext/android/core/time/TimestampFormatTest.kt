package com.loonext.android.core.time

import java.time.Instant
import java.time.ZoneId
import org.junit.Assert.assertEquals
import org.junit.Test

/** #720: the labels, in both languages, pinned to a zone and a "now". */
class TimestampFormatTest {
    private val zone = ZoneId.of("America/Toronto")
    private val now = Instant.parse("2026-11-10T20:00:00Z") // Tue 3:00 PM EST

    private fun short(iso: String, locale: String = "en") =
        TimestampFormat.label(iso, TimestampFormat.Style.SHORT, locale, now, zone)

    private fun long(iso: String, locale: String = "en") =
        TimestampFormat.label(iso, TimestampFormat.Style.LONG, locale, now, zone)

    @Test
    fun `short labels follow the buckets`() {
        assertEquals("now", short("2026-11-10T19:59:40Z"))
        assertEquals("12m", short("2026-11-10T19:48:00Z"))
        assertEquals("1:42 PM", short("2026-11-10T18:42:00Z"))
        assertEquals("Yesterday", short("2026-11-09T20:42:00Z"))
        assertEquals("Tomorrow", short("2026-11-11T20:42:00Z"))
        assertEquals("Sat", short("2026-11-07T20:42:00Z"))
        assertEquals("Sep 9", short("2026-09-09T19:42:00Z"))
        assertEquals("Sep 9, 2025", short("2025-09-09T19:42:00Z"))
    }

    @Test
    fun `long labels add the time`() {
        assertEquals("Yesterday 3:42 PM", long("2026-11-09T20:42:00Z"))
        assertEquals("Tomorrow 3:42 PM", long("2026-11-11T20:42:00Z"))
        assertEquals("Sat 3:42 PM", long("2026-11-07T20:42:00Z"))
        assertEquals("Sep 9, 3:42 PM", long("2026-09-09T19:42:00Z"))
        assertEquals("Sep 9, 2025, 3:42 PM", long("2025-09-09T19:42:00Z"))
    }

    @Test
    fun `french words and day-month order`() {
        assertEquals("maintenant", short("2026-11-10T19:59:40Z", "fr-CA"))
        assertEquals("Hier", short("2026-11-09T20:42:00Z", "fr-CA"))
        assertEquals("Demain", short("2026-11-11T20:42:00Z", "fr-CA"))
        assertEquals("9 sept.", short("2026-09-09T19:42:00Z", "fr-CA").replace(" ", " "))
    }

    @Test
    fun `exact names the weekday date time and zone`() {
        assertEquals(
            "Tue, Nov 10, 2026, 3:42 PM EST",
            TimestampFormat.exact("2026-11-10T20:42:00Z", "en", zone),
        )
        assertEquals(
            "Wed, Sep 9, 2026, 3:42 PM EDT",
            TimestampFormat.exact("2026-09-09T19:42:00Z", "en", zone),
        )
    }

    @Test
    fun `spoken is the label then the exact time`() {
        assertEquals(
            "Yesterday 3:42 PM, Mon, Nov 9, 2026, 3:42 PM EST",
            TimestampFormat.spoken("2026-11-09T20:42:00Z", "en", now, zone),
        )
    }

    @Test
    fun `a time minutes ago is spoken as the exact time alone`() {
        assertEquals(
            "Tue, Nov 10, 2026, 2:48 PM EST",
            TimestampFormat.spoken(now.minusSeconds(12 * 60).toString(), "en", now, zone),
        )
    }

    @Test
    fun `a bad timestamp is blank`() {
        assertEquals("", short("not a date"))
        assertEquals("", TimestampFormat.exact(null, "en", zone))
    }
}
