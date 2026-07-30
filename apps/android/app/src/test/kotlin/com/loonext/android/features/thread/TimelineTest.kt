package com.loonext.android.features.thread

import com.loonext.android.core.model.ConversationEvent
import com.loonext.android.core.model.Message
import com.loonext.android.core.model.MessageDirection
import com.loonext.android.core.model.MessageStatus
import java.time.LocalDate
import java.time.ZoneOffset
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** Timeline assembly: interleave, filters, pending rows, day dividers. */
class TimelineTest {

    private val zone = ZoneOffset.UTC
    private val today = LocalDate.parse("2026-07-15")

    private fun message(
        id: String,
        at: String,
        direction: String = MessageDirection.INBOUND,
    ) = Message(
        id = id,
        conversation_id = "c1",
        direction = direction,
        body = "body $id",
        status = if (direction == MessageDirection.NOTE) null else MessageStatus.RECEIVED,
        created_at = at,
    )

    private fun event(id: String, at: String, type: String = "status_changed") =
        ConversationEvent(
            id = id,
            conversation_id = "c1",
            actor_user_id = "u1",
            type = type,
            payload = buildJsonObject { put("to", "closed") },
            created_at = at,
        )

    @Test
    fun `messages and events interleave newest-first by created_at`() {
        val timeline = buildTimeline(
            messages = listOf(
                message("m2", "2026-07-15T12:00:00Z"),
                message("m1", "2026-07-15T10:00:00Z"),
            ),
            events = listOf(event("e1", "2026-07-15T11:00:00Z")),
            pending = emptyList(),
            filter = ThreadFilter(),
            allMessagesLoaded = true,
            zone = zone,
            today = today,
        )
        assertEquals(
            listOf("m:m2", "e:e1", "m:m1", "d:2026-07-15"),
            timeline.map { it.key },
        )
    }

    @Test
    fun `pending sends render newest (bottom of a reversed list)`() {
        val timeline = buildTimeline(
            messages = listOf(message("m1", "2026-07-15T10:00:00Z")),
            events = emptyList(),
            pending = listOf(
                PendingSend("p1", "hi", 0, "2026-07-15T12:00:00Z", "k1"),
            ),
            filter = ThreadFilter(),
            allMessagesLoaded = true,
            zone = zone,
            today = today,
        )
        assertEquals("p:p1", timeline.first().key)
    }

    @Test
    fun `day dividers append after each day's oldest item`() {
        val timeline = buildTimeline(
            messages = listOf(
                message("m2", "2026-07-15T09:00:00Z"),
                message("m1", "2026-07-14T09:00:00Z"),
            ),
            events = emptyList(),
            pending = emptyList(),
            filter = ThreadFilter(),
            allMessagesLoaded = true,
            zone = zone,
            today = today,
        )
        assertEquals(
            listOf("m:m2", "d:2026-07-15", "m:m1", "d:2026-07-14"),
            timeline.map { it.key },
        )
        val labels = timeline.filterIsInstance<TimelineItem.DayDivider>().map { it.label }
        assertEquals(listOf("Today", "Yesterday"), labels)
    }

    @Test
    fun `notes filter hides note rows`() {
        val timeline = buildTimeline(
            messages = listOf(
                message("m2", "2026-07-15T12:00:00Z", MessageDirection.NOTE),
                message("m1", "2026-07-15T10:00:00Z"),
            ),
            events = emptyList(),
            pending = emptyList(),
            filter = ThreadFilter(notes = false),
            allMessagesLoaded = true,
            zone = zone,
            today = today,
        )
        assertEquals(listOf("m:m1", "d:2026-07-15"), timeline.map { it.key })
    }

