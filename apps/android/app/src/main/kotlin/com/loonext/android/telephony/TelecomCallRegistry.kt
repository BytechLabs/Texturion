package com.loonext.android.telephony

import android.content.Context
import android.net.Uri
import android.telecom.DisconnectCause
import androidx.core.telecom.CallAttributesCompat
import androidx.core.telecom.CallControlResult
import androidx.core.telecom.CallControlScope
import androidx.core.telecom.CallEndpointCompat
import androidx.core.telecom.CallsManager
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.collectLatest
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import java.util.concurrent.ConcurrentHashMap

/**
 * The single owner of every call the OS sees (#171, docs/CALLS-CLIENT-V2.md
 * §3-§8). One `androidx.core.telecom` call per `call_session_id`, from
 * whichever trigger arrives first (FCM wake OR live-socket INVITE), deduped in
 * this one process-wide registry. The OS owns presentation, the audio mode,
 * the mic FGS, and the route; this class connects/disconnects the Telnyx leg
 * from the OS callbacks via the [Bridge].
 *
 * All decision logic lives in the pure, JVM-tested [TelecomCallReducer]; this
 * class is the thin platform executor. Crash-safe at every telephony boundary
 * (#168A): every OS/SDK touch is `runCatching`-guarded and the addCall
 * coroutines ride the caller's supervised scope — a Telecom transaction that
 * throws can never take the process (and a live call) down.
 */
