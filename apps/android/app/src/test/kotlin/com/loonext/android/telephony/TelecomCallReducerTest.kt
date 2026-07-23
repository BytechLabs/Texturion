package com.loonext.android.telephony

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The pure safety net for the Jetpack Telecom rearchitecture
 * (docs/CALLS-CLIENT-V2.md §11.1). The platform shell [TelecomCallRegistry] is
 * device-only; every DECISION it executes is pinned here on the JVM.
 */
class TelecomCallReducerTest {

    // ------------------------------------------------ §3.2 header correlation

    @Test
    fun `header keys the session regardless of caller or time`() {
        val correlation = TelecomCallReducer.correlateInvite(
            customHeaders = listOf("X-Loonext-Session" to "S1", "X-Other" to "junk"),
            legId = "leg-abc",
        )
        assertEquals(TelecomCallReducer.Correlation.Header("S1"), correlation)
    }

    @Test
    fun `header name matching is case-insensitive`() {
        val correlation = TelecomCallReducer.correlateInvite(
            listOf("x-loonext-session" to "S9"), legId = null,
        )
        assertEquals(TelecomCallReducer.Correlation.Header("S9"), correlation)
    }

    @Test
    fun `two anonymous callers on two numbers bind to their OWN sessions — no cross-wire`() {
        // The multi-number cross-wire the first review found is impossible: the
        // header, not the caller, is the whole correlation.
        val a = TelecomCallReducer.correlateInvite(listOf("X-Loonext-Session" to "S-A"), "leg-a")
        val b = TelecomCallReducer.correlateInvite(listOf("X-Loonext-Session" to "S-B"), "leg-b")
        assertEquals(TelecomCallReducer.Correlation.Header("S-A"), a)
        assertEquals(TelecomCallReducer.Correlation.Header("S-B"), b)
    }

    @Test
    fun `missing header falls back to by-leg — never a caller guess`() {
        val correlation = TelecomCallReducer.correlateInvite(
            customHeaders = emptyList(), legId = "leg-xyz",
        )
        assertEquals(TelecomCallReducer.Correlation.ByLeg("leg-xyz"), correlation)
    }

    @Test
    fun `no header and no leg id is uncorrelatable — honest teardown, no present`() {
        val correlation = TelecomCallReducer.correlateInvite(emptyList(), legId = null)
        assertEquals(TelecomCallReducer.Correlation.Uncorrelatable, correlation)
        // A blank header value is not a session either.
        assertEquals(
            TelecomCallReducer.Correlation.Uncorrelatable,
            TelecomCallReducer.correlateInvite(listOf("X-Loonext-Session" to "  "), null),
        )
    }

    // --------------------------------------------------- §3 idempotent ensure

    @Test
    fun `ensureCall is idempotent — push then INVITE is ONE call`() {
        val registered = mutableSetOf<String>()
        // FCM push arrives first.
        assertTrue(TelecomCallReducer.shouldAddCall(registered, "S"))
        registered += "S"
        // The header-matched INVITE for the same S reuses the handle.
        assertFalse(TelecomCallReducer.shouldAddCall(registered, "S"))
        // A duplicate push is a no-op too.
        assertFalse(TelecomCallReducer.shouldAddCall(registered, "S"))
        // A different session is its own call.
        assertTrue(TelecomCallReducer.shouldAddCall(registered, "S2"))
    }

    @Test
    fun `one ring-me in flight per session`() {
        assertTrue(TelecomCallReducer.shouldRingMe(emptySet(), emptySet(), "S"))
        assertFalse(TelecomCallReducer.shouldRingMe(setOf("S"), emptySet(), "S"))
        assertFalse(TelecomCallReducer.shouldRingMe(emptySet(), setOf("S"), "S"))
    }

    // ------------------------------------------------ §3.3 connect-on-answer

