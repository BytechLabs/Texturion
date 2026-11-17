package com.loonext.android.telephony

import androidx.core.telecom.CallEndpointCompat
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class ProximityLockTest {
    @Test
    fun `receiver blanks the screen only while the call is active`() {
        val receiver = CallEndpointCompat.TYPE_EARPIECE
        assertTrue(shouldHoldProximityLock(CallPhase.ACTIVE, receiver))
        CallPhase.entries.filter { it != CallPhase.ACTIVE }.forEach { phase ->
            assertFalse(shouldHoldProximityLock(phase, receiver))
        }
        assertFalse(shouldHoldProximityLock(null, receiver))
    }

    @Test
    fun `speaker and both headset routes leave the screen on`() {
        val routes = listOf(
            CallEndpointCompat.TYPE_SPEAKER,
            CallEndpointCompat.TYPE_BLUETOOTH,
            CallEndpointCompat.TYPE_WIRED_HEADSET,
            null,
        )
        routes.forEach { route -> assertFalse(shouldHoldProximityLock(CallPhase.ACTIVE, route)) }
    }
}
