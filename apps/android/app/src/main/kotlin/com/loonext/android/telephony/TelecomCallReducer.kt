package com.loonext.android.telephony

/**
 * The pure decision half of the Jetpack Telecom rearchitecture
 * (docs/CALLS-CLIENT-V2.md §3-§8). Free of Android / `androidx.core.telecom`
 * imports so every rule unit-tests on the JVM — the platform shell
 * ([TelecomCallRegistry]) stays a thin executor of these verdicts, exactly the
 * way [SoftphoneCore]/[CallWakePolicy] keep the platform classes testable.
 *
 * Everything the founder's "this isn't even possible" rests on is decided
 * here: deterministic session correlation (§3.2 — the `X-Loonext-Session`
 * header, never a caller/time heuristic), idempotent one-call-per-session
 * (§3), the onAnswer 5-second strategy (§3.3), the bounded ring-me retry
 * (§3.4), and the inbound+outbound leg→scope mirror (§7/§8).
 */
object TelecomCallReducer {
    /** The custom SIP header the server stamps on every member ring dial
     *  (initial fan-out AND ring-me re-dial). `X-` prefix is MANDATORY —
     *  Telnyx WebRTC only forwards custom headers whose name starts with `X-`. */
    const val HEADER_NAME = "X-Loonext-Session"

    /**
     * §3.3: the single tunable bind deadline. `onAnswer` holds the OS call
     * (setActive) immediately and binds media async; if the Telnyx leg never
     * accepts within this budget the OS call is disconnected with an honest
     * cause rather than parked in dead air. ~10s per §3.3 (raise toward — never
     * to — the 45s ring window only if the measured cold-wake P99 demands it;
     * the value must not be hardcoded past what the §11 device ladder validates).
     */
    const val ANSWER_BIND_DEADLINE_MS = 10_000L

    /** §3.4/B3: a ring-me that throws or returns a retryable `rang:false` is
     *  retried with backoff, bounded to this many attempts within the ring
     *  window. Bounds the CALLS-V3 §10.2 retry licence. */
    const val RING_ME_MAX_ATTEMPTS = 3

    /** §3.2 fallback: the by-leg resolve budget (matches the client's existing
     *  by-leg backoff). Past it, an uncorrelatable leg is honestly torn down —
     *  never a caller guess, never a mystery OS call. */
    const val LEG_RESOLVE_DEADLINE_MS = 4_000L

    /**
     * §5 ghost-ring backstop. A push-registered OS call (FCM wake, pre-INVITE)
     * whose Telnyx leg never binds within the ring window is torn down honestly
     * by a client-side timer — so the no-ghost-ring guarantee has NO external
     * dependency on the server `call_end` push arriving. ~45s (the server ring
     * window); a leg that binds/accepts cancels it.
     */
    const val RING_WINDOW_MS = 45_000L

    // ---------------------------------------------------------- §3.2 correlate

    /** How an inbound INVITE was correlated to its authoritative server session. */
    sealed interface Correlation {
        /** The deterministic path: `X-Loonext-Session` was present on the leg. */
        data class Header(val session: String) : Correlation

        /** Header absent (older server / stripped) — resolve server-side by the
         *  leg id (`GET /v1/calls/live/by-leg/:legId`). NEVER a caller guess. */
        data class ByLeg(val legId: String) : Correlation

        /** No header and no leg id to resolve → honest teardown (end the leg;
         *  do not present a mystery call, do not answer an unknown session). */
        data object Uncorrelatable : Correlation
    }

    /**
     * Read the session off the INVITE's custom SIP headers, deterministically
     * (§3.2). The header MATCH is the whole correlation — caller/time is never
     * consulted, so two anonymous callers hitting two numbers inside any window
     * bind to their OWN sessions (the multi-number cross-wire is impossible).
     * Header absent → by-leg fallback; no leg id either → uncorrelatable.
     */
    fun correlateInvite(customHeaders: List<Pair<String, String>>, legId: String?): Correlation {
        val session = customHeaders
            .firstOrNull { it.first.equals(HEADER_NAME, ignoreCase = true) }
            ?.second
            ?.takeIf { it.isNotBlank() }
        return when {
            session != null -> Correlation.Header(session)
            !legId.isNullOrBlank() -> Correlation.ByLeg(legId)
            else -> Correlation.Uncorrelatable
        }
    }