    @Test
    fun `onAnswer issues the OS ANSWER transition FIRST, never setActive (BLOCKING-1)`() {
        // A RINGING inbound call is answered with answer(callType); setActive on a
        // ringing call returns CallControlResult.Error and never transitions the
        // OS call to answered. So the FIRST action is ANSWER, not SET_ACTIVE.
        assertEquals(
            TelecomCallReducer.AnswerAction.ANSWER,
            TelecomCallReducer.onAnswer(legBound = false).first(),
        )
        assertEquals(
            TelecomCallReducer.AnswerAction.ANSWER,
            TelecomCallReducer.onAnswer(legBound = true).first(),
        )
        // The old, wrong SET_ACTIVE answer path is gone entirely.
        assertFalse(
            TelecomCallReducer.AnswerAction.entries.any { it.name == "SET_ACTIVE" },
        )
    }

    @Test
    fun `onAnswer with leg bound answers then accepts immediately`() {
        assertEquals(
            listOf(
                TelecomCallReducer.AnswerAction.ANSWER,
                TelecomCallReducer.AnswerAction.ACCEPT_LEG,
            ),
            TelecomCallReducer.onAnswer(legBound = true),
        )
    }

    @Test
    fun `onAnswer with only the push arrived answers, stays muted-until-bound, arms the deadline`() {
        assertEquals(
            listOf(
                TelecomCallReducer.AnswerAction.ANSWER,
                TelecomCallReducer.AnswerAction.ARM_DEADLINE,
            ),
            TelecomCallReducer.onAnswer(legBound = false),
        )
    }

    @Test
    fun `the onAnswer-race catch-up re-runs the full onAnswer — the ANSWER is never lost (I3)`() {
        // The registry catch-up (scope became available after onAnswer fired)
        // re-runs onAnswer(legBound); it MUST include ANSWER, not only ACCEPT_LEG,
        // so the OS answer transition survives the race.
        assertTrue(
            TelecomCallReducer.AnswerAction.ANSWER in TelecomCallReducer.onAnswer(legBound = true),
        )
        assertTrue(
            TelecomCallReducer.AnswerAction.ANSWER in TelecomCallReducer.onAnswer(legBound = false),
        )
    }

    @Test
    fun `the header-matched leg binds after answer — accept on the pending answer`() {
        assertEquals(
            listOf(TelecomCallReducer.AnswerAction.ACCEPT_LEG),
            TelecomCallReducer.onLegBound(answerRequested = true, accepted = false, terminated = false),
        )
        // A leg that binds with no answer requested is a plain ring — no accept.
        assertTrue(
            TelecomCallReducer.onLegBound(answerRequested = false, accepted = false, terminated = false).isEmpty(),
        )
        // A bind after the leg is already accepted (sibling / ring-me re-dial) is
        // an idempotent no-op — never a double-accept.
        assertTrue(
            TelecomCallReducer.onLegBound(answerRequested = true, accepted = true, terminated = false).isEmpty(),
        )
    }

    @Test
    fun `a leg that binds AFTER the OS answer already issued is still accepted (I3 dead-air fix)`() {
        // The regression: the accept gate must NOT depend on whether the OS
        // answer() transition has fired. The user answered from the lock screen
        // (answerRequested), the OS answer went out, and only THEN did the Telnyx
        // leg bind. If the bind doesn't accept the leg, media never connects and
        // the answered call sits in permanent one-way dead air. `answered` is
        // therefore irrelevant to onLegBound — only answerRequested && !accepted.
        assertEquals(
            listOf(TelecomCallReducer.AnswerAction.ACCEPT_LEG),
            TelecomCallReducer.onLegBound(answerRequested = true, accepted = false, terminated = false),
        )
    }

    @Test
    fun `a leg that binds AFTER teardown is NEVER accepted — durable answerRequested cannot resurrect a dead call`() {
        // BLOCKING re-review finding: answerRequested never clears, so a leg that
        // binds after the bind-deadline / reject / remote-hangup tore the call down
        // (terminated=true, but the entry is still resolvable until the suspend
        // addCall returns) must NOT accept — else Telnyx media connects onto a dead
        // OS call (silent one-way air) after declineMine already handed the answer
        // to a teammate (a double-answer / cross-wire). terminated vetoes the accept.
        assertTrue(
            TelecomCallReducer.onLegBound(answerRequested = true, accepted = false, terminated = true).isEmpty(),
        )
    }

