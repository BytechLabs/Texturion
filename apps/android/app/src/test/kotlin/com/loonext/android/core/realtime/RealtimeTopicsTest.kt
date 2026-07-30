package com.loonext.android.core.realtime

import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.atomic.AtomicInteger
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.flow.onSubscription
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import mockwebserver3.MockResponse
import mockwebserver3.MockWebServer
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Before
import org.junit.Test

private const val COMPANY = "co-1"
private const val COMPANY_TOPIC = "realtime:company:$COMPANY"

private fun numberTopic(numberId: String) = "$COMPANY_TOPIC:number:$numberId"

private fun replyFrame(topic: String, ref: String, ok: Boolean) =
    """{"topic":"$topic","event":"phx_reply","ref":"$ref",""" +
        """"payload":{"status":"${if (ok) "ok" else "error"}","response":{}}}"""

private fun broadcastFrame(topic: String, event: String, conversationId: String) =
    """{"topic":"$topic","event":"broadcast","payload":{"event":"$event",""" +
        """"payload":{"conversation_id":"$conversationId"}}}"""

/** A CHANNEL-level failure — not a transport one. */
private fun channelErrorFrame(topic: String) =
    """{"topic":"$topic","event":"phx_error","payload":{}}"""

private fun JsonObject.str(key: String) = this[key]?.jsonPrimitive?.content

/**
 * Stands in for Supabase Realtime: records what the client sent, answers every
 * phx_join, and can REFUSE a topic the way the `realtime.messages` policy does
 * when `member_number_level` is 'none' (D88).
 */
private class FakeRealtimeServer : WebSocketListener() {
    private val json = Json { ignoreUnknownKeys = true }

    /** Every frame the client sent, in order. */
    val received = CopyOnWriteArrayList<JsonObject>()

    /** One entry per accepted connection — the tests assert there is only ONE. */
    val connections = CopyOnWriteArrayList<WebSocket>()

    /** Close reasons the CLIENT initiated: the "realtime is dead" signal. */
    val clientCloses = CopyOnWriteArrayList<String>()

    @Volatile
    var refuse: (String) -> Boolean = { false }

    override fun onOpen(webSocket: WebSocket, response: Response) {
        connections.add(webSocket)
    }

    override fun onMessage(webSocket: WebSocket, text: String) {
        val msg = json.parseToJsonElement(text).jsonObject
        // Reply BEFORE recording. A test that has observed a join frame then
        // knows its reply is already on the wire, so anything the test sends
        // afterwards is strictly later in the client's single reader — which is
        // what makes "the refusal has been processed" observable at all.
        val topic = msg.str("topic")
        if (msg.str("event") == "phx_join" && topic != null) {
            webSocket.send(replyFrame(topic, msg.str("ref") ?: "0", ok = !refuse(topic)))
        }
        received.add(msg)
    }

    override fun onClosing(webSocket: WebSocket, code: Int, reason: String) {
        clientCloses.add(reason)
        // Echo the close so the client's onClosed fires and its backoff runs.
        webSocket.close(1000, null)
    }

    fun topicsOf(event: String): List<String> =
        received.filter { it.str("event") == event }.mapNotNull { it.str("topic") }
}

/**
 * The real transport with one behaviour changed: the first [refusals] phx_leave
 * frames are REFUSED, the way OkHttp refuses any send once its output buffer is
 * full or the socket is closing.
 *
 * Staged in a decorator rather than on the wire because the real conditions are
 * unobservable: a socket that refuses sends for real has also stopped
 * delivering, so what this exists to test — what the client still believes it is
 * joined to after a leave it could not send — could never be read back.
 */
private class RefusesLeaves(
    private val delegate: WebSocket,
    private val refusals: AtomicInteger,
) : WebSocket by delegate {
    override fun send(text: String): Boolean = when {
        !text.contains("\"phx_leave\"") -> delegate.send(text)
        refusals.getAndDecrement() > 0 -> false
        else -> delegate.send(text)
    }
}