    // ------------------------------------------------------- §3 idempotency

    /**
     * The one-call-per-`call_session_id` invariant (§3): `ensureCall(S)` is a
     * compare-and-set. The first trigger (FCM push OR INVITE) registers; every
     * later trigger for the same S — the INVITE after the push, a duplicate
     * push, the pure foreground INVITE — reuses the handle. Returns true only
     * when a fresh `addCall` must be issued.
     */
    fun shouldAddCall(registered: Set<String>, session: String): Boolean =
        session.isNotBlank() && session !in registered

    /** One ring-me in flight per session before an INVITE binds (§5). */
    fun shouldRingMe(ringMeInFlight: Set<String>, invited: Set<String>, session: String): Boolean =
        session.isNotBlank() && session !in ringMeInFlight && session !in invited

    // -------------------------------------------------- §3.3 onAnswer strategy

    /** The ordered actions [TelecomCallRegistry] executes for a callback. */
    enum class AnswerAction {
        /**
         * The OS answer transition — `CallControlScope.answer(callType)` on a
         * RINGING inbound call, the FIRST thing onAnswer does (BLOCKING-1). This
         * is DISTINCT from a resume-from-hold `setActive()`: the framework
         * `androidx.core.telecom` state machine REQUIRES `answer()` to move a
         * ringing call to active — `setActive()` on a RINGING call returns
         * `CallControlResult.Error` and the OS call never transitions to
         * answered. A failed `answer()` escalates to honest teardown (I1).
         */
        ANSWER,

        /** Arm the [ANSWER_BIND_DEADLINE_MS] timer (leg not bound yet). */
        ARM_DEADLINE,

        /** Accept the Telnyx leg + unmute (the leg is bound). */
        ACCEPT_LEG,
    }

    /**
     * §3.3 committed strategy — `onAnswer` fires (the OS/remote surface answered
     * this RINGING inbound call). The OS answer transition (`answer(callType)`)
     * FIRST, unconditionally, well inside the 5s budget; then either accept the
     * already-bound leg, or stay muted-until-bound and arm the deadline. NEVER
     * blocks on the leg binding. `answer()` — never `setActive()` — because the
     * call is RINGING, not held (BLOCKING-1).
     */
    fun onAnswer(legBound: Boolean): List<AnswerAction> =
        if (legBound) {
            listOf(AnswerAction.ANSWER, AnswerAction.ACCEPT_LEG)
        } else {
            listOf(AnswerAction.ANSWER, AnswerAction.ARM_DEADLINE)
        }

    /**
     * §5 ghost-ring backstop verdict (IMPORTANT-5): a push-registered OS call
     * whose leg never bound and was never accepted, and isn't already being
     * torn down, must be disconnected when the ring window elapses.
     */
    fun shouldRingWindowDisconnect(legBound: Boolean, accepted: Boolean, terminated: Boolean): Boolean =
        !legBound && !accepted && !terminated

    /** How to scope a reject of an un-accepted OS call (IMPORTANT-4). */
    enum class RejectScope { SESSION, MINE }

    /**
     * IMPORTANT-4: member-scoped `declineMine` drops THIS device from EVERY
     * ringing session — so with more than one ring presented, rejecting ONE
     * would decline them ALL. Scope the reject to the rejected SESSION when
     * another ring is live; otherwise the universal `declineMine` (robust even
     * with no session at all) is correct for the lone ring.
     */
    fun rejectScope(otherRingsPresented: Int): RejectScope =
        if (otherRingsPresented > 0) RejectScope.SESSION else RejectScope.MINE

    /**
     * BLOCKING-2b: whether a leg's state change may drive the OS call keyed on a
     * (possibly shared) session. Only the OWNING leg may — or an as-yet-unowned
     * entry (first leg to bind). A reaped SIBLING leg for the same session must
     * NEVER drive, least of all tear down, the entry the answered leg owns.
     */
    fun legMayDrive(owningLegId: String?, legId: String): Boolean =
        owningLegId == null || owningLegId == legId

