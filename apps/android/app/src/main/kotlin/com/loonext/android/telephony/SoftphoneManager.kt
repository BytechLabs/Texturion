package com.loonext.android.telephony

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.ProcessLifecycleOwner
import com.loonext.android.core.diag.CrashDiagnostics
import com.loonext.android.core.diag.PostCrashHonesty
import com.loonext.android.core.net.ApiClient
import com.loonext.android.push.CallEndHandler
import com.loonext.android.push.CallWakeHandler
import com.loonext.android.push.PushContent
import com.loonext.android.push.PushHooks
import com.loonext.android.push.postPushNotification
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineExceptionHandler
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.withTimeoutOrNull
import java.util.Collections

/**
 * The Android softphone (#155/#171): [SoftphoneCore] (registration, multi-call
 * leg state, live-call ops — pure and unit-tested) BRIDGED to two engines it
 * does not own — **Android Telecom** ([TelecomCallRegistry]: presentation +
 * audio ownership) and **Telnyx WebRTC** ([TelnyxSdkClient]: media).
 *
 * This class stopped being a presenter (docs/CALLS-CLIENT-V2.md §8). The OS
 * owns the ringing session, the audio mode, the mic FGS, and the route; this
 * bridge only connects/disconnects the Telnyx leg from the OS callbacks and
 * mirrors leg-state changes back to the OS call. Deleted with the rewrite (§6):
 * the self-managed `ConnectionService`, the `Ringer`, the incoming `CallStyle`
 * ring, the in-app banner, and ALL hand-rolled `AudioManager` focus/mode code
 * (§4.3 — we write ZERO audio-mode/focus code; Telecom owns the FGS/mode and
 * Telnyx sets `MODE_IN_COMMUNICATION`+focus internally on `acceptCall`).
 *
 * Crash-safe at every telephony boundary (#168A): a supervised scope with a
 * `CoroutineExceptionHandler`, per-emission guards, and `runCatching` around
 * every platform touch. The #168 crash-diagnostics hardening + #168D
 * call-in-flight marker are kept.
 */