    @Test
    fun `the addCall block reconcile disconnects a terminated call and NEVER answers it (HIGH dead-air fix)`() {
        // A teardown that raced ahead of the scope (terminated=true) MUST take the
        // scope's one reconciliation slot to DISCONNECT — even when the user also
        // answered (answerRequested). Answering here would strand the OS call
        // permanently answered with no media (terminated vetoes the accept) and no
        // backstop left to end it (they all no-op on terminated) — dead air.
        assertEquals(
            TelecomCallReducer.ScopeReconcile.DISCONNECT,
            TelecomCallReducer.reconcileOnScope(terminated = true, answerRequested = true, answered = false),
        )
        // Terminated wins even if the OS answer had already been issued.
        assertEquals(
            TelecomCallReducer.ScopeReconcile.DISCONNECT,
            TelecomCallReducer.reconcileOnScope(terminated = true, answerRequested = true, answered = true),
        )
        // Not terminated + answer owed → answer (the I3 catch-up).
        assertEquals(
            TelecomCallReducer.ScopeReconcile.ANSWER,
            TelecomCallReducer.reconcileOnScope(terminated = false, answerRequested = true, answered = false),
        )
        // Not terminated, answer already issued → nothing (a re-entrant block).
        assertEquals(
            TelecomCallReducer.ScopeReconcile.NONE,
            TelecomCallReducer.reconcileOnScope(terminated = false, answerRequested = true, answered = true),
        )
        // Not terminated, never answered → a plain ring, nothing to reconcile.
        assertEquals(
            TelecomCallReducer.ScopeReconcile.NONE,
            TelecomCallReducer.reconcileOnScope(terminated = false, answerRequested = false, answered = false),
        )
    }

    @Test
    fun `the addCall block catch-up owes the OS answer only while unissued (I3)`() {
        // Requested + not yet issued → the block must issue answer() now.
        assertTrue(TelecomCallReducer.shouldAnswerOnCatchUp(answerRequested = true, answered = false))
        // Already issued → never re-issue (answer() on an answered call is Error).
        assertTrue(!TelecomCallReducer.shouldAnswerOnCatchUp(answerRequested = true, answered = true))
        // Never answered → nothing owed (a plain ring the user hasn't touched).
        assertTrue(!TelecomCallReducer.shouldAnswerOnCatchUp(answerRequested = false, answered = false))
    }

    // NOTE: the multi-leg session live-set logic (owner re-home + last-leg
    // teardown) lives in TelecomCallRegistry.setLiveLegs — it operates on the
    // per-entry lock and the CallEntry flags, so it is exercised on-device, not
    // here. The pure reducer no longer owns a re-home verdict.

    @Test
    fun `bind deadline with no accept and not terminated tears down — no dead air`() {
        assertTrue(TelecomCallReducer.deadlineDisconnects(accepted = false, terminated = false))
    }

    @Test
    fun `a late bind deadline never overrides a real connection`() {
        // The leg accepted before the timer fired — a connected call is NEVER
        // dropped by the deadline (the platform makes this decision atomically with
        // the accept commit; the policy itself is pinned here). MEDIUM re-review.
        assertTrue(!TelecomCallReducer.deadlineDisconnects(accepted = true, terminated = false))
        // Already terminated → the deadline never double-terminates.
        assertTrue(!TelecomCallReducer.deadlineDisconnects(accepted = false, terminated = true))
    }

    // ------------------------------------- #208 C2 disconnect-delivery policy

    @Test
    fun `a failed OS disconnect delivery retries once, then force-completes locally`() {
        // The pre-fix behavior was report-only: terminated was already latched,
        // every backstop stood down, and cleanup (which only runs when the
        // suspend addCall returns) never ran - the entry and its OS call leaked
        // for the process lifetime. One retry, then the local force-complete.
        assertEquals(
            TelecomCallReducer.DisconnectDeliveryStep.RETRY,
            TelecomCallReducer.onDisconnectDeliveryFailed(failedAttempts = 1),
        )
        assertEquals(
            TelecomCallReducer.DisconnectDeliveryStep.FORCE_COMPLETE,
            TelecomCallReducer.onDisconnectDeliveryFailed(failedAttempts = 2),
        )
        // Defensive: any later failure count also force-completes (never loops).
        assertEquals(
            TelecomCallReducer.DisconnectDeliveryStep.FORCE_COMPLETE,
            TelecomCallReducer.onDisconnectDeliveryFailed(failedAttempts = 3),
        )
        // One initial try plus exactly one retry.
        assertEquals(2, TelecomCallReducer.DISCONNECT_DELIVERY_MAX_ATTEMPTS)
    }