private class RefusingSockets(
    private val real: OkHttpClient,
    private val refusals: AtomicInteger,
) : WebSocket.Factory {
    override fun newWebSocket(request: Request, listener: WebSocketListener): WebSocket =
        RefusesLeaves(real.newWebSocket(request, listener), refusals)
}

/**
 * #480 step 5: the client subscribes to `company:{id}` AND one
 * `company:{id}:number:{n}` per number it may see, all on one socket.
 *
 * These are frame-level tests against a real WebSocket because everything that
 * matters here is a frame: which topics are joined, which are left, which
 * refusals are survivable, and which single topic decides that the connection
 * itself is dead.
 */
class RealtimeTopicsTest {
    private lateinit var server: MockWebServer
    private lateinit var channel: FakeRealtimeServer
    private lateinit var scope: CoroutineScope
    private lateinit var client: RealtimeClient

    /** How many phx_leave sends the transport will refuse — none by default. */
    private val refusedLeaves = AtomicInteger(0)

    @Before
    fun setUp() {
        channel = FakeRealtimeServer()
        server = MockWebServer().also { it.start() }
        scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
        client = RealtimeClient(
            http = RefusingSockets(OkHttpClient(), refusedLeaves),
            supabaseUrl = server.url("/").toString().trimEnd('/'),
            publishableKey = "pk",
            scope = scope,
        )
    }

    @After
    fun tearDown() {
        client.disconnect()
        scope.cancel()
        server.close()
    }

    /** Accept [count] upgrades — one per (re)connect the test expects. */
    private fun serve(count: Int) {
        repeat(count) {
            server.enqueue(MockResponse.Builder().webSocketUpgrade(channel).build())
        }
    }

    private fun awaitUntil(what: String, timeoutMs: Long = 5_000, check: () -> Boolean) {
        val deadline = System.currentTimeMillis() + timeoutMs
        while (System.currentTimeMillis() < deadline) {
            if (check()) return
            Thread.sleep(10)
        }
        fail("timed out waiting for $what")
    }

    /** Start collecting [RealtimeClient.events] and wait until registered. */
    private fun collectEvents(): List<RealtimeEvent> {
        val seen = CopyOnWriteArrayList<RealtimeEvent>()
        val ready = CompletableDeferred<Unit>()
        scope.launch {
            client.events
                .onSubscription { ready.complete(Unit) }
                .collect { seen.add(it) }
        }
        // replay=0: a frame sent before the collector registers is nobody's.
        runBlocking { withTimeout(5_000) { ready.await() } }
        return seen
    }

    /** Start collecting [RealtimeClient.reconnected] and wait until registered. */
    private fun collectReconnects(): List<Unit> {
        val seen = CopyOnWriteArrayList<Unit>()
        val ready = CompletableDeferred<Unit>()
        scope.launch {
            client.reconnected
                .onSubscription { ready.complete(Unit) }
                .collect { seen.add(Unit) }
        }
        runBlocking { withTimeout(5_000) { ready.await() } }
        return seen
    }

    @Test
    fun `joins the company topic and one topic per visible number`() {
        serve(1)
        client.connect(COMPANY, "jwt-1", listOf("num-a", "num-b"))

        awaitUntil("three joins") { channel.topicsOf("phx_join").size == 3 }
        assertEquals(
            listOf(COMPANY_TOPIC, numberTopic("num-a"), numberTopic("num-b")),
            channel.topicsOf("phx_join"),
        )
        // N+1 CHANNELS on ONE connection: Phoenix multiplexes, so a socket per
        // number would be N handshakes and N heartbeats for nothing.
        assertEquals(1, server.requestCount)
    }