class SoftphoneManager private constructor(
    private val appContext: Context,
    api: ApiClient,
) {
    companion object {
        @Volatile
        private var instance: SoftphoneManager? = null

        /** Lazy process-wide singleton (Context + the app's ApiClient). */
        fun get(context: Context, api: ApiClient): SoftphoneManager =
            instance ?: synchronized(this) {
                instance ?: SoftphoneManager(context.applicationContext, api)
                    .also { instance = it }
            }

        /** The instance if the app already built one (never create from a
         *  callback that must not block startup). */
        fun peek(): SoftphoneManager? = instance
    }

    private val diagnostics = CrashDiagnostics.get(appContext)

    /**
     * #168A: an uncaught failure in ANY child coroutine used to reach the
     * default handler — Android kills the process for uncaught coroutine
     * exceptions — taking a live call down with it. The handler records the
     * stack (shareable next launch) and lets the process live.
     */
    private val scope = CoroutineScope(
        SupervisorJob() + Dispatchers.Main.immediate +
            CoroutineExceptionHandler { _, error ->
                diagnostics.recordNonFatal("softphone", error)
            },
    )
    private val sdk = TelnyxSdkClient(appContext, scope)
    private val core = SoftphoneCore(HttpCallsApi(api), sdk, scope)
    private val notifier = CallNotifier(appContext)

    /** The one softphone state stream every surface renders from. */
    val state: StateFlow<SoftphoneSnapshot> = core.state

    /** Discrete ring/place moments (the overlay uses state; kept for parity). */
    val events: SharedFlow<CoreEvent> = core.events

    /**
     * The single owner of every OS-visible call (§3). Its [TelecomCallRegistry.Bridge]
     * performs the Telnyx-media ops on this bridge's leg state.
     */
    private val registry = TelecomCallRegistry(
        context = appContext,
        scope = scope,
        bridge = TelecomBridge(),
        onFailure = { tag, error -> diagnostics.recordNonFatal(tag, error) },
    )

    /** Call ids the USER (or an OS reject) tore down — so a leg→scope mirror
     *  reports a LOCAL vs REMOTE disconnect honestly (§7 table). */
    private val userHungUp: MutableSet<String> = Collections.synchronizedSet(mutableSetOf())

    // syncPlatform's per-collector state. DECLARED BEFORE `init {}` on purpose: the
    // state collector launched in init runs syncPlatform SYNCHRONOUSLY on the first
    // StateFlow emission (immediate dispatch during construction), so any field it
    // reads must already be initialized. A ref-typed field declared AFTER init reads
    // as null there (a primitive reads as its default) — that null crashed
    // `liveInbound.keys + liveLegSessions` on the first inbound call (device-caught).

    /** #168D marker ownership (see [syncPlatform]). */
    private var markedCallInFlight = false

    /** Registry keys we pushed a live-leg set to last pass — so a session whose
     *  LAST leg just vanished (empty this pass) still gets a final setLiveLegs(∅),
     *  which is what ends the OS call. Confined to the single `core.state` collector. */
    private var liveLegSessions: Set<String> = emptySet()

    init {
        watchNetwork()
        watchForeground()
        core.onInternalFailure = { tag, error -> diagnostics.recordNonFatal(tag, error) }
        // #168A: per-emission guards — one bad snapshot must not kill the
        // collector (all future syncs) or the process.
        scope.launch {
            core.events.collect { event ->
                try {
                    onCoreEvent(event)
                } catch (cause: CancellationException) {
                    throw cause
                } catch (cause: Exception) {
                    diagnostics.recordNonFatal("core-event", cause)
                }
            }
        }
        scope.launch {
            core.state.collect { snapshot ->
                try {
                    syncPlatform(snapshot)
                } catch (cause: CancellationException) {
                    throw cause
                } catch (cause: Exception) {
                    diagnostics.recordNonFatal("sync-platform", cause)
                }
            }
        }
        // Claim the calls-wake seam (calls-v3 §10.2) — this install is THE one
        // wake handler; nothing else overwrites it.
        PushHooks.callWakeHandler = CallWakeHandler { content -> onCallWakePush(content) }
        // §9.2 `call_end` revocation: disconnect the OS call for the session
        // (the server-resolved teardown, capability-gated on the `call_end`
        // cap this client already registers) and bring the in-app leg down.
        PushHooks.callEndHandler = CallEndHandler { content ->
            content.callSessionId?.let { session ->
                runCatching { registry.disconnect(session) }
                core.onCallEndPush(session)
            }
        }
    }

    // ------------------------------------------------------- the Telnyx bridge

    /**
     * The Telnyx-media side of the two engines (§8). Telecom owns presentation
     * + audio; these ops act on [SoftphoneCore]'s leg for a session. Every one
     * is best-effort and must never throw back into a Telecom callback.
     */
    private inner class TelecomBridge : TelecomCallRegistry.Bridge {
        override fun acceptLeg(session: String): Boolean =
            legFor(session)?.let { answer(it.id); true } ?: false

        override fun endLeg(session: String) {
            legFor(session)?.let { hangup(it.id) }
        }

        override fun holdLeg(session: String, hold: Boolean) {
            val call = legFor(session) ?: return
            val isHeld = call.phase == CallPhase.HELD
            if (hold != isHeld) core.toggleHold(call.id)
        }

        /** Member-scoped server signal ONLY — the OS callback that triggered
         *  this already owns the leg teardown (§3.3). */
        override fun declineMine() = core.declineMineSignal()

        override fun releaseHeldSession(session: String) = core.releaseHeldForSession(session)

        /** Per-session decline (IMPORTANT-4) — drop this device from ONLY the
         *  rejected session, so a reject with another ring live doesn't decline
         *  both. The OS callback already owns the leg teardown. */
        override fun declineSession(session: String) = core.declineSessionSignal(session)

        /** Follower route mirror (§4.2/§4.3) — Telnyx follows Telecom's endpoint. */
        override fun mirrorRouteToTelnyx(route: AudioRoute) = core.setAudioRoute(route)

        override fun onCallRegistered(session: String, callerName: String, callerNumber: String) {
            notifier.showConnecting(session, callerName)
        }

        override fun onCallUnregistered(session: String) {
            notifier.cancelConnecting(session)
        }

        override fun showIncomingCall(session: String, callerName: String, callerNumber: String) {
            notifier.showIncoming(session, callerName, callerNumber)
        }

        override fun cancelIncomingCall(session: String) {
            notifier.cancelIncoming(session)
        }

        private fun legFor(session: String): CallSnapshot? {
            // Match on the customer session (the steady-state key) OR the leg's
            // own id — a header-absent OS call is keyed on the leg id, since its
            // session only resolves post-answer (IMPORTANT-2).
            val calls = core.state.value.calls.filter {
                it.direction == CallDirection.INBOUND && it.phase != CallPhase.ENDED &&
                    (it.sessionId == session || it.id == session)
            }
            return calls.firstOrNull { it.phase == CallPhase.RINGING } ?: calls.firstOrNull()
        }
    }

    // ------------------------------------------------------ wake path (§5/§10.2)

    /**
     * A `kind:'call'` push. §5 wake path: register the OS incoming call NOW
     * (locked included) so the system shows its incoming UI pre-INVITE, THEN
     * ring-me so the Telnyx leg binds to the already-registered call by header.
     * One retry on a real failure; a ring is never dropped silently.
     */
    private fun onCallWakePush(content: PushContent) {
        val session = content.callSessionId
        if (session == null) {
            postPushNotification(appContext, content)
            return
        }
        val callerHint = CallWakePolicy.callerHintFromPushBody(content.body)
        // §5: OS shows the incoming UI from the push, pre-INVITE (idempotent
        // with the INVITE trigger — one Telecom call per session).
        runCatching { registry.ensureIncomingCall(session, content.title, callerHint.orEmpty()) }
        scope.launch {
            try {
                core.onIncomingCallPush(session, callerHint)
            } catch (cause: CancellationException) {
                throw cause
            } catch (_: Exception) {
                delay(1_500)
                try {
                    core.onIncomingCallPush(session, callerHint)
                } catch (cause: CancellationException) {
                    throw cause
                } catch (_: Exception) {
                    postPushNotification(appContext, content)
                }
            }
        }
    }

    // -------------------------------------------------------------- lifecycle

    /** #168D: the interrupted-call line is claimed at most once per process. */
    @Volatile
    private var postCrashChecked = false

    /**
     * Register (or keep) the softphone for a company. Idempotent and silent on
     * failure. Also registers the self-managed PhoneAccount with Telecom (via
     * [TelecomCallRegistry.registerOnce]) — no manual `registerPhoneAccount`.
     */
    fun start(companyId: String, callerIdName: String = "") {
        runCatching { registry.registerOnce() }
        surfaceInterruptedCallOnce()
        core.start(companyId, callerIdName)
    }

    /**
     * #168 part D: if the LAST crash happened while the 'call in flight' marker
     * was up, the process died mid-call — say so, once, calmly.
     */
    private fun surfaceInterruptedCallOnce() {
        if (postCrashChecked) return
        postCrashChecked = true
        runCatching {
            val markerSetAt = diagnostics.callMarker.setAtMs() ?: return
            val interrupted = PostCrashHonesty.callInterruptedByCrash(
                markerSetAtMs = markerSetAt,
                lastCrashAtMs = diagnostics.store.lastCrashAtMs(),
            )
            diagnostics.callMarker.clear()
            if (interrupted) {
                core.reportUiError("A call was interrupted when the app closed unexpectedly.")
            }
        }
    }

    fun retryNow() = core.retryNow()

    fun clearError() = core.clearError()

    /**
     * Push-to-wake / notification-tap wake (calls-v3 §10.2). Also registers the
     * OS incoming call so a tray-fallback / cold-start tap lands the OS UI, not
     * an empty calls list. conflict/not_found are swallowed by contract.
     */
    suspend fun onIncomingCallPush(sessionId: String, callerHint: String? = null) {
        runCatching { registry.ensureIncomingCall(sessionId, "Incoming call", callerHint.orEmpty()) }
        core.onIncomingCallPush(sessionId, callerHint)
    }

    /**
     * Realtime `call.updated` reconciliation (calls-v3 §9.1/§10.1): a
     * ringing-exit state tears down this device's OS call for the session
     * (the server also sends the BYE / `call_end`).
     */
    fun onCallSessionUpdate(sessionId: String, state: String?) {
        if (CallWakePolicy.isRingingExit(state)) runCatching { registry.disconnect(sessionId) }
        core.onCallSessionUpdate(sessionId, state)
    }

    fun hasMicPermission(): Boolean =
        appContext.checkSelfPermission(Manifest.permission.RECORD_AUDIO) ==
            PackageManager.PERMISSION_GRANTED

    /** The company the softphone last registered. */
    fun currentCompanyId(): String? = core.companyId

    // -------------------------------------------------------------------- ops

    suspend fun placeCall(
        displayName: String,
        conversationId: String? = null,
        contactId: String? = null,
        to: String? = null,
        phoneNumberId: String? = null,
    ) = core.placeCall(
        displayName = displayName,
        conversationId = conversationId,
        contactId = contactId,
        to = to,
        phoneNumberId = phoneNumberId,
    )

    /** Answer the incoming call for [session] from the app's own ring surface
     *  (the `CallStyle` notification / [CallActivity]) — self-managed
     *  Telecom has no OS answer surface, so this is how the user answers. Drives
     *  the Telecom registry's answer (OS answer + accept the Telnyx leg). */
    fun answerIncoming(session: String) {
        runCatching {
            markedCallInFlight = true
            diagnostics.callMarker.set()
        }
        // Re-assert the call foreground service now that we're answering. If it
        // started at RING time before RECORD_AUDIO was granted it is running
        // phoneCall-only, which does not carry the background mic-capture right;
        // restarting re-evaluates the type and upgrades it to include microphone
        // (idempotent — same notification id, no user-visible change).
        runCatching { CallForegroundService.start(appContext, "Ongoing call") }
        val handled = runCatching { registry.answerFromNotification(session) }.getOrDefault(false)
        if (!handled) {
            // No registry entry (cold process, or the OS call already cleaned up):
            // never let Answer be a no-op — accept the core's ringing leg for this
            // session directly, matching how the bridge resolves a leg.
            val leg = core.state.value.calls.firstOrNull {
                it.direction == CallDirection.INBOUND && it.phase == CallPhase.RINGING &&
                    (it.sessionId == session || it.id == session)
            }
            leg?.let { runCatching { core.answer(it.id) } }
        }
    }

    /**
     * Answer a RINGING leg from an IN-APP surface. An inbound ring must go through
     * the registry (OS answer transition + accept + cancel the ring notification):
     * calling [answer] straight into the core left the `CallStyle` ring posted for
     * the whole call, and its Decline could later hang up the live call.
     */
    fun answerRinging(call: CallSnapshot) {
        if (call.direction == CallDirection.INBOUND) {
            answerIncoming(call.sessionId ?: call.id)
        } else {
            answer(call.id)
        }
    }

    /** Decline the incoming call for [session] from the app's own ring. A Decline
     *  must NEVER be a local-only no-op: if the registry has no entry (a cold /
     *  killed process where the SDK never bound this ring), route a member-scoped
     *  fire-and-forget server decline so the caller stops ringing. */
    fun declineIncoming(session: String) {
        val handled = runCatching { registry.declineFromNotification(session) }.getOrDefault(false)
        if (!handled) runCatching { core.declineCurrent(sessionHint = session) }
    }

    /** Answer a ringing call (any active call is held first). */
    fun answer(id: String) {
        // #168D: stamp the in-flight marker at the ANSWER moment — the crash
        // this issue chases happened between accept and ACTIVE.
        runCatching {
            markedCallInFlight = true
            diagnostics.callMarker.set()
        }
        // Every accept path must re-assert the FGS: one started at ring time (before
        // RECORD_AUDIO existed) is phoneCall-only and carries no background mic right.
        runCatching { CallForegroundService.start(appContext, "Ongoing call") }
        core.answer(id)
    }

    /** Decline a ringing call / hang up a live one. */
    fun hangup(id: String) {
        userHungUp.add(id)
        core.hangup(id)
    }

    /** Universal user Decline (#171 R1) — member-scoped decline-mine + optional
     *  per-session + local teardown, routed through the core. */
    fun declineCurrent(callId: String? = null, sessionHint: String? = null) {
        callId?.let { userHungUp.add(it) }
        core.declineCurrent(callId, sessionHint)
    }

    fun toggleHold(id: String) = core.toggleHold(id)

    fun setMuted(id: String, muted: Boolean) = core.setMuted(id, muted)

    fun dtmf(id: String, digit: String) = core.dtmf(id, digit)

    fun dismiss(id: String) = core.dismiss(id)

    /** §4.2: the user's route choice flows through Telecom (authoritative
     *  router); Telnyx follows. We never lead the route from the SDK. */
    fun setAudioRoute(route: AudioRoute) = registry.requestRoute(route)

    suspend fun liveFacts(sessionId: String): LiveCallFacts = core.liveFacts(sessionId)

    suspend fun transferTargets(sessionId: String): TransferTargets =
        core.transferTargets(sessionId)

    suspend fun blindTransfer(sessionId: String, targetUserId: String): TransferAck =
        core.blindTransfer(sessionId, targetUserId)

    // ----------------------------------------------------------- core events

    private fun onCoreEvent(event: CoreEvent) {
        when (event) {
            is CoreEvent.IncomingRinging -> onIncomingRinging(event)
            is CoreEvent.OutgoingPlaced -> {
                // §7: outbound registers with Telecom too (same audio ownership).
                registry.ensureOutgoingCall(
                    event.call.id, event.call.peerName, event.call.peerNumber,
                )
            }
        }
    }

    /**
     * An inbound INVITE bound. §3.2: when the `X-Loonext-Session` header set the
     * session, the OS call keys on it (idempotent with the FCM push) and the leg
     * binds by MATCHING the header — never the caller. Header absent → by-leg
     * fallback within [TelecomCallReducer.LEG_RESOLVE_DEADLINE_MS] → honest
     * teardown (never a mystery call, never a caller guess).
     */
    private fun onIncomingRinging(event: CoreEvent.IncomingRinging) {
        val call = event.call
        val session = call.sessionId
        if (session != null) {
            registry.ensureIncomingCall(session, call.peerName, call.peerNumber)
            registry.onLegBound(session, call.id)
            return
        }
        // §3.2 header ABSENT. The header is the shipped steady state (the server
        // stamps X-Loonext-Session on every ring dial), so this is a legacy/edge
        // path — but a legitimate inbound call must NEVER be dropped (IMPORTANT-2).
        // The by-leg resolve is BEST-EFFORT: the SDK exposes no call_control_id
        // pre-answer, so GET /by-leg 404s until the customer session resolves
        // AFTER answer (getTelnyxCallControlId works post-accept, via the core's
        // resolveSession). Present regardless; never hang up a real call here.
        val legId = event.legId
        scope.launch {
            val resolved = legId?.let {
                withTimeoutOrNull(TelecomCallReducer.LEG_RESOLVE_DEADLINE_MS) {
                    core.resolveSessionByLeg(it)
                }
            }
            if (resolved != null) {
                registry.ensureIncomingCall(resolved, call.peerName, call.peerNumber)
                registry.onLegBound(resolved, call.id)
            } else {
                // Present the OS call keyed on the leg's own id — never a hangup.
                // The customer session (for server-side ops) is filled in by the
                // core's post-answer resolveSession; the leg's own BYE and the
                // §5 ring-window backstop cover teardown.
                diagnostics.recordNonFatal(
                    "incoming-header-absent",
                    IllegalStateException(
                        "inbound leg presented without a correlated session (header absent, by-leg unresolved) — best-effort",
                    ),
                )
                registry.ensureIncomingCall(call.id, call.peerName, call.peerNumber)
                registry.onLegBound(call.id, call.id)
            }
        }
    }

    // ----------------------------------------------------- state -> platform

    /**
     * Drive the OS-facing surfaces from the one leg-state snapshot. Telecom now
     * owns presentation; this method shrank to (1) the App→OS leg→scope mirror
     * (§7/§8), (2) the ongoing-call notification mirror, and (3) the #168D
     * call-in-flight marker. Everything the old `syncPlatform` did — telecom
     * report, ringer, notification ring, audio focus — is now the OS's job.
     */
    private fun syncPlatform(snapshot: SoftphoneSnapshot) {
        val byId = snapshot.calls.associateBy { it.id }

        // App→OS. Two things per pass, both level-triggered off this one snapshot:
        //  1. Tell the registry the AUTHORITATIVE live-leg set of every inbound
        //     session — presented legs ∪ silently-held legs. A RINGING leg's death
        //     is invisible in `calls` (CallStateMachine drops it) and held legs are
        //     never in `calls`, so this recomputed-every-pass set is how the
        //     registry learns a session's last leg is gone (end the OS call) or its
        //     owner died with a sibling still live (re-home) — see setLiveLegs.
        //  2. Drive each present leg's own state (the §7/§8 leg→scope mirror).
        val liveInbound = LinkedHashMap<String, MutableSet<String>>()
        for (call in snapshot.calls) {
            if (call.direction != CallDirection.INBOUND || call.phase == CallPhase.ENDED) continue
            liveInbound.getOrPut(call.sessionId ?: call.id) { LinkedHashSet() }.add(call.id)
        }
        for ((session, held) in snapshot.heldLegsBySession) {
            liveInbound.getOrPut(session) { LinkedHashSet() }.addAll(held)
        }
        runCatching {
            // Every session with legs now, plus every one that had legs last pass
            // (so a now-empty session gets its final setLiveLegs(∅) → teardown).
            for (session in liveInbound.keys + liveLegSessions) {
                registry.setLiveLegs(session, liveInbound[session] ?: emptySet())
            }
            for (call in snapshot.calls) {
                val legState = legStateFor(call)
                when (call.direction) {
                    CallDirection.INBOUND ->
                        registry.driveInbound(call.sessionId ?: call.id, call.id, legState)

                    CallDirection.OUTBOUND -> registry.driveOutbound(call.id, legState)
                }
            }
        }.onFailure { diagnostics.recordNonFatal("sync-scope", it) }
        liveLegSessions = liveInbound.keys.toSet()

        // Ongoing-call notification mirrors the active (or lone held) call.
        runCatching {
            val live = snapshot.liveCalls.filter { it.phase != CallPhase.RINGING }
            val featured = snapshot.activeCall ?: live.firstOrNull()
            if (featured != null) {
                notifier.showOngoing(featured)
                // The within-5s ring-phase notification hands off to the ongoing one.
                featured.sessionId?.let { notifier.cancelConnecting(it) }
            } else {
                notifier.cancelOngoing()
            }
        }.onFailure { diagnostics.recordNonFatal("sync-notification", it) }

        // #168D: the 'call in flight' marker — up while any answered/placed leg
        // lives, down when the line clears (only this process's own stamp).
        runCatching {
            val anyInFlight = snapshot.calls.any {
                it.phase == CallPhase.CONNECTING ||
                    it.phase == CallPhase.ACTIVE ||
                    it.phase == CallPhase.HELD
            }
            val lineIdle = snapshot.calls.none { it.phase != CallPhase.ENDED }
            if (anyInFlight && !markedCallInFlight) {
                markedCallInFlight = true
                diagnostics.callMarker.set()
            } else if (lineIdle && markedCallInFlight) {
                markedCallInFlight = false
                diagnostics.callMarker.clear()
            }
        }

        // Reap teardown-tracking for calls that are gone.
        userHungUp.retainAll { byId.containsKey(it) }
    }

    /** Map a leg's [CallPhase] to the richer [TelecomCallReducer.LegState] the
     *  §7 mirror table consumes (LOCAL vs REMOTE hangup from who tore down). */
    private fun legStateFor(call: CallSnapshot): TelecomCallReducer.LegState = when (call.phase) {
        CallPhase.CONNECTING -> TelecomCallReducer.LegState.DIALING
        CallPhase.RINGING -> TelecomCallReducer.LegState.RINGING
        CallPhase.ACTIVE -> TelecomCallReducer.LegState.ACTIVE
        CallPhase.HELD -> TelecomCallReducer.LegState.HELD
        CallPhase.ENDED ->
            if (call.id in userHungUp) TelecomCallReducer.LegState.DONE_LOCAL
            else TelecomCallReducer.LegState.DONE_REMOTE
    }

    // -------------------------------------------------- watchdog triggers

    private fun watchNetwork() {
        val connectivity =
            appContext.getSystemService(android.net.ConnectivityManager::class.java) ?: return
        runCatching {
            connectivity.registerDefaultNetworkCallback(
                object : android.net.ConnectivityManager.NetworkCallback() {
                    override fun onAvailable(network: android.net.Network) {
                        core.scheduleRecover()
                    }
                },
            )
        }
    }

    private fun watchForeground() {
        scope.launch {
            ProcessLifecycleOwner.get().lifecycle.addObserver(
                LifecycleEventObserver { _, event ->
                    if (event == Lifecycle.Event.ON_START) core.scheduleRecover()
                },
            )
        }
    }
}
