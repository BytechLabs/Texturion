package com.loonext.android.features.thread

import android.content.Context
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import java.time.Instant
import java.time.temporal.ChronoUnit
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
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
    /**
     * Photos that ride with this message, as files this app owns.
     *
     * NOT the picker's content URI. That URI's read permission dies with the
     * process, so a row restored after a reboot would hold a handle to nothing
     * and the message would send with the photo silently missing — which is
     * the exact failure #234 exists to prevent. The bytes are already in hand
     * when the person presses send (the composer read and normalized them to
     * stage the chip), so queueing copies them into our own storage.
     */
    val media: List<QueuedMedia> = emptyList(),
    /**
     * The person has been told this message is old and said send it anyway.
     *
     * Without this the age-out below would re-block the row on the very next
     * flush, so "send it anyway" would be a button that does nothing.
     */
    val staleAcknowledged: Boolean = false,
)

/** One queued photo: a file in this app's storage, plus what it is. */
@Serializable
data class QueuedMedia(
    val fileName: String,
    val contentType: String,
)

/** Bytes on their way to disk — the composer's StagedPhoto, minus its Uri. */
class OutboxMediaBytes(val contentType: String, val bytes: ByteArray)

/**
 * How long a queued message keeps sending itself before it stops and asks.
 *
 * A day, because the thing being protected against is not the basement — it is
 * the phone that was in a drawer all weekend. "On my way" delivered Monday
 * morning is worse than not delivered: the customer reads it as current. Past
 * this the row waits for a person, who is the only one who knows whether the
 * message still means anything.
 */
const val OUTBOX_AGE_OUT_HOURS = 24L

/** Said to the person, not logged — so it names the decision they now own. */
const val OUTBOX_STALE_MESSAGE =
    "Queued for over a day. The conversation may have moved on — send it now, or delete it."

/** Said when the photo is gone but the words are still worth sending. */
const val OUTBOX_MEDIA_LOST_MESSAGE =
    "The photo for this message is no longer on this device. Send the text on its own, " +
        "or delete it."

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

    /** Drops the row AND the photos it owned — nothing outlives its message. */
    suspend fun remove(localId: String)

    /**
     * Copy staged bytes into storage this app owns, before the row is written.
     *
     * That order is deliberate. Files first then row means a crash in between
     * leaves orphaned files, which [pruneMedia] sweeps. Row first then files
     * would leave a row pointing at photos that do not exist — a message that
     * can never be sent as written, which is the worse of the two.
     */
    suspend fun saveMedia(localId: String, items: List<OutboxMediaBytes>): List<QueuedMedia>

    /** Null when the file is gone — the caller must not send as if it were there. */
    suspend fun readMedia(localId: String, item: QueuedMedia): ByteArray?

    /** Delete photo files whose message is no longer queued. */
    suspend fun pruneMedia()

    /**
     * #330 — everything, and the photos with it, when the session ends.
     *
     * The queue holds what somebody was in the middle of saying to a customer, and
     * the photos they attached. On a phone the company does not own, that has to go
     * when the session does: a tech leaves, the owner signs their phone out from
     * Devices, and an unsent message to a homeowner must not be sitting there
     * afterwards — nor flush to the customer under a session that no longer exists.
     */
    suspend fun clear()

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
        withContext(Dispatchers.IO) { runCatching { dirFor(localId).deleteRecursively() } }
    }

    /**
     * filesDir, not cacheDir: the system may evict a cache under storage
     * pressure, and a photo that disappears because the phone was full is the
     * silent drop this whole file exists to prevent.
     */
    private fun mediaRoot() = java.io.File(context.filesDir, "outbox-media")

    private fun dirFor(localId: String) = java.io.File(mediaRoot(), localId)

    override suspend fun saveMedia(
        localId: String,
        items: List<OutboxMediaBytes>,
    ): List<QueuedMedia> = withContext(Dispatchers.IO) {
        val dir = dirFor(localId)
        dir.mkdirs()
        items.mapIndexedNotNull { index, item ->
            // Index, not the original filename: the picker's name is attacker-
            // adjacent (it can contain separators) and we never show it here.
            val name = "$index.bin"
            runCatching { java.io.File(dir, name).writeBytes(item.bytes) }
                .map { QueuedMedia(fileName = name, contentType = item.contentType) }
                .getOrNull()
        }
    }

    override suspend fun readMedia(localId: String, item: QueuedMedia): ByteArray? =
        withContext(Dispatchers.IO) {
            val file = java.io.File(dirFor(localId), item.fileName)
            runCatching { if (file.isFile) file.readBytes() else null }.getOrNull()
        }

    override suspend fun clear() {
        context.outboxStore.edit { it.clear() }
        // The whole directory rather than a walk over the rows: a row that failed to
        // decode is a row `all()` cannot see, and its photos would survive a per-row
        // sweep. What must not remain is the bytes.
        withContext(Dispatchers.IO) { runCatching { mediaRoot().deleteRecursively() } }
    }

    override suspend fun pruneMedia() {
        val live = all().map { it.localId }.toSet()
        withContext(Dispatchers.IO) {
            runCatching {
                mediaRoot().listFiles()?.forEach { dir ->
                    if (dir.name !in live) dir.deleteRecursively()
                }
            }
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
    /** Injected so the age-out is assertable without waiting a day. */
    private val now: () -> Instant = { Instant.now() },
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
            // Old enough that sending it is a decision rather than a delivery.
            if (!item.staleAcknowledged && agedOut(item, now())) {
                outbox.put(item.copy(blocked = true, lastError = OUTBOX_STALE_MESSAGE))
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

/**
 * True once a row has waited longer than [OUTBOX_AGE_OUT_HOURS].
 *
 * A createdAt we cannot parse is NEVER stale. Guessing "old" from an
 * unreadable timestamp would stop a message the person is still waiting on,
 * and of the two ways to be wrong that is the one that loses a delivery.
 */
private fun agedOut(item: QueuedSend, now: Instant): Boolean {
    val created = runCatching { Instant.parse(item.createdAt) }.getOrNull() ?: return false
    return created.plus(OUTBOX_AGE_OUT_HOURS, ChronoUnit.HOURS).isBefore(now)
}

/** The three answers a flush can get, which is the distinction #234 turns on. */
sealed interface SendOutcome {
    data object Sent : SendOutcome

    /** The server answered no. Not retried automatically. */
    data class Refused(val message: String) : SendOutcome

    /** We never got an answer. Stays queued. */
    data class Unreachable(val message: String) : SendOutcome
}
