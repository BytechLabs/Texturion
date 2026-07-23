package com.loonext.android.telephony

import com.loonext.android.core.diag.CallFlowLog
import com.loonext.android.core.net.ApiErrorCode
import com.loonext.android.core.net.ApiException
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withTimeoutOrNull

/** Discrete moments the Android layer (Jetpack Telecom) reacts to. */
sealed interface CoreEvent {
    /**
     * An inbound INVITE bound (#171). [call].sessionId carries the
     * authoritative server session when the `X-Loonext-Session` header was
     * present (§3.2 — the deterministic correlation); [legId] is the by-leg
     * fallback key for a header-less leg. [TelecomCallRegistry] keys the OS
     * call on the session (idempotent with the FCM-push trigger).
     */
    data class IncomingRinging(val call: CallSnapshot, val legId: String? = null) : CoreEvent
    data class OutgoingPlaced(val call: CallSnapshot) : CoreEvent
}

/**
 * The softphone's brain — registration lifecycle, the multi-call state, and
 * every live-call op — with the Telnyx SDK behind [SdkClient] and the server
 * behind [CallsApi], so the whole flow is unit-testable (a suspend-fake
 * [CallsApi] + a fake SDK). [SoftphoneManager] wraps this with the Android
 * plumbing (telecom, notifications, foreground service, watchdog triggers).
 *
 * Invariants (BINDING, from the calls domain contract + calls-v3 §10):
 * - The login token is minted ON CONNECT ONLY — never per call (rate-limited).
 *   Recovery reconnects mint fresh, which is also the auth-failure fix.
 * - client_state from POST /v1/calls/browser goes into newCall VERBATIM.
 * - An answered INBOUND call's SDK leg is the RING leg — the customer
 *   call_session_id resolves via GET /v1/calls/live/by-leg/{ccid} before any
 *   live-call op can run.
 * - Max 2 concurrent PRESENTED calls; answering the second holds the first;
 *   inbound INVITEs beyond the ceiling are held SILENT (never declined — see
 *   the next rule) and promote when a slot frees.
 * - The client NEVER hangs up a leg except on explicit user action
 *   (decline/hangup). No staleness probe, no ceiling decline, no
 *   reconciliation kill: the server cancels every stale leg on every exit
 *   from `ringing`, and a decline on a forked INVITE is not provably scoped
 *   to this device (§10.1.4 — it would kill the ring on the member's other
 *   devices). Dismissal is SILENCE-only ([CallStateMachine.presentationSilenced]).
 * - ring-me only when holding no live leg, always with `no_local_leg:true`
 *   (§10.1.3 — the call is the attestation).
 * - Recovery never rebuilds the client while any call is live (#138).
 */