    @Test
    fun `force-completing a wedged ghost re-opens its key - the next inbound proceeds`() {
        // The C2 ghost: a terminated entry whose disconnect never delivered
        // stayed in the registry map forever, so shouldAddCall refused any
        // fresh presentation keyed on its session, and the leaked entry could
        // poison a refused addCall's declineForTeardown into a device-global
        // decline-mine (instant voicemail in a solo-reachable workspace).
        // Force-complete REMOVES the entry, and removal is exactly what
        // re-opens the key for the next call.
        assertFalse(TelecomCallReducer.shouldAddCall(setOf("S-ghost"), "S-ghost"))
        assertTrue(TelecomCallReducer.shouldAddCall(emptySet(), "S-ghost"))
    }

    // ----------------------------------------------------- §3.4 ring-me retry

    @Test
    fun `ring-me dials first, retries bounded, then stops`() {
        assertEquals(TelecomCallReducer.RingMeStep.DIAL, TelecomCallReducer.ringMeStep(0, retryable = true))
        assertEquals(TelecomCallReducer.RingMeStep.RETRY, TelecomCallReducer.ringMeStep(1, retryable = true))
        assertEquals(TelecomCallReducer.RingMeStep.RETRY, TelecomCallReducer.ringMeStep(2, retryable = true))
        // RING_ME_MAX_ATTEMPTS = 3 → the 3rd attempt is the last; no 4th.
        assertEquals(TelecomCallReducer.RingMeStep.STOP, TelecomCallReducer.ringMeStep(3, retryable = true))
    }

    @Test
    fun `a non-retryable ring-me result stops immediately`() {
        assertEquals(TelecomCallReducer.RingMeStep.STOP, TelecomCallReducer.ringMeStep(1, retryable = false))
    }

    // --------------------------------------- §7/§8 leg → scope mirror (both dirs)

    @Test
    fun `inbound and outbound share ONE leg to scope mirror table`() {
        // DIALING/RINGING/HELD/DONE/ERROR are direction- and history-agnostic.
        for (outbound in listOf(false, true)) {
            assertEquals(
                TelecomCallReducer.ScopeAction.NONE,
                TelecomCallReducer.mapLegState(TelecomCallReducer.LegState.DIALING, outbound, null),
            )
            assertEquals(
                TelecomCallReducer.ScopeAction.NONE,
                TelecomCallReducer.mapLegState(TelecomCallReducer.LegState.RINGING, outbound, null),
            )
            assertEquals(
                TelecomCallReducer.ScopeAction.SET_INACTIVE,
                TelecomCallReducer.mapLegState(TelecomCallReducer.LegState.HELD, outbound, null),
            )
            assertEquals(
                TelecomCallReducer.ScopeAction.DISCONNECT_LOCAL,
                TelecomCallReducer.mapLegState(TelecomCallReducer.LegState.DONE_LOCAL, outbound, null),
            )
            assertEquals(
                TelecomCallReducer.ScopeAction.DISCONNECT_REMOTE,
                TelecomCallReducer.mapLegState(TelecomCallReducer.LegState.DONE_REMOTE, outbound, null),
            )
            assertEquals(
                TelecomCallReducer.ScopeAction.DISCONNECT_ERROR,
                TelecomCallReducer.mapLegState(TelecomCallReducer.LegState.ERROR, outbound, null),
            )
        }
    }

