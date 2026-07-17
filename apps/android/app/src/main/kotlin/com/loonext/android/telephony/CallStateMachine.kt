package com.loonext.android.telephony

/**
 * #155 softphone state — the pure, SDK-agnostic call model, a Kotlin port of
 * the web's unit-tested reducer (apps/web/src/lib/softphone/state.ts). Kept
 * free of Android and Telnyx imports so the transitions are testable on the
 * JVM without a device, a mic, or the SDK.
 *
 * MULTI-CALL (call waiting): the state holds a small list of calls — at most
 * one ACTIVE (audio flowing), the rest held or ringing. One active call per
 * member (the line model's member side); flip freely between a held call and
 * an incoming one. A ringing inbound call that ends un-answered vanishes
 * silently (another member won the race or the caller gave up — not this
 * member's "Call ended" moment).
 */

enum class SoftphoneStatus { DISCONNECTED, CONNECTING, READY }

enum class CallDirection { INBOUND, OUTBOUND }

/** One call's UI phase. HELD is client-side (SDK hold — far side stays up). */
enum class CallPhase { RINGING, CONNECTING, ACTIVE, HELD, ENDED }

data class CallSnapshot(
    /** The SDK call's id — the state's map key. */
    val id: String,
    val direction: CallDirection,
    /** Resolved display name (contact > CNAM > number) at ring/place time. */
    val peerName: String,
    /** E.164 (or raw dialed digits) — empty for anonymous callers. */
    val peerNumber: String,
    val phase: CallPhase,
    val muted: Boolean = false,
    /**
     * The CUSTOMER call_session_id once known — the server-side handle every
     * live-call op (transfer, notes link, ring-me) uses. For an answered
     * INBOUND call the SDK leg is the RING leg, so this arrives only after
     * GET /v1/calls/live/by-leg/{ccid} resolves; outbound legs carry it
     * directly (the SDK leg IS the customer leg).
     */
    val sessionId: String? = null,
    /** Epoch ms this call first went active — the live timer's anchor. */
    val activeSinceMs: Long? = null,
    /**
     * Presentation dismissed (calls-v3 §10.1.2): a state read / `call.updated`
     * / `call_end` push said this ringing session exited `ringing`, so the
     * banner, ringer, and CallStyle surface come down while the leg awaits the
     * server BYE. The client NEVER ends the leg itself — this flag is the
     * whole dismissal mechanism.
     */
    val silenced: Boolean = false,
)

data class SoftphoneSnapshot(
    val status: SoftphoneStatus = SoftphoneStatus.DISCONNECTED,
    /** A registration/call error the UI surfaces (never blocks texting). */
    val error: String? = null,
    val calls: List<CallSnapshot> = emptyList(),
    /** The call whose audio is flowing (at most one). */
    val activeId: String? = null,
) {
    val activeCall: CallSnapshot? get() = calls.firstOrNull { it.id == activeId }

    /** Calls still holding a line (anything not torn down). */
    val liveCalls: List<CallSnapshot> get() = calls.filter { it.phase != CallPhase.ENDED }
}

object CallStateMachine {
    /** At most one active + one waiting/held — a third concurrent declines. */
    const val MAX_CONCURRENT_CALLS = 2

    fun ready(state: SoftphoneSnapshot): SoftphoneSnapshot =
        state.copy(status = SoftphoneStatus.READY, error = null)

    fun connecting(state: SoftphoneSnapshot): SoftphoneSnapshot =
        state.copy(status = SoftphoneStatus.CONNECTING)

    /** The socket dropped — the phone can't ring until it re-registers. */
    fun disconnected(state: SoftphoneSnapshot): SoftphoneSnapshot =
        state.copy(status = SoftphoneStatus.DISCONNECTED)

    fun error(state: SoftphoneSnapshot, message: String): SoftphoneSnapshot =
        state.copy(error = message)

    fun clearError(state: SoftphoneSnapshot): SoftphoneSnapshot = state.copy(error = null)

    /** A just-placed outbound call — connecting, immediately the active slot. */
    fun placing(state: SoftphoneSnapshot, call: CallSnapshot): SoftphoneSnapshot = state.copy(
        error = null,
        calls = state.calls.filter { it.phase != CallPhase.ENDED } +
            call.copy(phase = CallPhase.CONNECTING, direction = CallDirection.OUTBOUND),
        activeId = call.id,
    )

