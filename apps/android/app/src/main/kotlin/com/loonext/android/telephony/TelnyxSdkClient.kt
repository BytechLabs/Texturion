package com.loonext.android.telephony

import android.content.Context
import com.telnyx.webrtc.sdk.TelnyxClient
import com.telnyx.webrtc.sdk.TokenConfig
import com.telnyx.webrtc.sdk.model.AudioDevice
import com.telnyx.webrtc.sdk.model.CallState
import com.telnyx.webrtc.sdk.model.LogLevel
import com.telnyx.webrtc.sdk.model.SocketMethod
import com.telnyx.webrtc.sdk.model.SocketStatus
import com.telnyx.webrtc.sdk.model.TxServerConfiguration
import com.telnyx.webrtc.sdk.verto.receive.InviteResponse
import com.telnyx.webrtc.sdk.verto.receive.ReceivedMessageBody
import com.telnyx.webrtc.sdk.verto.receive.SocketResponse
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.launch

/**
 * The real [SdkClient] over the Telnyx Android WebRTC SDK (v3.5). One
 * TelnyxClient per registration; [connect] tears the old one down and builds
 * fresh — mint-on-connect is the whole recovery story (a dead token can't be
 * fixed by the SDK's own reconnect, a rebuild with a fresh mint can).
 */
class TelnyxSdkClient(
    context: Context,
    private val scope: CoroutineScope,
) : SdkClient {
    private val appContext = context.applicationContext

    private val _events = MutableSharedFlow<SdkEvent>(extraBufferCapacity = 32)
    override val events: SharedFlow<SdkEvent> = _events

    private var client: TelnyxClient? = null
    private var socketJob: Job? = null

    override fun connect(token: String, callerIdName: String) {
        disconnect()
        val next = TelnyxClient(appContext)
        client = next
        socketJob = scope.launch {
            next.socketResponseFlow.collect { response ->
                // #168A: one malformed/unexpected message must not kill this
                // collector (every future event) — or, uncaught, the process.
                runCatching { onSocketResponse(next, response) }
            }
        }
        next.connect(
            TxServerConfiguration(),
            TokenConfig(
                sipToken = token,
                sipCallerIDName = callerIdName.ifBlank { "Loonext" },
                sipCallerIDNumber = "",
                fcmToken = null,
                ringtone = null,
                ringBackTone = null,
                logLevel = LogLevel.ERROR,
                autoReconnect = true,
            ),
            null,
            true,
        )
    }

    override fun disconnect() {
        socketJob?.cancel()
        socketJob = null
        val previous = client
        client = null
        runCatching { previous?.disconnect() }
    }

    override fun newCall(
        callerIdName: String,
        callerIdNumber: String,
        destinationNumber: String,
        clientState: String,
    ): SdkCallHandle {
        val active = client ?: throw IllegalStateException("softphone is not connected")
        // The Android SDK base64-encodes its clientState argument internally;
        // hand it the DECODED tag so the wire carries the server's client_state
        // byte-for-byte (see ClientState).
        val call = active.newInvite(
            callerIdName,
            callerIdNumber,
            destinationNumber,
            ClientState.forAndroidSdk(clientState),
        )
        return TelnyxCallHandle(active, call)
    }

    override fun setAudioRoute(route: AudioRoute) {
        client?.setAudioOutputDevice(
            when (route) {
                AudioRoute.EARPIECE -> AudioDevice.PHONE_EARPIECE
                AudioRoute.SPEAKER -> AudioDevice.LOUDSPEAKER
                AudioRoute.BLUETOOTH -> AudioDevice.BLUETOOTH
            },
        )
    }

    private fun onSocketResponse(
        source: TelnyxClient,
        response: SocketResponse<ReceivedMessageBody>,
    ) {
        // A stale client's straggler events must not flip the fresh one's state.
        if (source !== client) return
        when (response.status) {
            SocketStatus.ESTABLISHED, SocketStatus.LOADING -> Unit
            SocketStatus.DISCONNECT -> _events.tryEmit(SdkEvent.Disconnected)
            SocketStatus.ERROR -> _events.tryEmit(SdkEvent.Error(response.errorMessage))
            SocketStatus.MESSAGERECEIVED -> onMessage(source, response.data)
        }
    }

    private fun onMessage(source: TelnyxClient, body: ReceivedMessageBody?) {
        when (body?.method) {
            SocketMethod.CLIENT_READY.methodName -> _events.tryEmit(SdkEvent.Ready)
            SocketMethod.INVITE.methodName -> {
                val invite = body.result as? InviteResponse ?: return
                val call = source.getActiveCalls()[invite.callId] ?: return
                // §3.2 DETERMINISTIC correlation: the server stamps
                // `X-Loonext-Session` on every member ring dial, and the SDK
                // surfaces it here as first-class custom headers ({name,value},
                // verified against telnyx-webrtc-android v3.5.0). Hand the raw
                // list up; [TelecomCallReducer.correlateInvite] reads the header
                // — NEVER a caller/time guess. legId is the by-leg fallback key
                // for an older server that hasn't shipped the header yet.
                val headers = runCatching {
                    invite.customHeaders?.mapNotNull { header ->
                        val name = header.name ?: return@mapNotNull null
                        name to (header.value ?: "")
                    }.orEmpty()
                }.getOrDefault(emptyList())
                val legId = runCatching { call.getTelnyxSessionId()?.toString() }.getOrNull()
                _events.tryEmit(
                    SdkEvent.Incoming(
                        call = TelnyxCallHandle(source, call),
                        callerName = invite.callerIdName,
                        callerNumber = invite.callerIdNumber,
                        customHeaders = headers,
                        legId = legId,
                    ),
                )
            }
        }
    }
}

/** One SDK call behind the testable handle interface. */
private class TelnyxCallHandle(
    private val client: TelnyxClient,
    private val call: com.telnyx.webrtc.sdk.Call,
) : SdkCallHandle {
    override val id: String = call.callId.toString()

    override val callControlId: String?
        get() = call.getTelnyxCallControlId()

    override val telnyxSessionId: String?
        get() = call.getTelnyxSessionId()?.toString()

    override val phases: Flow<CallPhase?> = call.callStateFlow.map { state ->
        when (state) {
            is CallState.NEW, is CallState.CONNECTING, is CallState.RINGING ->
                CallPhase.CONNECTING

            is CallState.ACTIVE -> CallPhase.ACTIVE
            is CallState.HELD -> CallPhase.HELD
            is CallState.DONE, is CallState.ERROR -> CallPhase.ENDED

            // Mid-call recovery states — the call keeps its current phase; a
            // failed recovery lands in DONE/ERROR on its own.
            else -> null
        }
    }

    override fun accept(destinationNumber: String) {
        client.acceptCall(call.callId, destinationNumber)
    }

    override fun end() {
        client.endCall(call.callId)
    }

    override fun toggleHold() {
        call.onHoldUnholdPressed(call.callId)
    }

    override fun setMuted(muted: Boolean) {
        call.setMuteState(muted)
    }

    override fun dtmf(digit: String) {
        call.dtmf(call.callId, digit)
    }
}
