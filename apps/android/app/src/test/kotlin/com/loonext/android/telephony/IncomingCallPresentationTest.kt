package com.loonext.android.telephony

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/**
 * #171 pure logic: the present-vs-finish reducer the full-screen
 * IncomingCallActivity runs, decline session-resolution, and notification-
 * action routing (including the dead-process decline). No Android, no device.
 */
class IncomingCallPresentationTest {
    private fun call(
        id: String,
        phase: CallPhase,
        direction: CallDirection = CallDirection.INBOUND,
        number: String = "+15557778888",
        silenced: Boolean = false,
        session: String? = null,
    ) = CallSnapshot(
        id = id,
        direction = direction,
        peerName = "Dana",
        peerNumber = number,
        phase = phase,
        silenced = silenced,
        sessionId = session,
    )

    // --------------------------------------------------------------- reduce

    @Test
    fun `pre-INVITE with no matched leg keeps presenting`() {
        assertEquals(
            IncomingCallPresentation.Presentation.PRESENT,
            IncomingCallPresentation.reduce(emptyList(), matchedCallId = null, sessionExited = false),
        )
    }

    @Test
    fun `pre-INVITE that timed out finishes`() {
        assertEquals(
            IncomingCallPresentation.Presentation.FINISH,
            IncomingCallPresentation.reduce(
                emptyList(), matchedCallId = null, sessionExited = false, timedOut = true,
            ),
        )
    }

    @Test
    fun `a ringing matched leg keeps presenting`() {
        val calls = listOf(call("in-1", CallPhase.RINGING))
        assertEquals(
            IncomingCallPresentation.Presentation.PRESENT,
            IncomingCallPresentation.reduce(calls, matchedCallId = "in-1", sessionExited = false),
        )
    }

    @Test
    fun `a silenced ring finishes - the server already exited ringing`() {
        val calls = listOf(call("in-1", CallPhase.RINGING, silenced = true))
        assertEquals(
            IncomingCallPresentation.Presentation.FINISH,
            IncomingCallPresentation.reduce(calls, matchedCallId = "in-1", sessionExited = false),
        )
    }

    @Test
    fun `an answered leg hands off`() {
        for (phase in listOf(CallPhase.CONNECTING, CallPhase.ACTIVE, CallPhase.HELD)) {
            val calls = listOf(call("in-1", phase))
            assertEquals(
                IncomingCallPresentation.Presentation.ANSWERED,
                IncomingCallPresentation.reduce(calls, matchedCallId = "in-1", sessionExited = false),
            )
        }
    }

    @Test
    fun `an ended matched leg finishes`() {
        val calls = listOf(call("in-1", CallPhase.ENDED))
        assertEquals(
            IncomingCallPresentation.Presentation.FINISH,
            IncomingCallPresentation.reduce(calls, matchedCallId = "in-1", sessionExited = false),
        )
    }

    @Test
    fun `a matched leg that vanished (server BYE) finishes`() {
        assertEquals(
            IncomingCallPresentation.Presentation.FINISH,
            IncomingCallPresentation.reduce(emptyList(), matchedCallId = "in-gone", sessionExited = false),
        )
    }

    @Test
    fun `sessionExited finishes regardless of a live matched leg`() {
        val calls = listOf(call("in-1", CallPhase.RINGING))
        assertEquals(
            IncomingCallPresentation.Presentation.FINISH,
            IncomingCallPresentation.reduce(calls, matchedCallId = "in-1", sessionExited = true),
        )
    }

    // ---------------------------------------------------------- matchLocalRing

    @Test
    fun `matchLocalRing locks onto the sole ringing inbound`() {
        val calls = listOf(call("in-1", CallPhase.RINGING, number = "+15557778888"))
        assertEquals("in-1", IncomingCallPresentation.matchLocalRing(calls, hintCaller = "+15557778888"))
    }

    @Test
    fun `matchLocalRing refuses a caller mismatch`() {
        val calls = listOf(call("in-1", CallPhase.RINGING, number = "+15551110000"))
        assertNull(IncomingCallPresentation.matchLocalRing(calls, hintCaller = "+15557778888"))
    }

    @Test
    fun `matchLocalRing refuses two simultaneous rings (ambiguous)`() {
        val calls = listOf(
            call("in-1", CallPhase.RINGING, number = "+15557778888"),
            call("in-2", CallPhase.RINGING, number = "+15559990000"),
        )
        assertNull(IncomingCallPresentation.matchLocalRing(calls, hintCaller = null))
    }

    @Test
    fun `matchLocalRing ignores outbound, silenced, and non-ringing legs`() {
        val calls = listOf(
            call("out", CallPhase.RINGING, direction = CallDirection.OUTBOUND),
            call("silenced", CallPhase.RINGING, silenced = true),
            call("active", CallPhase.ACTIVE),
            call("in-1", CallPhase.RINGING, number = "+15557778888"),
        )
        assertEquals("in-1", IncomingCallPresentation.matchLocalRing(calls, hintCaller = null))
    }

    // ------------------------------------------------------ resolveDeclineSession

    private val fresh = 1_000_000L

