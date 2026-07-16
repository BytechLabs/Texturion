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
}
