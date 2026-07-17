package com.loonext.android.telephony

/**
 * #168 part B (client): a late inbound INVITE (frozen socket, slow wake) must
 * not keep ringing for a session that already resolved (voicemail or a
 * teammate answered). The Android SDK's INVITE carries NO client_state and no
 * call_control_id, so the leg can't name its own customer session — the best
 * truthful correlation is the `kind:'call'` wake push (it DOES carry the
 * session, and the same call produces both). This module is the pure decision
 * half; [SoftphoneCore] runs the probe CONCURRENTLY with presentation (the
 * fast path never waits) and cancels the ring only on a definite stale
 * verdict.
 *
 * The probe is deliberately conservative — a false "stale" would silence a
 * real customer call, which is worse than a brief stale ring:
 *  - no session hint, or a hint older than [StaleRingPolicy.HINT_WINDOW_MS]
 *    → no probe, ring normally;
 *  - another call already live locally → no probe (call-waiting: the hint
 *    could name the call I'm ON, and killing the new ring would be wrong);
 *  - caller numbers known on both sides but different → no probe;
 *  - probe timeout / network trouble / ambiguity → ring normally.
 */

/** What the freshness probe learned about the hinted session. */
enum class RingProbe {
    /** Someone (member or voicemail claim) answered — this ring is over. */
    ANSWERED,

    /** The server has no such call. */
    GONE,

    /** The call finished (outcome written). */
    ENDED,

    /** Still ringing server-side. */
    RINGING,

    /** Couldn't tell (timeout, network, ambiguous read) — never cancel. */
    UNKNOWN,
}

object StaleRingPolicy {
    /** A wake-push hint is only trusted this long (ring window is 45s). */
    const val HINT_WINDOW_MS = 90_000L

    /** Best-effort budget for the probe — never holds the ring hostage. */
    const val PROBE_TIMEOUT_MS = 1_500L

    /** The hint session to probe, or null when there is nothing trustworthy. */
    fun usableHint(
        hintSession: String?,
        hintAtMs: Long?,
        nowMs: Long,
        otherLiveCalls: Int,
        hintCaller: String?,
        inviteCaller: String?,
    ): String? {
        if (hintSession.isNullOrBlank() || hintAtMs == null) return null
        if (nowMs - hintAtMs > HINT_WINDOW_MS || nowMs < hintAtMs) return null
        // Call waiting: the hint may name the call I'm already on — a probe
        // would see ANSWERED and kill the legitimately-ringing second call.
        if (otherLiveCalls > 0) return null
        // When both sides know the caller, they must agree.
        val hintDigits = digits(hintCaller)
        val inviteDigits = digits(inviteCaller)
        if (hintDigits != null && inviteDigits != null && hintDigits != inviteDigits) return null
        return hintSession
    }

    /** Only a definite verdict cancels a ring. */
    fun isStale(probe: RingProbe): Boolean = when (probe) {
        RingProbe.ANSWERED, RingProbe.GONE, RingProbe.ENDED -> true
        RingProbe.RINGING, RingProbe.UNKNOWN -> false
    }

    /**
     * Classify a calls-log row for the hinted session (the liveFacts read
     * answers "answered/gone" but is deliberately 'conflict' for BOTH
     * still-ringing and already-ended — the row's outcome disambiguates).
     */
    fun probeFromCallRow(outcome: String?, answeredByUserId: String?): RingProbe = when {
        outcome != null -> RingProbe.ENDED
        answeredByUserId != null -> RingProbe.ANSWERED
        else -> RingProbe.RINGING
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

    /** Comparison digits: the last 10 — "+14155550100" and "(415) 555-0100"
     *  are the same NANP caller despite the country code. */
    private fun digits(raw: String?): String? =
        raw?.filter { it.isDigit() }?.takeIf { it.length >= 7 }?.takeLast(10)
}