class TelecomCallRegistry(
    context: Context,
    private val scope: CoroutineScope,
    private val bridge: Bridge,
    private val onFailure: (String, Throwable) -> Unit = { _, _ -> },
) {
    /**
     * The Telnyx-media side of the two engines. [TelecomCallRegistry] owns
     * presentation + audio via Telecom; the [Bridge] performs the media ops on
     * [SoftphoneCore]'s leg for a session. Every method is best-effort and must
     * never throw back into a Telecom callback.
     */
    interface Bridge {
        /** Accept the ring leg bound to [session] (§3.3 — the media connect).
         *  Returns false when NO leg could be resolved for the session — the call
         *  re-homed to a still-held duplicate that has not been promoted into the
         *  media state yet, so there is nothing to answer. The caller then re-arms
         *  the bind deadline instead of committing a media-less accept. */
        fun acceptLeg(session: String): Boolean

        /** End the Telnyx leg for [session] (OS disconnect / bind-deadline). */
        fun endLeg(session: String)

        /** Hold / resume the Telnyx leg for [session] (OS set inactive/active). */
        fun holdLeg(session: String, hold: Boolean)

        /** Member-scoped decline-mine — resolve the answer race elsewhere. Drops
         *  THIS device from EVERY currently-ringing session; the correct signal
         *  for a lone ring. */
        fun declineMine()

        /** Per-session decline (IMPORTANT-4): drop THIS device from ONLY [session].
         *  Used when more than one ring is presented, so rejecting one does not
         *  decline the others (which member-scoped `declineMine` would). */
        fun declineSession(session: String)

        /** Drop any silently-HELD duplicate/capacity fork of [session] the core is
         *  tracking, so a leg the user just DECLINED can never be promoted into a
         *  fresh ring before the server's BYE reaps it (HIGH re-review). Best-effort. */
        fun releaseHeldSession(session: String)

        /** Follower route mirror (§4.2/§4.3): Telecom picked [route]; tell Telnyx
         *  (never the leader — the user's route control is the OS in-call UI). */
        fun mirrorRouteToTelnyx(route: AudioRoute)

        /** Post/cancel the within-5s call notification that keeps foreground
         *  priority — and thus the `phoneCall` mic FGS (§3.1/I4). */
        fun onCallRegistered(session: String, callerName: String, callerNumber: String)
        fun onCallUnregistered(session: String)

        /** Post the incoming RING (self-managed → the OS shows no incoming UI, so
         *  the app must; a `CallStyle` notification + full-screen intent whose
         *  Answer/Decline drive this registry). Cancel when answered or ended. */
        fun showIncomingCall(session: String, callerName: String, callerNumber: String)
        fun cancelIncomingCall(session: String)
    }

    private val appContext = context.applicationContext
    private val callsManager = CallsManager(appContext)

    @Volatile
    private var registered = false

    /**
     * One entry per call key (inbound: the session S; outbound: "out:"+id).
     *
     * CONCURRENCY: the answer-phase flags ([scope]/[answered]/[accepted]/
     * [terminated]/[pendingDisconnectCause]) are driven from several threads that
     * genuinely interleave — the OS callbacks (onAnswer/onDisconnect), the addCall
     * block acquiring the scope, onLegBound from the SDK, and the bind-deadline /
     * ring-window timers. Each is @Volatile for visibility, but any COMPOUND
     * transition that must be all-or-nothing (publish-scope-and-decide,
     * commit-the-accept, latch-terminated-and-snapshot-accepted) runs inside
     * `synchronized(entry)`. The lock is held ONLY around the flag reads/writes —
     * never around a `bridge.*` call or a `control.launch { }` — so it can't block
     * a dispatcher or deadlock. This is what makes "accept onto a terminated call"
     * and "answer a call a teardown just ended" structurally impossible rather than
     * merely improbable (HIGH/MEDIUM re-review findings).
     */
    private class CallEntry(
        val key: String,
        val direction: Int,
    ) {
        @Volatile var scope: CallControlScope? = null

        /**
         * The user answered this call (onAnswer fired) — a PERSISTENT signal, set
         * once and never cleared. It is deliberately distinct from [answered] (the
         * OS `answer()` transition has been issued) and [accepted] (the Telnyx leg
         * is connected): those two flip at different moments and each guards its
         * own idempotent op, whereas the leg-bind path needs the durable "the user
         * wants this call" fact. A leg that binds AFTER the OS answer already went
         * out must still be accepted — gating that accept on a transient
         * "answer-issued" flag stranded the answered call in dead air (the I3 race
         * fix). onLegBound therefore accepts whenever `answerRequested && !accepted`.
         */
        @Volatile var answerRequested = false

        /** The framework-supplied call type from `onAnswer` — forwarded VERBATIM
         *  to `answer(callType)` (BLOCKING-1). Defaults to audio. */
        @Volatile var callType: Int = CallAttributesCompat.CALL_TYPE_AUDIO_CALL

        /** The OS answer transition (`answer(callType)`) has been issued on the
         *  scope — guards against a double-answer when onAnswer races the addCall
         *  block (I3): `answer()` on an already-answered call is an Error. */
        @Volatile var answered = false

        /** The Telnyx leg has been accepted (media connected). */
        @Volatile var accepted = false

        /**
         * The owning leg actually reached ACTIVE — media is genuinely flowing. This
         * is stronger than [accepted]: `answer()` can be issued (accepted=true) onto
         * a RINGING leg that the caller BYE'd in the same instant (answer glare), so
         * the leg dies without ever going ACTIVE. [setLiveLegs] must protect only a
         * truly-active call; an accepted-but-never-active leg that vanishes has to be
         * re-homed / torn down like any other (else the OS call strands "connected"
         * on dead media — HIGH re-review finding).
         */
        @Volatile var mediaActive = false

        /**
         * A disconnect requested while [scope] was still null (the addCall block
         * had not run) — its `scopeOp` no-op'd because there was no scope to run
         * it on. The addCall block MUST deliver this cause the instant it acquires
         * the scope, else the OS call strands admitted-but-never-disconnected
         * (HIGH re-review finding). Set once, by the first teardown that races
         * ahead of the scope; read only under the per-entry lock.
         */
        @Volatile var pendingDisconnectCause: DisconnectCause? = null

        /** A leg is bound for this session (INVITE arrived). */
        @Volatile var legBound = false

        /**
         * The leg that OWNS this OS call (BLOCKING-2b). Two INVITEs can share one
         * `call_session_id` (anonymous caller + ring-me re-dial); the OS call is
         * keyed on S, so a reaped SIBLING leg's terminal state must NEVER tear
         * down the entry the answered leg owns. Set when a leg binds/goes active.
         */
        @Volatile var owningLegId: String? = null

        @Volatile var terminated = false

        /** The last scope op driven (App→OS mirror idempotency). */
        @Volatile var lastAction: TelecomCallReducer.ScopeAction? = null

        var deadlineJob: Job? = null

        /** §5 ghost-ring backstop timer (IMPORTANT-5) — armed for push-registered
         *  inbound calls, cancelled once a leg binds/accepts. */
        var ringWindowJob: Job? = null
    }

    private val entries = ConcurrentHashMap<String, CallEntry>()

    /** §9.1: register the self-managed PhoneAccount once. Idempotent, silent on
     *  failure — a call is never blocked by a registration blip (the watchdog
     *  and the next call retry). */
    fun registerOnce() {
        if (registered) return
        synchronized(this) {
            if (registered) return
            registered = runCatching {
                callsManager.registerAppWithTelecom(CallsManager.CAPABILITY_BASELINE)
            }.onFailure { onFailure("telecom-register", it) }.isSuccess
        }
    }

    // ---------------------------------------------------------- inbound (§3/§5)

    /**
     * §3 invariant — exactly ONE Telecom call per [session]. Idempotent: the
     * first trigger (FCM push OR INVITE) does `addCall`; every later trigger
     * for the same S reuses the handle. Safe to call from the FCM-woken process
     * (pre-INVITE, locked included) and from the INVITE handler.
     */
    fun ensureIncomingCall(session: String, callerName: String, callerNumber: String) {
        if (session.isBlank()) return
        registerOnce()
        // NOTE: do NOT evict a terminated-but-uncleaned entry here to let a
        // same-session re-presentation through. That was tried and reverted: a
        // user REJECT terminates the entry, then SoftphoneCore's synchronous
        // maybePromoteHeld→presentIncoming re-enters this method for the promoted
        // duplicate fork — so the eviction re-rang a call the user had just
        // declined (and answering it would accept media on a session whose
        // decline was already sent). The promoted-fork missed-ring is real but
        // needs the leg-gone signal (see the note on onLegBound below), not this.
        if (!TelecomCallReducer.shouldAddCall(entries.keys, session)) return
        val entry = CallEntry(session, CallAttributesCompat.DIRECTION_INCOMING)
        if (entries.putIfAbsent(session, entry) != null) return // lost the race
        // SELF-MANAGED reality: Telecom draws no incoming UI, so WE ring. Posted
        // once per fresh registration (a duplicate push/INVITE returned above, so
        // it never re-rings). Answer/Decline on it drive [answerFromNotification]/
        // [declineFromNotification].
        runCatching { bridge.showIncomingCall(session, callerName, callerNumber) }
        // Hold the process AND the mic from the moment the call exists. Jetpack
        // Telecom does NOT run a foreground service (verified: core-telecom only
        // calls startForeground in InCallServiceCompat, the dialer path), so
        // without this an answer from the notification/lock screen has no mic
        // ("the caller can't hear me") and swiping the app away kills the call.
        CallForegroundService.start(appContext, callerName.ifBlank { "Incoming call" })
        launchAddCall(entry, callerName, callerNumber, address = callerNumber)
        armRingWindow(entry)
    }

    /**
     * The header-matched INVITE bound after (or with) the OS call registration
     * (§3.2/§5). If an answer is pending (the user answered from the lock screen
     * before the leg arrived), accept now and clear the bind deadline. [legId]
     * claims ownership of the OS call for this leg (BLOCKING-2b) so a reaped
     * sibling leg sharing the session can never disconnect it.
     *
     * OWNERSHIP CAN CHANGE HANDS. A RINGING leg's death is invisible in the
     * snapshot ([CallStateMachine] drops a RINGING call when it ENDs) and held
     * duplicate legs are never in the snapshot at all — so the death of the leg
     * that OWNS a session's OS call, while a sibling is still live, reaches the
     * registry only through [setLiveLegs] (the authoritative presented∪held set,
     * recomputed every snapshot). [setLiveLegs] clears [owningLegId] on such a
     * re-home; the surviving or promoted leg then claims it HERE. DO NOT re-try the
     * reverted approaches (an ensureIncomingCall eviction re-rings a just-declined
     * call; a re-home keyed on per-leg terminal drives never fires — the death is
     * invisible; a per-leg edge callback drops/severs under buffering and promotion).
     */
    fun onLegBound(session: String, legId: String? = null) {
        val entry = entries[session] ?: return
        // A leg that binds AFTER the OS call was torn down (bind deadline / reject
        // / remote hangup set terminated, but the suspend addCall hasn't returned
        // so the entry is still resolvable) must NEVER be accepted: answerRequested
        // is durable, so accepting here would put Telnyx media on a phone whose OS
        // call is already gone (silent one-way air) AFTER declineMine handed the
        // answer to a teammate — a double-answer / cross-wire. End the orphan leg
        // and stop (BLOCKING re-review finding). The pure reducer encodes the same
        // veto; this is the executor-side guard that also tears the stray leg down.
        if (entry.terminated) {
            // ...but ONLY hang up the leg this dying entry actually OWNS. A binding
            // leg whose id differs is a NEW leg for the same session (a promoted
            // duplicate fork / ring-me re-dial) — hanging it up would kill a LIVE
            // ring with no user action and the user would miss the call (HIGH
            // re-review finding). `bridge.endLeg` resolves legFor(session), which
            // would pick that new RINGING leg, so the guard must be here. The
            // owningLegId == null / legId == null escapes preserve the original
            // answer-before-bind orphan teardown.
            if (entry.owningLegId == null || legId == null || legId == entry.owningLegId) {
                runCatching { bridge.endLeg(session) }
            }
            return
        }
        entry.legBound = true
        // Claim ownership if unowned — including after a re-home cleared it
        // ([setLiveLegs] sets owningLegId=null when the previous owner dies with a
        // sibling still live, so a promoted/surviving leg takes over here).
        if (entry.owningLegId == null) entry.owningLegId = legId
        entry.ringWindowJob?.cancel() // a leg bound — no ghost ring to backstop
        val actions = TelecomCallReducer.onLegBound(entry.answerRequested, entry.accepted, entry.terminated)
        runActions(entry, actions)
    }

    /**
     * §10.1.4: the AUTHORITATIVE set of legs currently live for [session] —
     * presented ∪ silently-held — recomputed from the snapshot and pushed on every
     * emission (level-triggered), because a RINGING leg's death is invisible to the
     * snapshot's `calls` (CallStateMachine drops it) and held legs are never in
     * `calls` at all. This ONE signal replaces the fragile per-leg edge callbacks
     * that earlier rounds kept getting wrong (a dropped hold-time signal when the
     * entry did not exist yet; a severed signal when promotion cancelled the
     * watcher; a stale accumulation under conflated emissions). From the always-
     * current set it derives, pre-accept only:
     *  - EMPTY and a leg had bound → the whole session is gone; end the OS call
     *    (the lone-ring ghost fix — no dependency on the server `call_end` push).
     *  - non-empty but the OWNER is no longer in it → the owner died while a sibling
     *    lives (a duplicate fork / ring-me re-dial); clear ownership so the survivor
     *    or the promoted leg claims it via onLegBound, and DON'T tear down.
     * An accepted or already-terminated call is never touched (its lifetime is the
     * media's, driven through the normal leg-state path).
     */
    fun setLiveLegs(session: String, legIds: Set<String>) {
        val entry = entries[session] ?: return
        val teardown = synchronized(entry) {
            when {
                entry.terminated -> false
                // Protect ONLY a truly-active call. An accepted-but-never-ACTIVE
                // leg (answer glare — answered as the caller BYE'd) is not real
                // media, so it is subject to re-home / teardown below like any
                // ringing leg (HIGH re-review finding).
                entry.accepted && entry.mediaActive -> false
                legIds.isEmpty() -> entry.legBound // all legs gone → end iff one had bound
                entry.owningLegId != null && entry.owningLegId !in legIds -> {
                    // Owner died with a sibling still live → re-home. Clear a stale
                    // glare-accept so the promoted/surviving leg re-accepts for real
                    // via onLegBound (the durable answerRequested carries the answer).
                    entry.owningLegId = null
                    entry.accepted = false
                    entry.lastAction = null
                    false
                }
                else -> false
            }
        }
        if (teardown) disconnectEntry(entry, DisconnectCause(DisconnectCause.REMOTE))
    }

    // -------------------------------------------------------- outbound (§7)

    /**
     * §7: outbound calls register with Telecom too (DIRECTION_OUTGOING) so they
     * get the SAME follower-routing + audio ownership — never half-migrated.
     * Keyed on the client-owned leg id (correlation is trivial; no header).
     */
    fun ensureOutgoingCall(callId: String, calleeName: String, calleeNumber: String) {
        if (callId.isBlank()) return
        registerOnce()
        val key = "out:$callId"
        if (!TelecomCallReducer.shouldAddCall(entries.keys, key)) return
        val entry = CallEntry(key, CallAttributesCompat.DIRECTION_OUTGOING)
        if (entries.putIfAbsent(key, entry) != null) return
        // Same reason as inbound: our own FGS is what grants the mic in the
        // background and keeps the process alive if the app is swiped away.
        CallForegroundService.start(appContext, calleeName.ifBlank { "Call" })
        launchAddCall(entry, calleeName, calleeNumber, address = calleeNumber)
    }

    // ------------------------------------------------ leg → scope mirror (§7/§8)

    /**
     * App→OS mirror: the Telnyx leg changed on its own (remote answered an
     * outbound dial, remote hung up, recovery landed) — drive the OS call to
     * follow the media (§7/§8 table via [TelecomCallReducer.mapLegState]).
     * Idempotent under repeated identical snapshots.
     */
    fun driveInbound(session: String, legId: String, legState: TelecomCallReducer.LegState) =
        drive(session, legId, legState, outbound = false)

    fun driveOutbound(callId: String, legState: TelecomCallReducer.LegState) =
        drive("out:$callId", callId, legState, outbound = true)

    private fun drive(
        key: String,
        legId: String,
        legState: TelecomCallReducer.LegState,
        outbound: Boolean,
    ) {
        // Find the entry by its key, OR by the leg that owns it — a header-absent
        // inbound call is keyed on the leg id and its server session resolves
        // AFTER answer, so the drive key can change out from under the entry.
        val entry = entries[key] ?: entries.values.firstOrNull { it.owningLegId == legId } ?: return
        // A torn-down entry (terminated by the bind deadline / reject / a prior
        // teardown that set the flag) follows NO further leg states — the OS call
        // is already ending. The teardown that SETS terminated still runs (the
        // flag is false until disconnectEntry flips it); only later drives no-op.
        if (entry.terminated) return
        // BLOCKING-2b: a SIBLING leg (different id) sharing this session must
        // never drive — least of all tear down — the entry the owning leg holds.
        // (Owner death / re-home is handled level-triggered by [setLiveLegs], not
        // here — a RINGING leg's death never reaches drive() at all.)
        if (!TelecomCallReducer.legMayDrive(entry.owningLegId, legId)) return
        // The owning leg reached ACTIVE → media is genuinely flowing; setLiveLegs
        // may now protect this call as a real connection (vs an answer-glare accept
        // onto a leg that died before going active).
        if (legState == TelecomCallReducer.LegState.ACTIVE) entry.mediaActive = true
        if (entry.owningLegId == null && legState == TelecomCallReducer.LegState.ACTIVE) {
            entry.owningLegId = legId
        }
        val action = TelecomCallReducer.mapLegState(legState, outbound, entry.lastAction)
        if (action == TelecomCallReducer.ScopeAction.NONE || action == entry.lastAction) return
        entry.lastAction = action
        when (action) {
            TelecomCallReducer.ScopeAction.SET_ACTIVE -> scopeOp(entry) { setActive() }
            TelecomCallReducer.ScopeAction.SET_INACTIVE -> scopeOp(entry) { setInactive() }
            TelecomCallReducer.ScopeAction.DISCONNECT_LOCAL ->
                disconnectEntry(entry, DisconnectCause(DisconnectCause.LOCAL))

            TelecomCallReducer.ScopeAction.DISCONNECT_REMOTE ->
                disconnectEntry(entry, DisconnectCause(DisconnectCause.REMOTE))

            TelecomCallReducer.ScopeAction.DISCONNECT_ERROR ->
                disconnectEntry(entry, DisconnectCause(DisconnectCause.ERROR))

            TelecomCallReducer.ScopeAction.NONE -> Unit
        }
    }

    /**
     * §4.2: Telecom is the authoritative router. A user route choice from the
     * in-call UI requests an OS endpoint change; Telnyx FOLLOWS via
     * [observeEndpoints]. We never call `setAudioOutputDevice` as the leader,
     * and never `setCommunicationDevice`/`startBluetoothSco`. No live scope →
     * no-op (route is the OS's to own).
     */
    fun requestRoute(route: AudioRoute) {
        // Scope the route change to the ACTIVE call (the one that owns the audio),
        // never a held second line (MINOR): a held call carries lastAction
        // SET_INACTIVE. Fall back to any live call if none is clearly active.
        val live = entries.values.filter { it.scope != null && !it.terminated }
        val control = (live.firstOrNull { it.lastAction != TelecomCallReducer.ScopeAction.SET_INACTIVE }
            ?: live.firstOrNull())?.scope
            ?: return
        scope.launch {
            runCatching {
                val endpoints = control.availableEndpoints.first()
                val target = endpoints.firstOrNull { endpointToRoute(it) == route }
                if (target != null) control.requestEndpointChange(target)
            }.onFailure { onFailure("telecom-route", it) }
        }
    }

    /** §9.2 `call_end` revocation / server-resolved teardown: disconnect the OS
     *  call for [session]. Unknown session → no-op. */
    fun disconnect(session: String) {
        val entry = entries[session] ?: return
        disconnectEntry(entry, DisconnectCause(DisconnectCause.REMOTE))
    }

    /**
     * Answer the incoming call for [session] from the app's OWN ring surface (the
     * `CallStyle` notification / [CallActivity]) — self-managed calls have
     * no OS answer surface, so this is how the user answers. Drives exactly the
     * path the framework `onAnswer` would: the OS answer transition + accept the
     * Telnyx leg (mic FGS engaged). Idempotent — a duplicate tap is harmless.
     */
    fun answerFromNotification(session: String) {
        val entry = entries[session] ?: return
        runCatching { bridge.cancelIncomingCall(session) }
        onTelecomAnswer(entry, CallAttributesCompat.CALL_TYPE_AUDIO_CALL)
    }

    /**
     * Decline the incoming call for [session] from the app's own ring — end the
     * Telnyx leg, tell the server (session-scoped when another ring is live, else
     * member-scoped), release the session's held forks so none re-rings, and tear
     * the OS call down. Mirrors a user reject.
     */
    fun declineFromNotification(session: String): Boolean {
        val entry = entries[session] ?: return false
        runCatching { bridge.cancelIncomingCall(session) }
        runCatching { bridge.endLeg(session) }
        declineForTeardown(entry)
        runCatching { bridge.releaseHeldSession(session) }
        disconnectEntry(entry, DisconnectCause(DisconnectCause.LOCAL))
        return true
    }

    // ------------------------------------------------------------- internals

    private fun launchAddCall(
        entry: CallEntry,
        callerName: String,
        callerNumber: String,
        address: String,
    ) {
        val attributes = runCatching {
            CallAttributesCompat(
                displayName = callerName.ifBlank { "Loonext" },
                address = Uri.fromParts("tel", address.ifBlank { "anonymous" }, null),
                direction = entry.direction,
                callType = CallAttributesCompat.CALL_TYPE_AUDIO_CALL,
                callCapabilities = CallAttributesCompat.SUPPORTS_SET_INACTIVE,
            )
        }.getOrElse {
            // addCall never launches, so its finally→cleanup (the only teardown
            // that cancels the ring) never runs — cancel the already-posted ring
            // + the ring-window timer here, or an IMPORTANCE_HIGH ring for a call
            // that will never present is stranded (LOW re-review).
            entry.ringWindowJob?.cancel()
            runCatching { bridge.cancelIncomingCall(entry.key.removePrefix("out:")) }
            entries.remove(entry.key, entry)
            onFailure("telecom-attrs", it)
            return
        }
        scope.launch {
            try {
                // `addCall` (suspend) admits the call and returns only when it is
                // terminal — that IS our "await terminal". The `block` below is
                // NON-suspend (CallControlScope is a CoroutineScope): it sets up
                // and returns; suspend scope ops run on `control.launch { … }`.
                callsManager.addCall(
                    attributes,
                    onAnswer = { callType -> onTelecomAnswer(entry, callType) },
                    onDisconnect = { cause -> onTelecomDisconnect(entry, cause) },
                    onSetActive = { onTelecomResume(entry) },
                    onSetInactive = { onTelecomHold(entry) },
                ) {
                    val session = entry.key.removePrefix("out:")
                    // Publish the scope AND decide what raced ahead of it in ONE
                    // atomic step (§ per-entry lock). This is the only window where
                    // a scope-dependent op (an answer OR a teardown) could have been
                    // requested while entry.scope was null and thus no-op'd; deciding
                    // under the same lock disconnectEntry/answerOnScope take means
                    // the block can never answer a call a concurrent teardown just
                    // terminated, nor miss a disconnect that fired first.
                    val reconcile = synchronized(entry) {
                        entry.scope = this
                        TelecomCallReducer.reconcileOnScope(
                            terminated = entry.terminated,
                            answerRequested = entry.answerRequested,
                            answered = entry.answered,
                        )
                    }
                    // §3.1/I4: keep foreground priority (and the mic FGS) within 5s.
                    // Inbound already posted its own RING in ensureIncomingCall;
                    // only an OUTBOUND dial shows the plain "Connecting…" here.
                    if (entry.direction == CallAttributesCompat.DIRECTION_OUTGOING) {
                        runCatching { bridge.onCallRegistered(entry.key, callerName, callerNumber) }
                    }
                    // Follower routing (§4.2/§4.3): mirror the OS endpoint into
                    // Telnyx — never lead, never touch setCommunicationDevice.
                    observeEndpoints(this)
                    when (reconcile) {
                        // Terminated before the scope existed — NEVER answer here.
                        // Deliver the disconnect ONLY when a cause was RECORDED (an
                        // app-requested disconnectEntry that no-op'd for lack of a
                        // scope; HIGH re-review finding). A null cause means the OS
                        // itself already tore the call down (onTelecomDisconnect set
                        // terminated) — there is nothing left to disconnect, so
                        // re-issuing would just Error on a dead call.
                        TelecomCallReducer.ScopeReconcile.DISCONNECT -> {
                            val cause = entry.pendingDisconnectCause
                            if (cause != null) scopeOp(entry) { disconnect(cause) }
                        }
                        // I3 catch-up: the user answered before the scope existed —
                        // issue the OS answer now (idempotent via entry.answered).
                        TelecomCallReducer.ScopeReconcile.ANSWER -> answerOnScope(entry, session)
                        TelecomCallReducer.ScopeReconcile.NONE -> Unit
                    }
                }
            } catch (cause: CancellationException) {
                throw cause
            } catch (cause: Exception) {
                // addCall refused (e.g. an emergency call in progress) — decline OUR
                // leg so the answer race resolves on a teammate's phone. Scoped so a
                // second live ring on this device isn't collaterally declined.
                onFailure("telecom-addcall", cause)
                declineForTeardown(entry)
            } finally {
                cleanup(entry)
            }
        }
    }

    /** onAnswer (§3.3): answer(callType) IMMEDIATELY, then accept-if-bound / arm
     *  the bind deadline. NEVER blocks on the leg binding. [callType] is the
     *  framework-supplied type, forwarded to `answer()` (BLOCKING-1). */
    private fun onTelecomAnswer(entry: CallEntry, callType: Int) {
        entry.callType = callType
        entry.answerRequested = true
        // Answered → the ring is over (any surface: our notification, BT, Auto).
        runCatching { bridge.cancelIncomingCall(entry.key.removePrefix("out:")) }
        runActions(entry, TelecomCallReducer.onAnswer(entry.legBound))
    }

    private fun onTelecomDisconnect(entry: CallEntry, cause: DisconnectCause) {
        // The OS tore the call down (reject / hang up from a remote surface).
        // `addCall` will return on its own; just end the Telnyx leg + resolve
        // the answer race elsewhere. No terminal signal to complete — the
        // suspend `addCall` completing is the terminal.
        //
        // Latch terminated and SNAPSHOT accepted atomically (§ per-entry lock): a
        // concurrent ACCEPT_LEG either committed before us (wasAccepted=true → we
        // treat this as a live-call hangup, no reject) or is blocked until we set
        // terminated=true (then its own locked check sees terminated and bails —
        // never accepts onto this torn-down call). Reading a plain @Volatile
        // accepted here would leave that window open (residual MEDIUM finding).
        val wasAccepted = synchronized(entry) {
            entry.terminated = true
            entry.accepted
        }
        runCatching { bridge.endLeg(entry.key.removePrefix("out:")) }
        // Not yet accepted → resolve the answer race elsewhere. Session-scoped when
        // another ring is live (IMPORTANT-4) so rejecting ONE presented ring never
        // declines them all — same scoping the automatic teardowns use.
        if (!wasAccepted) {
            declineForTeardown(entry)
            // A USER decline (LOCAL/REJECTED cause) means the user rejected the whole
            // SESSION — release its silently-held duplicate forks so the core cannot
            // promote one into a fresh ring before the server's BYE lands (HIGH
            // re-review). NOT on a REMOTE hangup: there, a sibling fork of a session
            // that is still ringing legitimately promotes. Worst case if the cause
            // is misread is a dropped fork the server re-rings via ring-me — far
            // better than re-ringing a call the user just declined.
            if (entry.direction == CallAttributesCompat.DIRECTION_INCOMING &&
                (cause.code == DisconnectCause.LOCAL || cause.code == DisconnectCause.REJECTED)
            ) {
                runCatching { bridge.releaseHeldSession(entry.key) }
            }
        }
    }

    private fun onTelecomResume(entry: CallEntry) {
        runCatching { bridge.holdLeg(entry.key.removePrefix("out:"), hold = false) }
    }

    private fun onTelecomHold(entry: CallEntry) {
        runCatching { bridge.holdLeg(entry.key.removePrefix("out:"), hold = true) }
    }

    private fun runActions(entry: CallEntry, actions: List<TelecomCallReducer.AnswerAction>) {
        val session = entry.key.removePrefix("out:")
        for (action in actions) {
            when (action) {
                TelecomCallReducer.AnswerAction.ANSWER -> answerOnScope(entry, session)
                TelecomCallReducer.AnswerAction.ARM_DEADLINE -> armBindDeadline(entry)
                TelecomCallReducer.AnswerAction.ACCEPT_LEG -> {
                    // Commit the accept atomically (§ per-entry lock): check
                    // "!accepted && !terminated" and set accepted=true in one step,
                    // so two racing ACCEPT_LEGs can't both fire (no double-accept),
                    // and a concurrent terminate can't slip its terminated=true
                    // between the check and the set (no accept onto a torn-down call
                    // — the residual MEDIUM the plain @Volatile check-then-set left
                    // open). [answerRequested] is left untouched — the durable "user
                    // answered" fact means a leg that binds later still routes here
                    // idempotently. bridge.acceptLeg runs OUTSIDE the lock.
                    val doAccept = synchronized(entry) {
                        if (!entry.accepted && !entry.terminated) {
                            entry.accepted = true
                            true
                        } else {
                            false
                        }
                    }
                    if (doAccept) {
                        // Only disarm the backstops once the bridge actually bound a
                        // leg. If the call had re-homed to a still-held duplicate,
                        // legFor(session) resolves nothing and acceptLeg returns
                        // false — committing accepted here would answer the OS call
                        // into permanent dead air with every timer already cancelled
                        // (BLOCKING re-review). Revert the accept and arm the bind
                        // deadline: the durable answerRequested makes the promoted
                        // leg's onLegBound perform the real accept, or the deadline
                        // tears the call down honestly within the budget.
                        val bound = runCatching { bridge.acceptLeg(session) }.getOrDefault(false)
                        if (bound) {
                            entry.deadlineJob?.cancel()
                            entry.ringWindowJob?.cancel()
                        } else {
                            val rearm = synchronized(entry) {
                                if (!entry.terminated) {
                                    entry.accepted = false
                                    true
                                } else {
                                    false
                                }
                            }
                            if (rearm) armBindDeadline(entry)
                        }
                    }
                }
            }
        }
    }

    /**
     * BLOCKING-1 + I1: the OS answer transition — `answer(callType)` on a RINGING
     * inbound call. Idempotent via [CallEntry.answered] so an onAnswer that races
     * the addCall block (I3) never double-answers. Scope not ready yet → no-op;
     * the block's catch-up re-runs onAnswer once [CallEntry.scope] exists. A
     * FAILED answer (Error/throw) is NOT swallowed — it escalates to honest
     * teardown (end the leg, decline-mine, disconnect the OS call) rather than
     * leaving a call the OS thinks is answered but that never went active.
     */
    private fun answerOnScope(entry: CallEntry, session: String) {
        val control = entry.scope ?: return // scope not ready — catch-up will answer
        // Commit the answer atomically (§ per-entry lock): idempotent via
        // [answered] (an onAnswer racing the block never double-answers), and
        // vetoed by [terminated] so a call a concurrent teardown just terminated
        // is never answered into dead air (reinforces the HIGH re-review fix; the
        // block's reconcile already routes terminated→disconnect, this closes the
        // gap where terminated flips true just after that decision).
        val doAnswer = synchronized(entry) {
            if (entry.answered || entry.terminated) {
                false
            } else {
                entry.answered = true
                true
            }
        }
        if (!doAnswer) return
        control.launch {
            val result = runCatching { control.answer(entry.callType) }
                .onFailure { onFailure("telecom-answer", it) }
                .getOrNull()
            if (result is CallControlResult.Error) {
                onFailure("telecom-answer", TelecomOpException("answer", result.errorCode))
                runCatching { bridge.endLeg(session) }
                disconnectEntry(entry, DisconnectCause(DisconnectCause.ERROR))
                // Scoped decline (not device-global) so a second live ring survives.
                declineForTeardown(entry)
            }
        }
    }

    /** §5 ghost-ring backstop (IMPORTANT-5): a push-registered inbound OS call
     *  whose leg never binds within the ring window is torn down honestly — no
     *  external dependency on the server `call_end` push. The tear-down decision
     *  is ATOMIC (claimTerminate): a leg that bound OR accepted right at the 45s
     *  boundary forces STAND_DOWN, so this late timer can never drop a call that
     *  just connected (the M1 twin — the same anti-pattern the bind deadline had). */
    private fun armRingWindow(entry: CallEntry) {
        if (entry.direction != CallAttributesCompat.DIRECTION_INCOMING) return
        entry.ringWindowJob?.cancel()
        entry.ringWindowJob = scope.launch {
            delay(TelecomCallReducer.RING_WINDOW_MS)
            val plan = claimTerminate(entry, DisconnectCause(DisconnectCause.ERROR)) {
                // Stand down UNLESS still a pure ghost (no leg bound, not accepted);
                // terminated is handled inside claimTerminate. Policy stays in the
                // pure reducer, evaluated here under the lock.
                !TelecomCallReducer.shouldRingWindowDisconnect(it.legBound, it.accepted, it.terminated)
            }
            if (plan == TerminatePlan.STAND_DOWN) return@launch
            runCatching { bridge.endLeg(entry.key) }
            if (plan == TerminatePlan.DISCONNECT_NOW) {
                scopeOp(entry) { disconnect(DisconnectCause(DisconnectCause.ERROR)) }
            }
        }
    }

    /** §3.3 bind deadline — the OS call can never ring answerable into permanent
     *  dead air. If the leg never accepts, tear it down honestly. The accept-vs-
     *  teardown decision is made ATOMICALLY (claimTerminate with an `accepted`
     *  stand-down): a leg that binds right at the deadline boundary either committed
     *  its accept
     *  first (deadline stands down — a connected call is NEVER dropped) or is
     *  blocked until the deadline claims `terminated` (its accept then bails).
     *  Reading `accepted` unlocked here dropped calls seconds after answer (MEDIUM
     *  re-review). */
    private fun armBindDeadline(entry: CallEntry) {
        val session = entry.key.removePrefix("out:")
        entry.deadlineJob?.cancel()
        entry.deadlineJob = scope.launch {
            delay(TelecomCallReducer.ANSWER_BIND_DEADLINE_MS)
            val plan = claimTerminate(entry, DisconnectCause(DisconnectCause.ERROR)) { it.accepted }
            if (plan == TerminatePlan.STAND_DOWN) return@launch
            // Tear down any half-bound Telnyx leg, deliver the OS disconnect if the
            // scope is up (else the addCall block delivers the recorded cause), and
            // resolve the answer race with a SESSION-SCOPED decline when another
            // ring is live (never collaterally decline a second ring).
            runCatching { bridge.endLeg(session) }
            if (plan == TerminatePlan.DISCONNECT_NOW) {
                scopeOp(entry) { disconnect(DisconnectCause(DisconnectCause.ERROR)) }
            }
            declineForTeardown(entry)
        }
    }

    private fun observeEndpoints(control: CallControlScope) {
        // On the CALL's own scope so it auto-cancels when the call ends.
        control.launch {
            runCatching {
                control.currentCallEndpoint.collectLatest { endpoint ->
                    endpointToRoute(endpoint)?.let { route ->
                        runCatching { bridge.mirrorRouteToTelnyx(route) }
                    }
                }
            }
        }
    }

    private fun endpointToRoute(endpoint: CallEndpointCompat): AudioRoute? = when (endpoint.type) {
        CallEndpointCompat.TYPE_SPEAKER -> AudioRoute.SPEAKER
        CallEndpointCompat.TYPE_BLUETOOTH -> AudioRoute.BLUETOOTH
        CallEndpointCompat.TYPE_EARPIECE, CallEndpointCompat.TYPE_WIRED_HEADSET ->
            AudioRoute.EARPIECE

        else -> null
    }

    /** How [claimTerminate] wants the OS disconnect delivered. */
    private enum class TerminatePlan {
        /** Already terminated, or the caller's `standDown` predicate held — do nothing. */
        STAND_DOWN,

        /** Terminated claimed; the scope was up — the caller issues `disconnect` now. */
        DISCONNECT_NOW,

        /** Terminated claimed but the scope wasn't up — the cause is recorded and the
         *  addCall block will deliver the disconnect the instant it publishes the scope. */
        RECORDED_FOR_BLOCK,
    }

    /**
     * The ONE place `terminated` is claimed for an app-initiated teardown, and the
     * ONE decision that must be atomic with the accept commit / scope publish
     * (§ per-entry lock). In a single lock it: (1) stands down if already
     * terminated, or if the caller's [standDown] predicate holds (the bind deadline
     * passes `accepted`; the ring window passes `legBound || accepted`) — so a late
     * timer can NEVER drop a call that just connected media (HIGH/MEDIUM re-review);
     * (2) else claims `terminated` — so a racing ACCEPT_LEG's own `!terminated`
     * check bails, never connecting media onto a torn-down call;
     * (3) decides delivery: scope up → the caller disconnects now, else the cause
     * is recorded for the addCall block (HIGH re-review — a disconnect that races
     * ahead of the scope is never lost). No bridge/scope op runs under the lock.
     */
    private fun claimTerminate(
        entry: CallEntry,
        cause: DisconnectCause,
        standDown: (CallEntry) -> Boolean,
    ): TerminatePlan = synchronized(entry) {
        when {
            entry.terminated -> TerminatePlan.STAND_DOWN
            // The caller's stand-down predicate is evaluated UNDER the lock, so a
            // timer's "has it accepted / bound?" read is atomic with the accept
            // commit — no late timer can drop a call that just connected (M1), and
            // no ghost-ring timer can drop one whose leg just bound (M1 twin).
            standDown(entry) -> TerminatePlan.STAND_DOWN
            else -> {
                entry.terminated = true
                if (entry.scope == null) {
                    entry.pendingDisconnectCause = cause
                    TerminatePlan.RECORDED_FOR_BLOCK
                } else {
                    TerminatePlan.DISCONNECT_NOW
                }
            }
        }
    }

    /**
     * Resolve the answer race when WE tear a ringing inbound call down (bind
     * deadline, answer() failure, addCall refused). Scope the decline EXACTLY like
     * a manual reject (IMPORTANT-4): device-global `declineMine` drops THIS device
     * from EVERY ringing session, so with a second ring presented it would
     * collaterally decline that one too (MEDIUM re-review). Use the session-scoped
     * decline whenever another ring is still live; the universal `declineMine`
     * only for the lone ring (robust even when no session resolves).
     */
    private fun declineForTeardown(entry: CallEntry) {
        if (entry.direction != CallAttributesCompat.DIRECTION_INCOMING) return
        val otherRings = entries.values.count {
            it !== entry && !it.terminated &&
                it.direction == CallAttributesCompat.DIRECTION_INCOMING
        }
        when (TelecomCallReducer.rejectScope(otherRings)) {
            TelecomCallReducer.RejectScope.SESSION -> runCatching { bridge.declineSession(entry.key) }
            TelecomCallReducer.RejectScope.MINE -> runCatching { bridge.declineMine() }
        }
    }

    private fun disconnectEntry(entry: CallEntry, cause: DisconnectCause) {
        // scope.disconnect() ends the OS call; the suspend `addCall` then returns
        // and `finally` runs cleanup. STAND_DOWN (already terminated) and
        // RECORDED_FOR_BLOCK (the block delivers) do nothing here.
        // No stand-down: server call_end and a leg that already ended (drive
        // DONE/ERROR) must tear the OS call down even if it had accepted.
        if (claimTerminate(entry, cause) { false } == TerminatePlan.DISCONNECT_NOW) {
            scopeOp(entry) { disconnect(cause) }
        }
    }

    /**
     * Run a suspend [CallControlScope] op on the CALL's own coroutine scope
     * (CallControlScope is a CoroutineScope), guarded — never throws. IMPORTANT-1:
     * the [CallControlResult] is NO LONGER swallowed — a transaction that returns
     * `Error` is reported (not a silent no-op). Critical transitions that must
     * ESCALATE on failure (answer, bind-deadline disconnect) do so at their call
     * site ([answerOnScope]); a failed setActive/setInactive is reported but not
     * escalated (a redundant hold/resume Error must not tear a live call down).
     */
    private fun scopeOp(entry: CallEntry, op: suspend CallControlScope.() -> CallControlResult) {
        val control = entry.scope ?: return
        control.launch {
            val result = runCatching { control.op() }
                .onFailure { onFailure("telecom-scope", it) }
                .getOrNull()
            if (result is CallControlResult.Error) {
                onFailure("telecom-scope", TelecomOpException("scope", result.errorCode))
            }
        }
    }

    private fun cleanup(entry: CallEntry) {
        entry.deadlineJob?.cancel()
        entry.ringWindowJob?.cancel()
        // Entry-scoped, not session-scoped: the value-guarded remove tells us
        // whether THIS entry is still the one mapped for its key. If a successor
        // entry has taken the key, its ring owns the connecting notification (they
        // share the session tag) — a superseded entry's teardown must never cancel
        // it, or the fresh ring loses the within-5s foreground-priority
        // notification that sustains the phoneCall mic FGS.
        if (entries.remove(entry.key, entry)) {
            val session = entry.key.removePrefix("out:")
            runCatching { bridge.cancelIncomingCall(session) }
            runCatching { bridge.onCallUnregistered(session) }
        }
        // Release the process/mic hold once the LAST call is gone (never while
        // another call is still live).
        if (entries.isEmpty()) CallForegroundService.stop(appContext)
    }

    /** A non-Success [CallControlResult] surfaced as a Throwable for [onFailure]
     *  (IMPORTANT-1) — a failed Telecom transaction is a reportable event, not a
     *  silent no-op. */
    private class TelecomOpException(op: String, errorCode: Int) :
        Exception("telecom $op failed: CallControlResult.Error($errorCode)")
}