    @Test
    fun `a member with no visible numbers joins the company topic alone and works`() {
        serve(1)
        val seen = collectEvents()
        client.connect(COMPANY, "jwt-1", emptyList())

        awaitUntil("the company join") { channel.topicsOf("phx_join").isNotEmpty() }
        awaitUntil("the channel to join") { client.state.value == RealtimeState.Joined }
        assertEquals(listOf(COMPANY_TOPIC), channel.topicsOf("phx_join"))

        // Zero numbers is a real state, not a failure: everything company-wide
        // (registration.updated, read.notifications, access.changed) still lands.
        channel.connections[0].send(broadcastFrame(COMPANY_TOPIC, "message.created", "conv-1"))
        awaitUntil("the company event") { seen.size == 1 }
    }

    @Test
    fun `a refused number topic neither closes the socket nor silences the rest`() {
        serve(1)
        channel.refuse = { it == numberTopic("num-b") }
        val seen = collectEvents()

        client.connect(COMPANY, "jwt-1", listOf("num-a", "num-b"))
        awaitUntil("three joins") { channel.topicsOf("phx_join").size == 3 }

        // The refusal is behind this broadcast in the client's reader, so once
        // the event lands the refusal has definitely been handled.
        channel.connections[0]
            .send(broadcastFrame(numberTopic("num-a"), "message.created", "conv-1"))
        awaitUntil("the accepted topic's event") { seen.size == 1 }

        // One topic this member may not see is not a transport failure. Closing
        // the socket here would reconnect, be refused again, and loop — taking
        // every other subscription down on each pass.
        assertTrue(channel.clientCloses.isEmpty())
        assertEquals(1, server.requestCount)
        assertEquals(RealtimeState.Joined, client.state.value)

        // And the refused topic is forgotten, so a token refresh is not pushed
        // at a channel we were never let into.
        client.setAuth("jwt-2")
        awaitUntil("the token pushes") { channel.topicsOf("access_token").size == 2 }
        assertEquals(
            listOf(COMPANY_TOPIC, numberTopic("num-a")),
            channel.topicsOf("access_token"),
        )
    }

    @Test
    fun `a refused company topic still drops the transport for the backoff`() {
        serve(1)
        channel.refuse = { it == COMPANY_TOPIC }

        client.connect(COMPANY, "jwt-1", listOf("num-a"))

        var sawJoined = false
        awaitUntil("the client to drop the transport") {
            if (client.state.value == RealtimeState.Joined) sawJoined = true
            channel.clientCloses.isNotEmpty()
        }
        // An expired JWT is the common case, and only a fresh connection can fix
        // it — so this one refusal DOES end the connection.
        assertEquals("join-rejected", channel.clientCloses[0])
        // num-a was accepted, and that must not have counted as "we are up":
        // only the company topic decides the connection's state.
        assertFalse(sawJoined)
    }

    @Test
    fun `a per-number channel error leaves the transport alone`() {
        serve(1)
        val seen = collectEvents()
        client.connect(COMPANY, "jwt-1", listOf("num-a"))
        awaitUntil("both joins") { channel.topicsOf("phx_join").size == 2 }

        val connection = channel.connections[0]
        connection.send(channelErrorFrame(numberTopic("num-a")))
        connection.send(broadcastFrame(COMPANY_TOPIC, "message.created", "conv-1"))
        awaitUntil("the company event") { seen.size == 1 }

        assertTrue(channel.clientCloses.isEmpty())
        assertEquals(1, server.requestCount)

        // The dead channel is forgotten rather than kept on the push list.
        client.setAuth("jwt-2")
        awaitUntil("the token push") { channel.topicsOf("access_token").size == 1 }
        assertEquals(listOf(COMPANY_TOPIC), channel.topicsOf("access_token"))
    }

