package com.loonext.android.telephony

/**
 * Calls-v3 (#171) — the pure decision half of the dedicated full-screen
 * incoming-call presentation ([com.loonext.android.features.calls.IncomingCallActivity])
 * and the notification-shade actions ([CallActionReceiver]). Kept free of
 * Android imports so every rule unit-tests on the JVM.
 *
 * Three concerns, all pure:
 *  - the present-vs-finish reducer the activity runs on every state emission
 *    (§9/§10: the activity finishes on ANY ringing-exit — answered-elsewhere,
 *    ended, declined, timeout);
 *  - decline session-resolution (which session a Decline POSTs against — the
 *    server decline is a first-class signal, #171 bug 1, not a leg hangup);
 *  - notification-action routing (#171 bug 3: the shade action acts DIRECTLY,
 *    including a decline that must still reach the server when the app process
 *    is dead).
 *
 * A ringing inbound leg carries NO resolved session client-side (a leg's
 * `sessionId` is null until answered — resolved via GET .../by-leg), so the
 * only session proxy during ring is the caller number the wake push carried;
 * every correlation here reuses [CallWakePolicy]'s conservative caller match.
 */
object IncomingCallPresentation {

    /** The maximum a push-immediate ring presents with NO leg ever binding —
     *  the ring window is 45s (calls-v3 §5); one extra second of grace covers
     *  a slow INVITE, then the activity gives up rather than ring forever. */
    const val PRESENT_TIMEOUT_MS = 46_000L

    /** What the full-screen activity should do given the current state. */
    enum class Presentation {
        /** Keep showing the answer/decline surface. */
        PRESENT,

        /** The call was answered (here or via telecom) — hand off to the
         *  in-call UI and finish. */
        ANSWERED,

        /** Any ringing-exit — end/decline/answered-elsewhere/timeout — finish. */
        FINISH,
    }

    /**
     * Present-vs-finish reducer (#171 bugs 2+4). [matchedCallId] is the local
     * ring leg once correlated ([matchLocalRing]); null while the push-immediate
     * ring presents before its INVITE binds. [sessionExited] is a ringing-exit
     * learned out-of-band for this activity's session (a `/state` read, a
     * `call_end` push, or a `call.updated` broadcast) — see
     * [SoftphoneManager.ringingExitSessions]. [timedOut] fires when the
     * pre-INVITE ring outlived [PRESENT_TIMEOUT_MS].
     */
    fun reduce(
        calls: List<CallSnapshot>,
        matchedCallId: String?,
        sessionExited: Boolean,
        timedOut: Boolean = false,
    ): Presentation {
        if (sessionExited) return Presentation.FINISH
        if (matchedCallId == null) {
            // Pre-INVITE window: keep presenting until the leg binds or the
            // session resolves (or we time out waiting for an INVITE that
            // never comes — the call was answered elsewhere before connect).
            return if (timedOut) Presentation.FINISH else Presentation.PRESENT
        }
        val call = calls.firstOrNull { it.id == matchedCallId }
            // The leg we locked onto is gone (the server's BYE) — finish.
            ?: return Presentation.FINISH
        return when (call.phase) {
            CallPhase.RINGING ->
                // §10.1.2: a silenced ring is a ringing-exit the server already
                // decided; stop presenting while the leg awaits its BYE.
                if (call.silenced) Presentation.FINISH else Presentation.PRESENT

            CallPhase.CONNECTING, CallPhase.ACTIVE, CallPhase.HELD -> Presentation.ANSWERED
            CallPhase.ENDED -> Presentation.FINISH
        }
    }

    /**
     * Correlate the activity's ring to a local inbound leg. During ring a leg
     * has no resolved session, so the sole proxy is the caller number: return
     * the ONE ringing inbound whose caller doesn't contradict the push hint.
     * Any ambiguity (two rings, a caller mismatch) → null (stay pre-INVITE;
     * the server BYE / the reducer's timeout are the backstops).
     */
    fun matchLocalRing(calls: List<CallSnapshot>, hintCaller: String?): String? {
        val rings = calls.filter {
            it.phase == CallPhase.RINGING && it.direction == CallDirection.INBOUND && !it.silenced
        }
        val lone = rings.singleOrNull() ?: return null
        if (CallWakePolicy.callerMismatch(hintCaller, lone.peerNumber)) return null
        return lone.id
    }

    /**
     * Which session a Decline POSTs against (#171 bug 1). Precedence:
     *  1. an EXPLICIT session the launching surface carried (the push /
     *     notification / activity always knows it — the most reliable source);
     *  2. the local leg's own resolved session (post-answer only, defensive);
     *  3. the correlated wake-push hint, trusted only while fresh and only when
     *     the caller doesn't contradict it.
     * Null = no server-addressable session (a pure foreground INVITE with no
     * wake hint) — the caller falls back to a local leg teardown alone.
     */
    fun resolveDeclineSession(
        explicitSession: String?,
        call: CallSnapshot?,
        hintSession: String?,
        hintCaller: String?,
        hintAtMs: Long?,
        nowMs: Long,
    ): String? {
        explicitSession?.takeIf { it.isNotBlank() }?.let { return it }
        call?.sessionId?.takeIf { it.isNotBlank() }?.let { return it }
        if (hintSession.isNullOrBlank() || hintAtMs == null) return null
        if (nowMs - hintAtMs > CallWakePolicy.HINT_WINDOW_MS || nowMs < hintAtMs) return null
        if (call != null && CallWakePolicy.callerMismatch(hintCaller, call.peerNumber)) return null
        return hintSession
    }

    /** A notification-shade call action. */
    enum class Action { ANSWER, DECLINE }

    /** How [CallActionReceiver] must execute a shade action (#171 bug 3). */
    enum class Route {
        /** Manager alive + mic already granted → answer the leg directly. */
        ANSWER_DIRECT,

        /** Manager dead, or mic not yet granted → open the full-screen activity
         *  (it wakes the softphone, runs the mic preflight, and answers). Never
         *  the tab shell. */
        ANSWER_VIA_ACTIVITY,

        /** Manager alive → route through [SoftphoneManager.decline] (server
         *  decline + local leg teardown). */
        DECLINE_VIA_MANAGER,

        /** Manager dead → a short-lived path POSTs the server decline from the
         *  session stored in the intent; the leg is the server's to reap. The
         *  decline is NEVER silently dropped. */
        DECLINE_DEAD_PROCESS,
    }

    fun routeNotificationAction(
        action: Action,
        managerAlive: Boolean,
        micGranted: Boolean,
    ): Route = when (action) {
        Action.ANSWER ->
            if (managerAlive && micGranted) Route.ANSWER_DIRECT else Route.ANSWER_VIA_ACTIVITY

        Action.DECLINE ->
            if (managerAlive) Route.DECLINE_VIA_MANAGER else Route.DECLINE_DEAD_PROCESS
    }
}
