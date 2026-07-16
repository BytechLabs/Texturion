package com.loonext.android.telephony

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

/** Discrete moments the Android layer (telecom + notifications) reacts to. */
sealed interface CoreEvent {
    data class IncomingRinging(val call: CallSnapshot) : CoreEvent
    data class OutgoingPlaced(val call: CallSnapshot) : CoreEvent
}

/**
 * The softphone's brain — registration lifecycle, the multi-call state, and
 * every live-call op — with the Telnyx SDK behind [SdkClient] and the server
 * behind [CallsApi], so the whole flow is unit-testable (MockWebServer + a
 * fake SDK). [SoftphoneManager] wraps this with the Android plumbing
 * (telecom, notifications, foreground service, watchdog triggers).
 *
 * Invariants (BINDING, from the calls domain contract):
 * - The login token is minted ON CONNECT ONLY — never per call (rate-limited).
 *   Recovery reconnects mint fresh, which is also the auth-failure fix.
 * - client_state from POST /v1/calls/browser goes into newCall VERBATIM.
 * - An answered INBOUND call's SDK leg is the RING leg — the customer
 *   call_session_id resolves via GET /v1/calls/live/by-leg/{ccid} before any
 *   live-call op can run.
 * - Max 2 concurrent calls; answering the second holds the first; a third
 *   inbound declines immediately so the answer race resolves elsewhere.
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

    private val connectMutex = Mutex()
    private var recoverJob: Job? = null

    var companyId: String? = null
        private set
    private var callerIdName: String = ""

    init {
        scope.launch { sdk.events.collect { onSdkEvent(it) } }
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
        recoverJob = scope.launch {
            delay(recoverDebounceMs)
            if (_state.value.status == SoftphoneStatus.READY) return@launch
            if (_state.value.liveCalls.isNotEmpty()) return@launch
            runCatching { ensureConnected() }
        }
    }

    /** Status-pill tap: force a rebuild now (still refuses during a call). */
    fun retryNow() {
        if (_state.value.liveCalls.isNotEmpty()) return
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
            is SdkEvent.Ready -> _state.update { CallStateMachine.ready(it) }

            is SdkEvent.Disconnected -> {
                _state.update { CallStateMachine.disconnected(it) }
                scheduleRecover()
            }

            is SdkEvent.Error -> {
                // Often an auth/token failure — the SDK's own reconnect can't
                // fix a dead token; a fresh mint + registration can. Deferred
                // automatically while a call is live.
                _state.update {
                    CallStateMachine.error(
                        CallStateMachine.disconnected(it),
                        "Calling is temporarily unavailable.",
                    )
                }
                scheduleRecover()
            }

            is SdkEvent.Incoming -> onIncoming(event)
        }
    }

    private fun onIncoming(event: SdkEvent.Incoming) {
        if (_state.value.calls.any { it.id == event.call.id }) return
        // Beyond the two-call ceiling: decline immediately so the answer race
        // resolves elsewhere without waiting out the ring timeout.
        if (_state.value.liveCalls.size >= CallStateMachine.MAX_CONCURRENT_CALLS) {
            runCatching { event.call.end() }
            return
        }
        val number = event.callerNumber.orEmpty()
        val name = event.callerName?.takeIf { it.isNotBlank() }
            ?: number.ifBlank { "Unknown caller" }
        val snapshot = CallSnapshot(
            id = event.call.id,
            direction = CallDirection.INBOUND,
            peerName = name,
            peerNumber = number,
            phase = CallPhase.RINGING,
        )
        handles[event.call.id] = event.call
        sdkPhases[event.call.id] = CallPhase.RINGING
        _state.update { CallStateMachine.incoming(it, snapshot) }
        watch(event.call)
        _events.tryEmit(CoreEvent.IncomingRinging(snapshot))
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
        _state.update { CallStateMachine.sdkPhase(it, id, phase, now()) }

        if (phase == CallPhase.ACTIVE) {
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
            // A recovery may have been deferred while this call held the
            // client (#138) — re-arm once the line is idle.
            if (_state.value.status != SoftphoneStatus.READY &&
                _state.value.liveCalls.isEmpty()
            ) {
                scheduleRecover()
            }
            watchJobs.remove(id)?.cancel()
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
     * Push-to-wake part 2 (#156 calls this): ensure the softphone is
     * registered, then ask the server to re-ring THIS member for the
     * still-ringing call. A conflict (already answered/ended — someone beat
     * us) or not_found (the push aged out) is SILENT by contract; anything
     * else propagates so the caller can retry.
     */
    suspend fun onIncomingCallPush(sessionId: String) {
        val company = requireCompany()
        ensureConnected()
        awaitReady()
        try {
            api.ringMe(company, sessionId)
        } catch (cause: ApiException) {
            if (cause.code != ApiErrorCode.CONFLICT && cause.code != ApiErrorCode.NOT_FOUND) {
                throw cause
            }
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