    @Test
    fun `an explicit session wins over everything`() {
        val session = IncomingCallPresentation.resolveDeclineSession(
            explicitSession = "explicit",
            call = call("in-1", CallPhase.RINGING, session = "leg-session"),
            hintSession = "hint",
            hintCaller = "+15557778888",
            hintAtMs = fresh,
            nowMs = fresh,
        )
        assertEquals("explicit", session)
    }

    @Test
    fun `the leg's own resolved session is used when no explicit hint`() {
        val session = IncomingCallPresentation.resolveDeclineSession(
            explicitSession = null,
            call = call("in-1", CallPhase.ACTIVE, session = "leg-session"),
            hintSession = "hint",
            hintCaller = null,
            hintAtMs = fresh,
            nowMs = fresh,
        )
        assertEquals("leg-session", session)
    }

    @Test
    fun `a fresh uncontradicted push hint resolves the session`() {
        val session = IncomingCallPresentation.resolveDeclineSession(
            explicitSession = null,
            call = call("in-1", CallPhase.RINGING, number = "+15557778888"),
            hintSession = "hint",
            hintCaller = "+15557778888",
            hintAtMs = fresh,
            nowMs = fresh + 1_000,
        )
        assertEquals("hint", session)
    }

    @Test
    fun `a stale push hint resolves nothing`() {
        val session = IncomingCallPresentation.resolveDeclineSession(
            explicitSession = null,
            call = null,
            hintSession = "hint",
            hintCaller = null,
            hintAtMs = fresh,
            nowMs = fresh + CallWakePolicy.HINT_WINDOW_MS + 1,
        )
        assertNull(session)
    }

    @Test
    fun `a caller-contradicted push hint resolves nothing`() {
        val session = IncomingCallPresentation.resolveDeclineSession(
            explicitSession = null,
            call = call("in-1", CallPhase.RINGING, number = "+15551110000"),
            hintSession = "hint",
            hintCaller = "+15557778888",
            hintAtMs = fresh,
            nowMs = fresh,
        )
        assertNull(session)
    }

    @Test
    fun `no explicit, no leg session, no hint resolves nothing`() {
        val session = IncomingCallPresentation.resolveDeclineSession(
            explicitSession = null,
            call = call("in-1", CallPhase.RINGING),
            hintSession = null,
            hintCaller = null,
            hintAtMs = null,
            nowMs = fresh,
        )
        assertNull(session)
    }

    // --------------------------------------------------------- answerPhase (R3)

    @Test
    fun `no answer committed is idle`() {
        assertEquals(
            IncomingCallPresentation.AnswerPhase.IDLE,
            IncomingCallPresentation.answerPhase(
                answerCommitted = false, legBound = false, bindTimedOut = false,
            ),
        )
    }

    @Test
    fun `committed and waiting for the leg is connecting`() {
        assertEquals(
            IncomingCallPresentation.AnswerPhase.CONNECTING,
            IncomingCallPresentation.answerPhase(
                answerCommitted = true, legBound = false, bindTimedOut = false,
            ),
        )
    }

    @Test
    fun `committed with a bound leg is connecting - a late timeout cannot override it`() {
        assertEquals(
            IncomingCallPresentation.AnswerPhase.CONNECTING,
            IncomingCallPresentation.answerPhase(
                answerCommitted = true, legBound = true, bindTimedOut = true,
            ),
        )
    }

    @Test
    fun `committed with no bound leg past the window is an honest failure`() {
        assertEquals(
            IncomingCallPresentation.AnswerPhase.FAILED,
            IncomingCallPresentation.answerPhase(
                answerCommitted = true, legBound = false, bindTimedOut = true,
            ),
        )
    }

    // ---------------------------------------------------- routeNotificationAction

    @Test
    fun `answer routes direct when the manager is alive and mic granted`() {
        assertEquals(
            IncomingCallPresentation.Route.ANSWER_DIRECT,
            IncomingCallPresentation.routeNotificationAction(
                IncomingCallPresentation.Action.ANSWER, managerAlive = true, micGranted = true,
            ),
        )
    }

    @Test
    fun `answer routes via the activity when the mic is not yet granted`() {
        assertEquals(
            IncomingCallPresentation.Route.ANSWER_VIA_ACTIVITY,
            IncomingCallPresentation.routeNotificationAction(
                IncomingCallPresentation.Action.ANSWER, managerAlive = true, micGranted = false,
            ),
        )
    }

    @Test
    fun `answer routes via the activity when the process is dead`() {
        assertEquals(
            IncomingCallPresentation.Route.ANSWER_VIA_ACTIVITY,
            IncomingCallPresentation.routeNotificationAction(
                IncomingCallPresentation.Action.ANSWER, managerAlive = false, micGranted = true,
            ),
        )
    }

    @Test
    fun `decline routes through the manager when it is alive`() {
        assertEquals(
            IncomingCallPresentation.Route.DECLINE_VIA_MANAGER,
            IncomingCallPresentation.routeNotificationAction(
                IncomingCallPresentation.Action.DECLINE, managerAlive = true, micGranted = false,
            ),
        )
    }

    @Test
    fun `decline still reaches the server when the process is dead`() {
        assertEquals(
            IncomingCallPresentation.Route.DECLINE_DEAD_PROCESS,
            IncomingCallPresentation.routeNotificationAction(
                IncomingCallPresentation.Action.DECLINE, managerAlive = false, micGranted = false,
            ),
        )
    }
}