    @Test
    fun `events older than the loaded message window stay hidden`() {
        val timeline = buildTimeline(
            messages = listOf(message("m1", "2026-07-15T10:00:00Z")),
            events = listOf(event("e0", "2026-07-10T10:00:00Z")),
            pending = emptyList(),
            filter = ThreadFilter(),
            allMessagesLoaded = false,
            zone = zone,
            today = today,
        )
        assertFalse(timeline.any { it.key == "e:e0" })

        val loaded = buildTimeline(
            messages = listOf(message("m1", "2026-07-15T10:00:00Z")),
            events = listOf(event("e0", "2026-07-10T10:00:00Z")),
            pending = emptyList(),
            filter = ThreadFilter(),
            allMessagesLoaded = true,
            zone = zone,
            today = today,
        )
        assertTrue(loaded.any { it.key == "e:e0" })
    }

    @Test
    fun `the last enabled filter toggle cannot turn off`() {
        val onlyEvents = ThreadFilter(messages = false, notes = false, events = true)
        assertEquals(onlyEvents, onlyEvents.toggledEvents())
        assertTrue(onlyEvents.toggledMessages().messages)
    }

    @Test
    fun `event lines resolve actors, statuses, and unknown types safely`() {
        val names = mapOf("u1" to "Dana")
        assertEquals(
            "Dana moved this to Closed",
            eventLine(event("e1", "2026-07-15T00:00:00Z"), names, "Sam"),
        )
        val unknown = ConversationEvent(
            id = "e2",
            conversation_id = "c1",
            actor_user_id = null,
            type = "brand_new_event_type",
            payload = buildJsonObject {},
            created_at = "2026-07-15T00:00:00Z",
        )
        assertEquals("Brand new event type", eventLine(unknown, names, "Sam"))
    }

    // ---------------------------------------------------------------------
    // #273 — one call event, six readings. Every shape that was not a
    // voicemail used to collapse to "Call with X ended", so an outbound call,
    // a missed call and a transfer were indistinguishable on the phone while
    // web showed all three. Same table as the iOS twin and web.
    //
    // The durations read "4m 32s", not "4:32" as #273's examples say: all three
    // formatCallDuration implementations agree on the m/s form, so the issue's
    // quoted web strings were illustrative rather than literal.
    // ---------------------------------------------------------------------

    private fun callEvent(payload: Map<String, String>): ConversationEvent =
        ConversationEvent(
            id = "call-1",
            conversation_id = "c1",
            actor_user_id = null,
            type = "call_completed",
            payload = buildJsonObject { payload.forEach { (k, v) -> put(k, v) } },
            created_at = "2026-07-15T00:00:00Z",
        )

    private fun callLine(payload: Map<String, String>): String =
        eventLine(callEvent(payload), mapOf("u1" to "Sam", "u2" to "Alex"), "Dana")

    @Test
    fun `an outbound call speaks from the crew side, with its length`() {
        assertEquals(
            "You called · 4m 32s",
            callLine(mapOf("direction" to "outbound", "outcome" to "answered", "forward_seconds" to "272")),
        )
        assertEquals(
            "You called",
            callLine(mapOf("direction" to "outbound", "outcome" to "answered")),
        )
        assertEquals(
            "Called, no answer",
            callLine(mapOf("direction" to "outbound", "outcome" to "missed")),
        )
    }

    @Test
    fun `a transfer names who handed the call to whom`() {
        assertEquals(
            "Sam transferred the call to Alex",
            callLine(mapOf("kind" to "transferred", "from_user_id" to "u1", "to_user_id" to "u2")),
        )
        // An unresolvable sender still names the recipient rather than going
        // generic — the useful half of the sentence survives.
        assertEquals(
            "Call transferred to Alex",
            callLine(mapOf("kind" to "transferred", "to_user_id" to "u2")),
        )
        assertEquals("Call transferred", callLine(mapOf("kind" to "transferred")))
    }