    /** A new inbound invite — rings until answered/declined/won elsewhere. */
    fun incoming(state: SoftphoneSnapshot, call: CallSnapshot): SoftphoneSnapshot {
        if (state.calls.any { it.id == call.id }) return state
        return state.copy(
            calls = state.calls.filter { it.phase != CallPhase.ENDED } +
                call.copy(phase = CallPhase.RINGING, direction = CallDirection.INBOUND),
        )
    }

    /** The customer call_session_id resolved (by-leg for inbound answers). */
    fun sessionKnown(state: SoftphoneSnapshot, id: String, sessionId: String): SoftphoneSnapshot =
        update(state, id) { it.copy(sessionId = sessionId) }

    fun muted(state: SoftphoneSnapshot, id: String, muted: Boolean): SoftphoneSnapshot =
        update(state, id) { it.copy(muted = muted) }

    /**
     * Stop presenting a ringing call whose session exited `ringing` server-
     * side (calls-v3 §10.1.2) — the reducer only flags it; the surfaces
     * (banner/ringer/notification) read the flag. Only a RINGING call can be
     * silenced: any other phase means the user already engaged, and the
     * dismissal races are the server's to resolve. The leg itself is
     * untouched — the server's BYE removes it through the normal ENDED path.
     */
    fun presentationSilenced(state: SoftphoneSnapshot, id: String): SoftphoneSnapshot =
        update(state, id) {
            if (it.phase == CallPhase.RINGING) it.copy(silenced = true) else it
        }

    /** Dismiss an ended call's chip. */
    fun dismissed(state: SoftphoneSnapshot, id: String): SoftphoneSnapshot = state.copy(
        calls = state.calls.filter { it.id != id },
        activeId = if (state.activeId == id) null else state.activeId,
    )

    /**
     * Apply an SDK per-call state transition. Mirrors the web reducer exactly:
     * an un-answered inbound ring ignores early SDK states (the Answer chip
     * must not morph) and its end is a SILENT removal; a call going active
     * structurally demotes any other active call to held (one-active-audio).
     */
    fun sdkPhase(
        state: SoftphoneSnapshot,
        id: String,
        phase: CallPhase,
        nowMs: Long,
    ): SoftphoneSnapshot {
        val call = state.calls.firstOrNull { it.id == id } ?: return state
        if (call.phase == CallPhase.RINGING) {
            return when (phase) {
                CallPhase.ACTIVE -> activate(state, id, nowMs)
                CallPhase.ENDED -> state.copy(
                    calls = state.calls.filter { it.id != id },
                    activeId = if (state.activeId == id) null else state.activeId,
                )

                else -> state
            }
        }
        return when (phase) {
            CallPhase.ACTIVE -> activate(state, id, nowMs)
            CallPhase.ENDED -> state.copy(
                calls = state.calls.map {
                    if (it.id == id) it.copy(phase = CallPhase.ENDED) else it
                },
                activeId = if (state.activeId == id) null else state.activeId,
            )

            CallPhase.HELD -> update(state, id) { it.copy(phase = CallPhase.HELD) }.copy(
                activeId = if (state.activeId == id) null else state.activeId,
            )

            CallPhase.RINGING, CallPhase.CONNECTING ->
                update(state, id) { it.copy(phase = CallPhase.CONNECTING) }
        }
    }

    /**
     * Make [id] the single ACTIVE call — demoting ANY other active call to
     * held, so two calls can never fight for the one audio path. The caller
     * (SoftphoneCore) SDK-holds the demoted call to match.
     */
    private fun activate(state: SoftphoneSnapshot, id: String, nowMs: Long): SoftphoneSnapshot =
        state.copy(
            calls = state.calls.map { call ->
                when {
                    call.id == id -> call.copy(
                        phase = CallPhase.ACTIVE,
                        activeSinceMs = call.activeSinceMs ?: nowMs,
                        // A call that went live is engaged, not dismissed — a
                        // stale silence flag must not follow it into the call.
                        silenced = false,
                    )

                    call.phase == CallPhase.ACTIVE -> call.copy(phase = CallPhase.HELD)
                    else -> call
                }
            },
            activeId = id,
        )

    private inline fun update(
        state: SoftphoneSnapshot,
        id: String,
        patch: (CallSnapshot) -> CallSnapshot,
    ): SoftphoneSnapshot = state.copy(
        calls = state.calls.map { if (it.id == id) patch(it) else it },
    )
}
