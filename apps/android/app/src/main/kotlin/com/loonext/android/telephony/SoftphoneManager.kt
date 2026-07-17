package com.loonext.android.telephony

import android.Manifest
import android.content.ComponentName
import android.content.Context
import android.content.pm.PackageManager
import android.media.AudioAttributes
import android.media.AudioFocusRequest
import android.media.AudioManager
import android.net.ConnectivityManager
import android.net.Network
import android.os.Bundle
import android.telecom.DisconnectCause
import android.telecom.PhoneAccount
import android.telecom.PhoneAccountHandle
import android.telecom.TelecomManager
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

/**
 * The Android softphone (#155): [SoftphoneCore] (registration, multi-call
 * state, live-call ops — pure and unit-tested) wrapped with the platform
 * plumbing that can't run on the JVM:
 *
 * - Telnyx SDK binding ([TelnyxSdkClient])
 * - self-managed telecom (ring/hold/audio-focus interop with cellular calls)
 * - the incoming-call ring surface (#167): the [Ringer] (looped ringtone +
 *   vibration, ringer-mode aware) runs whenever the process is alive and an
 *   inbound call rings; the CallStyle notification posts ONLY while the app
 *   is NOT foreground (foreground presentation is the in-app banner)
 * - the ongoing-call notification
 * - recovery watchdog triggers: network regained + app foregrounded (the
 *   debounce, the never-during-a-live-call rule, and the fresh-mint-on-auth-
 *   failure behavior all live in the core)
 * - audio-focus fallback for devices/situations where telecom refuses us
 *
 * Created lazily via [get] — one instance per process, alive for the process
 * lifetime (the phone must ring on whatever company was last started).
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

        /** The instance if the app already built one — telecom callbacks and
         *  notification actions use this (never create from a callback). */
        fun peek(): SoftphoneManager? = instance
    }

    private val diagnostics = CrashDiagnostics.get(appContext)

    /**
     * #168A: an uncaught failure in ANY child coroutine of this scope used to
     * reach the default handler — Android kills the process for uncaught
     * coroutine exceptions — taking a live call down with it. The handler
     * records the stack (shareable next launch) and lets the process live.
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

    private val telecomManager: TelecomManager? =
        appContext.getSystemService(TelecomManager::class.java)
    private val audioManager: AudioManager? =
        appContext.getSystemService(AudioManager::class.java)

    /** callId -> live telecom connection (absent when telecom refused us). */
    private val connections = mutableMapOf<String, LoonextConnection>()

    /** Calls already reported to telecom (attach may lag the report). */
    private val reportedToTelecom = mutableSetOf<String>()

    /** Incoming notifications currently showing, keyed by call id. */
    private val ringingNotified = mutableSetOf<String>()

    private val ringer = Ringer(appContext)

    /** ProcessLifecycleOwner-tracked; gates the incoming notification (#167). */
    @Volatile
    private var appInForeground = false

    private var focusRequest: AudioFocusRequest? = null
    private var phoneAccountRegistered = false

    init {
        watchNetwork()
        watchForeground()
        core.onInternalFailure = { tag, error -> diagnostics.recordNonFatal(tag, error) }
        // #168A: per-emission guards — one bad snapshot must not kill the
        // collector (all future syncs) or the process. Failures are recorded
        // for the next-launch share sheet; the next emission syncs normally.
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
        // Claim the calls-wake seam: incoming-call pushes (#156) route here
        // instead of the tray once the softphone exists in this process.
        // This install is THE one wake handler (calls-v3 §10.2) — nothing
        // else may overwrite it (MainActivity's overwrite is gone).
        PushHooks.callWakeHandler = CallWakeHandler { content -> onCallWakePush(content) }
        // `kind:'call_end'` revocation (§9.2): the tray cancel-by-tag happens
        // in the messaging service; the in-app surfaces come down here.
        PushHooks.callEndHandler = CallEndHandler { content ->
            content.callSessionId?.let { session -> core.onCallEndPush(session) }
        }
    }

    /**
     * A `kind:'call'` push while the app process is alive: ensure the SDK is
     * registered, then ring-me. One retry on a real failure; if the wake
     * still can't happen, fall back to the tray notification — a ring is
     * never dropped silently.
     */
    private fun onCallWakePush(content: PushContent) {
        val session = content.callSessionId
        if (session == null) {
            postPushNotification(appContext, content)
            return
        }
        // The push body is the raw caller E.164 when known — it rides along
        // as the presentation-reconcile caller correlation (§10.1).
        val callerHint = CallWakePolicy.callerHintFromPushBody(content.body)
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
     * Register (or keep) the softphone for a company. Idempotent and silent
     * on failure — texting is never blocked by calling; the status pill and
     * the watchdog retry. Also registers the telecom phone account.
     */
    fun start(companyId: String, callerIdName: String = "") {
        registerPhoneAccount()
        surfaceInterruptedCallOnce()
        core.start(companyId, callerIdName)
    }

    /**
     * #168 part D: if the LAST crash happened while the 'call in flight'
     * marker was up, the process died mid-call — say so, once, calmly. A
     * marker without a newer crash (system kill, stale file) clears silently:
     * we only claim what the crash log proves.
     */
    private fun surfaceInterruptedCallOnce() {
        if (postCrashChecked) return
        postCrashChecked = true
        runCatching {
            val markerSetAt = diagnostics.callMarker.setAtMs()
            if (markerSetAt == null) return
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

    /** Status-pill tap — force a re-registration now (refused mid-call). */
    fun retryNow() = core.retryNow()

    fun clearError() = core.clearError()

    /**
     * Push-to-wake part 2 — #156's FCM handler calls this with the
     * call_session_id parsed from the push (`/calls?call=<session>`): ensure
     * the SDK is registered, then POST /v1/calls/live/{session}/ring-me.
     * conflict (already answered/ended) and not_found are swallowed by
     * contract; other failures propagate to the caller.
     */
    suspend fun onIncomingCallPush(sessionId: String, callerHint: String? = null) =
        core.onIncomingCallPush(sessionId, callerHint)

    /**
     * Realtime `call.updated` reconciliation (calls-v3 §9.1/§10.1): the
     * shell forwards every call.updated broadcast here; a ringing-exit state
     * dismisses this device's presentation for that session (silence only —
     * the server sends the BYE).
     */
    fun onCallSessionUpdate(sessionId: String, state: String?) =
        core.onCallSessionUpdate(sessionId, state)

    fun hasMicPermission(): Boolean =
        appContext.checkSelfPermission(Manifest.permission.RECORD_AUDIO) ==
            PackageManager.PERMISSION_GRANTED

    // -------------------------------------------------------------------- ops

    /**
     * Authorize + place an outbound call (exactly one of conversation /
     * contact / raw number). Callers MUST preflight the mic permission —
     * [hasMicPermission] — before invoking (a denial never reserves the
     * line). Gate refusals surface as ApiException by code.
     */
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

    /** Answer a ringing call (any active call is held first). */
    fun answer(id: String) {
        // #168D: stamp the in-flight marker at the ANSWER moment — the crash
        // this issue chases happened between accept and ACTIVE, before the
        // state ever showed a live phase. syncPlatform clears it when the
        // line clears (including an answer that never connected).
        runCatching {
            markedCallInFlight = true
            diagnostics.callMarker.set()
        }
        core.answer(id)
    }

    /** Decline a ringing call / hang up a live one. */
    fun hangup(id: String) = core.hangup(id)

    fun toggleHold(id: String) = core.toggleHold(id)

    fun setMuted(id: String, muted: Boolean) = core.setMuted(id, muted)

    fun dtmf(id: String, digit: String) = core.dtmf(id, digit)

    fun dismiss(id: String) = core.dismiss(id)

    fun setAudioRoute(route: AudioRoute) = core.setAudioRoute(route)

    suspend fun liveFacts(sessionId: String): LiveCallFacts = core.liveFacts(sessionId)

    suspend fun transferTargets(sessionId: String): TransferTargets =
        core.transferTargets(sessionId)

    suspend fun blindTransfer(sessionId: String, targetUserId: String): TransferAck =
        core.blindTransfer(sessionId, targetUserId)

    // -------------------------------------------------- telecom entry points

    internal fun attachConnection(callId: String, connection: LoonextConnection) {
        connections[callId] = connection
        // Apply the current phase immediately — the call may have progressed
        // (or vanished) while telecom was binding the service.
        syncPlatform(core.state.value)
    }

    /** Bluetooth/wearable answer — telecom verified the user intent; the mic
     *  permission was granted when the app first placed/answered a call, but
     *  re-check anyway and fall back to opening the app. */
    internal fun answerFromTelecom(callId: String) {
        if (hasMicPermission()) {
            answer(callId)
        } else {
            appContext.packageManager.getLaunchIntentForPackage(appContext.packageName)
                ?.addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK)
                ?.let { appContext.startActivity(it) }
        }
    }

    internal fun holdFromTelecom(callId: String, hold: Boolean) {
        val call = core.state.value.calls.firstOrNull { it.id == callId } ?: return
        val eligible =
            if (hold) call.phase == CallPhase.ACTIVE else call.phase == CallPhase.HELD
        if (eligible) core.toggleHold(callId)
    }

    internal fun telecomRefusedOutgoing(callId: String) {
        core.hangup(callId)
        core.reportUiError("That call couldn't start — another app is on a call.")
    }

    internal fun showIncomingUi(callId: String) {
        val call = core.state.value.calls.firstOrNull { it.id == callId } ?: return
        if (call.phase == CallPhase.RINGING && !call.silenced && !appInForeground) {
            postIncomingNotification(call)
        }
        // Foreground: the in-app banner + ringer (state-driven) are the ring
        // surface — telecom's re-ask needs no notification on top of them.
    }

    internal fun silenceRing() = ringer.silence()

    internal fun mirrorTelecomRoute(route: AudioRoute) = core.setAudioRoute(route)

    // ----------------------------------------------------------- core events

    private fun onCoreEvent(event: CoreEvent) {
        when (event) {
            is CoreEvent.IncomingRinging -> {
                reportIncomingToTelecom(event.call)
                // Foreground = the animated in-app banner + ringer own the
                // presentation (#167); backgrounded-but-alive = the CallStyle
                // notification (heads-up unlocked, full screen locked). The
                // ringer itself is state-driven in syncPlatform.
                if (!appInForeground) postIncomingNotification(event.call)
            }

            is CoreEvent.OutgoingPlaced -> reportOutgoingToTelecom(event.call)
        }
    }

    private fun postIncomingNotification(call: CallSnapshot) {
        notifier.showIncoming(call)
        ringingNotified.add(call.id)
    }

    private fun phoneAccountHandle() = PhoneAccountHandle(
        ComponentName(appContext, LoonextConnectionService::class.java),
        TelecomBridge.PHONE_ACCOUNT_ID,
    )

    private fun registerPhoneAccount() {
        if (phoneAccountRegistered) return
        val telecom = telecomManager ?: return
        val account = PhoneAccount.builder(phoneAccountHandle(), "Loonext")
            .setCapabilities(PhoneAccount.CAPABILITY_SELF_MANAGED)
            .build()
        phoneAccountRegistered = runCatching { telecom.registerPhoneAccount(account) }.isSuccess
    }

    private fun reportIncomingToTelecom(call: CallSnapshot) {
        val telecom = telecomManager ?: return
        if (!phoneAccountRegistered) registerPhoneAccount()
        if (!reportedToTelecom.add(call.id)) return
        val extras = Bundle().apply {
            putString(TelecomBridge.EXTRA_CALL_ID, call.id)
            putParcelable(
                TelecomManager.EXTRA_INCOMING_CALL_ADDRESS,
                TelecomBridge.telUri(call.peerNumber),
            )
        }
        runCatching { telecom.addNewIncomingCall(phoneAccountHandle(), extras) }
            .onFailure {
                reportedToTelecom.remove(call.id)
                acquireFocusFallback()
            }
    }

    private fun reportOutgoingToTelecom(call: CallSnapshot) {
        val telecom = telecomManager ?: return acquireFocusFallback()
        if (!phoneAccountRegistered) registerPhoneAccount()
        if (!reportedToTelecom.add(call.id)) return
        val extras = TelecomBridge.outgoingExtras(call.id).apply {
            putParcelable(TelecomManager.EXTRA_PHONE_ACCOUNT_HANDLE, phoneAccountHandle())
        }
        runCatching {
            telecom.placeCall(TelecomBridge.telUri(call.peerNumber), extras)
        }.onFailure {
            reportedToTelecom.remove(call.id)
            acquireFocusFallback()
        }
    }

    // ----------------------------------------------------- state -> platform

    /** Tracks whether THIS process stamped the call-in-flight marker (#168D)
     *  — the idle emissions before start() must not clear a crashed
     *  process's marker before it's been read. */
    private var markedCallInFlight = false

    /**
     * Drive every Android-side surface from the one state snapshot.
     *
     * #168A: each surface is its own runCatching section — this method runs
     * inside the state collector, where ANY throw used to kill the process
     * mid-call (that is exactly how the founder's answer crash died: the
     * ongoing-notification build threw the instant the call went ACTIVE).
     * One broken surface must not stop the ringer, the notifications, or
     * telecom from syncing.
     */
    private fun syncPlatform(snapshot: SoftphoneSnapshot) {
        val byId = snapshot.calls.associateBy { it.id }

        // Telecom connection states follow call phases.
        runCatching {
            val goneConnections = connections.keys.filter { byId[it] == null }
            for (callId in goneConnections) {
                val connection = connections.remove(callId) ?: continue
                reportedToTelecom.remove(callId)
                runCatching {
                    connection.setDisconnected(DisconnectCause(DisconnectCause.MISSED))
                    connection.destroy()
                }
            }
            for ((callId, connection) in connections) {
                runCatching {
                    when (byId[callId]?.phase) {
                        CallPhase.RINGING -> connection.setRinging()
                        CallPhase.CONNECTING -> connection.setDialing()
                        CallPhase.ACTIVE -> connection.setActive()
                        CallPhase.HELD -> connection.setOnHold()
                        CallPhase.ENDED, null -> {
                            connection.setDisconnected(DisconnectCause(DisconnectCause.LOCAL))
                            connection.destroy()
                        }

                        else -> Unit
                    }
                }
            }
            connections.entries.removeAll { byId[it.key]?.phase == CallPhase.ENDED }
            reportedToTelecom.removeAll {
                byId[it] == null || byId[it]?.phase == CallPhase.ENDED
            }
        }.onFailure { diagnostics.recordNonFatal("sync-telecom", it) }

        // Ring surface (#167): the ringer follows the pure policy on every
        // emission — answer/decline/remote-end/timeout all stop it here — and
        // notifications for calls that stopped ringing come down with it
        // (that cancel is also the 'answered elsewhere' CallStyle teardown).
        // A SILENCED ring (calls-v3 §10.1.2: state said the session exited
        // `ringing`) counts as not-ringing here — banner, ringer, and
        // CallStyle all come down while the leg waits for the server BYE.
        runCatching {
            val ringingIds = snapshot.calls
                .filter {
                    it.phase == CallPhase.RINGING &&
                        it.direction == CallDirection.INBOUND && !it.silenced
                }
                .map { it.id }
                .toSet()
            ringer.sync(RingerPolicy.decide(currentRingMode(), ringingIds.size))
            ringingNotified.filter { it !in ringingIds }.forEach { gone ->
                notifier.cancelIncoming(gone)
                ringingNotified.remove(gone)
            }
        }.onFailure { diagnostics.recordNonFatal("sync-ring", it) }

        // Ongoing-call notification mirrors the active (or lone held) call.
        runCatching {
            val live = snapshot.liveCalls.filter { it.phase != CallPhase.RINGING }
            val featured = snapshot.activeCall ?: live.firstOrNull()
            if (featured != null) notifier.showOngoing(featured) else notifier.cancelOngoing()
        }.onFailure { diagnostics.recordNonFatal("sync-notification", it) }

        // #168D: the 'call in flight' marker — up while any answered/placed
        // leg lives (ringing alone is not OUR call yet), down when the line
        // clears. Only this process's own stamp is cleared here; a crashed
        // process's marker survives until start() has read it.
        runCatching {
            val anyInFlight = snapshot.calls.any {
                it.phase == CallPhase.CONNECTING ||
                    it.phase == CallPhase.ACTIVE ||
                    it.phase == CallPhase.HELD
            }
            // Clearing waits for a FULLY idle line (not merely "nothing live
            // yet"): answer() stamps the marker while the phase is still
            // RINGING, and an interim emission must not un-stamp it.
            val lineIdle = snapshot.calls.none { it.phase != CallPhase.ENDED }
            if (anyInFlight && !markedCallInFlight) {
                markedCallInFlight = true
                diagnostics.callMarker.set()
            } else if (lineIdle && markedCallInFlight) {
                markedCallInFlight = false
                diagnostics.callMarker.clear()
            }
        }

        // Audio-focus fallback only matters while telecom isn't holding it.
        runCatching {
            val needsFocus = snapshot.calls.any {
                it.phase == CallPhase.ACTIVE && !connections.containsKey(it.id)
            }
            if (needsFocus) acquireFocusFallback() else releaseFocusFallback()
        }.onFailure { diagnostics.recordNonFatal("sync-focus", it) }
    }

    // ------------------------------------------------------- ring + focus

    /** Silent/vibrate/normal — the [RingerPolicy] input. No manager = ring. */
    private fun currentRingMode(): RingMode = when (audioManager?.ringerMode) {
        AudioManager.RINGER_MODE_SILENT -> RingMode.SILENT
        AudioManager.RINGER_MODE_VIBRATE -> RingMode.VIBRATE
        else -> RingMode.NORMAL
    }

    private fun acquireFocusFallback() {
        if (focusRequest != null) return
        val audio = audioManager ?: return
        val request = AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT)
            .setAudioAttributes(
                AudioAttributes.Builder()
                    .setUsage(AudioAttributes.USAGE_VOICE_COMMUNICATION)
                    .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
                    .build(),
            )
            .build()
        if (audio.requestAudioFocus(request) == AudioManager.AUDIOFOCUS_REQUEST_GRANTED) {
            focusRequest = request
        }
    }

    private fun releaseFocusFallback() {
        val request = focusRequest ?: return
        focusRequest = null
        audioManager?.abandonAudioFocusRequest(request)
    }

    // -------------------------------------------------- watchdog triggers

    private fun watchNetwork() {
        val connectivity =
            appContext.getSystemService(ConnectivityManager::class.java) ?: return
        runCatching {
            connectivity.registerDefaultNetworkCallback(
                object : ConnectivityManager.NetworkCallback() {
                    override fun onAvailable(network: Network) {
                        core.scheduleRecover()
                    }
                },
            )
        }
    }

    private fun watchForeground() {
        // Main-thread requirement for lifecycle observers.
        scope.launch {
            ProcessLifecycleOwner.get().lifecycle.addObserver(
                LifecycleEventObserver { _, event ->
                    when (event) {
                        Lifecycle.Event.ON_START -> {
                            onForegroundChanged(foreground = true)
                            core.scheduleRecover()
                        }

                        Lifecycle.Event.ON_STOP -> onForegroundChanged(foreground = false)
                        else -> Unit
                    }
                },
            )
        }
    }

    /**
     * Presentation handoff on the foreground boundary (#167): coming forward
     * mid-ring, the banner takes over and any ring notifications come down;
     * going background mid-ring, the CallStyle notification goes up so the
     * ring survives recents/screen-off while the process is alive.
     */
    private fun onForegroundChanged(foreground: Boolean) {
        if (appInForeground == foreground) return
        appInForeground = foreground
        val ringing = core.state.value.calls.filter {
            it.phase == CallPhase.RINGING && it.direction == CallDirection.INBOUND &&
                !it.silenced
        }
        if (foreground) {
            ringingNotified.toList().forEach { notifier.cancelIncoming(it) }
            ringingNotified.clear()
        } else {
            ringing.forEach { postIncomingNotification(it) }
        }
    }
}
