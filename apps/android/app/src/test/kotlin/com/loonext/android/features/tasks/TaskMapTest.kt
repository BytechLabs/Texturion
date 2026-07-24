package com.loonext.android.features.tasks

import com.loonext.android.core.model.Task
import com.loonext.android.core.model.TaskContactLocation
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/**
 * The pure Map-view geometry: [taskPinCoords] (which coordinate a task pins at)
 * and [buildTaskMapModel] (fusing located tasks into per-location pin groups +
 * the "without a location" count). Web parity with map-types.ts / map-view.tsx.
 *
 * The founder-reported bug this guards: a task whose OWN address is "CN Tower,
 * Toronto" was plotted at the CONTACT's Calgary address. A task now pins at its
 * own geocoded site, falling back to the contact only when it has none.
 */
class TaskMapTest {

    // CN Tower, Toronto (the task's own job site) vs the contact's Calgary home.
    private val torontoLat = 43.6426
    private val torontoLng = -79.3871
    private val calgaryLat = 51.0447
    private val calgaryLng = -114.0719

    private fun task(
        id: String = "t1",
        lat: Double? = null,
        lng: Double? = null,
        contact: TaskContactLocation? = null,
    ) = Task(
        id = id,
        company_id = "c1",
        message_id = "m1",
        conversation_id = "cv1",
        title = "Job for $id",
        created_by_user_id = "u1",
        created_at = "2026-07-01T00:00:00Z",
        updated_at = "2026-07-01T00:00:00Z",
        lat = lat,
        lng = lng,
        contact = contact,
    )

    private fun contact(id: String = "k1", lat: Double? = null, lng: Double? = null) =
        TaskContactLocation(id = id, name = "Acme", lat = lat, lng = lng)

    @Test
    fun `prefers the task's OWN geocode over the contact's location`() {
        val pin = taskPinCoords(
            task(
                lat = torontoLat,
                lng = torontoLng,
                contact = contact(lat = calgaryLat, lng = calgaryLng),
            ),
        )
        assertEquals(torontoLat to torontoLng, pin)
    }

    @Test
    fun `falls back to the contact when the task has no own coordinate`() {
        val pin = taskPinCoords(task(contact = contact(lat = calgaryLat, lng = calgaryLng)))
        assertEquals(calgaryLat to calgaryLng, pin)
    }

    @Test
    fun `no coordinate anywhere is unplaceable`() {
        assertNull(taskPinCoords(task()))
        assertNull(taskPinCoords(task(contact = contact())))
    }

    @Test
    fun `an out-of-range own coordinate is rejected, then falls back to the contact`() {
        // A bad own geocode must never plot; the valid contact still can.
        val pin = taskPinCoords(
            task(lat = 91.0, lng = 0.0, contact = contact(lat = calgaryLat, lng = calgaryLng)),
        )
        assertEquals(calgaryLat to calgaryLng, pin)
        // And with no fallback it is simply unplaceable.
        assertNull(taskPinCoords(task(lat = 0.0, lng = 200.0)))
    }

    @Test
    fun `two jobs for the SAME contact at DIFFERENT sites become two pins`() {
        // THE founder fix: contact-id grouping would have collapsed these onto
        // one location; coordinate grouping keeps them apart.
        val shared = contact(id = "same-customer")
        val model = buildTaskMapModel(
            listOf(
                task(id = "toronto-job", lat = torontoLat, lng = torontoLng, contact = shared),
                task(id = "calgary-job", lat = calgaryLat, lng = calgaryLng, contact = shared),
            ),
        )
        assertEquals(2, model.groups.size)
        assertEquals(2, model.located)
        assertEquals(0, model.missing)
    }

    @Test
    fun `tasks sharing an exact coordinate fuse into one pin`() {
        val model = buildTaskMapModel(
            listOf(
                task(id = "a", lat = torontoLat, lng = torontoLng, contact = contact("c-a")),
                task(id = "b", lat = torontoLat, lng = torontoLng, contact = contact("c-b")),
            ),
        )
        assertEquals(1, model.groups.size)
        assertEquals(2, model.groups.first().tasks.size)
        assertEquals(2, model.located)
    }

    @Test
    fun `mapsDirectionsUrl builds a keyless directions URL to the exact coordinate`() {
        assertEquals(
            "https://www.google.com/maps/dir/?api=1&destination=43.6426,-79.3871",
            mapsDirectionsUrl(torontoLat, torontoLng),
        )
        // Western-hemisphere longitude (the whole market) carried verbatim.
        assertEquals(
            "https://www.google.com/maps/dir/?api=1&destination=51.0447,-114.0719",
            mapsDirectionsUrl(calgaryLat, calgaryLng),
        )
    }

    @Test
    fun `tasks without any location surface as the missing count, not pins`() {
        val model = buildTaskMapModel(
            listOf(
                task(id = "located", lat = torontoLat, lng = torontoLng),
                task(id = "unplaced"),
            ),
        )
        assertEquals(1, model.groups.size)
        assertEquals(1, model.located)
        assertEquals(1, model.missing)
    }
}