    @Test
    fun `an access change joins the added number and leaves the removed one`() {
        serve(1)
        client.connect(COMPANY, "jwt-1", listOf("num-a"))
        awaitUntil("the first two joins") { channel.topicsOf("phx_join").size == 2 }
        awaitUntil("the channel to join") { client.state.value == RealtimeState.Joined }

        // Exactly what RootViewModel does when `access.changed` lands: same
        // company, a re-derived number list.
        client.connect(COMPANY, "jwt-1", listOf("num-b"))

        awaitUntil("the join/leave delta") {
            channel.topicsOf("phx_join").size == 3 && channel.topicsOf("phx_leave").size == 1
        }
        assertEquals(numberTopic("num-b"), channel.topicsOf("phx_join")[2])
        // LEFT, not merely dropped from the list. Authorization is a join-time
        // handshake, so the server keeps publishing to every channel we hold.
        assertEquals(listOf(numberTopic("num-a")), channel.topicsOf("phx_leave"))
        // On the LIVE socket: no reconnect, so no gap and no refetch storm.
        assertEquals(1, server.requestCount)
    }

    @Test
    fun `events arrive on both topics and duplicates are not suppressed`() {
        serve(1)
        val seen = collectEvents()
        client.connect(COMPANY, "jwt-1", listOf("num-a"))
        awaitUntil("both joins") { channel.topicsOf("phx_join").size == 2 }

        // The dual-publish window (D88 addendum): one write, two sends.
        val connection = channel.connections[0]
        connection.send(broadcastFrame(COMPANY_TOPIC, "message.created", "conv-1"))
        connection.send(broadcastFrame(numberTopic("num-a"), "message.created", "conv-1"))

        awaitUntil("both copies") { seen.size == 2 }
        // Handled TWICE on purpose. Every consumer is an id-only refetch
        // trigger, so a duplicate costs a redundant read and never correctness,
        // while a seen-set would be new state to get wrong — and it would need
        // an exception for `call.updated` on a call whose number was deleted,
        // which can only arrive on the company topic.
        assertEquals(
            listOf("conv-1", "conv-1"),
            seen.map { it.payload["conversation_id"]?.jsonPrimitive?.content },
        )
    }

    @Test
    fun `reconnected fires once per reconnect, not once per topic`() {
        serve(2)
        val reconnects = collectReconnects()

        client.connect(COMPANY, "jwt-1", listOf("num-a", "num-b", "num-c"))
        awaitUntil("four joins") { channel.topicsOf("phx_join").size == 4 }
        awaitUntil("the channel to join") { client.state.value == RealtimeState.Joined }
        // A FIRST join is not a reconnect — there is nothing to backfill.
        assertEquals(0, reconnects.size)

        // The company channel dies, which does end the connection.
        channel.connections[0].send(channelErrorFrame(COMPANY_TOPIC))

        awaitUntil("four re-joins", timeoutMs = 20_000) {
            channel.topicsOf("phx_join").size == 8
        }
        awaitUntil("the reconnect signal") { reconnects.size == 1 }
        // Four join replies, ONE signal. The company topic alone flips the
        // state, so screens refetch their first pages once per reconnect rather
        // than once per number.
        Thread.sleep(250)
        assertEquals(1, reconnects.size)
    }

    @Test
    fun `an access change while the socket is down still backfills on reconnect`() {
        serve(2)
        val reconnects = collectReconnects()

        client.connect(COMPANY, "jwt-1", listOf("num-a"))
        awaitUntil("both joins") { channel.topicsOf("phx_join").size == 2 }
        awaitUntil("the channel to join") { client.state.value == RealtimeState.Joined }

        // The socket dies — an elevator, a lost cell. The loop is now sitting in
        // its backoff delay with no transport.
        channel.connections[0].send(channelErrorFrame(COMPANY_TOPIC))
        awaitUntil("the transport to drop") {
            client.state.value == RealtimeState.Disconnected
        }

        // `access.changed` lands in exactly that window. Ordinary rather than
        // exotic: RootViewModel spends ~300ms on /v1/me before it gets here.
        client.connect(COMPANY, "jwt-1", listOf("num-a", "num-b"))

        awaitUntil("the re-JOIN with the new list", timeoutMs = 20_000) {
            channel.topicsOf("phx_join").size == 5
        }
        assertEquals(
            listOf(COMPANY_TOPIC, numberTopic("num-a"), numberTopic("num-b")),
            channel.topicsOf("phx_join").drop(2),
        )
        // The point: connect() no longer clears the backfill gate just because
        // the socket happened to be down. It used to, and then InboxTab,
        // ThreadScreen, CallsScreen and TasksTab kept their pre-gap pages with no
        // self-heal until the user navigated away and back.
        awaitUntil("the reconnect signal") { reconnects.size == 1 }
        // One socket per drop: the live backoff was not cancelled and restarted
        // underneath itself either.
        assertEquals(2, server.requestCount)
    }