    @Test
    fun `an inbound call reports its outcome`() {
        assertEquals(
            "Call answered · 4m 32s",
            callLine(mapOf("direction" to "inbound", "outcome" to "answered", "forward_seconds" to "272")),
        )
        assertEquals("Call answered", callLine(mapOf("direction" to "inbound", "outcome" to "answered")))
        assertEquals("Missed call", callLine(mapOf("direction" to "inbound", "outcome" to "missed")))
        assertEquals(
            "Call went to voicemail",
            callLine(mapOf("direction" to "inbound", "outcome" to "voicemail")),
        )
    }

    @Test
    fun `a voicemail carries the MESSAGE length, not the call outcome`() {
        // Branch order is the point: a voicemail also has outcome=voicemail, so
        // testing outcome first would swallow the message duration.
        assertEquals(
            "Left a voicemail · 45s",
            callLine(mapOf("kind" to "voicemail", "outcome" to "voicemail", "voicemail_seconds" to "45")),
        )
        assertEquals(
            "Left a voicemail",
            callLine(mapOf("kind" to "voicemail", "outcome" to "voicemail")),
        )
    }

    @Test
    fun `an outbound transfer is read as a transfer, not as an outbound call`() {
        // The other ordering trap: a transferred call still carries a direction.
        assertEquals(
            "Sam transferred the call to Alex",
            callLine(
                mapOf(
                    "kind" to "transferred",
                    "direction" to "inbound",
                    "from_user_id" to "u1",
                    "to_user_id" to "u2",
                ),
            ),
        )
    }

    @Test
    fun `a bare payload never reads as the old catch-all`() {
        // "Call with Dana ended" was the bug. Anything is better than a line
        // that hides the outcome, and "Call answered" is the honest default for
        // an inbound call the server told us completed.
        val line = callLine(emptyMap())
        assertEquals("Call answered", line)
        assertFalse(line.contains("ended"))
    }

    // ---------------------------------------------------------------------
    // #272 — the audio row's caption. Extracted from the composable so the
    // failed wording is asserted rather than assumed, and so it stays
    // identical to the iOS twin (which had a comma where this has a dot).
    // ---------------------------------------------------------------------

    @Test
    fun `the audio row says what it is, and says when it cannot play`() {
        assertEquals("Audio message", audioRowCaption(false))
        assertEquals("Audio unavailable · tap to retry", audioRowCaption(true))
    }

    @Test
    fun `the failed caption tells the user what to DO about it`() {
        // The bug it replaces was silence: the icon flipped to pause, the bar
        // stayed at zero and nothing said the tap had failed or was retryable.
        val caption = audioRowCaption(true)
        assertTrue(caption.contains("unavailable"))
        assertTrue(caption.contains("retry"))
    }

    /**
     * #225: the quiet-hours line states a FACT, never an attestation.
     *
     * It used to read "confirmed sending during quiet hours". Once an admin can
     * switch the confirmation step off (#225 ask 5) the same event is written for
     * a send nobody was asked about, and the old wording would have put a
     * confirmation nobody gave into the customer's own audit trail. Web has
     * always said it this way; this is the parity assertion.
     */
    @Test
    fun `the quiet-hours line does not claim somebody confirmed`() {
        val asked = ConversationEvent(
            id = "e-quiet",
            conversation_id = "c1",
            actor_user_id = "u1",
            type = "quiet_hours_confirmed",
            payload = buildJsonObject {
                put("destination_local_hour", 23)
                put("confirmed", true)
            },
            created_at = "2026-07-15T00:00:00Z",
        )
        val line = eventLine(asked, mapOf("u1" to "Dana"), "Sam")
        assertEquals("Dana sent during this customer's quiet hours", line)
        assertFalse(line.contains("confirmed"))

        // The switched-off case renders identically — the event type is shared, so
        // the sentence has to be true for both readings of it.
        val notAsked = asked.copy(
            id = "e-quiet-2",
            payload = buildJsonObject {
                put("destination_local_hour", 2)
                put("confirmed", false)
            },
        )
        assertEquals(line, eventLine(notAsked, mapOf("u1" to "Dana"), "Sam"))
    }
}
