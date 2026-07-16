package com.loonext.android.telephony

import android.Manifest
import android.content.ComponentName
import android.content.Context
import android.content.pm.PackageManager
import android.media.AudioAttributes
import android.media.AudioFocusRequest
import android.media.AudioManager
import android.media.Ringtone
import android.media.RingtoneManager
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
import com.loonext.android.core.net.ApiClient
import com.loonext.android.push.CallWakeHandler
import com.loonext.android.push.PushContent
import com.loonext.android.push.PushHooks
import com.loonext.android.push.postPushNotification
import kotlinx.coroutines.CancellationException
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
 * - the incoming-call ring surface (CallStyle notification + ringtone/vibra)
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

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    private val sdk = TelnyxSdkClient(appContext, scope)
    private val core = SoftphoneCore(CallsApi(api), sdk, scope)
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

    private var ringtone: Ringtone? = null
    private var focusRequest: AudioFocusRequest? = null
    private var phoneAccountRegistered = false

    init {
        watchNetwork()
        watchForeground()
        scope.launch { core.events.collect { onCoreEvent(it) } }
        scope.launch { core.state.collect { syncPlatform(it) } }
        // Claim the calls-wake seam: incoming-call pushes (#156) route here
        // instead of the tray once the softphone exists in this process.
        PushHooks.callWakeHandler = CallWakeHandler { content -> onCallWakePush(content) }
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
        scope.launch {
            try {
                core.onIncomingCallPush(session)
            } catch (cause: CancellationException) {
                throw cause
            } catch (_: Exception) {
                delay(1_500)
                try {
                    core.onIncomingCallPush(session)
                } catch (cause: CancellationException) {
                    throw cause
                } catch (_: Exception) {
                    postPushNotification(appContext, content)
                }
            }
        }
    }

    // -------------------------------------------------------------- lifecycle

    /**
     * Register (or keep) the softphone for a company. Idempotent and silent
     * on failure — texting is never blocked by calling; the status pill and
     * the watchdog retry. Also registers the telecom phone account.
     */
    fun start(companyId: String, callerIdName: String = "") {
        registerPhoneAccount()
        core.start(companyId, callerIdName)
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
    suspend fun onIncomingCallPush(sessionId: String) = core.onIncomingCallPush(sessionId)

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
    fun answer(id: String) = core.answer(id)

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
            core.answer(callId)
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
        if (call.phase == CallPhase.RINGING) {
            notifier.showIncoming(call)
            ringingNotified.add(callId)
            startRingtone()
        }
    }

    internal fun silenceRing() {
        runCatching { ringtone?.stop() }
        ringtone = null
    }

    internal fun mirrorTelecomRoute(route: AudioRoute) = core.setAudioRoute(route)

    // ----------------------------------------------------------- core events

    private fun onCoreEvent(event: CoreEvent) {
        when (event) {
            is CoreEvent.IncomingRinging -> {
                reportIncomingToTelecom(event.call)
                // The ring surface goes up regardless of telecom's verdict —
                // onShowIncomingCallUi will re-post idempotently if it comes.
                notifier.showIncoming(event.call)
                ringingNotified.add(event.call.id)
                startRingtone()
            }

            is CoreEvent.OutgoingPlaced -> reportOutgoingToTelecom(event.call)
        }
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

    /** Drive every Android-side surface from the one state snapshot. */
    private fun syncPlatform(snapshot: SoftphoneSnapshot) {
        val byId = snapshot.calls.associateBy { it.id }

        // Telecom connection states follow call phases.
        val goneConnections = connections.keys.filter { byId[it] == null }
        for (callId in goneConnections) {
            val connection = connections.remove(callId) ?: continue
            reportedToTelecom.remove(callId)
            connection.setDisconnected(DisconnectCause(DisconnectCause.MISSED))
            connection.destroy()
        }
        for ((callId, connection) in connections) {
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
        connections.entries.removeAll { byId[it.key]?.phase == CallPhase.ENDED }
        reportedToTelecom.removeAll { byId[it] == null || byId[it]?.phase == CallPhase.ENDED }

        // Ring surface: sound + per-call notification while anything rings.
        val ringingIds = snapshot.calls
            .filter { it.phase == CallPhase.RINGING }
            .map { it.id }
            .toSet()
        if (ringingIds.isEmpty()) silenceRing()
        ringingNotified.filter { it !in ringingIds }.forEach { gone ->
            notifier.cancelIncoming(gone)
            ringingNotified.remove(gone)
        }

        // Ongoing-call notification mirrors the active (or lone held) call.
        val live = snapshot.liveCalls.filter { it.phase != CallPhase.RINGING }
        val featured = snapshot.activeCall ?: live.firstOrNull()
        if (featured != null) notifier.showOngoing(featured) else notifier.cancelOngoing()

        // Audio-focus fallback only matters while telecom isn't holding it.
        val needsFocus = snapshot.calls.any {
            it.phase == CallPhase.ACTIVE && !connections.containsKey(it.id)
        }
        if (needsFocus) acquireFocusFallback() else releaseFocusFallback()
    }

    // ------------------------------------------------------- ring + focus

    private fun startRingtone() {
        if (ringtone != null) return
        val audio = audioManager ?: return
        // Respect the ringer switch: silent/vibrate devices don't blare — the
        // channel's vibration pattern and the notification still surface it.
        if (audio.ringerMode != AudioManager.RINGER_MODE_NORMAL) return
        val uri = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE) ?: return
        ringtone = runCatching {
            RingtoneManager.getRingtone(appContext, uri)?.apply {
                audioAttributes = AudioAttributes.Builder()
                    .setUsage(AudioAttributes.USAGE_NOTIFICATION_RINGTONE)
                    .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                    .build()
                isLooping = true
                play()
            }
        }.getOrNull()
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
                    if (event == Lifecycle.Event.ON_START) core.scheduleRecover()
                },
            )
        }
    }
}
