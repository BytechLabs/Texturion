package com.loonext.android.features.compose

import com.loonext.android.core.model.DestinationClock
import com.loonext.android.core.scheduled.ScheduledSend
import java.time.Instant
import java.time.ZoneId
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * #233 — the send-later logic this phone owns, rather than the vocabulary.
 *
 * `ScheduledSendTest` covers the shared spec (presets, reasons, recovery).
 * These are the decisions that only exist on the client: which zone the picker
 * speaks in, and how far the customer is from it.
 *
 * The zone question is the one worth pinning. The picker is the SENDER's wall
 * clock and the presets are the CUSTOMER's morning, and a sentence that got
 * that backwards would send a text hours from where somebody put it — a
 * silent error, invisible in any test where the two zones happen to agree.
 * Every case below therefore uses two genuinely different zones.
 */
class SendLaterTest {

    private val toronto = ZoneId.of("America/Toronto")
    private val vancouver = ZoneId.of("America/Vancouver")
    private val stJohns = ZoneId.of("America/St_Johns")

    // --- hoursApart ------------------------------------------------------

    @Test
    fun `a customer three hours west reads as behind you`() {
        // A January instant: both zones are on standard time, three apart.
        val winter = Instant.parse("2026-01-15T17:00:00Z")
        assertEquals("3 hours behind you", hoursApart(vancouver, toronto, winter))
    }

    @Test
    fun `and the same pair reads as ahead from the other side`() {
        val winter = Instant.parse("2026-01-15T17:00:00Z")
        assertEquals("3 hours ahead of you", hoursApart(toronto, vancouver, winter))
    }

    @Test
    fun `one hour is words, not a number`() {
        // "1 hours behind you" is the kind of sentence that makes a product
        // look machine-written to the person reading it at 9:40pm.
        val winter = Instant.parse("2026-01-15T17:00:00Z")
        assertEquals(
            "an hour ahead of you",
            hoursApart(ZoneId.of("America/Halifax"), toronto, winter),
        )
    }

    @Test
    fun `the same zone says so rather than saying zero`() {
        assertEquals(
            "on the same clock",
            hoursApart(toronto, toronto, Instant.parse("2026-01-15T17:00:00Z")),
        )
    }

    @Test
    fun `a half-hour offset rounds toward the whole hour it shares`() {
        // Newfoundland is 90 minutes from Toronto. Integer division keeps this
        // at "an hour ahead", which is the honest short answer — the sentence
        // exists to stop somebody sending at 11pm their time, and 30 minutes
        // never changes that decision.
        val winter = Instant.parse("2026-01-15T17:00:00Z")
        assertEquals("an hour ahead of you", hoursApart(stJohns, toronto, winter))
    }

    @Test
    fun `it is measured across a DST boundary, not from a table`() {
        // Between the US/Canada spring-forward and Europe's, London is 4 hours
        // from Toronto rather than the usual 5. A fixed offset table gets this
        // wrong for two weeks every year, in the direction that tells somebody
        // a message is landing at a civilised hour when it is not.
        val gap = Instant.parse("2026-03-12T17:00:00Z")
        assertEquals("4 hours ahead of you", hoursApart(ZoneId.of("Europe/London"), toronto, gap))
    }

    // --- senderClockNote -------------------------------------------------

    @Test
    fun `the picker says it is your own clock`() {
        val note = senderClockNote(null, toronto)
        assertTrue(note, note.startsWith("This is your own time."))
        assertTrue(note, note.endsWith(ScheduledSend.copy("picker_reassurance")))
    }

    @Test
    fun `and names the gap when we actually know their zone`() {
        val note = senderClockNote(
            DestinationClock(timezone = "America/Vancouver", source = "contact"),
            toronto,
        )
        assertTrue(note, note.contains("they are 3 hours behind you"))
    }

    @Test
    fun `the weakest rung claims no gap at all`() {
        // source='company' means we do NOT know their zone — it is the shop's
        // own clock wearing a label. Saying "they are 3 hours behind you" off
        // that rung would be inventing a fact, which is exactly what the
        // provenance ladder exists to prevent.
        val note = senderClockNote(
            DestinationClock(timezone = "America/Vancouver", source = "company"),
            toronto,
        )
        assertEquals("This is your own time. ${ScheduledSend.copy("picker_reassurance")}", note)
    }

    @Test
    fun `a timezone we cannot parse falls back rather than crashing`() {
        // The server sends an IANA id; a client that trusted it blindly would
        // crash the composer on a value it had never seen.
        val note = senderClockNote(
            DestinationClock(timezone = "Mars/Olympus_Mons", source = "contact"),
            toronto,
        )
        assertEquals("This is your own time. ${ScheduledSend.copy("picker_reassurance")}", note)
        assertEquals(ZoneId.systemDefault(), destinationZone(DestinationClock("Mars/Olympus_Mons")))
    }

    // --- sendAtLabel -----------------------------------------------------

    @Test
    fun `the label is rendered in the destination zone, not the device's`() {
        // 8am Vancouver is 11am Toronto. A dispatcher in Toronto looking at
        // this send must see the customer's 8, because that is the time the
        // sender chose — the whole point of storing the zone on the row.
        val at = Instant.parse("2026-01-15T16:00:00Z")
        assertEquals("Thu, 8:00 AM", sendAtLabel(at, vancouver))
        assertEquals("Thu, 11:00 AM", sendAtLabel(at, toronto))
    }
}
