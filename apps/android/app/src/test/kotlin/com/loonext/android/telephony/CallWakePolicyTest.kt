package com.loonext.android.telephony

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The pure calls-v3 §10 client decision layer — every rule that decides
 * present / hold-silent / stop-presenting, free of Android imports. This is
 * the reducer half the retired StaleRing probe used to own; the whole
 * difference is that every verdict here only ever SILENCES a presentation
 * (§10.1.2) — none of them ends a leg.
 */
class CallWakePolicyTest {
    private val now = 1_000_000L

    private fun call(
        id: String,
        phase: CallPhase = CallPhase.RINGING,
        direction: CallDirection = CallDirection.INBOUND,
        number: String = "+15557778888",
        sessionId: String? = null,
        silenced: Boolean = false,
    ) = CallSnapshot(
        id = id,
        direction = direction,
        peerName = "Caller",
        peerNumber = number,
        phase = phase,
        sessionId = sessionId,
        silenced = silenced,
    )

    // ------------------------------------------------------- isRingingExit

    @Test
    fun `only a non-null non-ringing state is a ringing-exit`() {
        assertFalse("null is 'couldn't tell' — never dismisses", CallWakePolicy.isRingingExit(null))
        assertFalse(CallWakePolicy.isRingingExit("ringing"))
        assertTrue(CallWakePolicy.isRingingExit("answered"))
        assertTrue(CallWakePolicy.isRingingExit("voicemail_greeting"))
        assertTrue(CallWakePolicy.isRingingExit("voicemail_recording"))
        assertTrue(CallWakePolicy.isRingingExit("ended_answered"))
        assertTrue(CallWakePolicy.isRingingExit("ended_voicemail"))
        assertTrue(CallWakePolicy.isRingingExit("ended_missed"))
        assertTrue(CallWakePolicy.isRingingExit("ended_rejected"))
    }

    // --------------------------------------------------- caller correlation

    @Test
    fun `caller identity compares the last ten NANP digits`() {
        assertTrue(CallWakePolicy.sameCaller("+14155550100", "(415) 555-0100"))
        assertTrue(CallWakePolicy.sameCaller("14155550100", "4155550100"))
        assertFalse(CallWakePolicy.sameCaller("+14155550100", "+14155550101"))
        // Unknown on either side is never a match AND never a mismatch.
        assertFalse(CallWakePolicy.sameCaller(null, "+14155550100"))
        assertFalse(CallWakePolicy.callerMismatch(null, "+14155550100"))
        assertFalse(CallWakePolicy.callerMismatch("+14155550100", ""))
        assertTrue(CallWakePolicy.callerMismatch("+14155550100", "+14155550101"))
    }

    @Test
    fun `a push body is a caller hint only when it is number-shaped`() {
        assertEquals("+14155550134", CallWakePolicy.callerHintFromPushBody("+14155550134"))
        assertEquals("(415) 555-0134", CallWakePolicy.callerHintFromPushBody("(415) 555-0134"))
        assertNull(CallWakePolicy.callerHintFromPushBody("Someone is calling your business."))
        assertNull(CallWakePolicy.callerHintFromPushBody(null))
        assertNull(CallWakePolicy.callerHintFromPushBody("   "))
    }

    // ---------------------------------------------- holdInviteSilent (§10.1.4)

    @Test
    fun `a second INVITE from a caller already inbound is held silent`() {
        assertTrue(
            CallWakePolicy.holdInviteSilent(listOf("+15557778888"), "+15557778888"),
        )
        // A different caller is a different session — present it.
        assertFalse(CallWakePolicy.holdInviteSilent(listOf("+15557778888"), "+14155550100"))
        // An unknown INVITE caller can't be proven a duplicate — present it.
        assertFalse(CallWakePolicy.holdInviteSilent(listOf("+15557778888"), null))
        assertFalse(CallWakePolicy.holdInviteSilent(emptyList(), "+15557778888"))
    }

    // ------------------------------------------------ reconcileSession guards

    @Test
    fun `reconcileSession returns the session only in the unambiguous shape`() {
        // Happy path: a fresh hint, no other live call, caller agrees.
        assertEquals(
            "sess-1",
            CallWakePolicy.reconcileSession(
                hintSession = "sess-1", hintAtMs = now, nowMs = now,
                otherLiveCalls = 0, hintCaller = "+15557778888", inviteCaller = "+15557778888",
            ),
        )
        // No hint / blank hint.
        assertNull(
            CallWakePolicy.reconcileSession(null, now, now, 0, null, null),
        )
        assertNull(
            CallWakePolicy.reconcileSession("", now, now, 0, null, null),
        )
        // Aged hint (older than the window) / a hint from the future.
        assertNull(
            CallWakePolicy.reconcileSession(
                "sess-1", now - CallWakePolicy.HINT_WINDOW_MS - 1, now, 0, null, null,
            ),
        )
        assertNull(
            CallWakePolicy.reconcileSession("sess-1", now + 1, now, 0, null, null),
        )
        // Another call already live — call waiting: never reconcile.
        assertNull(
            CallWakePolicy.reconcileSession("sess-1", now, now, 1, null, null),
        )
        // Caller known on both sides and different.
        assertNull(
            CallWakePolicy.reconcileSession(
                "sess-1", now, now, 0, "+14155550100", "+15557778888",
            ),
        )
    }

    // -------------------------------- dismissalsForRingingExit (one-per-session)

