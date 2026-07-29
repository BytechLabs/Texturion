package com.loonext.android.features.settings

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * #236 — the three pieces of the signed-in-devices screen that are logic
 * rather than layout, and that are hand-ported to three clients (so a silent
 * divergence here is a real risk rather than a theoretical one).
 */
class DevicesLogicTest {
    private fun session(
        id: String,
        client: String = SessionClient.ANDROID,
        current: Boolean = false,
        lastActive: String = "2026-07-28T10:00:00Z",
    ) = DeviceSession(
        id = id,
        client = client,
        signed_in_at = "2026-07-01T10:00:00Z",
        last_active_at = lastActive,
        current = current,
    )

    @Test
    fun `names each app, and says so plainly when it does not know`() {
        assertEquals("Web browser", deviceClientLabel(SessionClient.WEB))
        assertEquals("Android app", deviceClientLabel(SessionClient.ANDROID))
        assertEquals("iPhone or iPad", deviceClientLabel(SessionClient.IOS))
        // A client that predates the X-Client header. "Unrecognised device" is
        // the row somebody SHOULD look twice at, so it must not read as a bug.
        assertEquals("Unrecognised device", deviceClientLabel(SessionClient.UNKNOWN))
        assertEquals("Unrecognised device", deviceClientLabel("something-new"))
    }

    @Test
    fun `counts devices in a sentence a person would say`() {
        assertEquals("1 device", deviceCountLabel(1))
        assertEquals("3 devices", deviceCountLabel(3))
        assertEquals("0 devices", deviceCountLabel(0))
    }

    @Test
    fun `puts the phone in your hand first, whatever its activity says`() {
        val ordered = orderMyDevices(
            listOf(
                session("busy-laptop", lastActive = "2026-07-28T18:00:00Z"),
                session("this-phone", current = true, lastActive = "2026-07-20T09:00:00Z"),
                session("old-tablet", lastActive = "2026-07-25T09:00:00Z"),
            ),
        )
        // The device being read on comes first even though it is the LEAST
        // recently active — the reader has to identify and dismiss it before
        // any other row means anything.
        assertEquals("this-phone", ordered.first().id)
        // Everything else falls back to most recently active.
        assertEquals(listOf("busy-laptop", "old-tablet"), ordered.drop(1).map { it.id })
    }

    @Test
    fun `leaves an empty list empty rather than inventing a row`() {
        assertTrue(orderMyDevices(emptyList()).isEmpty())
    }
}
