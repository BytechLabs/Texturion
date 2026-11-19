package com.loonext.android.core.realtime

import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.advanceTimeBy
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import okhttp3.OkHttpClient
import org.junit.Assert.assertEquals
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class RealtimeClientTest {
    private fun newClient(scope: CoroutineScope) = RealtimeClient(
        http = OkHttpClient(),
        supabaseUrl = "https://example.supabase.co",
        publishableKey = "pk",
        scope = scope,
    )

    private fun event(seq: Int) = RealtimeEvent(
        event = "message.created",
        payload = buildJsonObject { put("seq", seq) },
    )

    @Test
    fun `no frame is dropped when a second collector is slow`() = runTest {
        val client = newClient(backgroundScope)
        // Exceed the 64-slot flow buffer to exercise the dispatch pump under backpressure.
        val total = 200
        val fast = mutableListOf<Int>()
        val slow = mutableListOf<Int>()
        backgroundScope.launch {
            client.events.collect { fast += it.payload.getValue("seq").jsonPrimitive.int }
        }
        backgroundScope.launch {
            client.events.collect {
                delay(1)
                slow += it.payload.getValue("seq").jsonPrimitive.int
            }
        }
        runCurrent()

        repeat(total) { client.ingestForTest(event(it)) }
        advanceTimeBy(total.toLong())
        runCurrent()

        val expected = (0 until total).toList()
        assertEquals(expected, fast)
        assertEquals(expected, slow)
    }

    @Test
    fun `a reconnect edge is not dropped while another collector is busy`() = runTest {
        val client = newClient(backgroundScope)
        var fast = 0
        var slow = 0
        val release = CompletableDeferred<Unit>()
        backgroundScope.launch {
            client.reconnected.collect { fast++ }
        }
        backgroundScope.launch {
            client.reconnected.collect {
                slow++
                if (slow == 1) release.await()
            }
        }
        runCurrent()

        client.signalReconnectForTest()
        runCurrent()
        assertEquals(1, fast)
        assertEquals(1, slow)

        // The slow collector is still busy, so the second edge fills its one pending slot.
        client.signalReconnectForTest()
        runCurrent()
        assertEquals(2, fast)
        client.signalReconnectForTest()
        runCurrent()
        assertEquals(3, fast)
        assertEquals(1, slow)

        release.complete(Unit)
        runCurrent()
        assertEquals(2, slow)
    }
}