    @Test
    fun `a direct session match always dismisses that ringing inbound`() {
        val calls = listOf(call("in-1", sessionId = "sess-1"))
        assertEquals(
            listOf("in-1"),
            CallWakePolicy.dismissalsForRingingExit(
                calls = calls, sessionId = "sess-1",
                hintSession = null, hintAtMs = null, nowMs = now, hintCaller = null,
            ),
        )
    }

    @Test
    fun `the hint tier dismisses the lone ringing inbound whose caller agrees`() {
        val calls = listOf(call("in-1")) // sessionId unknown; caller +15557778888
        assertEquals(
            listOf("in-1"),
            CallWakePolicy.dismissalsForRingingExit(
                calls = calls, sessionId = "sess-1",
                hintSession = "sess-1", hintAtMs = now, nowMs = now, hintCaller = "+15557778888",
            ),
        )
    }

    @Test
    fun `ambiguity dismisses nothing - a second live call blocks the hint tier`() {
        val calls = listOf(call("in-1"), call("in-2", number = "+15551110002"))
        assertTrue(
            CallWakePolicy.dismissalsForRingingExit(
                calls = calls, sessionId = "sess-1",
                hintSession = "sess-1", hintAtMs = now, nowMs = now, hintCaller = "+15557778888",
            ).isEmpty(),
        )
    }

    @Test
    fun `a caller mismatch, an aged hint, or the wrong session dismisses nothing`() {
        val calls = listOf(call("in-1")) // caller +15557778888
        // Caller mismatch.
        assertTrue(
            CallWakePolicy.dismissalsForRingingExit(
                calls, "sess-1", "sess-1", now, now, "+14155550100",
            ).isEmpty(),
        )
        // Aged hint.
        assertTrue(
            CallWakePolicy.dismissalsForRingingExit(
                calls, "sess-1", "sess-1", now - CallWakePolicy.HINT_WINDOW_MS - 1, now, "+15557778888",
            ).isEmpty(),
        )
        // The hint names a different session than the one that exited.
        assertTrue(
            CallWakePolicy.dismissalsForRingingExit(
                calls, "sess-1", "sess-2", now, now, "+15557778888",
            ).isEmpty(),
        )
    }

    @Test
    fun `an already-silenced ring is not re-dismissed and a live call is never silenced`() {
        val silenced = listOf(call("in-1", sessionId = "sess-1", silenced = true))
        assertTrue(
            CallWakePolicy.dismissalsForRingingExit(
                silenced, "sess-1", null, null, now, null,
            ).isEmpty(),
        )
        // An ACTIVE call sharing the session is not a ringing presentation.
        val active = listOf(call("in-1", phase = CallPhase.ACTIVE, sessionId = "sess-1"))
        assertTrue(
            CallWakePolicy.dismissalsForRingingExit(
                active, "sess-1", null, null, now, null,
            ).isEmpty(),
        )
    }

    // ------------------------------------------- engaged-leg gate (#195 F3)

    @Test
    fun `only active, held, connecting, or a visible ring counts as engaged`() {
        assertTrue(CallWakePolicy.engagedLeg(call("a", phase = CallPhase.ACTIVE)))
        assertTrue(CallWakePolicy.engagedLeg(call("b", phase = CallPhase.HELD)))
        assertTrue(
            CallWakePolicy.engagedLeg(
                call("c", phase = CallPhase.CONNECTING, direction = CallDirection.OUTBOUND),
            ),
        )
        assertTrue(
            "a non-silenced ring the user can see is engaged",
            CallWakePolicy.engagedLeg(call("d", phase = CallPhase.RINGING)),
        )
        assertFalse(
            "a SILENCED ring is presentation debris — never engaged",
            CallWakePolicy.engagedLeg(call("e", phase = CallPhase.RINGING, silenced = true)),
        )
        assertFalse(CallWakePolicy.engagedLeg(call("f", phase = CallPhase.ENDED)))
    }

    @Test
    fun `anyEngaged ignores a snapshot of nothing but zombies`() {
        assertFalse(CallWakePolicy.anyEngaged(emptyList()))
        assertFalse(
            "silenced zombie + ended chip must not wedge a wake push or recovery",
            CallWakePolicy.anyEngaged(
                listOf(
                    call("z", phase = CallPhase.RINGING, silenced = true),
                    call("gone", phase = CallPhase.ENDED),
                ),
            ),
        )
        assertTrue(
            CallWakePolicy.anyEngaged(
                listOf(
                    call("z", phase = CallPhase.RINGING, silenced = true),
                    call("live", phase = CallPhase.ACTIVE),
                ),
            ),
        )
    }

    // ------------------------------------------------- ring TTL math (#195 F2)

    @Test
    fun `a ring expires only after the TTL, never on a backwards clock`() {
        val t0 = 1_000_000L
        assertFalse(CallWakePolicy.ringExpired(t0, t0))
        assertFalse(CallWakePolicy.ringExpired(t0, t0 + CallWakePolicy.RING_TTL_MS - 1))
        assertTrue(CallWakePolicy.ringExpired(t0, t0 + CallWakePolicy.RING_TTL_MS))
        assertTrue(CallWakePolicy.ringExpired(t0, t0 + CallWakePolicy.RING_TTL_MS + 60_000))
        assertFalse("a clock that moved backwards expires nothing", CallWakePolicy.ringExpired(t0, t0 - 1))
    }

    @Test
    fun `the TTL outlives the server ring window with grace`() {
        // The 45s server window must have fully elapsed before the client
        // reaps — the TTL may never race a legitimately-ringing leg.
        assertTrue(CallWakePolicy.RING_TTL_MS > 45_000L)
    }
}