    /**
     * The header-matched leg bound after `onAnswer` already ran. Accept the leg
     * iff the user has answered ([answerRequested]), it isn't accepted yet, and
     * the OS call has NOT been torn down ([terminated]). [answerRequested] is a
     * durable fact that does NOT depend on whether the OS `answer()` transition
     * has already been issued — gating the accept on a transient "answer-issued"
     * latch stranded a call whose leg bound AFTER the OS answer in permanent dead
     * air (the I3 race). But because [answerRequested] never clears, [terminated]
     * MUST veto: a leg that binds after the bind-deadline / reject / remote-hangup
     * tore the call down (the entry is still resolvable until the suspend addCall
     * returns) would otherwise ACCEPT media onto a dead OS call — silent one-way
     * air after `declineMine` already handed the answer to a teammate (a
     * double-answer / cross-wire; BLOCKING re-review finding). Mirrors the
     * [terminated] veto already in [shouldRingWindowDisconnect]. A bind with no
     * answer requested is a plain ring — no accept yet; a bind after accept is a
     * sibling / re-dial — idempotent no-op.
     */
    fun onLegBound(answerRequested: Boolean, accepted: Boolean, terminated: Boolean): List<AnswerAction> =
        if (answerRequested && !accepted && !terminated) listOf(AnswerAction.ACCEPT_LEG) else emptyList()

    /**
     * The addCall block's catch-up (I3): the OS `answer()` transition is owed iff
     * the user answered ([answerRequested]) and it has not yet been issued
     * ([answered]). Distinct from [onLegBound]'s accept gate — answering the OS
     * call and accepting the Telnyx leg are separate transitions that complete at
     * different moments, each idempotent on its own flag.
     */
    fun shouldAnswerOnCatchUp(answerRequested: Boolean, answered: Boolean): Boolean =
        answerRequested && !answered

    /** What the addCall block must reconcile the instant the scope becomes
     *  available (the platform executes this under the per-entry lock). */
    enum class ScopeReconcile { DISCONNECT, ANSWER, NONE }

    /**
     * The addCall block acquired the [CallControlScope] — the ONE moment a
     * scope-dependent op that raced ahead while `scope` was null can finally run.
     * Reconcile in priority order:
     *  - [terminated] FIRST: a teardown fired before the scope existed, so its
     *    disconnect no-op'd (scopeOp needs a scope). Deliver the OS disconnect NOW,
     *    and — critically — do NOT answer: without this a terminated call is
     *    answered into permanent dead air (media is vetoed by terminated, and every
     *    teardown backstop then no-ops on terminated too; HIGH re-review finding).
     *  - else the I3 catch-up: the user answered before the scope existed — issue
     *    the OS answer now.
     *  - else nothing (a plain ring waiting on the user).
     */
    fun reconcileOnScope(terminated: Boolean, answerRequested: Boolean, answered: Boolean): ScopeReconcile =
        when {
            terminated -> ScopeReconcile.DISCONNECT
            shouldAnswerOnCatchUp(answerRequested, answered) -> ScopeReconcile.ANSWER
            else -> ScopeReconcile.NONE
        }

    /**
     * The bind deadline fired: tear the call down ONLY if the leg hasn't accepted
     * and the call isn't already terminated — a late timer must never override a
     * real connection (§3.4/B3), nor double-terminate. The platform applies this
     * verdict UNDER the per-entry lock (claiming `terminated` in the same step) so
     * a racing ACCEPT_LEG can neither connect media into a call this timer is
     * dropping, nor be dropped by a timer after it connected. Pure so the policy
     * is unit-tested; the atomic mechanism lives in the shell.
     */
    fun deadlineDisconnects(accepted: Boolean, terminated: Boolean): Boolean =
        !accepted && !terminated

    // ----------------------------------------------------- §3.4 ring-me retry

    enum class RingMeStep { DIAL, RETRY, STOP }

