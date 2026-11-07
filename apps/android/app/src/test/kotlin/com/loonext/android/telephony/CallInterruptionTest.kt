package com.loonext.android.telephony

import android.app.ApplicationExitInfo
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder

class CallInterruptionTest {
    @get:Rule
    val tmp = TemporaryFolder()

    @Test
    fun `interrupted only when a crash is not older than the call marker`() {
        assertTrue(PostCrashHonesty.callInterruptedByCrash(markerSetAtMs = 100, lastCrashAtMs = 150))
        assertTrue(PostCrashHonesty.callInterruptedByCrash(markerSetAtMs = 100, lastCrashAtMs = 100))
        assertFalse(PostCrashHonesty.callInterruptedByCrash(markerSetAtMs = 100, lastCrashAtMs = 50))
        assertFalse(PostCrashHonesty.callInterruptedByCrash(markerSetAtMs = null, lastCrashAtMs = 150))
        assertFalse(PostCrashHonesty.callInterruptedByCrash(markerSetAtMs = 100, lastCrashAtMs = null))
    }

    @Test
    fun `the last crash is the newest JVM or native crash the OS recorded`() {
        val exits = listOf(
            ApplicationExitInfo.REASON_CRASH to 200L,
            ApplicationExitInfo.REASON_USER_REQUESTED to 900L,
            ApplicationExitInfo.REASON_CRASH_NATIVE to 400L,
            ApplicationExitInfo.REASON_CRASH to 100L,
        )

        assertEquals(400L, PostCrashHonesty.lastCrashAtMs(exits))
    }

    @Test
    fun `exits that were not crashes say nothing`() {
        // A swipe from Recents, low memory or an ANR is not a crash, and the
        // line on the call screen says crash.
        val exits = listOf(
            ApplicationExitInfo.REASON_USER_REQUESTED to 500L,
            ApplicationExitInfo.REASON_LOW_MEMORY to 600L,
            ApplicationExitInfo.REASON_ANR to 700L,
        )

        assertNull(PostCrashHonesty.lastCrashAtMs(exits))
        assertNull(PostCrashHonesty.lastCrashAtMs(emptyList()))
    }

    @Test
    fun `marker set - read - clear round trip, first stamp wins`() {
        var clock = 500L
        val marker = CallInFlightMarker(tmp.newFolder("calls"), now = { clock })
        assertNull(marker.setAtMs())

        marker.set()
        assertEquals(500L, marker.setAtMs())

        // A second set during the same live stretch keeps the ORIGINAL stamp.
        clock = 900L
        marker.set()
        assertEquals(500L, marker.setAtMs())

        marker.clear()
        assertNull(marker.setAtMs())

        // A fresh call after the clear stamps anew.
        marker.set()
        assertEquals(900L, marker.setAtMs())
    }
}
