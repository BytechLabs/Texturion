package com.loonext.android.telephony

import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.SharedFlow

/**
 * The minimal slice of the Telnyx WebRTC SDK the softphone touches, behind an
 * interface so [SoftphoneCore]'s registration/call orchestration is unit-
 * testable on the JVM (the real client needs an Android Context + a device).
 * The real implementation is [TelnyxSdkClient].
 */

enum class AudioRoute { EARPIECE, SPEAKER, BLUETOOTH }

sealed interface SdkEvent {
    /** Registered on the socket — the phone can ring. */
    data object Ready : SdkEvent

    /** The socket dropped; the SDK's own reconnect may or may not recover. */
    data object Disconnected : SdkEvent

    /** A socket/auth error — often a dead token; recovery re-mints. */
    data class Error(val message: String?) : SdkEvent

    /**
     * A new inbound invite (the ring engine or a transfer dialed us).
     *
     * [customHeaders] are the INVITE's custom SIP headers ({name,value}). The
     * server stamps `X-Loonext-Session` on every member ring dial (§3.2), so
     * this is the DETERMINISTIC correlation to the authoritative server session
     * — read via [TelecomCallReducer.correlateInvite], never a caller/time
     * heuristic. [legId] is the leg's own Telnyx id, the by-leg fallback key
     * when the header is somehow absent (older server / stripped header).
     */
    data class Incoming(
        val call: SdkCallHandle,
        val callerName: String?,
        val callerNumber: String?,
        val customHeaders: List<Pair<String, String>> = emptyList(),
        val legId: String? = null,
    ) : SdkEvent
}

interface SdkCallHandle {
    val id: String

    /** Telnyx call_control_id of THIS leg — the by-leg resolution key. */
    val callControlId: String?

    /** Telnyx session id of THIS leg (the customer session for outbound). */
    val telnyxSessionId: String?

    /**
     * Per-call phase stream mapped from the SDK's CallState. `null` values are
     * mid-call recovery states (reconnecting/renegotiating) the state machine
     * ignores — the call keeps its current phase.
     */
    val phases: Flow<CallPhase?>

    fun accept(destinationNumber: String)
    fun end()

    /** The SDK only exposes a hold TOGGLE; [SoftphoneCore] serializes it. */
    fun toggleHold()
    fun setMuted(muted: Boolean)
    fun dtmf(digit: String)
}

interface SdkClient {
    val events: SharedFlow<SdkEvent>

    /**
     * Tear down any previous socket and register with a fresh login token
     * (mint-on-connect is what makes auth-failure recovery a simple rebuild).
     */
    fun connect(token: String, callerIdName: String)

    fun disconnect()

    /**
     * Place an outbound call. [clientState] MUST be the exact string from
     * POST /v1/calls/browser — the webhook hangs up any outgoing PSTN leg
     * whose client_state doesn't carry a valid single-use nonce.
     */
    fun newCall(
        callerIdName: String,
        callerIdNumber: String,
        destinationNumber: String,
        clientState: String,
    ): SdkCallHandle

    fun setAudioRoute(route: AudioRoute)
}
