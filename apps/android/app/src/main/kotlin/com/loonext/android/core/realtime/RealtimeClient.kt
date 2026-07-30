package com.loonext.android.core.realtime

import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.channels.BufferOverflow
import kotlinx.coroutines.channels.Channel
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
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import java.util.concurrent.atomic.AtomicLong
import kotlin.math.min

/**
 * One realtime event off this company's broadcast topics (SPEC §8). Payloads
 * are ID-only by design — consumers refetch the referenced resource via the API.
 */
data class RealtimeEvent(val event: String, val payload: JsonObject)

sealed interface RealtimeState {
    data object Disconnected : RealtimeState
    data object Connecting : RealtimeState
    data object Joined : RealtimeState
}

/**
 * Supabase Realtime private-broadcast client (Phoenix protocol over OkHttp
 * WebSocket) for one company's topics: `company:{id}` and, since #480, one
 * `company:{id}:number:{n}` per number this member is allowed to see.
 *
 * - N+1 topics on ONE socket. Phoenix multiplexes channels over a single
 *   connection, so per-number topics cost join frames, not sockets.
 * - Private channels: every join carries `access_token`; RLS on
 *   realtime.messages authorizes membership, and the per-number shape only when
 *   `member_number_level` is not 'none' (D88). Token refreshes are pushed to
 *   EVERY joined topic, because a private channel re-checks authorization only
 *   when a refreshed JWT arrives on it.
 * - Reconnects with capped exponential backoff; each successful re-JOIN of the
 *   COMPANY topic emits [reconnected] so callers refetch first pages (payloads
 *   may have been lost while offline — the web client does exactly this).
 */
