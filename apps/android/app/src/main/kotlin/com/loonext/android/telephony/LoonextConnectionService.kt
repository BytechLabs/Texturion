package com.loonext.android.telephony

import android.net.Uri
import android.telecom.CallAudioState
import android.telecom.Connection
import android.telecom.ConnectionRequest
import android.telecom.ConnectionService
import android.telecom.DisconnectCause
import android.telecom.PhoneAccount
import android.telecom.PhoneAccountHandle
import android.telecom.TelecomManager

/**
 * Self-managed telecom integration (#155). Registering calls with telecom is
 * what buys us: system-managed audio focus (cellular calls hold ours and vice
 * versa), lock-screen interop, and hardware answer/hangup (bluetooth buttons)
 * routed into [SoftphoneManager]. The UI itself is ours — self-managed
 * connections never show the system in-call screen; the full-screen ring is
 * [CallNotifier]'s CallStyle notification and the in-app surfaces.
 *
 * Everything here is a thin bridge: telecom callbacks delegate to the
 * process-wide [SoftphoneManager] singleton, and the manager drives each
 * [LoonextConnection]'s state from the softphone snapshot. Telecom being
 * unavailable (registration refused, service not bound) NEVER blocks a call —
 * the manager falls back to its own audio-focus handling.
 */
class LoonextConnectionService : ConnectionService() {
    override fun onCreateIncomingConnection(
        connectionManagerPhoneAccount: PhoneAccountHandle?,
        request: ConnectionRequest?,
    ): Connection {
        val callId = request?.extras?.getString(TelecomBridge.EXTRA_CALL_ID)
        val connection = LoonextConnection(callId)
        connection.setInitializing()
        if (callId != null) {
            SoftphoneManager.peek()?.attachConnection(callId, connection)
            connection.setRinging()
        } else {
            connection.setDisconnected(DisconnectCause(DisconnectCause.CANCELED))
            connection.destroy()
        }
        return connection
    }

    override fun onCreateIncomingConnectionFailed(
        connectionManagerPhoneAccount: PhoneAccountHandle?,
        request: ConnectionRequest?,
    ) {
        // Telecom refused the ring (e.g. an emergency call is in progress) —
        // decline OUR leg so the answer race resolves on a teammate's phone.
        request?.extras?.getString(TelecomBridge.EXTRA_CALL_ID)?.let { callId ->
            SoftphoneManager.peek()?.hangup(callId)
        }
    }

    override fun onCreateOutgoingConnection(
        connectionManagerPhoneAccount: PhoneAccountHandle?,
        request: ConnectionRequest?,
    ): Connection {
        val callId = request?.extras?.getString(TelecomBridge.EXTRA_CALL_ID)
        val connection = LoonextConnection(callId)
        if (callId != null) {
            SoftphoneManager.peek()?.attachConnection(callId, connection)
            connection.setDialing()
        } else {
            connection.setDisconnected(DisconnectCause(DisconnectCause.CANCELED))
            connection.destroy()
        }
        return connection
    }

    override fun onCreateOutgoingConnectionFailed(
        connectionManagerPhoneAccount: PhoneAccountHandle?,
        request: ConnectionRequest?,
    ) {
        // The system refused (another app's call is active and unholdable).
        // The SDK leg already exists — end it and say why, honestly.
        request?.extras?.getString(TelecomBridge.EXTRA_CALL_ID)?.let { callId ->
            SoftphoneManager.peek()?.telecomRefusedOutgoing(callId)
        }
    }
}

/**
 * One telecom-side call. All user intent flows to the manager; all state
 * flows back via the setters the manager calls from its snapshot sync.
 */
class LoonextConnection(private val callId: String?) : Connection() {
    init {
        audioModeIsVoip = true
        connectionCapabilities =
            CAPABILITY_HOLD or CAPABILITY_SUPPORT_HOLD or CAPABILITY_MUTE
    }

    override fun onAnswer() {
        callId?.let { SoftphoneManager.peek()?.answerFromTelecom(it) }
    }

    override fun onReject() {
        callId?.let { SoftphoneManager.peek()?.hangup(it) }
    }

    override fun onDisconnect() {
        callId?.let { SoftphoneManager.peek()?.hangup(it) }
    }

    override fun onHold() {
        callId?.let { SoftphoneManager.peek()?.holdFromTelecom(it, hold = true) }
    }

    override fun onUnhold() {
        callId?.let { SoftphoneManager.peek()?.holdFromTelecom(it, hold = false) }
    }

    override fun onPlayDtmfTone(c: Char) {
        callId?.let { SoftphoneManager.peek()?.dtmf(it, c.toString()) }
    }

    override fun onShowIncomingCallUi() {
        callId?.let { SoftphoneManager.peek()?.showIncomingUi(it) }
    }

    override fun onSilence() {
        SoftphoneManager.peek()?.silenceRing()
    }

    override fun onCallAudioStateChanged(state: CallAudioState?) {
        // Route changes initiated by hardware (bluetooth connect/disconnect)
        // land here; mirror them into the SDK's audio device so WebRTC audio
        // follows the system's routing decision.
        val route = when (state?.route) {
            CallAudioState.ROUTE_SPEAKER -> AudioRoute.SPEAKER
            CallAudioState.ROUTE_BLUETOOTH -> AudioRoute.BLUETOOTH
            CallAudioState.ROUTE_EARPIECE, CallAudioState.ROUTE_WIRED_HEADSET ->
                AudioRoute.EARPIECE

            else -> null
        } ?: return
        SoftphoneManager.peek()?.mirrorTelecomRoute(route)
    }
}

/** Constants + tel-uri helper shared by the service and the manager. */
internal object TelecomBridge {
    const val EXTRA_CALL_ID = "com.loonext.android.telephony.extra.CALL_ID"

    /** Phone-account id — stable so re-registration updates in place. */
    const val PHONE_ACCOUNT_ID = "loonext.softphone"

    fun telUri(number: String): Uri =
        Uri.fromParts(PhoneAccount.SCHEME_TEL, number.ifBlank { "anonymous" }, null)

    fun outgoingExtras(callId: String): android.os.Bundle = android.os.Bundle().apply {
        putBundle(
            TelecomManager.EXTRA_OUTGOING_CALL_EXTRAS,
            android.os.Bundle().apply { putString(EXTRA_CALL_ID, callId) },
        )
    }
}
