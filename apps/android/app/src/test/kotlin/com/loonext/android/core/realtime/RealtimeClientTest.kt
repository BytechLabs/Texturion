package com.loonext.android.core.realtime

import java.util.concurrent.CopyOnWriteArrayList
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
}
