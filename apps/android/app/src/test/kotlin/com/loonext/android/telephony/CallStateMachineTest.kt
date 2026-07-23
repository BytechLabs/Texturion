package com.loonext.android.telephony

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class CallStateMachineTest {
    private fun ringing(id: String) = CallSnapshot(
        id = id,
        direction = CallDirection.INBOUND,
        peerName = "Dana",
        peerNumber = "+15551230000",
        phase = CallPhase.RINGING,
    )

    private fun outbound(id: String) = CallSnapshot(
        id = id,
        direction = CallDirection.OUTBOUND,
        peerName = "Ari",
        peerNumber = "+15559998888",
        phase = CallPhase.CONNECTING,
    )

    @Test
    fun `an unanswered inbound ring ends SILENTLY - no ended chip`() {
        var state = CallStateMachine.incoming(SoftphoneSnapshot(), ringing("a"))
        assertEquals(CallPhase.RINGING, state.calls.single().phase)

        state = CallStateMachine.sdkPhase(state, "a", CallPhase.ENDED, nowMs = 1_000)
        assertTrue(state.calls.isEmpty())
    }

    @Test
    fun `early SDK states never morph a ringing call's answer chip`() {
        var state = CallStateMachine.incoming(SoftphoneSnapshot(), ringing("a"))
        state = CallStateMachine.sdkPhase(state, "a", CallPhase.CONNECTING, nowMs = 0)
        assertEquals(CallPhase.RINGING, state.calls.single().phase)
    }

    @Test
    fun `a call going active demotes the previous active call to held`() {
        var state = CallStateMachine.placing(SoftphoneSnapshot(), outbound("out"))
        state = CallStateMachine.sdkPhase(state, "out", CallPhase.ACTIVE, nowMs = 5_000)
        assertEquals("out", state.activeId)
        assertEquals(5_000L, state.calls.single().activeSinceMs)

        state = CallStateMachine.incoming(state, ringing("in"))
        state = CallStateMachine.sdkPhase(state, "in", CallPhase.ACTIVE, nowMs = 9_000)

        assertEquals("in", state.activeId)
        assertEquals(CallPhase.HELD, state.calls.first { it.id == "out" }.phase)
        assertEquals(CallPhase.ACTIVE, state.calls.first { it.id == "in" }.phase)
    }

    @Test
    fun `activeSince anchors on FIRST activation and survives hold-resume`() {
        var state = CallStateMachine.placing(SoftphoneSnapshot(), outbound("out"))
        state = CallStateMachine.sdkPhase(state, "out", CallPhase.ACTIVE, nowMs = 1_000)
        state = CallStateMachine.sdkPhase(state, "out", CallPhase.HELD, nowMs = 2_000)
        assertNull(state.activeId)
        state = CallStateMachine.sdkPhase(state, "out", CallPhase.ACTIVE, nowMs = 3_000)
        assertEquals(1_000L, state.calls.single().activeSinceMs)
    }

    @Test
    fun `an established call's end keeps a dismissible ended chip`() {
        var state = CallStateMachine.placing(SoftphoneSnapshot(), outbound("out"))
        state = CallStateMachine.sdkPhase(state, "out", CallPhase.ACTIVE, nowMs = 0)
        state = CallStateMachine.sdkPhase(state, "out", CallPhase.ENDED, nowMs = 1)

        assertEquals(CallPhase.ENDED, state.calls.single().phase)
        assertNull(state.activeId)
        assertTrue(state.liveCalls.isEmpty())

        state = CallStateMachine.dismissed(state, "out")
        assertTrue(state.calls.isEmpty())
    }

    @Test
    fun `placing a new call sweeps old ended chips`() {
        var state = CallStateMachine.placing(SoftphoneSnapshot(), outbound("one"))
        state = CallStateMachine.sdkPhase(state, "one", CallPhase.ACTIVE, nowMs = 0)
        state = CallStateMachine.sdkPhase(state, "one", CallPhase.ENDED, nowMs = 1)
        state = CallStateMachine.placing(state, outbound("two"))
        assertEquals(listOf("two"), state.calls.map { it.id })
    }

    @Test
    fun `duplicate incoming events are ignored`() {
        var state = CallStateMachine.incoming(SoftphoneSnapshot(), ringing("a"))
        state = CallStateMachine.incoming(state, ringing("a"))
        assertEquals(1, state.calls.size)
    }

    @Test
    fun `sessionKnown patches only the target call`() {
        var state = CallStateMachine.incoming(SoftphoneSnapshot(), ringing("a"))
        state = CallStateMachine.incoming(state, ringing("b"))
        state = CallStateMachine.sessionKnown(state, "a", "sess-1")
        assertEquals("sess-1", state.calls.first { it.id == "a" }.sessionId)
        assertNull(state.calls.first { it.id == "b" }.sessionId)
    }

    @Test
    fun `disconnect drops registration but keeps the calls`() {
        var state = CallStateMachine.ready(SoftphoneSnapshot())
        state = CallStateMachine.placing(state, outbound("out"))
        state = CallStateMachine.disconnected(state)
        assertEquals(SoftphoneStatus.DISCONNECTED, state.status)
        assertEquals(1, state.calls.size)
    }

    // ---------------------------------- #213 placement reconcile (server-dialed)

    private fun placement(session: String) = CallSnapshot(
        id = SoftphoneCore.placementId(session),
        direction = CallDirection.OUTBOUND,
        peerName = "Ari",
        peerNumber = "+15559998888",
        phase = CallPhase.CONNECTING,
        sessionId = session,
    )

    @Test
    fun `placementConnected rekeys the Calling chip onto the real SDK id, staying outbound and active`() {
        val placementId = SoftphoneCore.placementId("S")
        var state = CallStateMachine.ready(SoftphoneSnapshot())
        state = CallStateMachine.placing(state, placement("S"))
        assertEquals(placementId, state.activeId)

        state = CallStateMachine.placementConnected(state, placementId, id = "op-1", sessionId = "S")
        state = CallStateMachine.sdkPhase(state, "op-1", CallPhase.ACTIVE, nowMs = 2_000)

        val call = state.calls.single()
        assertEquals("op-1", call.id)
        assertEquals("S", call.sessionId)
        assertEquals(CallDirection.OUTBOUND, call.direction)
        assertEquals(CallPhase.ACTIVE, call.phase)
        assertEquals("op-1", state.activeId)
    }

    @Test
    fun `placementConnected on a cancelled (already-removed) chip is a no-op`() {
        val placementId = SoftphoneCore.placementId("S")
        var state = CallStateMachine.placing(SoftphoneSnapshot(), placement("S"))
        state = CallStateMachine.dismissed(state, placementId) // user cancelled during Calling…
        state = CallStateMachine.placementConnected(state, placementId, id = "op-1", sessionId = "S")

        assertTrue(state.calls.isEmpty())
        assertNull(state.activeId)
    }

    @Test
    fun `placementFailed drops the Calling chip and surfaces an error`() {
        val placementId = SoftphoneCore.placementId("S")
        var state = CallStateMachine.placing(SoftphoneSnapshot(), placement("S"))
        state = CallStateMachine.placementFailed(state, placementId, "Couldn't reach the line.")

        assertTrue(state.calls.isEmpty())
        assertNull(state.activeId)
        assertEquals("Couldn't reach the line.", state.error)
    }
}
