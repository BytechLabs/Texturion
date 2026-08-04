package com.loonext.android.core.realtime

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * #289 — the socket a backgrounded phone should not be holding.
 *
 * Vectors shared with packages/shared/src/realtime-lifecycle.test.ts and the
 * Swift port. Two platforms disagreeing about when to drop a socket is how one
 * of them ends up holding it forever, and the symptom of that is a name on the
 * battery screen rather than a bug report.
 */
class RealtimeLifecycleTest {

    @Test
    fun `holds it while somebody is looking at the app`() {
        assertTrue(RealtimeLifecycle.shouldHold(true, 0, false))
        assertNull(RealtimeLifecycle.dropDelayMs(true, 0, false))
    }

    @Test
    fun `holds it through a quick app-switch`() {
        // Photographing a job, checking an address in Maps, answering a text on
        // a personal line. Tearing the socket down and rebuilding it for each
        // of those costs MORE radio than staying up: a fresh connection is a
        // DNS lookup, a TCP handshake, a TLS handshake and a channel join,
        // against one 300-byte heartbeat.
        assertTrue(RealtimeLifecycle.shouldHold(false, 5_000, false))
    }

    @Test
    fun `drops it once the phone is genuinely in a pocket`() {
        assertFalse(
            RealtimeLifecycle.shouldHold(false, RealtimeLifecycle.BACKGROUND_GRACE_MS, false),
        )
    }

    @Test
    fun `never drops it under a live call`() {
        // Call state rides realtime — hold, transfer, the far end hanging up.
        // A call is also exactly when the phone is out of the pocket and often
        // plugged in.
        for (backgrounded in listOf(0L, RealtimeLifecycle.BACKGROUND_GRACE_MS, 3_600_000L)) {
            assertTrue("$backgrounded", RealtimeLifecycle.shouldHold(false, backgrounded, true))
            assertNull(RealtimeLifecycle.dropDelayMs(false, backgrounded, true))
        }
    }

    @Test
    fun `counts down the remaining grace`() {
        assertEquals(
            RealtimeLifecycle.BACKGROUND_GRACE_MS - 10_000,
            RealtimeLifecycle.dropDelayMs(false, 10_000, false),
        )
    }

    @Test
    fun `never returns a negative delay`() {
        // A phone backgrounded overnight comes back with a huge elapsed figure,
        // and a negative delay() throws.
        assertEquals(0L, RealtimeLifecycle.dropDelayMs(false, 86_400_000, false))
    }

    @Test
    fun `agrees with shouldHold at every boundary`() {
        // The two answer the same question — "is the socket wanted" and "when
        // does that change" — and the view model wires both. If they can
        // disagree, the app schedules a drop it then refuses to perform and the
        // socket stays up forever.
        for (backgrounded in listOf(
            0L,
            1L,
            RealtimeLifecycle.BACKGROUND_GRACE_MS - 1,
            RealtimeLifecycle.BACKGROUND_GRACE_MS,
            RealtimeLifecycle.BACKGROUND_GRACE_MS + 1,
        )) {
            val held = RealtimeLifecycle.shouldHold(false, backgrounded, false)
            val delay = RealtimeLifecycle.dropDelayMs(false, backgrounded, false)
            assertEquals("$backgrounded", !held, delay == 0L)
        }
    }

    @Test
    fun `holds the shared grace window`() {
        // Pinned against packages/shared/src/realtime-lifecycle.ts. A phone
        // that waited a different amount of time from the other would be a
        // silent divergence in the one behaviour this issue is about.
        assertEquals(30_000L, RealtimeLifecycle.BACKGROUND_GRACE_MS)
    }
}
