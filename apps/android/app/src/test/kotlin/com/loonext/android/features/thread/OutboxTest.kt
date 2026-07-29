package com.loonext.android.features.thread

import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.delay
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * #234 — the outbox, driven on the JVM.
 *
 * Everything this has to survive — app kill, a reboot, two connectivity
 * callbacks racing on an LTE/Wi-Fi handoff — is exactly what a device test
 * would never reproduce reliably. So the store is an interface and the flush
 * is pure logic over it.
 */
class OutboxTest {

    /** A fake with the one property that matters: it outlives the controller. */
    private class FakeOutbox(initial: List<QueuedSend> = emptyList()) : Outbox {
        var rows: List<QueuedSend> = initial
        override suspend fun all(): List<QueuedSend> = rows
        override suspend fun put(send: QueuedSend) {
            rows = rows.filterNot { it.localId == send.localId } + send
        }
        override suspend fun remove(localId: String) {
            rows = rows.filterNot { it.localId == localId }
        }
    }

    private fun queued(id: String, at: String, body: String = "hi") = QueuedSend(
        localId = id,
        companyId = "co",
        conversationId = "conv",
        body = body,
        createdAt = at,
    )

    @Test
    fun `a queued message survives the process and sends exactly once`() = runTest {
        // The acceptance case: airplane mode, compose, send, kill, reboot,
        // connectivity back. The store IS the survival — a fresh flusher over
        // the same rows is what "after a reboot" means here.
        val store = FakeOutbox(listOf(queued("k1", "2026-07-28T10:00:00Z")))
        val attempts = mutableListOf<String>()

        val flusher = OutboxFlusher(store) { item ->
            attempts += item.localId
            SendOutcome.Sent
        }
        val result = flusher.flush()

        assertEquals(listOf("k1"), result.sent)
        assertEquals(listOf("k1"), attempts)
        assertTrue("a sent row must leave the queue", store.rows.isEmpty())

        // A second flush after the first has nothing left to send.
        assertEquals(FlushResult(), OutboxFlusher(store) { SendOutcome.Sent }.flush())
    }

    @Test
    fun `two connectivity flaps produce one delivered message`() = runTest {
        // An LTE/Wi-Fi handoff fires two callbacks within a second. Without the
        // mutex both read the same queue and send it twice — the idempotency
        // key would collapse them server-side, but the client would show two
        // rows and count two sends, and "the key saves us" is not a reason to
        // send twice.
        val store = FakeOutbox(listOf(queued("k1", "2026-07-28T10:00:00Z")))
        val attempts = mutableListOf<String>()
        val flusher = OutboxFlusher(store) { item ->
            attempts += item.localId
            delay(10) // the window a real request leaves open
            SendOutcome.Sent
        }

        listOf(
            async { flusher.flush() },
            async { flusher.flush() },
        ).awaitAll()

        assertEquals("exactly one send attempt", 1, attempts.size)
        assertTrue(store.rows.isEmpty())
    }

    @Test
    fun `every flush reuses the key minted when the person pressed send`() = runTest {
        // The row's localId IS its idempotency key, so a message that fails
        // offline and flushes an hour later is the SAME message to the server.
        // Minting a fresh key per attempt is how a retry becomes a duplicate.
        val store = FakeOutbox(listOf(queued("k1", "2026-07-28T10:00:00Z")))
        val keys = mutableListOf<String>()
        var failFirst = true

        val flusher = OutboxFlusher(store) { item ->
            keys += item.localId
            if (failFirst) {
                failFirst = false
                SendOutcome.Unreachable("no signal")
            } else {
                SendOutcome.Sent
            }
        }
        flusher.flush()
        flusher.flush()

        assertEquals(listOf("k1", "k1"), keys)
        assertTrue(store.rows.isEmpty())
    }

    @Test
    fun `a refusal stops the row rather than retrying it forever`() = runTest {
        // A STOP arriving while the message sat queued. The server answering
        // "no" is an ANSWER — retrying it would either spam the gate or,
        // worse, eventually get a yes to a question the customer already
        // answered. The row waits for the person instead.
        val store = FakeOutbox(listOf(queued("k1", "2026-07-28T10:00:00Z")))
        var calls = 0
        val flusher = OutboxFlusher(store) {
            calls += 1
            SendOutcome.Refused("This customer opted out.")
        }

        assertEquals(listOf("k1"), flusher.flush().blocked)
        val row = store.rows.single()
        assertTrue("the row stays, so the person can see why", row.blocked)
        assertEquals("This customer opted out.", row.lastError)

        // The second flush must not re-ask.
        assertEquals(listOf("k1"), flusher.flush().blocked)
        assertEquals("a blocked row is never re-sent", 1, calls)
    }

    @Test
    fun `an unreachable network leaves the row queued and stops the pass`() = runTest {
        // Down for one is down for the rest, and hammering it burns battery in
        // the exact place battery matters.
        val store = FakeOutbox(
            listOf(
                queued("k1", "2026-07-28T10:00:00Z"),
                queued("k2", "2026-07-28T10:01:00Z"),
            ),
        )
        var calls = 0
        val flusher = OutboxFlusher(store) {
            calls += 1
            SendOutcome.Unreachable("no signal")
        }

        val result = flusher.flush()

        assertEquals(listOf("k1"), result.stillQueued)
        assertEquals("stops after the first unreachable", 1, calls)
        assertEquals("nothing is lost", 2, store.rows.size)
        assertEquals(1, store.rows.first { it.localId == "k1" }.attempts)
        assertFalse(store.rows.first { it.localId == "k1" }.blocked)
    }

    @Test
    fun `messages flush in the order they were written`() = runTest {
        // These are messages to one customer. Delivering "on my way" before
        // "running 20 late" would be worse than delivering both slowly.
        val store = FakeOutbox(
            listOf(
                queued("later", "2026-07-28T10:05:00Z", "on my way"),
                queued("earlier", "2026-07-28T10:00:00Z", "running 20 late"),
            ),
        )
        val order = mutableListOf<String>()
        OutboxFlusher(store) { item ->
            order += item.body
            SendOutcome.Sent
        }.flush()

        assertEquals(listOf("running 20 late", "on my way"), order)
    }

    @Test
    fun `a blocked row does not hold up the ones behind it`() = runTest {
        // The blocked row waits for a person, which could be hours. The
        // messages after it are to the same customer but are not refused, and
        // holding them hostage would turn one refusal into a dead thread.
        val store = FakeOutbox(
            listOf(
                queued("blocked", "2026-07-28T10:00:00Z").copy(blocked = true),
                queued("fine", "2026-07-28T10:01:00Z"),
            ),
        )
        val result = OutboxFlusher(store) { SendOutcome.Sent }.flush()

        assertEquals(listOf("blocked"), result.blocked)
        assertEquals(listOf("fine"), result.sent)
        assertEquals(listOf("blocked"), store.rows.map { it.localId })
    }

    @Test
    fun `the queue is per conversation for the timeline, oldest first`() = runTest {
        val store = FakeOutbox(
            listOf(
                queued("b", "2026-07-28T10:05:00Z"),
                queued("a", "2026-07-28T10:00:00Z"),
                queued("other", "2026-07-28T10:01:00Z").copy(conversationId = "elsewhere"),
            ),
        )
        assertEquals(listOf("a", "b"), store.forConversation("conv").map { it.localId })
    }
}