class SoftphoneCore(
    private val api: CallsApi,
    private val sdk: SdkClient,
    private val scope: CoroutineScope,
    private val now: () -> Long = { System.currentTimeMillis() },
    private val recoverDebounceMs: Long = 4_000,
    private val readyTimeoutMs: Long = 15_000,
) {
    private val _state = MutableStateFlow(SoftphoneSnapshot())
    val state: StateFlow<SoftphoneSnapshot> = _state

    private val _events = MutableSharedFlow<CoreEvent>(extraBufferCapacity = 16)
    val events: SharedFlow<CoreEvent> = _events

    private val handles = mutableMapOf<String, SdkCallHandle>()
    private val watchJobs = mutableMapOf<String, Job>()

    /** Ground truth of what the SDK last reported per call — hold toggling
     *  must consult THIS, not the reduced UI state (which demotes to HELD
     *  structurally before the SDK has actually held anything). */
    private val sdkPhases = mutableMapOf<String, CallPhase>()

    /** Calls with a hold TOGGLE in flight — a second toggle would undo it. */
    private val pendingHoldToggle = mutableSetOf<String>()

    /** Handles whose by-leg resolution is running or done (resolve once). */
    private val resolvingLegs = mutableSetOf<String>()

    /**
     * §10.1.4 held INVITEs — legs this device received but does NOT present
     * (a duplicate fork of a session already presented here, or an INVITE
     * beyond the two-call ceiling). No UI, no ringtone, no signaling; the
     * server (or the leg's own 45s timeout) reaps them, and a qualifying
     * presented-leg death promotes one to presentation.
     */
    private data class HeldInvite(
        val handle: SdkCallHandle,
        val callerName: String,
        val callerNumber: String,
        val reason: HoldReason,
        val headerSession: String? = null,
        val legId: String? = null,
    )

    private enum class HoldReason { DUPLICATE, CAPACITY }

    private val heldInvites = LinkedHashMap<String, HeldInvite>()
    private val heldWatchJobs = mutableMapOf<String, Job>()

    /**
     * #195 F2 — when each inbound leg (presented OR held) was FIRST seen, keyed
     * by leg id. A side map on purpose: [CallSnapshot] is a published shape and
     * must not grow a field for a private TTL. Entries die with the leg
     * (ENDED / releaseHeld / reap); a promotion keeps the ORIGINAL first-seen —
     * the TTL bounds the ring's total life, not its latest presentation.
     */
    private val ringFirstSeenMs = mutableMapOf<String, Long>()

    /** The single F2 sweep job — self-terminating when nothing is tracked. */
    private var ringTtlJob: Job? = null

    /** §10.1.4: held legs grouped by header session, for [SoftphoneSnapshot]. Held
     *  legs are invisible in `calls` by design, so this is how the Telecom registry
     *  learns a session still has an un-presented sibling leg — published on the
     *  snapshot (level-triggered), never via a fragile one-shot edge callback. */
    private fun heldLegsBySession(): Map<String, Set<String>> {
        val out = LinkedHashMap<String, MutableSet<String>>()
        for ((id, held) in heldInvites) {
            val session = held.headerSession ?: continue
            out.getOrPut(session) { LinkedHashSet() }.add(id)
        }
        return out
    }

    /** Re-publish the held-leg map onto the snapshot (no other state change). */
    private fun publishHeldLegs() {
        _state.update { it.copy(heldLegsBySession = heldLegsBySession()) }
    }

    private val connectMutex = Mutex()
    private var recoverJob: Job? = null

    /** Consecutive [SdkEvent.Error]s since the last READY (see the Error branch). */
    private var consecutiveSdkErrors = 0

    /**
     * The freshest `kind:'call'` wake push (session + caller + when) — the
     * only client-side clue tying a later INVITE to a server session, because
     * the Android SDK's INVITE carries no client_state. Consumed by the
     * §10.1 presentation-reconcile (silence-only) paths; refreshed on every
     * wake push / ring-me.
     */
    private var pushHintSession: String? = null
    private var pushHintCaller: String? = null
    private var pushHintAtMs: Long? = null

    /** Hook for a listener that must hear about swallowed failures (#168A). */
    var onInternalFailure: ((String, Throwable) -> Unit)? = null

    var companyId: String? = null
        private set
    private var callerIdName: String = ""

    init {
        scope.launch {
            sdk.events.collect { event ->
                // One malformed event must neither kill this collector nor
                // the process (#168A) — swallow, report, keep listening.
                try {
                    onSdkEvent(event)
                } catch (cause: CancellationException) {
                    throw cause
                } catch (cause: Exception) {
                    onInternalFailure?.invoke("sdk-event", cause)
                }
            }
        }
    }

    /**
     * Begin (or keep) registration for a company. Fire-and-forget and silent
     * on failure — texting is unaffected; the Call button and the watchdog
     * retry. Registering is also what makes this member ring-eligible.
     */
    fun start(companyId: String, callerIdName: String = "") {
        val switching = this.companyId != null && this.companyId != companyId
        this.companyId = companyId
        if (callerIdName.isNotBlank()) this.callerIdName = callerIdName
        if (switching) {
            // A different company means a different credential — rebuild.
            sdk.disconnect()
            _state.update { CallStateMachine.disconnected(it) }
        }
        scope.launch {
            runCatching { ensureConnected() }
        }
    }

    /** Mint a fresh token and register — single-flight, no-op unless down. */
    private suspend fun ensureConnected() {
        val company = companyId ?: return
        connectMutex.withLock {
            if (_state.value.status != SoftphoneStatus.DISCONNECTED) return
            _state.update { CallStateMachine.connecting(it) }
            try {
                val token = api.mintToken(company)
                sdk.connect(token.token, callerIdName)
            } catch (cause: Exception) {
                _state.update { CallStateMachine.disconnected(it) }
                throw cause
            }
        }
    }

    private suspend fun awaitReady() {
        if (_state.value.status == SoftphoneStatus.READY) return
        withTimeoutOrNull(readyTimeoutMs) {
            state.first { it.status == SoftphoneStatus.READY }
        } ?: throw ApiException(
            ApiErrorCode.NETWORK,
            "Couldn't connect your phone. Check your connection and try again.",
            0,
        )
    }

    /**
     * Recovery watchdog entry — call on network-regained / app-foreground /
     * socket-close. Debounced so a burst collapses into one attempt; no-op
     * while healthy; NEVER rebuilds while a call is live (#138) — the
     * call-end path re-arms it once the line clears.
     */
    fun scheduleRecover() {
        if (_state.value.status == SoftphoneStatus.READY) return
        if (recoverJob?.isActive == true) return
        CallFlowLog.log("recover", "recover scheduled debounce=${recoverDebounceMs}ms")
        recoverJob = scope.launch {
            delay(recoverDebounceMs)
            if (_state.value.status == SoftphoneStatus.READY) return@launch
            // #195 F3 honest gate: only a GENUINELY ENGAGED leg defers recovery
            // (#138's "never rebuild while a call is live"). A silenced/stale
            // RINGING zombie is presentation debris, not a call — letting it
            // wedge recovery is how a dead socket stayed dead for good.
            if (CallWakePolicy.anyEngaged(_state.value.calls)) return@launch
            runCatching { ensureConnected() }
        }
    }

    /** Status-pill tap: force a rebuild now (still refuses during a call). */
    fun retryNow() {
        // #195 F3: same honest gate as scheduleRecover — an engaged leg refuses
        // the rebuild; a zombie ring must never block the user's own retry.
        if (CallWakePolicy.anyEngaged(_state.value.calls)) return
        sdk.disconnect()
        _state.update { CallStateMachine.disconnected(it) }
        scope.launch { runCatching { ensureConnected() } }
    }

    /**
     * #195 F5 — the socket reset after a FAILED answer. Called (via the bridge)
     * when a registry teardown (bind deadline / ring window) kills a call the
     * user had ANSWERED: the leg never bound or never accepted, which is the
     * zombie-socket signature — the SDK claims READY but its legs never
     * materialize. If nothing is genuinely engaged, rebuild the socket outright
     * (mint-on-connect is the designed recovery), so at most ONE call is ever
     * lost to a zombie socket. State hygiene only — no leg is ever hung up here.
     */
    fun forceRecoverAfterAnswerFailure() {
        if (CallWakePolicy.anyEngaged(_state.value.calls)) {
            CallFlowLog.log("recover", "answer-failure rebuild skipped - engaged leg present")
            return
        }
        CallFlowLog.log("recover", "answer failed with no engaged leg - rebuilding socket")
        sdk.disconnect()
        _state.update { CallStateMachine.disconnected(it) }
        scope.launch { runCatching { ensureConnected() } }
    }

    fun clearError() {
        _state.update { CallStateMachine.clearError(it) }
    }

    /** Surface a client-side failure (mic permission, telecom refusal). */
    fun reportUiError(message: String) {
        _state.update { CallStateMachine.error(it, message) }
    }

    // ------------------------------------------------------------------ SDK

    private fun onSdkEvent(event: SdkEvent) {
        when (event) {
            is SdkEvent.Ready -> {
                CallFlowLog.log("socket", "Ready")
                consecutiveSdkErrors = 0
                _state.update { CallStateMachine.ready(it) }
            }

            is SdkEvent.Disconnected -> {
                CallFlowLog.log("socket", "Disconnected")
                _state.update { CallStateMachine.disconnected(it) }
                // #195 F1: a dead client's RINGING legs and held INVITEs are
                // ZOMBIES — their phase flows can never emit after a rebuild,
                // so nothing else will ever clear them and they wedge every
                // gate that counts them. Reap the presentation state now
                // (never a BYE — the server owns the real legs).
                reapOnClientDeath()
                scheduleRecover()
            }

            is SdkEvent.Error -> {
                // Often an auth/token failure — the SDK's own reconnect can't
                // fix a dead token; a fresh mint + registration can. Deferred
                // automatically while a call is live.
                //
                // QUIET BY DEFAULT: single socket errors are routine mobile
                // churn that [scheduleRecover] heals in seconds — surfacing
                // each one produced a phantom "Calling is temporarily
                // unavailable" popup while simply browsing. The user-visible
                // message is reserved for a PERSISTENT outage (3+ consecutive
                // failures without a READY in between) or an error while a
                // call is actually live.
                consecutiveSdkErrors++
                CallFlowLog.log("socket", "Error consecutive=$consecutiveSdkErrors")
                val worthTelling =
                    _state.value.liveCalls.isNotEmpty() || consecutiveSdkErrors >= 3
                _state.update {
                    val down = CallStateMachine.disconnected(it)
                    if (worthTelling) {
                        CallStateMachine.error(down, "Calling is temporarily unavailable.")
                    } else {
                        down
                    }
                }
                scheduleRecover()
            }

            is SdkEvent.Incoming -> onIncoming(event)
        }
    }

    private fun onIncoming(event: SdkEvent.Incoming) {
        val id = event.call.id
        CallFlowLog.log("sip", "INVITE received leg=${CallFlowLog.tail(id)} caller=${CallFlowLog.mask(event.callerNumber)}")
        if (_state.value.calls.any { it.id == id } || heldInvites.containsKey(id)) return
        val number = event.callerNumber.orEmpty()
        val name = event.callerName?.takeIf { it.isNotBlank() }
            ?: number.ifBlank { "Unknown caller" }
        // §3.2 DETERMINISTIC correlation — the `X-Loonext-Session` header IS the
        // authoritative server session (never a caller/time guess). When present
        // the customer session is known at ring time; the OS call keys on it.
        val correlation = TelecomCallReducer.correlateInvite(event.customHeaders, event.legId)
        val headerSession =
            (correlation as? TelecomCallReducer.Correlation.Header)?.session
        val legId = event.legId
        // §10.1.4 one presentation per session per device: the shared Telnyx
        // credential forks every leg's INVITE to all of a member's devices,
        // so a second INVITE for a session this device already presents is held
        // SILENT. BLOCKING-2a: two INVITEs can share ONE call_session_id (an
        // anonymous caller + a ring-me re-dial), so a caller-NUMBER match is not
        // enough — dedup on the deterministic header SESSION first (the OS call
        // is keyed on S; a second presented leg for S would let a reaped sibling
        // tear the shared OS call down). Fall back to the caller-number proxy for
        // header-absent legs.
        val presentedSessions = (
            _state.value.calls
                .filter { it.phase != CallPhase.ENDED && it.direction == CallDirection.INBOUND }
                .mapNotNull { it.sessionId } +
                heldInvites.values.mapNotNull { it.headerSession }
            ).toSet()
        val sessionDuplicate = headerSession != null && headerSession in presentedSessions
        val inboundCallers = _state.value.calls
            .filter { it.phase != CallPhase.ENDED && it.direction == CallDirection.INBOUND }
            .map { it.peerNumber } + heldInvites.values.map { it.callerNumber }
        val duplicate = sessionDuplicate || CallWakePolicy.holdInviteSilent(inboundCallers, number)
        // Beyond the two-call ceiling the extra INVITE is ALSO held, never
        // declined: the client never hangs up a leg outside user action
        // (§10.1.2), and a decline on a forked leg would kill the ring on the
        // member's other devices too. The server reaps unanswered legs; a
        // freed slot promotes it so the answer race still resolves.
        val overCeiling =
            _state.value.liveCalls.size >= CallStateMachine.MAX_CONCURRENT_CALLS
        if (duplicate || overCeiling) {
            holdInvite(
                event.call, name, number,
                if (duplicate) HoldReason.DUPLICATE else HoldReason.CAPACITY,
                headerSession, legId,
            )
            return
        }
        presentIncoming(event.call, name, number, headerSession, legId)
    }

    private fun presentIncoming(
        handle: SdkCallHandle,
        name: String,
        number: String,
        headerSession: String?,
        legId: String?,
    ) {
        val otherLiveCalls = _state.value.liveCalls.size
        val snapshot = CallSnapshot(
            id = handle.id,
            direction = CallDirection.INBOUND,
            peerName = name,
            peerNumber = number,
            phase = CallPhase.RINGING,
            // §3.2: header-known customer session at ring time (else resolved
            // by-leg post-answer, as before, when the header was absent).
            sessionId = headerSession,
        )
        handles[handle.id] = handle
        sdkPhases[handle.id] = CallPhase.RINGING
        // F2: TTL clock — getOrPut so a promoted held fork keeps its ORIGINAL
        // first-seen (the TTL bounds the ring's total life).
        ringFirstSeenMs.getOrPut(handle.id) { now() }
        ensureRingTtlSweep()
        _state.update { CallStateMachine.incoming(it, snapshot) }
        watch(handle)
        _events.tryEmit(CoreEvent.IncomingRinging(snapshot, legId))
        // §10.1.1 present-from-state: fast path first (the ring is already
        // presenting), THEN the concurrent /state reconcile — a ringing-exit
        // verdict SILENCES the presentation (banner/ringer/notification down)
        // while the leg waits for the server BYE. Never a client hangup.
        reconcilePresentation(inviteCaller = number, otherLiveCalls = otherLiveCalls)
    }

    /** Track a held INVITE (§10.1.4) until it dies or gets promoted. */
    private fun holdInvite(
        handle: SdkCallHandle,
        name: String,
        number: String,
        reason: HoldReason,
        headerSession: String? = null,
        legId: String? = null,
    ) {
        val id = handle.id
        heldInvites[id] = HeldInvite(handle, name, number, reason, headerSession, legId)
        // F2: held INVITEs are subject to the same ring TTL as presented ones.
        ringFirstSeenMs.getOrPut(id) { now() }
        ensureRingTtlSweep()
        // Publish this held leg so the registry counts it as a live leg of the
        // session even though it is never presented — the presented leg's death
        // then re-homes the OS call here instead of tearing it down.
        publishHeldLegs()
        heldWatchJobs[id] = scope.launch {
            handle.phases.collect { phase ->
                if (phase == CallPhase.ENDED) releaseHeld(id)
            }
        }
    }

    /**
     * The user DECLINED [session] (§ Telecom reject) — STOP TRACKING every
     * silently-held fork of that session so [maybePromoteHeld] cannot promote one
     * into a fresh ring after the decline. Mirrors [applyRingingExit]: release
     * (untrack) only, never a client-side leg reject — the decline already dropped
     * this member server-side, and the leg's own BYE tears it down. A local reject
     * of a forked leg risks cancelling the ring on the member's other devices.
     */
    fun releaseHeldForSession(session: String) {
        heldInvites.entries
            .filter { it.value.headerSession == session }
            .map { it.key }
            .forEach { releaseHeld(it) }
    }

    /** Forget a held INVITE (its BYE arrived, or its session died). Re-publishing
     *  drops it from the snapshot's held map, so the registry's authoritative
     *  live-leg set for the session shrinks — if it was the leg an OS call had
     *  re-homed to, the registry ends that call rather than ringing forever.
     *  [promoteHeld] removes the entry itself (a promoted leg is still live — the
     *  snapshot's `calls` takes over reporting it) and re-publishes too. */
    private fun releaseHeld(id: String) {
        heldInvites.remove(id)
        heldWatchJobs.remove(id)?.cancel()
        // F2: the TTL clock dies with the held entry — unless this same leg is
        // still PRESENTED in `calls` (promotion keeps the original clock).
        if (_state.value.calls.none { it.id == id }) ringFirstSeenMs.remove(id)
        publishHeldLegs()
    }

    /**
     * A presented call ENDED — promote a held INVITE if one qualifies
     * (§10.1.4): a duplicate fork promotes only when its presented sibling
     * died still-RINGING and `/state` (when the session is knowable via the
     * push hint) still says `ringing`; a capacity-held ring promotes whenever
     * a slot frees. On doubt (state unreadable / session unknowable) the
     * INVITE promotes — suppressing an unverifiable real ring is worse than
     * briefly presenting a leg the server is about to BYE.
     */
    private fun maybePromoteHeld(endedRinging: CallSnapshot?) {
        if (heldInvites.isEmpty()) return
        val snapshot = _state.value
        if (snapshot.liveCalls.size >= CallStateMachine.MAX_CONCURRENT_CALLS) return
        val duplicateId = endedRinging?.let { ended ->
            heldInvites.entries.firstOrNull { (_, held) ->
                held.reason == HoldReason.DUPLICATE &&
                    // Match on the DETERMINISTIC header session first (BLOCKING-2a):
                    // an anonymous caller's two forks both have a BLANK number, so
                    // the caller-number proxy never matches them — yet the header
                    // session identifies them exactly. Fall back to the number proxy
                    // only for header-absent legs.
                    (
                        (held.headerSession != null && held.headerSession == ended.sessionId) ||
                            CallWakePolicy.sameCaller(held.callerNumber, ended.peerNumber)
                        )
            }?.key
        }
        val candidateId = duplicateId
            ?: heldInvites.entries.firstOrNull { it.value.reason == HoldReason.CAPACITY }?.key
            ?: return
        val held = heldInvites.getValue(candidateId)
        val verifySession = if (held.reason == HoldReason.DUPLICATE) {
            CallWakePolicy.reconcileSession(
                hintSession = pushHintSession,
                hintAtMs = pushHintAtMs,
                nowMs = now(),
                otherLiveCalls = snapshot.liveCalls.size,
                hintCaller = pushHintCaller,
                inviteCaller = held.callerNumber,
            )
        } else {
            null
        }
        val company = companyId
        if (verifySession == null || company == null) {
            promoteHeld(candidateId)
            return
        }
        scope.launch {
            val live = runCatching { api.sessionState(company, verifySession) }.getOrNull()
            if (live != null && CallWakePolicy.isRingingExit(live.state)) {
                // The session is over — the fork must not ring a dead call.
                // Release (stop tracking) only; the server BYE ends the leg.
                releaseHeld(candidateId)
            } else if (heldInvites.containsKey(candidateId)) {
                promoteHeld(candidateId)
            }
        }
    }

    private fun promoteHeld(id: String) {
        val held = heldInvites.remove(id) ?: return
        heldWatchJobs.remove(id)?.cancel()
        if (_state.value.liveCalls.size >= CallStateMachine.MAX_CONCURRENT_CALLS) {
            // A slot filled while we deliberated — hold again.
            holdInvite(
                held.handle, held.callerName, held.callerNumber, HoldReason.CAPACITY,
                held.headerSession, held.legId,
            )
            return
        }
        // ORDERING INVARIANT (keep): the dying presented leg's removal was emitted
        // to `state` by onSdkPhase BEFORE this promotion runs, and presentIncoming's
        // IncomingRinging event is emitted AFTER. On the single Main.immediate FIFO
        // loop the state collector (SoftphoneManager.syncPlatform → setLiveLegs
        // re-home) therefore runs before the event collector (onIncomingRinging →
        // onLegBound → accept). That is what lets a promoted fork re-accept cleanly
        // after an answer-glare (accepted-but-never-active owner) without dead air.
        // Do NOT reorder promotion ahead of the dead leg's state removal.
        presentIncoming(
            held.handle, held.callerName, held.callerNumber, held.headerSession, held.legId,
        )
        // Drop it from the held map only AFTER it is in `calls`, so the session's
        // authoritative live-leg set (presented ∪ held) never transiently empties
        // and tears the re-homed OS call down a beat before the promotion lands.
        publishHeldLegs()
    }

    /**
     * §10.1.1 reconcile: correlate the fresh INVITE to a session via the wake
     * hint (conservative guards in [CallWakePolicy.reconcileSession]) and ask
     * `/state`. Runs concurrently — never blocks or delays the ring — and a
     * ringing-exit verdict only SILENCES presentation. Only a 200 dismisses:
     * a 404/network failure leaves the ring alone (the server BYE is the
     * backstop for a genuinely dead session).
     */
    private fun reconcilePresentation(inviteCaller: String?, otherLiveCalls: Int) {
        val company = companyId ?: return
        val session = CallWakePolicy.reconcileSession(
            hintSession = pushHintSession,
            hintAtMs = pushHintAtMs,
            nowMs = now(),
            otherLiveCalls = otherLiveCalls,
            hintCaller = pushHintCaller,
            inviteCaller = inviteCaller,
        ) ?: return
        scope.launch {
            val live = try {
                api.sessionState(company, session)
            } catch (cause: CancellationException) {
                throw cause
            } catch (_: Exception) {
                return@launch
            }
            if (CallWakePolicy.isRingingExit(live.state)) applyRingingExit(session)
        }
    }

    /**
     * Realtime `call.updated` (calls-v3 §9.1): the payload now carries
     * `state` (+ `answered_by_user_id`) — any ringing-exit state dismisses
     * this device's presentation for the session. Silence only; the server
     * cancels the leg.
     */
    fun onCallSessionUpdate(sessionId: String, state: String?) {
        if (sessionId.isBlank()) return
        if (!CallWakePolicy.isRingingExit(state)) return
        applyRingingExit(sessionId)
    }

    /**
     * `kind:'call_end'` revocation push (calls-v3 §9.2): the tray entry is
     * cancelled by tag in the messaging service; here the in-app surfaces
     * (banner, ringer, CallStyle notification) come down via the silenced
     * flag, and correlated held INVITEs stop being promotable. No telecom or
     * SDK interaction of any kind.
     */
    fun onCallEndPush(sessionId: String) {
        if (sessionId.isBlank()) return
        applyRingingExit(sessionId)
    }

    private fun applyRingingExit(sessionId: String) {
        // Held INVITEs correlated to the dead session must never promote
        // into it (the leg's own BYE still tears them down).
        if (pushHintSession == sessionId) {
            heldInvites.filterValues { held ->
                !CallWakePolicy.callerMismatch(pushHintCaller, held.callerNumber)
            }.keys.toList().forEach { releaseHeld(it) }
        }
        val ids = CallWakePolicy.dismissalsForRingingExit(
            calls = _state.value.calls,
            sessionId = sessionId,
            hintSession = pushHintSession,
            hintAtMs = pushHintAtMs,
            nowMs = now(),
            hintCaller = pushHintCaller,
        )
        if (ids.isEmpty()) return
        ids.forEach { id ->
            _state.update { CallStateMachine.presentationSilenced(it, id) }
        }
        if (pushHintSession == sessionId) {
            // One hint dismisses at most one ring — the NEXT call must not
            // inherit a stale correlation.
            pushHintSession = null
            pushHintCaller = null
            pushHintAtMs = null
        }
    }

    // ------------------------------------------------- zombie hygiene (#195)

    /**
     * #195 F1 — the SDK client died (socket [SdkEvent.Disconnected]): every
     * still-RINGING presented call and every held INVITE belonged to that
     * client, and their per-call flows can NEVER emit again after a rebuild.
     * Drop the presentation state (watchers cancelled, `calls`/held cleared)
     * so no immortal zombie wedges the wake/recovery gates. This is state
     * hygiene, not teardown: no BYE, no decline — the server owns the legs.
     */
    private fun reapOnClientDeath() {
        _state.value.calls
            .filter { it.phase == CallPhase.RINGING }
            .forEach { call ->
                CallFlowLog.log(
                    "reap",
                    "client died - dropping RINGING zombie leg=${CallFlowLog.tail(call.id)} " +
                        "caller=${CallFlowLog.mask(call.peerNumber)}",
                )
                dropRingingPresentation(call.id)
            }
        heldInvites.keys.toList().forEach { id ->
            CallFlowLog.log(
                "reap",
                "client died - releasing held INVITE leg=${CallFlowLog.tail(id)}",
            )
            releaseHeld(id)
        }
    }

    /**
     * #195 F2 — one bounded sweep job while any inbound ring (presented or
     * held) is tracked; exits on its own once nothing is left, so it can
     * never leak. Each pass drops rings older than [CallWakePolicy.RING_TTL_MS]
     * — the server ring window (45s) plus grace, so the real leg is already
     * dead. Presentation state only; never a BYE.
     */
    private fun ensureRingTtlSweep() {
        if (ringTtlJob?.isActive == true) return
        ringTtlJob = scope.launch {
            while (ringFirstSeenMs.isNotEmpty()) {
                delay(CallWakePolicy.RING_TTL_SWEEP_MS)
                reapExpiredRings()
            }
        }
    }

    private fun reapExpiredRings() {
        val nowMs = now()
        _state.value.calls
            .filter { it.phase == CallPhase.RINGING && it.direction == CallDirection.INBOUND }
            .forEach { call ->
                val firstSeen = ringFirstSeenMs[call.id] ?: return@forEach
                if (!CallWakePolicy.ringExpired(firstSeen, nowMs)) return@forEach
                CallFlowLog.log(
                    "reap",
                    "ring TTL (${CallWakePolicy.RING_TTL_MS}ms) - dropping stale ring " +
                        "leg=${CallFlowLog.tail(call.id)} silenced=${call.silenced}",
                )
                dropRingingPresentation(call.id)
            }
        heldInvites.keys.toList().forEach { id ->
            val firstSeen = ringFirstSeenMs[id] ?: return@forEach
            if (!CallWakePolicy.ringExpired(firstSeen, nowMs)) return@forEach
            CallFlowLog.log(
                "reap",
                "ring TTL - releasing stale held INVITE leg=${CallFlowLog.tail(id)}",
            )
            releaseHeld(id)
        }
        // Ids no longer tracked anywhere (raced out between passes) — prune so
        // the sweep's own liveness check can reach empty.
        val tracked = _state.value.calls.map { it.id }.toSet() + heldInvites.keys
        ringFirstSeenMs.keys.retainAll(tracked)
    }

    /**
     * Drop ONE still-RINGING call's local presentation (F1/F2): cancel its
     * watcher, forget its handle, and remove it from `calls` through the same
     * silent-removal path a server-reaped ring takes. The snapshot change then
     * drives the platform teardown (setLiveLegs) exactly like a real ring
     * death. NEVER ends the leg — the server owns it.
     */
    private fun dropRingingPresentation(id: String) {
        watchJobs.remove(id)?.cancel()
        handles.remove(id)
        sdkPhases.remove(id)
        resolvingLegs.remove(id)
        pendingHoldToggle.remove(id)
        ringFirstSeenMs.remove(id)
        _state.update { CallStateMachine.sdkPhase(it, id, CallPhase.ENDED, now()) }
    }

    private fun watch(handle: SdkCallHandle) {
        watchJobs[handle.id] = scope.launch {
            handle.phases.collect { phase ->
                if (phase != null) onPhase(handle, phase)
            }
        }
    }

    private fun onPhase(handle: SdkCallHandle, phase: CallPhase) {
        val id = handle.id
        sdkPhases[id] = phase
        pendingHoldToggle.remove(id)
        val before = _state.value
        val prev = before.calls.firstOrNull { it.id == id } ?: return
        CallFlowLog.log("phase", "${phase.name} leg=${CallFlowLog.tail(id)} sess=${CallFlowLog.tail(prev.sessionId)}")
        _state.update { CallStateMachine.sdkPhase(it, id, phase, now()) }

        if (phase == CallPhase.ACTIVE) {
            // F2: an answered leg is no longer a ring — stop its TTL clock (a
            // live call must never be swept, and the sweep job can wind down).
            ringFirstSeenMs.remove(id)
            // One active audio path: SDK-hold whichever call was active before
            // this one connected (the reducer already demoted it in state).
            before.activeId?.let { previousActive ->
                if (previousActive != id) requestHold(previousActive, hold = true)
            }
            if (prev.direction == CallDirection.INBOUND && prev.sessionId == null) {
                resolveSession(handle)
            }
            if (prev.direction == CallDirection.OUTBOUND && prev.sessionId == null) {
                handle.telnyxSessionId?.let { session ->
                    _state.update { CallStateMachine.sessionKnown(it, id, session) }
                }
            }
        }
        if (phase == CallPhase.ENDED) {
            handles.remove(id)
            sdkPhases.remove(id)
            resolvingLegs.remove(id)
            ringFirstSeenMs.remove(id) // F2: the TTL clock dies with the leg
            // A recovery may have been deferred while this call held the
            // client (#138) — re-arm once the line is idle.
            if (_state.value.status != SoftphoneStatus.READY &&
                _state.value.liveCalls.isEmpty()
            ) {
                scheduleRecover()
            }
            watchJobs.remove(id)?.cancel()
            // §10.1.4 promotion: a presented ring that died un-answered may
            // hand presentation to a held duplicate fork (if the session
            // still rings); any freed slot promotes a capacity-held INVITE.
            maybePromoteHeld(
                endedRinging = prev.takeIf {
                    it.phase == CallPhase.RINGING && it.direction == CallDirection.INBOUND
                },
            )
        }
    }

    /**
     * The answered inbound leg is the RING leg — resolve the CUSTOMER
     * call_session_id so transfer/notes/voicemail address the right call.
     * Retries briefly (the webhook ledger row can land a beat after answer);
     * live-call ops stay disabled until it lands.
     */
    private fun resolveSession(handle: SdkCallHandle) {
        val company = companyId ?: return
        if (!resolvingLegs.add(handle.id)) return
        scope.launch {
            var backoffMs = 600L
            repeat(6) {
                val ccid = handle.callControlId
                if (ccid != null) {
                    try {
                        val resolved = api.resolveByLeg(company, ccid)
                        _state.update {
                            CallStateMachine.sessionKnown(it, handle.id, resolved.call_session_id)
                        }
                        return@launch
                    } catch (cause: CancellationException) {
                        throw cause
                    } catch (_: Exception) {
                        // Not ledgered yet (or a blip) — retry below.
                    }
                }
                delay(backoffMs)
                backoffMs = (backoffMs * 2).coerceAtMost(5_000)
            }
            // Allow a fresh attempt if the caller retries a live-call op.
            resolvingLegs.remove(handle.id)
        }
    }

    // ------------------------------------------------------------------ ops

    /**
     * Place an outbound call. Exactly one origin: an existing thread, a
     * contact (no thread yet), or raw dialed digits. Gate refusals surface as
     * [ApiException] BY CODE (usage_cap_reached, subscription_inactive,
     * conflict "line on another call", validation_failed). The current active
     * call is held only AFTER the new leg exists (#148) — an authorize or
     * connect failure never strands the live call on hold.
     */
    suspend fun placeCall(
        displayName: String,
        conversationId: String? = null,
        contactId: String? = null,
        to: String? = null,
        phoneNumberId: String? = null,
    ) {
        val company = companyId ?: throw ApiException(
            ApiErrorCode.NETWORK,
            "Calling isn't ready yet. Try again in a moment.",
            0,
        )
        if (_state.value.liveCalls.size >= CallStateMachine.MAX_CONCURRENT_CALLS) {
            throw ApiException(
                ApiErrorCode.CONFLICT,
                "You're already on two calls.",
                0,
            )
        }
        val auth = api.authorizeBrowserCall(
            companyId = company,
            conversationId = conversationId,
            contactId = contactId,
            to = to,
            phoneNumberId = phoneNumberId,
        )
        ensureConnected()
        awaitReady()
        // client_state VERBATIM — the webhook hangs up any leg without the
        // valid single-use nonce inside it.
        val handle = sdk.newCall(
            callerIdName = callerIdName,
            callerIdNumber = auth.from,
            destinationNumber = auth.to,
            clientState = auth.client_state,
        )
        _state.value.activeId?.let { requestHold(it, hold = true) }
        handles[handle.id] = handle
        sdkPhases[handle.id] = CallPhase.CONNECTING
        val snapshot = CallSnapshot(
            id = handle.id,
            direction = CallDirection.OUTBOUND,
            peerName = displayName.ifBlank { auth.to },
            peerNumber = auth.to,
            phase = CallPhase.CONNECTING,
        )
        _state.update { CallStateMachine.placing(it, snapshot) }
        watch(handle)
        _events.tryEmit(CoreEvent.OutgoingPlaced(snapshot))
    }

    /** Answer a ringing call; any active call is held first (call waiting). */
    fun answer(id: String) {
        val handle = handles[id] ?: return
        val call = _state.value.calls.firstOrNull { it.id == id } ?: return
        if (call.phase != CallPhase.RINGING) return
        _state.value.activeId?.let { if (it != id) requestHold(it, hold = true) }
        runCatching { handle.accept(call.peerNumber.ifBlank { "unknown" }) }
            .onFailure { cause ->
                // #168A: an SDK refusal degrades to an in-app line, never
                // process death. The call stays RINGING — the user can retry
                // or decline; a leg the SDK already tore down ends itself.
                reportUiError("Couldn't answer — try again.")
                onInternalFailure?.invoke("answer", cause)
            }
        // The caller may have hung up in the same instant — the ring's end
        // event clears the chip silently.
    }

    /** Decline a ringing call / hang up a live one — same SDK verb. */
    fun hangup(id: String) {
        val handle = handles[id]
        if (handle == null) {
            // Already torn down — just clear the chip.
            _state.update { CallStateMachine.dismissed(it, id) }
            return
        }
        runCatching { handle.end() }
    }

    /**
     * Universal user Decline (#171 R1) — the member-scoped server signal EVERY
     * user-facing Decline routes through (banner, full-screen activity,
     * notification shade, in-call second-ring). It ALWAYS POSTs
     * `decline-mine` — no session in the request — so the server drops THIS
     * member's device from the avenue set of every currently-ringing session.
     * That is the fix for the FOREGROUND live-socket ring: the Android SDK
     * exposes neither a session nor a ccid pre-answer, so the old per-session
     * path resolved null and silently dropped the decline, leaving the caller
     * ringing for the full window. decline-mine needs no resolution, so that
     * silent drop cannot recur.
     *
     * When the launching surface already KNOWS the session (a notification /
     * activity carrying the push `?call=<session>`), that session ALSO gets the
     * narrow per-session [postDecline] as a free fast path (both are idempotent
     * 200 no-ops server-side). Then the local ring leg — the given [callId],
     * else the sole wake-correlated ring — is torn down through [hangup], the
     * single lint-pinned SDK teardown path.
     */
    fun declineCurrent(callId: String? = null, sessionHint: String? = null) {
        // Fast path: a session the surface already knows (free — no resolution).
        sessionHint?.takeIf { it.isNotBlank() }?.let { postDecline(it) }
        // Universal fallback — ALWAYS fires, even with no session at all.
        postDeclineMine()
        // Local teardown of the presented ring (explicit user action).
        val id = callId
            ?: CallWakePolicy.matchLocalRing(_state.value.calls, pushHintCaller)
        id?.let { hangup(it) }
    }

    /**
     * The member-scoped decline-mine server signal ONLY — no local SDK
     * teardown (the OS/Telecom callback that triggers this already owns leg
     * teardown via the bridge, §3.3). Used by [TelecomCallRegistry] on an OS
     * reject / bind-deadline so the answer race resolves on a teammate's phone
     * without double-hanging the leg.
     */
    fun declineMineSignal() = postDeclineMine()

    /**
     * Per-session decline signal ONLY (IMPORTANT-4) — no local SDK teardown (the
     * OS/Telecom callback that triggers this owns leg teardown via the bridge).
     * Used by [TelecomCallRegistry] when MORE THAN ONE ring is presented, so
     * rejecting one does not decline the others (member-scoped decline-mine
     * would drop this device from every ringing session).
     */
    fun declineSessionSignal(session: String) = postDecline(session)

    /**
     * §3.2 by-leg fallback: resolve a header-less inbound leg to its customer
     * session server-side (`GET /v1/calls/live/by-leg/:legId`). Null on any
     * failure within the caller's deadline → the leg is uncorrelatable →
     * honest teardown (never a caller guess).
     */
    suspend fun resolveSessionByLeg(legId: String): String? {
        val company = companyId ?: return null
        return try {
            api.resolveByLeg(company, legId).call_session_id
        } catch (cause: CancellationException) {
            throw cause
        } catch (_: Exception) {
            null
        }
    }

    /** POST the member-scoped decline-mine (#171 R1). Best-effort like every
     *  telephony signal — the leg teardown and the server ladder are backstops. */
    private fun postDeclineMine() {
        val company = companyId ?: return
        scope.launch {
            try {
                api.declineMine(company)
            } catch (cause: CancellationException) {
                throw cause
            } catch (cause: Exception) {
                onInternalFailure?.invoke("decline-mine", cause)
            }
        }
    }

    /** POST the narrow per-session decline (the free fast path when the session
     *  is already known). Best-effort; decline-mine is the universal backstop. */
    private fun postDecline(session: String) {
        val company = companyId ?: return
        if (session.isBlank()) return
        scope.launch {
            try {
                api.decline(company, session)
            } catch (cause: CancellationException) {
                throw cause
            } catch (cause: Exception) {
                onInternalFailure?.invoke("decline", cause)
            }
        }
    }

    /** Hold/unhold flip — unholding another call swaps the active audio. */
    fun toggleHold(id: String) {
        val call = _state.value.calls.firstOrNull { it.id == id } ?: return
        when (call.phase) {
            CallPhase.HELD -> {
                _state.value.activeId?.let { if (it != id) requestHold(it, hold = true) }
                requestHold(id, hold = false)
            }

            CallPhase.ACTIVE -> requestHold(id, hold = true)
            else -> Unit
        }
    }

    fun setMuted(id: String, muted: Boolean) {
        val handle = handles[id] ?: return
        runCatching { handle.setMuted(muted) }
        _state.update { CallStateMachine.muted(it, id, muted) }
    }

    fun dtmf(id: String, digit: String) {
        val handle = handles[id] ?: return
        runCatching { handle.dtmf(digit) }
    }

    fun dismiss(id: String) {
        _state.update { CallStateMachine.dismissed(it, id) }
    }

    /**
     * The SDK only has a hold TOGGLE, so command it strictly from the SDK's
     * own last-reported phase (never the reduced state, which demotes calls
     * structurally before the SDK follows) and never while a toggle is
     * already in flight — a doubled toggle would silently UNDO the hold.
     */
    private fun requestHold(id: String, hold: Boolean) {
        val handle = handles[id] ?: return
        val actual = sdkPhases[id] ?: return
        val eligible = if (hold) actual == CallPhase.ACTIVE else actual == CallPhase.HELD
        if (!eligible) return
        if (!pendingHoldToggle.add(id)) return
        runCatching { handle.toggleHold() }
            .onFailure { pendingHoldToggle.remove(id) }
    }

    // ------------------------------------------------------- live-call ops

    suspend fun liveFacts(sessionId: String): LiveCallFacts =
        api.liveFacts(requireCompany(), sessionId)

    suspend fun transferTargets(sessionId: String): TransferTargets =
        api.transferTargets(requireCompany(), sessionId)

    suspend fun blindTransfer(sessionId: String, targetUserId: String): TransferAck =
        api.blindTransfer(requireCompany(), sessionId, targetUserId)

    /**
     * A `kind:'call'` wake (push or notification tap) — the calls-v3 §10.2
     * sequence:
     *  1. Any live local leg — presented or held — means the INVITE path owns
     *     presentation: the push is IGNORED (this rule holds at any push
     *     latency, so a slow Doze push can never flap a live banner).
     *  2. Otherwise register, read the always-200 `/state`, and only a
     *     still-`ringing` session gets ring-me — with `no_local_leg:true`,
     *     the §6 attestation (calling ring-me with no live leg IS the claim
     *     "nothing presents on this device").
     *  3. A `rang:false, recent_leg` ack with no INVITE inside ~4s licenses
     *     exactly one retry (it passes the debounce if the ring_me leg died).
     *
     * A 404 on either call (the push aged out / hidden number) is SILENT by
     * contract, as is ring-me's request-property 409; real failures propagate
     * so the caller (SoftphoneManager) can retry and tray-fall-back.
     */
    suspend fun onIncomingCallPush(sessionId: String, callerHint: String? = null) {
        val company = requireCompany()
        // Remember which session is (supposedly) ringing us — presentation
        // reconciliation correlates a later INVITE against this hint.
        pushHintSession = sessionId
        pushHintCaller = callerHint
        pushHintAtMs = now()
        // #195 F3 honest gate: only a GENUINELY ENGAGED leg (active/held/
        // connecting, or a non-silenced ring the user can see) means the
        // INVITE path owns presentation. A silenced/stale RINGING zombie or a
        // leftover held fork must never eat a wake push — that wedge is how
        // every later call went straight to voicemail until app restart.
        if (CallWakePolicy.anyEngaged(_state.value.calls)) return
        if (_state.value.calls.isNotEmpty() || heldInvites.isNotEmpty()) {
            CallFlowLog.log(
                "wake",
                "stale-only leg state (calls=${_state.value.calls.size} " +
                    "held=${heldInvites.size}) - wake proceeds anyway",
            )
        }
        ensureConnected()
        awaitReady()
        val live = try {
            api.sessionState(company, sessionId)
        } catch (cause: ApiException) {
            if (cause.code == ApiErrorCode.NOT_FOUND) return
            throw cause
        }
        if (live.state != CallWakePolicy.STATE_RINGING) return
        val ack = requestRingMe(company, sessionId) ?: return
        if (ack.rang != false) {
            // rang:true (or a pre-v3 server's bare `ok`) — an INVITE is
            // coming; refresh the hint clock so the correlation window tracks
            // the re-dial, not the original push.
            pushHintAtMs = now()
            return
        }
        if (ack.reason != CallWakePolicy.REASON_RECENT_LEG) return
        // §10.2: one retry after ~4s, only if no INVITE landed meanwhile.
        // "Landed" means an ENGAGED leg (F3) — a fresh INVITE presents as a
        // non-silenced ring; a zombie must not swallow the one retry.
        delay(CallWakePolicy.RING_ME_RETRY_MS)
        if (CallWakePolicy.anyEngaged(_state.value.calls)) return
        val retry = requestRingMe(company, sessionId) ?: return
        if (retry.rang != false) pushHintAtMs = now()
    }

    /** ring-me with the §6 attestation; 409/404 (request-property refusals,
     *  §8.3) are silent by contract — anything else propagates. */
    private suspend fun requestRingMe(company: String, sessionId: String): RingAck? = try {
        api.ringMe(company, sessionId, noLocalLeg = true)
    } catch (cause: ApiException) {
        if (cause.code == ApiErrorCode.CONFLICT || cause.code == ApiErrorCode.NOT_FOUND) {
            null
        } else {
            throw cause
        }
    }

    fun setAudioRoute(route: AudioRoute) {
        runCatching { sdk.setAudioRoute(route) }
    }

    private fun requireCompany(): String = companyId ?: throw ApiException(
        ApiErrorCode.NETWORK,
        "Calling isn't ready yet. Try again in a moment.",
        0,
    )
}
