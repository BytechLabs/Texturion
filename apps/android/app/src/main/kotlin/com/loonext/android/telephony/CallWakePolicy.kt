package com.loonext.android.telephony

/**
 * Calls-v3 client protocol (docs/CALLS-V3.md §10) — the pure decision half of
 * push-wake, one-presentation-per-session, and presentation dismissal. Kept
 * free of Android imports so every rule unit-tests on the JVM.
 *
 * The three binding client rules (§10.1):
 *  1. Present from facts: an INVITE presents immediately; the always-200
 *     `GET /v1/calls/live/{session}/state` read and the `call.updated`
 *     realtime event reconcile presentation afterwards. No heuristic probes —
 *     StaleRing is deleted, not repaired.
 *  2. NEVER hang up a leg for staleness. The server cancels stale legs on
 *     every exit from `ringing`; the client's only teardown triggers are the
 *     user (decline/hangup) and SDK/telecom events. When state says a
 *     presenting session isn't `ringing`, the client STOPS PRESENTING
 *     (silence UI) while it waits for the server BYE — it never sends one.
 *  3. ring-me only when holding no live leg — and always with
 *     `no_local_leg:true`: the call itself is the attestation (§6).
 *
 * Plus §10.1.4 (one presentation per session per device): the shared Telnyx
 * credential forks every leg's INVITE to ALL of a member's devices, so a
 * device may receive a second INVITE for a session it already presents. That
 * INVITE is HELD silent — no UI, no ringtone, no signaling — and promoted
 * only if the presented leg dies while the session still rings.
 *
 * The INVITE itself carries no client_state, so the only client-side clue
 * tying a leg to a server session is the `kind:'call'` wake push hint
 * (session + caller + when). Every hint-based decision here is deliberately
 * conservative: a false dismissal silences a real customer call, which is
 * worse than a briefly-stale presentation the server BYE cleans up anyway.
 */
object CallWakePolicy {
    /** A wake-push hint is only trusted this long (ring window is 45s). */
    const val HINT_WINDOW_MS = 90_000L

    /** §10.2: `rang:false, recent_leg` + no INVITE within this → one retry. */
    const val RING_ME_RETRY_MS = 4_000L

    /** The one state that licenses ring-me / promotion (§8.1 vocabulary). */
    const val STATE_RINGING = "ringing"

    /** ring-me 200 body reason that licenses the single §10.2 retry. */
    const val REASON_RECENT_LEG = "recent_leg"

    /**
     * Any non-null state other than `ringing` is a ringing-exit — answered,
     * the voicemail states, and every `ended_*` all dismiss presentation.
     * `null` is "couldn't tell" and never dismisses anything.
     */
    fun isRingingExit(state: String?): Boolean = state != null && state != STATE_RINGING

    /** Comparison digits: the last 10 — "+14155550100" and "(415) 555-0100"
     *  are the same NANP caller despite the country code. */
    fun callerDigits(raw: String?): String? =
        raw?.filter { it.isDigit() }?.takeIf { it.length >= 7 }?.takeLast(10)

    /** Same caller — only when BOTH sides are known and agree. */
    fun sameCaller(a: String?, b: String?): Boolean {
        val da = callerDigits(a)
        val db = callerDigits(b)
        return da != null && db != null && da == db
    }

    /** Provably DIFFERENT callers — both known and disagreeing. Unknown on
     *  either side is never a mismatch (conservatism cuts toward "could be
     *  the same call"). */
    fun callerMismatch(a: String?, b: String?): Boolean {
        val da = callerDigits(a)
        val db = callerDigits(b)
        return da != null && db != null && da != db
    }

    /**
     * The caller hint from a wake push's body — the server puts the raw
     * caller E.164 there when known, a generic sentence otherwise. Only a
     * number-shaped body is a hint; prose is null.
     */
    fun callerHintFromPushBody(body: String?): String? {
        val trimmed = body?.trim().orEmpty()
        if (trimmed.isEmpty()) return null
        val looksLikeNumber = Regex("^\\+?[0-9()\\-.\\s]{7,20}$").matches(trimmed)
        return if (looksLikeNumber) trimmed else null
    }

    /**
     * §10.1.4 — should a fresh inbound INVITE be held silent because this
     * device already presents (or has active/held) a call from the same
     * caller? Caller identity is the only session proxy an INVITE offers;
     * both sides must be known for a match, so an unknown caller always
     * presents (never suppress what can't be proven duplicate).
     */
    fun holdInviteSilent(inboundCallers: List<String?>, inviteCaller: String?): Boolean =
        inboundCallers.any { sameCaller(it, inviteCaller) }

    /**
     * Which session (if any) an INVITE's presentation should reconcile
     * against via `/state`. Mirrors the retired StaleRing hint guards — but
     * the verdict now only ever SILENCES presentation (§10.1.2), never ends
     * a leg:
     *  - no hint, or one older than [HINT_WINDOW_MS] → nothing to reconcile;
     *  - another call already live locally → no reconcile (call waiting: the
     *    hint could name the call I'm ON, and a dismissal would silence the
     *    legitimately-ringing second call);
     *  - caller numbers known on both sides but different → no reconcile.
     */
    fun reconcileSession(
        hintSession: String?,
        hintAtMs: Long?,
        nowMs: Long,
        otherLiveCalls: Int,
        hintCaller: String?,
        inviteCaller: String?,
    ): String? {
        if (hintSession.isNullOrBlank() || hintAtMs == null) return null
        if (nowMs - hintAtMs > HINT_WINDOW_MS || nowMs < hintAtMs) return null
        if (otherLiveCalls > 0) return null
        if (callerMismatch(hintCaller, inviteCaller)) return null
        return hintSession
    }

    /**
     * A ringing-exit landed for [sessionId] (`/state` read, `call.updated`,
     * or a `kind:'call_end'` push) — which locally-RINGING inbound calls stop
     * presenting? Returns call ids to SILENCE (never to end).
     *
     * Two correlation tiers:
     *  - direct: a ringing call that already resolved its own sessionId — a
     *    stored fact, always dismissible;
     *  - hint: the wake-push correlation, applied only in the unambiguous
     *    shape — a fresh hint naming this session, exactly ONE live local
     *    call, and that call a ringing inbound whose caller doesn't
     *    contradict the hint. Any ambiguity (a second live call, a caller
     *    mismatch, an aged hint) dismisses nothing — the server BYE is the
     *    backstop.
     */
    fun dismissalsForRingingExit(
        calls: List<CallSnapshot>,
        sessionId: String,
        hintSession: String?,
        hintAtMs: Long?,
        nowMs: Long,
        hintCaller: String?,
    ): List<String> {
        val direct = calls.filter {
            it.phase == CallPhase.RINGING && it.direction == CallDirection.INBOUND &&
                !it.silenced && it.sessionId == sessionId
        }.map { it.id }
        if (direct.isNotEmpty()) return direct

        if (hintSession != sessionId || hintAtMs == null) return emptyList()
        if (nowMs - hintAtMs > HINT_WINDOW_MS || nowMs < hintAtMs) return emptyList()
        val live = calls.filter { it.phase != CallPhase.ENDED }
        val lone = live.singleOrNull() ?: return emptyList()
        if (lone.phase != CallPhase.RINGING || lone.direction != CallDirection.INBOUND) {
            return emptyList()
        }
        if (lone.silenced) return emptyList()
        if (lone.sessionId != null && lone.sessionId != sessionId) return emptyList()
        if (callerMismatch(hintCaller, lone.peerNumber)) return emptyList()
        return listOf(lone.id)
    }
}
