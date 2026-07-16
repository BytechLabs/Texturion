package com.loonext.android.core.realtime

import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import kotlinx.serialization.json.putJsonObject
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import java.util.concurrent.atomic.AtomicLong
import kotlin.math.min

/**
 * One realtime event off the company broadcast channel (SPEC §8). Payloads are
 * ID-only by design — consumers refetch the referenced resource via the API.
 */
data class RealtimeEvent(val event: String, val payload: JsonObject)

sealed interface RealtimeState {
    data object Disconnected : RealtimeState
    data object Connecting : RealtimeState
    data object Joined : RealtimeState
}

/**
 * Supabase Realtime private-broadcast client (Phoenix protocol over OkHttp
 * WebSocket) for the per-company channel `company:{id}`.
 *
 * - Private channel: join carries `access_token`; RLS on realtime.messages
 *   authorizes membership. Token refreshes are pushed via the `access_token`
 *   event so the socket survives JWT rotation.
 * - Reconnects with capped exponential backoff; each successful re-JOIN emits
 *   [reconnected] so callers refetch first pages (payloads may have been lost
 *   while offline — the web client does exactly this).
 */
class RealtimeClient(
    private val http: OkHttpClient,
    private val supabaseUrl: String,
    private val publishableKey: String,
    private val scope: CoroutineScope,
) {
    private val json = Json { ignoreUnknownKeys = true }

    private val _events = MutableSharedFlow<RealtimeEvent>(extraBufferCapacity = 64)
    val events: SharedFlow<RealtimeEvent> = _events

    private val _state = MutableStateFlow<RealtimeState>(RealtimeState.Disconnected)
    val state: StateFlow<RealtimeState> = _state

    private val _reconnected = MutableSharedFlow<Unit>(extraBufferCapacity = 1)

    /** Fires on every re-JOIN after the first — refetch first pages. */
    val reconnected: SharedFlow<Unit> = _reconnected

    private var socket: WebSocket? = null
    private var loop: Job? = null
    private val ref = AtomicLong(1)
    private var companyId: String? = null
    private var accessToken: String? = null
    private var everJoined = false

    /** Connect (or switch) to a company channel. Safe to call repeatedly. */
    @Synchronized
    fun connect(companyId: String, accessToken: String) {
        val sameChannel = this.companyId == companyId
        this.companyId = companyId
        this.accessToken = accessToken
        if (sameChannel && _state.value != RealtimeState.Disconnected) {
            pushAccessToken()
            return
        }
        everJoined = false
        restart()
    }

    /** Push a refreshed JWT into the live channel (call on every refresh). */
    @Synchronized
    fun setAuth(accessToken: String) {
        this.accessToken = accessToken
        pushAccessToken()
    }

    @Synchronized
    fun disconnect() {
        loop?.cancel()
        loop = null
        socket?.close(1000, "bye")
        socket = null
        companyId = null
        _state.value = RealtimeState.Disconnected
    }

    private fun restart() {
        loop?.cancel()
        socket?.close(1000, "switch")
        socket = null
        loop = scope.launch {
            var attempt = 0
            while (isActive && companyId != null) {
                _state.value = RealtimeState.Connecting
                val closed = CompletableDeferred<Unit>()
                val ws = open(closed)
                socket = ws
                if (ws != null) {
                    // A JOIN reply resets the backoff; see handle().
                    attempt = if (_state.value == RealtimeState.Joined) 0 else attempt
                    closed.await()
                }
                _state.value = RealtimeState.Disconnected
                attempt++
                val backoffMs = min(30_000L, 1_000L * (1L shl min(attempt, 5)))
                delay(backoffMs)
            }
        }
    }

    private fun open(closed: CompletableDeferred<Unit>): WebSocket? {
        val company = companyId ?: return null
        val wsBase = supabaseUrl
            .replaceFirst("https://", "wss://")
            .replaceFirst("http://", "ws://")
        val request = Request.Builder()
            .url("$wsBase/realtime/v1/websocket?apikey=$publishableKey&vsn=1.0.0")
            .build()

        return http.newWebSocket(request, object : WebSocketListener() {
            override fun onOpen(webSocket: WebSocket, response: Response) {
                webSocket.send(joinMessage(company))
                startHeartbeat(webSocket)
            }

            override fun onMessage(webSocket: WebSocket, text: String) {
                handle(text)
            }

            override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
                heartbeat?.cancel()
                closed.complete(Unit)
            }

            override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
                heartbeat?.cancel()
                closed.complete(Unit)
            }
        })
    }

    private var heartbeat: Job? = null

    private fun startHeartbeat(ws: WebSocket) {
        heartbeat?.cancel()
        heartbeat = scope.launch {
            while (isActive) {
                delay(25_000)
                ws.send(
                    message(topic = "phoenix", event = "heartbeat", payload = buildJsonObject {}),
                )
            }
        }
    }

    private fun handle(text: String) {
        val msg = try {
            json.parseToJsonElement(text).jsonObject
        } catch (_: Exception) {
            return
        }
        val event = msg["event"]?.jsonPrimitive?.content ?: return
        val payload = msg["payload"] as? JsonObject

        when (event) {
            "phx_reply" -> {
                val ok = payload?.get("status")?.jsonPrimitive?.content == "ok"
                val topic = msg["topic"]?.jsonPrimitive?.content
                if (ok && topic?.startsWith("realtime:company:") == true &&
                    _state.value != RealtimeState.Joined
                ) {
                    _state.value = RealtimeState.Joined
                    if (everJoined) _reconnected.tryEmit(Unit)
                    everJoined = true
                }
            }

            "broadcast" -> {
                val inner = payload ?: return
                val name = inner["event"]?.jsonPrimitive?.content ?: return
                val data = inner["payload"] as? JsonObject ?: buildJsonObject {}
                _events.tryEmit(RealtimeEvent(name, data))
            }

            "phx_close", "phx_error" -> {
                // The reconnect loop notices via onClosed/onFailure; nothing here.
            }
        }
    }

    private fun joinMessage(company: String): String {
        val token = accessToken.orEmpty()
        return message(
            topic = "realtime:company:$company",
            event = "phx_join",
            payload = buildJsonObject {
                putJsonObject("config") {
                    putJsonObject("broadcast") {
                        put("self", false)
                        put("ack", false)
                    }
                    putJsonObject("presence") { put("key", "") }
                    put("private", true)
                }
                put("access_token", token)
            },
        )
    }

    private fun pushAccessToken() {
        val company = companyId ?: return
        val token = accessToken ?: return
        socket?.send(
            message(
                topic = "realtime:company:$company",
                event = "access_token",
                payload = buildJsonObject { put("access_token", token) },
            ),
        )
    }

    private fun message(topic: String, event: String, payload: JsonObject): String =
        buildJsonObject {
            put("topic", topic)
            put("event", event)
            put("payload", payload)
            put("ref", ref.getAndIncrement().toString())
        }.toString()
}
