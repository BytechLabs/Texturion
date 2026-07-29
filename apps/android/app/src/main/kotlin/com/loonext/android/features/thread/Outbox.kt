package com.loonext.android.features.thread

import android.content.Context
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json

/**
 * #234 — the durable outbox.
 *
 * Our users are in crawl spaces, mechanical rooms, elevators and parking
 * garages. That is not an edge case, it is the job. Before this, a send that
 * could not reach the server dropped its pending row, restored the draft and
 * showed a toast — so a tech who typed an update in a basement, hit send and
 * walked to the truck had nothing queued and, if they did not read the toast,
 * believed the customer had been told.
 *
 * WHAT DECIDES WHETHER SOMETHING IS QUEUED is whether we reached the server at
 * all, and that distinction is the whole design:
 *
 *   - We never reached it (no signal, DNS, timeout) → QUEUE. We have no answer
 *     yet, so the message waits for one.
 *   - We reached it and it REFUSED (opted out, cap, registration) → do NOT
 *     queue. That is an answer, and queueing it would mean re-asking a
 *     question that has already been decided while telling the user their
 *     message is on its way.
 *
 * #234 asks for "gates run at flush time, not at queue time", and this is that
 * rule stated precisely: a gate that has not run yet runs at flush; a gate
 * that has already refused is not re-run, it is reported.
 *
 * IDEMPOTENCY IS INHERITED, not invented. The key minted for the first attempt
 * is stored with the row and reused by every flush, so the existing
 * server-side claim machinery collapses a double-send into one message — which
 * is what makes a connectivity flap mid-flush safe.
 */
@Serializable
data class QueuedSend(
    /** Also the idempotency key: one identity for the life of this message. */
    val localId: String,
    val companyId: String,
    val conversationId: String,
    val body: String,
    /** ISO-8601, when the person actually pressed send. */
    val createdAt: String,
    /** Flush attempts so far — surfaced so a stuck row can be seen, not hidden. */
    val attempts: Int = 0,
    /** The last flush failure, for the row's own explanation. */
    val lastError: String? = null,
    /**
     * Set when the server REFUSED at flush. The row stops being retried
     * automatically and waits for the person: a refusal is an answer, and
     * silently re-asking would either spam a gate or, worse, eventually get a
     * yes to a question the customer had already answered with STOP.
     */
    val blocked: Boolean = false,
)

/**
 * Persistence for the outbox.
 *
 * An interface for the reason `ComposerDrafts` is one: what this must survive
 * — app kill, reboot, a flush racing itself — is exactly what a device test
 * would never catch reliably, and a JVM fake makes all of it assertable.
 */
interface Outbox {
    suspend fun all(): List<QueuedSend>
    suspend fun put(send: QueuedSend)
    suspend fun remove(localId: String)

    /** Everything queued for one thread, oldest first (the timeline order). */
    suspend fun forConversation(conversationId: String): List<QueuedSend> =
        all().filter { it.conversationId == conversationId }.sortedBy { it.createdAt }
}

private val Context.outboxStore by preferencesDataStore(name = "outbox")

@Suppress("FunctionName")
fun Outbox(context: Context): Outbox = DataStoreOutbox(context)

private class DataStoreOutbox(private val context: Context) : Outbox {
    private val json = Json { ignoreUnknownKeys = true }

    /**
     * ONE key holding the whole queue, rather than a key per message.
     *
     * A queue is read and rewritten as a unit on every flush, and DataStore
     * gives no cross-key transaction — so per-message keys would make a crash
     * mid-flush able to leave a partially-updated queue. It is also small by
     * construction: a person can only type so many messages while offline.
     */
    private val key = stringPreferencesKey("queued")

    override suspend fun all(): List<QueuedSend> {
        val raw = context.outboxStore.data.first()[key] ?: return emptyList()
        return runCatching { json.decodeFromString<List<QueuedSend>>(raw) }
            // A queue we cannot parse is a queue we cannot send. Dropping it
            // loses messages silently, which is the failure this file exists
            // to prevent — so keep the raw value and report empty, and the
            // next successful write replaces it.
            .getOrElse { emptyList() }
    }

    override suspend fun put(send: QueuedSend) {
        context.outboxStore.edit { prefs ->
            val current = prefs[key]
                ?.let { runCatching { json.decodeFromString<List<QueuedSend>>(it) }.getOrNull() }
                ?: emptyList()
            val next = current.filterNot { it.localId == send.localId } + send
            prefs[key] = json.encodeToString(next)
        }
    }

    override suspend fun remove(localId: String) {
        context.outboxStore.edit { prefs ->
            val current = prefs[key]
                ?.let { runCatching { json.decodeFromString<List<QueuedSend>>(it) }.getOrNull() }
                ?: return@edit
            prefs[key] = json.encodeToString(current.filterNot { it.localId == localId })
        }
    }
}

/** What one flush attempt did, so the caller can refresh exactly what changed. */
data class FlushResult(
    val sent: List<String> = emptyList(),
    val blocked: List<String> = emptyList(),
    val stillQueued: List<String> = emptyList(),
)

/**
 * Drains the outbox. One at a time, in the order the person wrote them.
 *
 * SERIAL, not parallel, and that is a product decision rather than a
 * simplification: these are messages to one customer, and delivering "on my
 * way" before "running 20 late" would be worse than delivering both slowly.
 *
 * The mutex is what makes #234's flap requirement hold — a handoff between LTE
 * and Wi-Fi can fire two connectivity callbacks within a second, and without
 * it both would read the same queue and send it twice. The idempotency key
 * would still collapse them server-side, but the client would show two rows
 * and count two sends, and "the key saves us" is not a reason to send twice.
 */
class OutboxFlusher(
    private val outbox: Outbox,
    private val send: suspend (QueuedSend) -> SendOutcome,
) {
    private val mutex = Mutex()

    suspend fun flush(): FlushResult = mutex.withLock {
        val sent = mutableListOf<String>()
        val blocked = mutableListOf<String>()
        val queued = mutableListOf<String>()

        for (item in outbox.all().sortedBy { it.createdAt }) {
            // A blocked row waits for the person, never for the network.
            if (item.blocked) {
                blocked += item.localId
                continue
            }
            when (val outcome = send(item)) {
                is SendOutcome.Sent -> {
                    outbox.remove(item.localId)
                    sent += item.localId
                }
                is SendOutcome.Refused -> {
                    // An answer. Stop retrying and let the row explain itself.
                    outbox.put(
                        item.copy(
                            attempts = item.attempts + 1,
                            lastError = outcome.message,
                            blocked = true,
                        ),
                    )
                    blocked += item.localId
                }
                is SendOutcome.Unreachable -> {
                    outbox.put(
                        item.copy(attempts = item.attempts + 1, lastError = outcome.message),
                    )
                    queued += item.localId
                    // Stop the pass: the network is down for this one, so it is
                    // down for the rest, and hammering it would only burn
                    // battery in the exact place battery matters.
                    break
                }
            }
        }
        FlushResult(sent = sent, blocked = blocked, stillQueued = queued)
    }
}

/** The three answers a flush can get, which is the distinction #234 turns on. */
sealed interface SendOutcome {
    data object Sent : SendOutcome

    /** The server answered no. Not retried automatically. */
    data class Refused(val message: String) : SendOutcome

    /** We never got an answer. Stays queued. */
    data class Unreachable(val message: String) : SendOutcome
}