    /**
     * §3.4/B3 bounded ring-me resilience. A first attempt dials. A throw, or a
     * `rang:false` with a retryable reason and no INVITE in ~4s, retries with
     * backoff — up to [RING_ME_MAX_ATTEMPTS]. Exhausted retries never leave the
     * OS call answerable into dead air (the §3.3 bind deadline still fires).
     */
    fun ringMeStep(attemptsSoFar: Int, retryable: Boolean): RingMeStep = when {
        attemptsSoFar <= 0 -> RingMeStep.DIAL
        retryable && attemptsSoFar < RING_ME_MAX_ATTEMPTS -> RingMeStep.RETRY
        else -> RingMeStep.STOP
    }

    // ---------------------------------------------- §7/§8 leg → scope mirror

    /**
     * The Telnyx leg's reported state, richer than [CallPhase] because the
     * §7 mapping table distinguishes local from remote hangup. The platform
     * derives DONE_LOCAL vs DONE_REMOTE from whether WE initiated teardown.
     */
    enum class LegState { DIALING, RINGING, ACTIVE, HELD, DONE_LOCAL, DONE_REMOTE, ERROR }

    /**
     * Whether a leg state means the leg is GONE — no longer a candidate to own the
     * session's OS call. Used to maintain the per-session live-leg set: two INVITEs
     * can share one `call_session_id` (a duplicate fork / ring-me re-dial), and when
     * the OWNING leg dies while a sibling is still live the OS call must re-home to
     * the survivor rather than tear down (else the user is left with a live ring and
     * no answerable call — HIGH re-review finding).
     */
    fun isTerminal(state: LegState): Boolean = when (state) {
        LegState.DONE_LOCAL, LegState.DONE_REMOTE, LegState.ERROR -> true
        LegState.DIALING, LegState.RINGING, LegState.ACTIVE, LegState.HELD -> false
    }

    /** The `CallControlScope` op the OS call must follow the media with. */
    enum class ScopeAction { NONE, SET_ACTIVE, SET_INACTIVE, DISCONNECT_LOCAL, DISCONNECT_REMOTE, DISCONNECT_ERROR }

    /**
     * The single inbound+outbound leg→scope mirror (§7/§8 table). App→OS: the
     * Telnyx leg changed on its own (remote answered an outbound dial, remote
     * hung up, recovery landed) — the OS UI follows the media. Idempotent under
     * repeated identical snapshots (a no-op is expressed as NONE by the caller
     * comparing to the last action).
     *
     * ACTIVE is the one state that MUST distinguish inbound-initial-answer from
     * resume-from-hold and from an outbound connect (BLOCKING-1):
     *  - outbound ACTIVE → `setActive()` (the remote answered our dial; there is
     *    no framework `onAnswer` for outbound calls).
     *  - inbound ACTIVE after a hold ([lastAction] == SET_INACTIVE) → `setActive()`
     *    (a genuine resume-from-hold).
     *  - inbound INITIAL answer → NONE: the OS answer transition already happened
     *    via the framework `onAnswer` → `answer(callType)`; the leg reaching
     *    ACTIVE only confirms media. Emitting `setActive()` here would fire a
     *    RINGING→setActive (Error) OR a redundant re-activation — never the
     *    correct answer path.
     */
    fun mapLegState(state: LegState, outbound: Boolean, lastAction: ScopeAction?): ScopeAction =
        when (state) {
            LegState.DIALING, LegState.RINGING -> ScopeAction.NONE // registered; no setActive yet
            LegState.ACTIVE -> when {
                outbound -> ScopeAction.SET_ACTIVE
                lastAction == ScopeAction.SET_INACTIVE -> ScopeAction.SET_ACTIVE // resume-from-hold
                else -> ScopeAction.NONE // inbound initial answer already went through answer(callType)
            }
            LegState.HELD -> ScopeAction.SET_INACTIVE
            LegState.DONE_LOCAL -> ScopeAction.DISCONNECT_LOCAL
            LegState.DONE_REMOTE -> ScopeAction.DISCONNECT_REMOTE
            LegState.ERROR -> ScopeAction.DISCONNECT_ERROR
        }
}