    @Test
    fun `switching company is a first join, not a reconnect`() {
        serve(2)
        val reconnects = collectReconnects()

        client.connect(COMPANY, "jwt-1", listOf("num-a"))
        awaitUntil("both joins") { channel.topicsOf("phx_join").size == 2 }
        awaitUntil("the channel to join") { client.state.value == RealtimeState.Joined }

        // A DIFFERENT company is the one case that legitimately clears the gate:
        // co-2 has no cached pages that could have missed anything.
        client.connect("co-2", "jwt-1", emptyList())

        awaitUntil("the second socket") { server.requestCount == 2 }
        awaitUntil("co-2's join") {
            channel.topicsOf("phx_join").contains("realtime:company:co-2")
        }
        // The fake replies before it records, so the reply is already on the
        // wire; this is the client's reader being given time to act on it.
        Thread.sleep(250)
        assertEquals(RealtimeState.Joined, client.state.value)
        assertEquals(0, reconnects.size)
    }

    @Test
    fun `a leave the socket refuses stays on the token push list`() {
        serve(1)
        refusedLeaves.set(Int.MAX_VALUE)
        client.connect(COMPANY, "jwt-1", listOf("num-a"))
        awaitUntil("both joins") { channel.topicsOf("phx_join").size == 2 }
        awaitUntil("the channel to join") { client.state.value == RealtimeState.Joined }

        // Access revoked: num-a leaves the list, and every leave frame for it is
        // refused by the transport.
        client.connect(COMPANY, "jwt-1", emptyList())
        client.setAuth("jwt-2")

        // connect() pushes the token BEFORE it syncs topics, so the pair that
        // proves the topic survived the refused leave is the second one.
        awaitUntil("both token pushes") { channel.topicsOf("access_token").size == 4 }
        // Still ours to close, so the hourly token push keeps re-running the topic
        // policy against it — the only other thing that can shut a channel whose
        // authorization was a join-time handshake. Forgetting it here recorded a
        // failed revocation as a completed one AND removed that backstop, leaving
        // the server publishing this number to us until the socket happened to die.
        assertEquals(
            listOf(COMPANY_TOPIC, numberTopic("num-a")),
            channel.topicsOf("access_token").drop(2),
        )
        // Nothing reached the server, so nothing was in fact left.
        assertTrue(channel.topicsOf("phx_leave").isEmpty())
    }

    @Test
    fun `a refused leave is retried until the socket takes it`() {
        serve(1)
        refusedLeaves.set(1)
        client.connect(COMPANY, "jwt-1", listOf("num-a"))
        awaitUntil("both joins") { channel.topicsOf("phx_join").size == 2 }
        awaitUntil("the channel to join") { client.state.value == RealtimeState.Joined }

        client.connect(COMPANY, "jwt-1", emptyList())

        // The first leave was refused and nothing else calls syncTopics, so a
        // leave arriving at all IS the retry. Without one the revocation would
        // wait for the socket to drop or for a token push to be refused — the
        // hour `broadcast_number_access_changed` exists to remove.
        awaitUntil("the retried leave") { channel.topicsOf("phx_leave").size == 1 }
        assertEquals(listOf(numberTopic("num-a")), channel.topicsOf("phx_leave"))

        // And now that it really is gone, it drops off the push list too.
        client.setAuth("jwt-2")
        awaitUntil("the last token push") { channel.topicsOf("access_token").size == 3 }
        assertEquals(listOf(COMPANY_TOPIC), channel.topicsOf("access_token").drop(2))
    }
}
