package com.loonext.android.core.realtime

import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.atomic.AtomicInteger
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.onSubscription
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import okhttp3.OkHttpClient
import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * #215 Part B regression: the realtime transport must be lossless. The old path
 * emitted broadcast frames with `tryEmit` into a 64-slot SharedFlow, so the
 * instant ONE of the ~10 app-wide collectors fell behind and filled the buffer,
 * `tryEmit` returned false and the frame was silently dropped for EVERY
 * subscriber — the confirmed root cause of "a new inbound message doesn't
 * appear until you leave and return."
 *
 * #483 asks the same question of the RECONNECT signal, which still rides a
 * `tryEmit` — with one slot rather than 64, and a collector that now spends two
 * network round trips re-deriving the per-number topic set inside its callback.
 */
class RealtimeClientTest {

    private fun event(seq: Int) = RealtimeEvent(
        event = "message.created",
        payload = buildJsonObject { put("seq", seq) },
    )

    @Test
    fun `no frame is dropped when a second collector is slow`() = runBlocking {
        val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
        val client = RealtimeClient(
            http = OkHttpClient(),
            supabaseUrl = "https://example.supabase.co",
            publishableKey = "pk",
            scope = scope,
        )

        // Deliberately larger than the SharedFlow's 64-slot buffer: under the
        // old tryEmit path a slow collector filling the buffer would drop every
        // frame past it, so `slow` would plateau below `total` and the wait
        // below would time out. The lossless path must deliver all of them.
        val total = 200
        val fast = CopyOnWriteArrayList<Int>()
        val slow = CopyOnWriteArrayList<Int>()
        val fastReady = CompletableDeferred<Unit>()
        val slowReady = CompletableDeferred<Unit>()

        scope.launch {
            client.events
                .onSubscription { fastReady.complete(Unit) }
                .collect { fast.add(it.payload["seq"]!!.jsonPrimitive.int) }
        }
        scope.launch {
            client.events
                .onSubscription { slowReady.complete(Unit) }
                .collect {
                    // A collector that lags on every single frame.
                    delay(1)
                    slow.add(it.payload["seq"]!!.jsonPrimitive.int)
                }
        }

        try {
            // Both collectors must be registered before any emit — a replay=0
            // SharedFlow only delivers to live subscribers.
            withTimeout(5_000) {
                fastReady.await()
                slowReady.await()
            }

            repeat(total) { client.ingestForTest(event(it)) }

            // If any frame were dropped, one of these never reaches `total` and
            // the wait times out — the assertion never even runs.
            withTimeout(10_000) {
                while (fast.size < total || slow.size < total) delay(5)
            }

            // Every frame arrived at both collectors, in order — nothing lost,
            // and the slow one never starved the fast one.
            assertEquals((0 until total).toList(), fast.toList())
            assertEquals((0 until total).toList(), slow.toList())
        } finally {
            scope.cancel()
        }
    }

    /**
     * #483: the reconnect signal's single buffer slot is shared by all ~12
     * collectors and is freed only when the LAST of them has taken the value, so
     * one collector held inside its callback makes the flow full for everybody.
     * Under the old SUSPEND overflow policy `tryEmit` then returned false and the
     * edge was gone for EVERY subscriber — the 11 screens that refetch first pages
     * on it, and RootViewModel, whose callback is the only thing that re-derives
     * the per-number topic set after a gap the broadcasts do not replay.
     *
     * So: the newest edge must reach a ready collector even while another is
     * busy, and the busy one must get the newest rather than the stale one it
     * missed.
     */
    @Test
    fun `a reconnect edge is not dropped while another collector is busy`() = runBlocking {
        val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
        val client = RealtimeClient(
            http = OkHttpClient(),
            supabaseUrl = "https://example.supabase.co",
            publishableKey = "pk",
            scope = scope,
        )

        // Stands in for the 11 screens: takes every edge the instant it lands.
        val fast = AtomicInteger(0)
        // Stands in for RootViewModel's: two network calls inside the callback.
        val slow = AtomicInteger(0)
        val fastReady = CompletableDeferred<Unit>()
        val slowReady = CompletableDeferred<Unit>()
        val busy = CompletableDeferred<Unit>()
        val release = CompletableDeferred<Unit>()

        scope.launch {
            client.reconnected
                .onSubscription { fastReady.complete(Unit) }
                .collect { fast.incrementAndGet() }
        }
        scope.launch {
            client.reconnected
                .onSubscription { slowReady.complete(Unit) }
                .collect {
                    if (slow.incrementAndGet() == 1) {
                        busy.complete(Unit)
                        release.await()
                    }
                }
        }

        try {
            // replay=0: an edge published before both are registered is nobody's.
            withTimeout(5_000) {
                fastReady.await()
                slowReady.await()
            }

            client.signalReconnectForTest()
            // The slow collector has TAKEN the first edge (a SharedFlow advances
            // its index before invoking the callback) and is now stuck in it, so
            // the buffer is empty and the next edge has a slot.
            withTimeout(5_000) { busy.await() }

            client.signalReconnectForTest()
            // Waiting for the fast collector proves the second edge is buffered
            // AND that the slow one has not taken it — which is the only way to
            // know the single slot is now occupied, i.e. that the third edge below
            // is the one the old code dropped.
            withTimeout(5_000) { while (fast.get() < 2) delay(5) }

            client.signalReconnectForTest()

            // The edge that used to vanish. Under SUSPEND overflow this wait times
            // out and the assertion never runs.
            withTimeout(5_000) { while (fast.get() < 3) delay(5) }
            assertEquals(3, fast.get())

            release.complete(Unit)
            withTimeout(5_000) { while (slow.get() < 2) delay(5) }
            // Give any further delivery time to arrive before claiming there is
            // none.
            delay(250)
            // TWO, not three: the busy collector's two pending edges collapsed
            // into one, which is correct — this signal means "your cached pages
            // may be wrong, ask again", and the later ask subsumes the earlier.
            // What must never collapse away is the LAST edge, and it did not: the
            // delivery it got after being released is the third one, published
            // while it was busy.
            assertEquals(2, slow.get())
        } finally {
            // A collector parked on `release` would otherwise outlive the test if
            // an assertion failed before the release above.
            release.complete(Unit)
            scope.cancel()
        }
    }
}
