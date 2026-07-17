package com.loonext.android.telephony

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * #168 part B (client): the pure stale-ring decisions. The bias is BINDING —
 * a false "stale" silences a real customer call, so every ambiguity must
 * resolve to "ring normally".
 */
class StaleRingPolicyTest {
    private fun hint(
        session: String? = "sess-1",
        atMs: Long? = 10_000,
        nowMs: Long = 11_000,
        otherLive: Int = 0,
        hintCaller: String? = null,
        inviteCaller: String? = null,
    ): String? = StaleRingPolicy.usableHint(
        hintSession = session,
        hintAtMs = atMs,
        nowMs = nowMs,
        otherLiveCalls = otherLive,
        hintCaller = hintCaller,
        inviteCaller = inviteCaller,
    )

    // ------------------------------------------------------------ usableHint

    @Test
    fun `a fresh hint with no conflicts is usable`() {
        assertEquals("sess-1", hint())
    }

    @Test
    fun `no session or no timestamp means no probe`() {
        assertNull(hint(session = null))
        assertNull(hint(session = "  "))
        assertNull(hint(atMs = null))
    }

    @Test
    fun `an expired hint is dead - the ring window is long over`() {
        assertNull(hint(atMs = 0, nowMs = StaleRingPolicy.HINT_WINDOW_MS + 1))
        // Boundary: exactly the window is still usable.
        assertEquals("sess-1", hint(atMs = 0, nowMs = StaleRingPolicy.HINT_WINDOW_MS))
        // A clock that moved backwards is a broken clock — no probe.
        assertNull(hint(atMs = 10_000, nowMs = 9_999))
    }

    @Test
    fun `call waiting - any other live call disables the probe`() {
        // The hint could name the call the user is ON; probing it would read
        // ANSWERED and kill the legitimately-ringing second call.
        assertNull(hint(otherLive = 1))
        assertNull(hint(otherLive = 2))
    }

    @Test
    fun `caller correlation - a definite mismatch disables the probe`() {
        assertNull(hint(hintCaller = "+14155550100", inviteCaller = "+15557778888"))
        // Same digits, different formatting = same caller.
        assertEquals(
            "sess-1",
            hint(hintCaller = "+14155550100", inviteCaller = "(415) 555-0100"),
        )
        // Either side unknown → correlation can't veto.
        assertEquals("sess-1", hint(hintCaller = null, inviteCaller = "+15557778888"))
        assertEquals("sess-1", hint(hintCaller = "+14155550100", inviteCaller = null))
        assertEquals("sess-1", hint(hintCaller = "+14155550100", inviteCaller = ""))
    }

    // --------------------------------------------------------------- isStale

    @Test
    fun `only definite verdicts cancel a ring`() {
        assertTrue(StaleRingPolicy.isStale(RingProbe.ANSWERED))
        assertTrue(StaleRingPolicy.isStale(RingProbe.GONE))
        assertTrue(StaleRingPolicy.isStale(RingProbe.ENDED))
        assertFalse(StaleRingPolicy.isStale(RingProbe.RINGING))
        assertFalse(StaleRingPolicy.isStale(RingProbe.UNKNOWN))
    }

    // ------------------------------------------------------ probeFromCallRow

    @Test
    fun `a written outcome means the call is over`() {
        assertEquals(RingProbe.ENDED, StaleRingPolicy.probeFromCallRow("voicemail", null))
        assertEquals(RingProbe.ENDED, StaleRingPolicy.probeFromCallRow("missed", null))
        assertEquals(
            RingProbe.ENDED,
            StaleRingPolicy.probeFromCallRow("answered", "user-1"),
        )
    }

    @Test
    fun `answered-by without an outcome is a live answered call`() {
        assertEquals(RingProbe.ANSWERED, StaleRingPolicy.probeFromCallRow(null, "user-1"))
    }

    @Test
    fun `no outcome and nobody answered - still ringing (voicemail-recording ambiguity rings)`() {
        // While voicemail is STILL RECORDING the row looks exactly like a
        // ringing call (outcome null, answered_by null) — the honest verdict
        // is RINGING; the server-side leg CANCEL (#168 B-server) owns that
        // window.
        assertEquals(RingProbe.RINGING, StaleRingPolicy.probeFromCallRow(null, null))
    }

    // ------------------------------------------------ callerHintFromPushBody

    @Test
    fun `a number-shaped push body is a caller hint - prose is not`() {
        assertEquals("+14155550100", StaleRingPolicy.callerHintFromPushBody("+14155550100"))
        assertEquals(
            "(415) 555-0100",
            StaleRingPolicy.callerHintFromPushBody("(415) 555-0100"),
        )
        assertNull(
            StaleRingPolicy.callerHintFromPushBody("Someone is calling your business number"),
        )
        assertNull(StaleRingPolicy.callerHintFromPushBody(null))
        assertNull(StaleRingPolicy.callerHintFromPushBody(""))
        assertNull(StaleRingPolicy.callerHintFromPushBody("call me maybe 555"))
    }
}