    @Test
    fun `ACTIVE distinguishes inbound-initial-answer from resume-from-hold and outbound (BLOCKING-1)`() {
        // Outbound ACTIVE → SET_ACTIVE (remote answered our dial; no framework onAnswer).
        assertEquals(
            TelecomCallReducer.ScopeAction.SET_ACTIVE,
            TelecomCallReducer.mapLegState(TelecomCallReducer.LegState.ACTIVE, outbound = true, lastAction = null),
        )
        // Inbound INITIAL answer → NONE: the OS answer transition already happened
        // via onAnswer→answer(callType); the leg reaching ACTIVE only confirms media.
        // A SET_ACTIVE here would be a RINGING→setActive (Error) / redundant reactivation.
        assertEquals(
            TelecomCallReducer.ScopeAction.NONE,
            TelecomCallReducer.mapLegState(TelecomCallReducer.LegState.ACTIVE, outbound = false, lastAction = null),
        )
        // Inbound RESUME-from-hold (last drove SET_INACTIVE) → SET_ACTIVE.
        assertEquals(
            TelecomCallReducer.ScopeAction.SET_ACTIVE,
            TelecomCallReducer.mapLegState(
                TelecomCallReducer.LegState.ACTIVE,
                outbound = false,
                lastAction = TelecomCallReducer.ScopeAction.SET_INACTIVE,
            ),
        )
    }

    // ------------------------------------- BLOCKING-2b sibling-leg ownership

    @Test
    fun `a sibling leg for a shared session may NOT drive the owner's entry (BLOCKING-2b)`() {
        // Two INVITEs share session S: leg A owns the OS call. A server-cancelled
        // sibling leg B going terminal must NOT be allowed to drive (disconnect)
        // the entry — that would tear the shared OS call down under the live leg A.
        assertFalse(TelecomCallReducer.legMayDrive(owningLegId = "A", legId = "B"))
        // The owning leg drives it (its own terminal state is authoritative).
        assertTrue(TelecomCallReducer.legMayDrive(owningLegId = "A", legId = "A"))
        // An as-yet-unowned entry (first leg to bind) may drive.
        assertTrue(TelecomCallReducer.legMayDrive(owningLegId = null, legId = "A"))
    }

    // ------------------------------------------- IMPORTANT-4 scoped reject

    @Test
    fun `a reject with more than one ring presented is scoped to the session, not decline-mine`() {
        // One lone ring → the universal member-scoped decline-mine (robust even
        // with no session).
        assertEquals(
            TelecomCallReducer.RejectScope.MINE,
            TelecomCallReducer.rejectScope(otherRingsPresented = 0),
        )
        // Another ring is live → scope to THIS session so rejecting one doesn't
        // decline both.
        assertEquals(
            TelecomCallReducer.RejectScope.SESSION,
            TelecomCallReducer.rejectScope(otherRingsPresented = 1),
        )
        assertEquals(
            TelecomCallReducer.RejectScope.SESSION,
            TelecomCallReducer.rejectScope(otherRingsPresented = 2),
        )
    }

    // ------------------------------------------ IMPORTANT-5 ring-window backstop

    @Test
    fun `a push-registered ring whose leg never binds is torn down at the ring window`() {
        // Leg never bound, never accepted, not already terminated → disconnect.
        assertTrue(
            TelecomCallReducer.shouldRingWindowDisconnect(legBound = false, accepted = false, terminated = false),
        )
        // A bound leg cancels the backstop (real INVITE arrived).
        assertFalse(
            TelecomCallReducer.shouldRingWindowDisconnect(legBound = true, accepted = false, terminated = false),
        )
        // An accepted call is live — never disconnect it.
        assertFalse(
            TelecomCallReducer.shouldRingWindowDisconnect(legBound = false, accepted = true, terminated = false),
        )
        // Already terminated → no double teardown.
        assertFalse(
            TelecomCallReducer.shouldRingWindowDisconnect(legBound = false, accepted = false, terminated = true),
        )
    }

    @Test
    fun `the tuned constants are sane bounds`() {
        assertEquals(3, TelecomCallReducer.RING_ME_MAX_ATTEMPTS)
        // The bind deadline is well inside the 45s ring window (§3.3).
        assertTrue(TelecomCallReducer.ANSWER_BIND_DEADLINE_MS in 5_000..45_000)
        assertEquals("X-Loonext-Session", TelecomCallReducer.HEADER_NAME)
        // The ghost-ring backstop tracks the server ring window.
        assertEquals(45_000L, TelecomCallReducer.RING_WINDOW_MS)
    }
}
