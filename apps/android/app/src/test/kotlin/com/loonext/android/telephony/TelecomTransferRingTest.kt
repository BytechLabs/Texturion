package com.loonext.android.telephony

import androidx.test.core.app.ApplicationProvider
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class TelecomTransferRingTest {
    @Test
    fun `a different transfer rings while the old Telecom call is closing`() = runTest {
        val bridge = IncomingRings()
        val registry = TelecomCallRegistry(ApplicationProvider.getApplicationContext(), backgroundScope, bridge)

        registry.ensureIncomingCall("session", "Original caller", "")
        registry.disconnect("session")
        registry.ensureIncomingCall("session", "Original duplicate", "")
        registry.ensureIncomingCall("session", "First transfer", "", transferId = "first-attempt")
        registry.ensureIncomingCall("session", "Duplicate transfer", "", transferId = "first-attempt")
        registry.disconnect("session")
        registry.ensureIncomingCall("session", "Late transfer duplicate", "", transferId = "first-attempt")
        registry.ensureIncomingCall("session", "Second transfer", "", transferId = "second-attempt")

        assertEquals(listOf("Original caller", "First transfer", "Second transfer"), bridge.posted)
    }

    @Test
    fun `a transfer wake cannot replace a live ring for the same session`() = runTest {
        val bridge = IncomingRings()
        val registry = TelecomCallRegistry(ApplicationProvider.getApplicationContext(), backgroundScope, bridge)

        registry.ensureIncomingCall("session", "Original caller", "")
        registry.ensureIncomingCall("session", "Transfer", "", transferId = "attempt")

        assertEquals(listOf("Original caller"), bridge.posted)
    }

    private class IncomingRings : TelecomCallRegistry.Bridge {
        val posted = mutableListOf<String>()

        override fun showIncomingCall(session: String, callerName: String, callerNumber: String) {
            posted += callerName
        }

        override fun acceptLeg(session: String) = false
        override fun endLeg(session: String) = Unit
        override fun holdLeg(session: String, hold: Boolean) = Unit
        override fun declineMine() = Unit
        override fun declineSession(session: String) = Unit
        override fun releaseHeldSession(session: String) = Unit
        override fun onAnswerFailedTeardown(session: String) = Unit
        override fun mirrorRouteToTelnyx(route: AudioRoute) = Unit
        override fun onCallRegistered(session: String, callerName: String, callerNumber: String) = Unit
        override fun onCallUnregistered(session: String) = Unit
        override fun cancelIncomingCall(session: String) = Unit
    }
}