class RealtimeClient(
    // The app's OkHttpClient, narrowed to the one thing this class asks of it.
    // #483: it is also the only place a test can stage a REFUSED send — OkHttp
    // refuses one only on a transport that is closing, and such a transport has
    // stopped delivering too, which would make the thing under test (what the
    // client remembers after a phx_leave it could not send) unobservable.
    private val http: WebSocket.Factory,
    private val supabaseUrl: String,
    private val publishableKey: String,
    private val scope: CoroutineScope,
) {
    private val json = Json { ignoreUnknownKeys = true }

    // #215: extraBufferCapacity's default onBufferOverflow is SUSPEND, so a
    // full buffer backpressures the emitter rather than dropping — the polar
    // opposite of the old tryEmit path, which returned false (and silently lost
    // the frame for EVERY subscriber) the instant one slow collector filled
    // these 64 slots.
    private val _events = MutableSharedFlow<RealtimeEvent>(extraBufferCapacity = 64)
    val events: SharedFlow<RealtimeEvent> = _events

    // #215 root-cause fix: broadcast frames arrive on the OkHttp WebSocket
    // thread, which must never block, yet a frame must never be dropped either.
    // They queue on this UNLIMITED channel (trySend always succeeds, never
    // blocks the socket) and a single dispatch coroutine drains it, re-emitting
    // with the SUSPENDING [MutableSharedFlow.emit]. A slow collector then
    // backpressures the queue (which simply grows) instead of starving the
    // other ~10 app-wide collectors of the same frame.
    private val ingress = Channel<RealtimeEvent>(Channel.UNLIMITED)

    private val _state = MutableStateFlow<RealtimeState>(RealtimeState.Disconnected)
    val state: StateFlow<RealtimeState> = _state

    // #483: DROP_OLDEST, where this used to take the default SUSPEND — and with
    // SUSPEND, [tryEmit] returns false on a full buffer and the edge is gone.
    // Gone for EVERY subscriber, not just a slow one: the single slot is shared
    // by all ~12 collectors and is freed only once the LAST of them has taken the
    // value, so "full" routinely means one screen was descheduled for a moment
    // rather than that anybody is behind. What that costs is the whole point of
    // the signal — the 11 screens that refetch first pages on it keep stale
    // content with no self-heal until the user navigates away, and
    // RootViewModel's collector, which re-derives the per-number topic set, never
    // runs. Broadcasts are NOT replayed (D88 addendum), so a dropped edge for an
    // `access.changed` published while this app was offline is the only notice a
    // newly granted number would ever have got: post-contract-step that member
    // silently receives nothing on it for the life of the process, with the
    // socket reporting Joined throughout.
    //
    // DROP_OLDEST keeps the NEWEST edge instead. Collapsing several into one is
    // correct for what this means — "something may have changed while you were
    // away, ask again" — because the later refetch subsumes the earlier one.
    // Losing the last one is not, and now cannot happen: tryEmit never returns
    // false when the overflow policy is not SUSPEND.
    private val _reconnected = MutableSharedFlow<Unit>(
        extraBufferCapacity = 1,
        onBufferOverflow = BufferOverflow.DROP_OLDEST,
    )

    /**
     * Fires once per re-JOIN of the company topic after the first — refetch
     * first pages. Once per RECONNECT, not once per topic: with N+1 channels on
     * the socket, a signal per join reply would mean N redundant refetches of
     * every open screen.
     *
     * Coalescing, not lossless: edges arriving faster than a collector drains
     * them are delivered as one. See [_reconnected] for why that is the right
     * trade and why the newest is nonetheless guaranteed.
     */
    val reconnected: SharedFlow<Unit> = _reconnected

    init {
        // The lossless dispatch pump (#215): lives for the client's lifetime,
        // suspends on an empty queue, and suspends on emit when a collector is
        // behind — so no frame is ever lost between the socket and the flow.
        scope.launch {
            for (event in ingress) _events.emit(event)
        }
    }

    private var socket: WebSocket? = null
    private var loop: Job? = null
    private val ref = AtomicLong(1)
    private var companyId: String? = null
    private var accessToken: String? = null

    /**
     * #480: the numbers whose per-number topics we WANT joined — the
     * access-filtered list exactly as the server reported it. Never narrowed
     * here: which numbers a member may see is D88's rule, and re-deciding it on
     * the client would be a second implementation of it.
     */
    private var numberIds: List<String> = emptyList()

    /**
     * Topics with a join frame sent on the CURRENT socket and not since refused,
     * plus any whose phx_leave the socket would not take (see [leaveUnwanted]).
     * Deliberately distinct from [numberIds]: the server refuses a number topic
     * whenever our list is a moment stale (a revocation we have not heard about
     * yet), and a refusal must not be retried on a loop. This is also the set
     * [pushAccessToken] walks, so it is the roster of channels we might still be
     * receiving on — never the roster we would LIKE to be receiving on.
     */
    private val joinedTopics = mutableSetOf<String>()

    /**
     * True once [companyId]'s COMPANY topic has been joined — the gate on
     * [reconnected]. Scoped to the COMPANY, not to a socket: a socket that
     * dropped is precisely the case a backfill exists for, so it is reset only
     * when the company itself changes.
     */
    private var everJoined = false

    /**
     * Connect (or switch) to a company's topics. Safe to call repeatedly, and
     * also how a changed number list is applied: pass the new one.
     */
    @Synchronized
    fun connect(companyId: String, accessToken: String, numberIds: List<String>) {
        val sameCompany = this.companyId == companyId
        this.companyId = companyId
        this.accessToken = accessToken
        this.numberIds = numberIds
        // Gated on a live reconnect LOOP, not on [_state]. This is a hot path
        // now — every `access.changed` runs it, not once per bootstrap — and
        // `_state != Disconnected` fell through to [restart] whenever the socket
        // happened to be down or in backoff: that cancelled the running backoff
        // and started it again at attempt 0, and cleared [everJoined], so the
        // re-JOIN that followed emitted no [reconnected] and every open screen
        // silently kept the gap that signal exists to backfill. The loop already
        // owns getting back up; all it needs is the new list, which [open]
        // applies on its next connection.
        if (sameCompany && loop?.isActive == true) {
            pushAccessToken()
            // #480: a number list that changed under a live connection is joined
            // and left in place. Restarting the socket would also arrive at the
            // right set, but it would cost the gap between close and re-JOIN
            // plus a [reconnected] refetch on every open screen — for what is
            // one extra frame.
            socket?.let { syncTopics(it) }
            return
        }
        // A genuine company SWITCH: the next company's first join IS a first
        // join, and backfilling pages nothing has ever fetched means nothing.
        everJoined = false
        restart()
    }

    /** Push a refreshed JWT into every live channel (call on every refresh). */
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
        numberIds = emptyList()
        joinedTopics.clear()
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
                    closed.await()
                    // A JOIN reply during THIS connection resets the backoff.
                    // open()/newWebSocket() returns BEFORE the async Phoenix JOIN
                    // reply lands, so checking before await() always saw
                    // Connecting and never reset — the backoff grew toward 30s
                    // even while joins kept succeeding. Check AFTER the socket
                    // closes (state is still Joined here; the loop sets
                    // Disconnected on the next line).
                    if (_state.value == RealtimeState.Joined) attempt = 0
                }
                // A closed socket is not a socket to send on. [connect] may now
                // land at any point in this backoff (it no longer restarts the
                // loop), and pushing joins into a dead transport would mark
                // topics joined that no server ever answered — [open] clears the
                // set on the next connection, so the joins would never be resent.
                socket = null
                _state.value = RealtimeState.Disconnected
                attempt++
                val backoffMs = min(30_000L, 1_000L * (1L shl min(attempt, 5)))
                delay(backoffMs)
            }
        }
    }

    @Synchronized
    private fun open(closed: CompletableDeferred<Unit>): WebSocket? {
        if (companyId == null) return null
        // Channel joins are per-connection: nothing carries over from the socket
        // that just died, so the set has to start empty or [syncTopics] would
        // skip the joins it believes it already sent.
        joinedTopics.clear()
        val wsBase = supabaseUrl
            .replaceFirst("https://", "wss://")
            .replaceFirst("http://", "ws://")
        val request = Request.Builder()
            .url("$wsBase/realtime/v1/websocket?apikey=$publishableKey&vsn=1.0.0")
            .build()

        return http.newWebSocket(request, object : WebSocketListener() {
            override fun onOpen(webSocket: WebSocket, response: Response) {
                syncTopics(webSocket)
                startHeartbeat(webSocket)
            }

            override fun onMessage(webSocket: WebSocket, text: String) {
                handle(webSocket, text)
            }

            override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
                heartbeat?.cancel()
                // A channel cannot outlive its transport, so an unsent leave has
                // nothing left to close.
                leaves?.cancel()
                closed.complete(Unit)
            }

            override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
                heartbeat?.cancel()
                leaves?.cancel()
                closed.complete(Unit)
            }
        })
    }

    /**
     * Bring the joined topics in line with [numberIds] on [ws]: the company
     * topic plus one per visible number, all on this one connection.
     *
     * Guarded per topic because Phoenix answers a second phx_join for a channel
     * already joined with an ERROR reply, which is indistinguishable from an
     * authorization refusal — so an unguarded re-join would make us forget a
     * channel we are in fact receiving on.
     */
    @Synchronized
    private fun syncTopics(ws: WebSocket) {
        val company = companyId ?: return
        val companyTopic = companyTopic(company)
        if (joinedTopics.add(companyTopic)) ws.send(joinMessage(companyTopic))

        val wanted = numberIds.mapTo(mutableSetOf()) { numberTopic(company, it) }
        for (topic in wanted) {
            if (joinedTopics.add(topic)) ws.send(joinMessage(topic))
        }

        if (leaveUnwanted(ws) > 0) retryLeaves(ws)
    }

    /**
     * Leave every joined number topic [numberIds] no longer wants, and report how
     * many the socket would not take.
     *
     * A number we no longer have is LEFT, not merely dropped from the list.
     * Authorization is a join-time handshake (D88 addendum): the server goes on
     * publishing to every channel we hold, so a member whose access was just
     * revoked would keep receiving that number's events until the socket dropped
     * if we only stopped wanting it.
     *
     * The topic is forgotten only once its leave is ON THE WIRE. Forgetting first
     * recorded a refused send as a completed revocation, and because
     * [pushAccessToken] iterates this same set it also dropped the topic from the
     * hourly token push — the one other thing that would have re-run the topic
     * policy and closed the channel. So a leave lost to a dying socket or a full
     * write buffer left the server publishing that number to us for up to an
     * hour, which is the exact window `broadcast_number_access_changed` exists to
     * shut. A topic kept here is retried by [retryLeaves] and re-checked by every
     * token push until one of them closes it.
     */
    @Synchronized
    private fun leaveUnwanted(ws: WebSocket): Int {
        val company = companyId ?: return 0
        val keep = numberIds.mapTo(mutableSetOf(companyTopic(company))) {
            numberTopic(company, it)
        }
        var refused = 0
        for (topic in joinedTopics - keep) {
            if (ws.send(message(topic, "phx_leave", buildJsonObject {}))) {
                joinedTopics.remove(topic)
            } else {
                refused++
            }
        }
        return refused
    }

    private var leaves: Job? = null

    /**
     * Retry the leaves [leaveUnwanted] could not hand to [ws]. One job at a time,
     * and bounded: a closing socket will never take them and a channel dies with
     * its transport anyway, so what retrying buys is the transient refusal — a
     * full output buffer, a backgrounding app. Anything still unsent when the
     * bound runs out is still in [joinedTopics], where the next access change and
     * every token push keep asking.
     */
    @Synchronized
    private fun retryLeaves(ws: WebSocket) {
        if (leaves?.isActive == true) return
        leaves = scope.launch {
            repeat(5) {
                delay(1_000)
                if (leaveUnwanted(ws) == 0) return@launch
            }
        }
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

    /**
     * A CHANNEL-level failure does not close the WebSocket. The transport stays
     * open, the 25s heartbeat keeps the server from idle-closing it, and OkHttp's
     * ping interval is satisfied by pongs from a perfectly healthy socket — so
     * `onClosed`/`onFailure` never fire, the reconnect loop's `closed.await()`
     * never resumes, and the backoff never runs. Realtime is then silently dead
     * for the life of the process: no inbound messages, no toasts, no call or
     * task ticks, with nothing observing `state` to notice. `connect()` cannot
     * recover it either — for the same company it early-returns and merely
     * pushes a token onto a channel that was never joined.
     *
     * The trigger is ordinary: the loop rejoins with whatever token was last
     * stashed, so an idle or offline stretch past the ~1h JWT lifetime draws a
     * rejected join (or a server-side channel close). Closing the transport on a
     * channel-level failure of the COMPANY topic hands control back to the
     * EXISTING capped backoff, which rejoins with the latest token.
     *
     * A per-number topic (#480) is judged the opposite way — see the branches.
     */
    private fun handle(webSocket: WebSocket, text: String) {
        val msg = try {
            json.parseToJsonElement(text).jsonObject
        } catch (_: Exception) {
            return
        }
        val event = msg["event"]?.jsonPrimitive?.content ?: return
        val payload = msg["payload"] as? JsonObject
        val topic = msg["topic"]?.jsonPrimitive?.content
        val companyTopic = companyId?.let { companyTopic(it) }
        // An EXACT match where this used to test the prefix `realtime:company:`.
        // That prefix now also matches the per-number topics riding the same
        // socket (#480), so it would have let a number topic's reply flip the
        // whole connection to Joined and a number topic's error close the
        // transport. The company topic is the one every member may join and the
        // only one whose loss means realtime is dead, so it alone governs the
        // reconnect; heartbeat replies ride topic "phoenix" and govern nothing.
        val isCompanyTopic = topic != null && topic == companyTopic
        val isNumberTopic = topic != null && companyTopic != null &&
            topic.startsWith("$companyTopic:number:")

        when (event) {
            "phx_reply" -> {
                val ok = payload?.get("status")?.jsonPrimitive?.content == "ok"
                if (isCompanyTopic) {
                    // Once per CONNECTION, not once per join: N+1 replies land
                    // per reconnect and only this branch can flip the state, so
                    // [reconnected] stays a single emission.
                    if (ok && _state.value != RealtimeState.Joined) {
                        _state.value = RealtimeState.Joined
                        if (everJoined) signalReconnected()
                        everJoined = true
                    } else if (!ok) {
                        // A REJECTED join (expired JWT being the common case) was
                        // previously ignored outright, parking the loop forever.
                        webSocket.close(1000, "join-rejected")
                    }
                } else if (isNumberTopic && !ok) {
                    // #480: a refused NUMBER topic is an ordinary outcome, not a
                    // transport failure. `is_company_topic_member` refuses it
                    // whenever the member's level is 'none', which is exactly
                    // what a stale list looks like. Closing the socket here — the
                    // right move for the company topic, so the backoff can rejoin
                    // with a fresh token — would reconnect, be refused again, and
                    // loop forever, taking every other subscription down on each
                    // pass. Forget the topic instead; the next access.changed or
                    // reconnect re-derives the list and asks again.
                    forgetTopic(topic)
                }
            }

            "broadcast" -> {
                val inner = payload ?: return
                val name = inner["event"]?.jsonPrimitive?.content ?: return
                val data = inner["payload"] as? JsonObject ?: buildJsonObject {}
                // Eight of the ten §8 events publish to BOTH the company topic
                // and the number's topic for the length of D88's
                // expand → adopt → contract transition, so a client joined to
                // both receives them twice. Deliberately NOT de-duplicated:
                // every consumer of [events] is an id-only refetch trigger, so a
                // duplicate costs one redundant read and never correctness,
                // while a seen-set would be new state to get wrong — and it
                // would need an exception for `call.updated` on a call whose
                // number was deleted (`calls.phone_number_id` is `on delete set
                // null`), which has no per-number topic and can only arrive on
                // the company one. The duplicates stop themselves when the
                // server drops the company send.

                // #480: number access changed somewhere in this company. The
                // payload names only the company — naming the number or the
                // member would broadcast the shape of the restriction to
                // everyone on the topic — so a client cannot tell whether it was
                // the subject and simply refetches.
                //
                // Reusing the reconnect signal rather than adding a second one:
                // every screen already treats it as "your cached pages may be
                // wrong, ask again", which is exactly what a change of access
                // means. Emitted IN ADDITION to the event itself, so a future
                // consumer that wants the event can still have it.
                if (name == "access.changed") signalReconnected()
                // trySend on an UNLIMITED channel never fails (never drops) and
                // never blocks this WebSocket thread — the dispatch pump above
                // does the (possibly suspending) hand-off to collectors.
                ingress.trySend(RealtimeEvent(name, data))
            }

            "phx_close", "phx_error" -> {
                // NOT a transport close (see the docblock): without this the
                // socket lives on, heartbeating, while the channel is dead.
                if (isCompanyTopic) {
                    webSocket.close(1000, "channel-closed")
                } else if (isNumberTopic) {
                    // #480: one number's channel dying is not the connection
                    // dying, and must not be able to take the socket with it —
                    // same reasoning as the refusal branch. Forgetting it stops
                    // us pushing tokens at a dead channel; the next reconnect or
                    // access change joins it again. Nothing is lost meanwhile:
                    // during the transition every number-scoped event also
                    // arrives on the company topic.
                    forgetTopic(topic)
                }
            }
        }
    }

    /**
     * Publish one "your cached pages may be wrong, ask again" edge.
     *
     * [tryEmit] rather than [MutableSharedFlow.emit] because both callers are on
     * the OkHttp reader thread, which must never suspend — a blocked reader stops
     * delivering every other frame on the socket. That was also how the edge got
     * lost, which is what [_reconnected]'s overflow policy now prevents; the
     * return value is unused because it can no longer be false.
     */
    private fun signalReconnected() {
        _reconnected.tryEmit(Unit)
    }

    @Synchronized
    private fun forgetTopic(topic: String) {
        joinedTopics.remove(topic)
    }

    private fun companyTopic(company: String) = "realtime:company:$company"

    /** Must match `broadcast_number_scoped`'s topic exactly (D88). */
    private fun numberTopic(company: String, numberId: String) =
        "realtime:company:$company:number:$numberId"

    private fun joinMessage(topic: String): String {
        val token = accessToken.orEmpty()
        return message(
            topic = topic,
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

    @Synchronized
    private fun pushAccessToken() {
        val token = accessToken ?: return
        val ws = socket ?: return
        // EVERY joined topic, not just the company one. A private channel
        // authorizes itself at join time and re-checks only when a refreshed JWT
        // is pushed TO IT (D88 addendum), so a per-number topic left on the old
        // token keeps running until the socket drops — and would never notice the
        // revocation this push exists to enforce.
        for (topic in joinedTopics.toList()) {
            ws.send(
                message(
                    topic = topic,
                    event = "access_token",
                    payload = buildJsonObject { put("access_token", token) },
                ),
            )
        }
    }

    private fun message(topic: String, event: String, payload: JsonObject): String =
        buildJsonObject {
            put("topic", topic)
            put("event", event)
            put("payload", payload)
            put("ref", ref.getAndIncrement().toString())
        }.toString()

    /**
     * #215 test seam: push an event through the real lossless dispatch path
     * (ingress channel → dispatch pump → suspending emit), exactly as [handle]'s
     * `broadcast` branch does for a live frame. Not used in production.
     */
    internal fun ingestForTest(event: RealtimeEvent) {
        ingress.trySend(event)
    }

    /**
     * #483 test seam: publish a reconnect edge through the real
     * [signalReconnected], exactly as a company-topic re-JOIN reply and an
     * `access.changed` frame do. Not used in production.
     *
     * A seam rather than real frames because what is under test is the flow's
     * overflow behaviour with a collector held mid-callback, and the emissions
     * have to land at a moment the test chooses — a reconnect on the wire costs a
     * transport drop and a backoff, neither of which can be timed against a
     * collector.
     */
    internal fun signalReconnectForTest() {
        signalReconnected()
    }
}
