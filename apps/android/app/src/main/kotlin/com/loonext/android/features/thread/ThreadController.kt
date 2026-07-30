package com.loonext.android.features.thread

import android.content.Context
import android.util.Base64
import androidx.compose.runtime.Stable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import com.loonext.android.core.data.CacheKeys
import com.loonext.android.core.data.MeRepository
import com.loonext.android.core.data.StoreCache
import com.loonext.android.core.model.Attachment
import com.loonext.android.core.model.CompanyView
import com.loonext.android.core.model.Contact
import com.loonext.android.core.model.ConversationDetail
import com.loonext.android.core.model.ConversationEvent
import com.loonext.android.core.model.ConversationListItem
import com.loonext.android.core.model.Member
import com.loonext.android.core.model.Message
import com.loonext.android.core.model.MessageDirection
import com.loonext.android.core.model.MessageTaskLink
import com.loonext.android.core.model.OutboundMedia
import com.loonext.android.core.model.Tag
import com.loonext.android.core.model.Task
import com.loonext.android.core.model.Usage
import com.loonext.android.core.net.ApiErrorCode
import com.loonext.android.core.net.ApiDecodeException
import com.loonext.android.core.net.ApiException
import com.loonext.android.core.realtime.RealtimeEvent
import com.loonext.android.features.compose.NoteFileUploader
import com.loonext.android.features.compose.StagedFile
import com.loonext.android.features.compose.StagedPhoto
import com.loonext.android.features.compose.readStagedFile
import com.loonext.android.ui.common.LoadState
import com.loonext.android.ui.common.userMessage
import java.time.Instant
import java.util.UUID
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonPrimitive

/** One-shot snackbar payload (id makes repeats re-fire the effect). */
data class ThreadNotice(
    val id: Long,
    val text: String,
    val actionLabel: String? = null,
    val action: (() -> Unit)? = null,
)

/** A failed send-intent: the SAME Idempotency-Key rides the user's retry. */
private data class FailedSendIntent(
    val body: String,
    val photoIds: List<String>,
    val key: String,
)

/**
 * The reopen-instantly snapshot (#176): everything the header + timeline need
 * to paint in the first frame, cached under [CacheKeys.thread]. Session-local
 * state (pending sends, drafts, contact-panel lists, per-note files) stays out
 * on purpose — pending sends resolve against the live process, and the panel
 * refreshes on every open by design.
 */
private data class ThreadSnapshot(
    val conversation: ConversationDetail,
    val messages: List<Message>,
    val messagesCursor: String?,
    val allMessagesLoaded: Boolean,
    val events: List<ConversationEvent>,
    val eventsCursor: String?,
    val eventsExhausted: Boolean,
    val pinnedMessages: List<Message>,
    val members: List<Member>,
    val contact: Contact?,
    val company: CompanyView?,
    val usage: Usage?,
)

/**
 * State + mutations for one conversation thread. Realtime payloads are treated
 * as ID-only routing hints — every update refetches through the authed API.
 */
@Stable
class ThreadController(
    private val repo: MessagingRepository,
    private val meRepo: MeRepository,
    private val uploader: NoteFileUploader,
    private val appContext: Context,
    private val cache: StoreCache,
    private val companyId: String,
    val conversationId: String,
    private val meUserId: String,
    private val scope: CoroutineScope,
) {
    var load by mutableStateOf<LoadState<Unit>>(LoadState.Loading)
        private set
    var conversation by mutableStateOf<ConversationDetail?>(null)
        private set
    var messages by mutableStateOf<List<Message>>(emptyList())
        private set
    var messagesCursor by mutableStateOf<String?>(null)
        private set
    var allMessagesLoaded by mutableStateOf(false)
        private set
    var loadingOlder by mutableStateOf(false)
        private set
    var events by mutableStateOf<List<ConversationEvent>>(emptyList())
        private set
    var pinnedMessages by mutableStateOf<List<Message>>(emptyList())
        private set
    var pendingSends by mutableStateOf<List<PendingSend>>(emptyList())
        private set

    /**
     * #234: the durable queue behind `pendingSends`.
     *
     * Lazy off the context the controller already holds rather than a new
     * constructor parameter — every caller would otherwise have to thread it
     * through, and the logic worth testing lives in OutboxFlusher, which is
     * driven directly on the JVM by OutboxTest.
     */
    private val outbox: Outbox by lazy { Outbox(appContext) }
    var members by mutableStateOf<List<Member>>(emptyList())
        private set
    var contact by mutableStateOf<Contact?>(null)
        private set
    var company by mutableStateOf<CompanyView?>(null)
        private set
    var usage by mutableStateOf<Usage?>(null)
        private set
    var filter by mutableStateOf(ThreadFilter())
    var notice by mutableStateOf<ThreadNotice?>(null)
        private set

    /** Bumps when an inbound message lands while this thread is open. */
    var newInboundTick by mutableStateOf(0)
        private set

    /** Per-note generic file attachments, fetched lazily per bubble. */
    var noteFiles by mutableStateOf<Map<String, LoadState<List<Attachment>>>>(emptyMap())
        private set

    // --- Contact panel state (#165) — loaded lazily when the sheet opens. ---

    /** Prior conversations with this contact (current thread excluded). */
    var otherConversations by mutableStateOf<LoadState<List<ConversationListItem>>?>(null)
        private set

    /** The conversation's task checklist (T5.2). */
    var conversationTasks by mutableStateOf<LoadState<List<Task>>?>(null)
        private set

    private var eventsCursor: String? = null
    private var eventsExhausted = false
    private var started = false
    private var noticeSeq = 0L
    private var convRefreshJob: Job? = null
    private var lastFailedIntent: FailedSendIntent? = null

    // #176 cache-first: reopening a conversation this process has already
    // loaded paints the timeline in the first frame — [start]'s initialLoad
    // then runs as a silent revalidation instead of a Loading gate. (This init
    // block must stay below every field it writes.)
    init {
        cache.flowOf<ThreadSnapshot>(CacheKeys.thread(companyId, conversationId)).value
            ?.let { restoreFromSnapshot(it) }
    }

    val newestMessageId: String?
        get() = messages.firstOrNull()?.id

    private fun notify(
        text: String,
        actionLabel: String? = null,
        action: (() -> Unit)? = null,
    ) {
        notice = ThreadNotice(++noticeSeq, text, actionLabel, action)
    }

    // --- Loading -------------------------------------------------------------

    fun start() {
        if (started) return
        started = true
        scope.launch { initialLoad() }
    }

    fun retryInitialLoad() {
        scope.launch { initialLoad() }
    }

    private suspend fun initialLoad() {
        // Seeded from a cached snapshot: keep painting it while this runs as a
        // silent revalidation — a miss must never cover data with an error.
        val seeded = load is LoadState.Ready
        if (!seeded) load = LoadState.Loading
        val detail = try {
            repo.detail(companyId, conversationId)
        } catch (cause: Exception) {
            if (!seeded) {
                load = LoadState.Failed(
                    cause.userMessage(),
                    (cause as? ApiException)?.code,
                )
            }
            return
        }
        conversation = detail
        if (seeded) {
            // Merge page 1 instead of trimming — the snapshot may hold pages
            // the user had already scrolled back through.
            messages = mergeMessagesFirstPage(messages, detail.messages.data)
            val cursor = detail.messages.next_cursor
            if (messagesCursor == null && cursor != null && !allMessagesLoaded) {
                messagesCursor = cursor
            }
        } else {
            messages = detail.messages.data
            messagesCursor = detail.messages.next_cursor
            allMessagesLoaded = detail.messages.next_cursor == null
            load = LoadState.Ready(Unit)
        }
        persistSnapshot()

        // #234: whatever was queued before this process existed comes back
        // into the thread, then we try to drain it. Restoring BEFORE flushing
        // is deliberate — if there is still no signal, the person opening the
        // thread sees their message sitting there rather than an empty
        // conversation that quietly ate it.
        scope.launch { restoreQueued(); flushOutbox() }

        // Secondary loads — quiet failures; they gate niceties, not the thread.
        scope.launch { runCatching { refreshEvents() } }
        scope.launch { runCatching { refreshPinned() } }
        scope.launch {
            runCatching { members = repo.members(companyId).data }
            persistSnapshot()
        }
        scope.launch { runCatching { refreshContact() } }
        scope.launch {
            runCatching { company = meRepo.me(companyId).company }
            persistSnapshot()
        }
        scope.launch {
            runCatching { usage = repo.usage(companyId) }
            persistSnapshot()
        }
    }

    private fun restoreFromSnapshot(snapshot: ThreadSnapshot) {
        conversation = snapshot.conversation
        messages = snapshot.messages
        messagesCursor = snapshot.messagesCursor
        allMessagesLoaded = snapshot.allMessagesLoaded
        events = snapshot.events
        eventsCursor = snapshot.eventsCursor
        eventsExhausted = snapshot.eventsExhausted
        pinnedMessages = snapshot.pinnedMessages
        members = snapshot.members
        contact = snapshot.contact
        company = snapshot.company
        usage = snapshot.usage
        load = LoadState.Ready(Unit)
    }

    /** Write-back after any state change worth surviving a reopen (#176). */
    private fun persistSnapshot() {
        val detail = conversation ?: return
        cache.put(
            CacheKeys.thread(companyId, conversationId),
            ThreadSnapshot(
                conversation = detail,
                messages = messages,
                messagesCursor = messagesCursor,
                allMessagesLoaded = allMessagesLoaded,
                events = events,
                eventsCursor = eventsCursor,
                eventsExhausted = eventsExhausted,
                pinnedMessages = pinnedMessages,
                members = members,
                contact = contact,
                company = company,
                usage = usage,
            ),
        )
    }

    fun loadOlderMessages() {
        val cursor = messagesCursor ?: return
        if (loadingOlder) return
        loadingOlder = true
        scope.launch {
            try {
                val page = repo.messages(companyId, conversationId, cursor)
                messages = appendPage(messages, page.data) { it.id }
                messagesCursor = page.next_cursor
                if (page.next_cursor == null) allMessagesLoaded = true
                ensureEventsCoverMessages()
                persistSnapshot()
            } catch (cause: Exception) {
                notify(cause.userMessage())
            } finally {
                loadingOlder = false
            }
        }
    }

    private suspend fun refreshMessagesFirstPage() {
        val page = repo.messages(companyId, conversationId)
        messages = mergeMessagesFirstPage(messages, page.data)
        if (messagesCursor == null && page.next_cursor != null && !allMessagesLoaded) {
            messagesCursor = page.next_cursor
        }
        persistSnapshot()
    }

    /**
     * Re-walk the pages the user already loaded (bounded) so a done/pin toggle
     * on a deep-history message lands without trusting the broadcast payload.
     */
    private suspend fun refetchLoadedWindow() {
        val target = messages.size
        var acc = emptyList<Message>()
        var cursor: String? = null
        var pages = 0
        do {
            val page = repo.messages(companyId, conversationId, cursor)
            acc = appendPage(acc, page.data) { it.id }
            cursor = page.next_cursor
            pages++
        } while (cursor != null && acc.size < target && pages < 12)
        messages = acc
        messagesCursor = cursor
        allMessagesLoaded = cursor == null
        persistSnapshot()
    }

    private suspend fun refreshEvents() {
        val page = repo.events(companyId, conversationId)
        events = mergeFirstPage(events, page.data, { it.id }, { it.created_at })
        if (eventsCursor == null && !eventsExhausted) {
            eventsCursor = page.next_cursor
            eventsExhausted = page.next_cursor == null
        }
        ensureEventsCoverMessages()
        persistSnapshot()
    }

    /**
     * Events interleave only once message history is at least as deep, so keep
     * paging the audit trail until it covers the oldest loaded message.
     */
    private suspend fun ensureEventsCoverMessages() {
        val oldestMessageAt = messages.lastOrNull()?.created_at ?: return
        var guard = 0
        while (!eventsExhausted && guard < 6) {
            val oldestEventAt = events.lastOrNull()?.created_at
            if (oldestEventAt != null && oldestEventAt <= oldestMessageAt) return
            val cursor = eventsCursor
            val page = repo.events(companyId, conversationId, cursor)
            events = appendPage(events, page.data) { it.id }
            eventsCursor = page.next_cursor
            if (page.next_cursor == null) {
                eventsExhausted = true
                return
            }
            guard++
        }
    }

    private suspend fun refreshPinned() {
        pinnedMessages = repo.pinnedMessages(companyId, conversationId).data
        persistSnapshot()
    }

    private suspend fun refreshConversationDetail() {
        val detail = repo.detail(companyId, conversationId)
        conversation = detail
        messages = mergeMessagesFirstPage(messages, detail.messages.data)
        persistSnapshot()
    }

    private suspend fun refreshContact() {
        val contactId = conversation?.contact_id ?: return
        contact = repo.contact(companyId, contactId)
        persistSnapshot()
    }

    private fun refreshGates() {
        scope.launch { runCatching { refreshContact() } }
        scope.launch {
            runCatching { company = meRepo.me(companyId).company }
            persistSnapshot()
        }
        scope.launch {
            runCatching { usage = repo.usage(companyId) }
            persistSnapshot()
        }
    }

    /**
     * Reconnect / foreground resync: refetch everything active (SPEC §8) and
     * MERGE page 1 into the timeline. This is the ON_RESUME target (#215) and
     * foregrounding is frequent, so it must NOT replace — a user who scrolled
     * back would lose every loaded page on each pause/resume (and on each socket
     * re-JOIN). Merging keeps the loaded scrollback while still healing a
     * page-1 message that a dropped/late frame missed.
     */
    fun refreshAfterReconnect() {
        scope.launch {
            runCatching {
                val detail = repo.detail(companyId, conversationId)
                conversation = detail
                messages = mergeMessagesFirstPage(messages, detail.messages.data)
                // Only adopt the fresh cursor from a blank slate; when the user
                // has already paged deeper, the existing cursor still points to
                // the oldest UNloaded message and the merge kept the rest.
                if (messagesCursor == null && detail.messages.next_cursor != null &&
                    !allMessagesLoaded
                ) {
                    messagesCursor = detail.messages.next_cursor
                }
            }
            // MERGE page 1, don't REPLACE with it. Assigning `events = page.data`
            // discarded every audit line the user had already paged back to — a
            // reconnect while scrolled into history silently erased the system
            // events from the visible thread (and reset the cursor, so paging
            // back re-fetched from the top). refreshEvents() is the same call
            // with the merge + cursor guard + ensureEventsCoverMessages that the
            // messages arm above already uses.
            runCatching { refreshEvents() }
            runCatching { refreshPinned() }
            runCatching { refreshContact() }
            persistSnapshot()
        }
    }

    // --- Realtime ----------------------------------------------------------------

    private fun payloadString(event: RealtimeEvent, key: String): String? =
        (event.payload[key] as? JsonPrimitive)?.content

    fun onRealtime(event: RealtimeEvent) {
        when (event.event) {
            "message.created" -> {
                if (payloadString(event, "conversation_id") != conversationId) return
                val direction = payloadString(event, "direction")
                scope.launch {
                    runCatching { refreshMessagesFirstPage() }
                    if (direction == MessageDirection.INBOUND) newInboundTick++
                    markRead()
                }
            }

            "message.status" -> {
                val id = payloadString(event, "message_id") ?: return
                val index = messages.indexOfFirst { it.id == id }
                val inPinned = pinnedMessages.any { it.id == id }
                if (index < 0 && !inPinned) return
                val deep = index >= 50 || (index < 0 && inPinned)
                scope.launch {
                    runCatching {
                        if (deep) refetchLoadedWindow() else refreshMessagesFirstPage()
                        // Key PRESENCE routes the extra refetches; values are
                        // never trusted — the API rows are.
                        if (event.payload.containsKey("pinned_at")) refreshPinned()
                        if (event.payload.containsKey("done_at")) refreshEvents()
                    }
                }
            }

            "conversation.updated" -> {
                if (payloadString(event, "conversation_id") != conversationId) return
                // 250ms debounce per SPEC §8 — status/assign/spam/tag/pin bursts
                // collapse into one detail refetch.
                convRefreshJob?.cancel()
                convRefreshJob = scope.launch {
                    delay(250)
                    runCatching {
                        refreshConversationDetail()
                        refreshEvents()
                        refreshPinned()
                        refreshContact()
                    }
                }
            }

            "task.changed" -> {
                if (payloadString(event, "conversation_id") != conversationId) return
                scope.launch {
                    runCatching {
                        refreshMessagesFirstPage()
                        refreshEvents()
                    }
                }
            }
        }
    }

    // --- Read receipts -----------------------------------------------------------

    fun markRead() {
        scope.launch { runCatching { repo.markRead(companyId, conversationId) } }
    }

    // --- Sending ------------------------------------------------------------------

    /**
     * Optimistic send: a local queued row appears immediately; the server's
     * queued insert replaces it. A failed attempt restores the draft and holds
     * onto its Idempotency-Key — retrying the SAME body+photos reuses the key,
     * so an airplane-mode double-send lands exactly one message.
     */
    fun sendText(body: String, photos: List<StagedPhoto>, onRestore: () -> Unit) {
        val photoIds = photos.map { it.id }
        val failed = lastFailedIntent
        val key = if (failed != null && failed.body == body && failed.photoIds == photoIds) {
            failed.key
        } else {
            UUID.randomUUID().toString()
        }
        val pendingRow = PendingSend(
            localId = key,
            body = body,
            mediaCount = photos.size,
            createdAt = Instant.now().toString(),
            idempotencyKey = key,
        )
        pendingSends = pendingSends + pendingRow
        scope.launch {
            try {
                val message = repo.send(
                    companyId = companyId,
                    conversationId = conversationId,
                    body = body,
                    media = photos.takeIf { it.isNotEmpty() }?.map { it.toOutboundMedia() },
                    idempotencyKey = key,
                )
                lastFailedIntent = null
                pendingSends = pendingSends - pendingRow
                messages = mergeMessagesFirstPage(messages, listOf(message))
                persistSnapshot()
                markRead()
            } catch (cause: Exception) {
                val code = (cause as? ApiException)?.code
                // #234: did we REACH the server? That is the whole decision.
                //
                // NETWORK means we never got an answer, so the message waits
                // for one — it stays in the thread as "Queued" and is written
                // to the durable outbox, which is what makes it survive the
                // app being killed on the walk back to the truck.
                //
                // Photos ride along, as OUR files. The picker's content URI
                // would be a dead handle after the process restarts, so the
                // bytes the composer already read are copied into app storage
                // first and the row is written only if that copy succeeded —
                // a row promising a photo we cannot produce is worse than an
                // honest failure here.
                if (code == ApiErrorCode.NETWORK) {
                    val queuedMedia = runCatching {
                        outbox.saveMedia(
                            key,
                            photos.map { OutboxMediaBytes(it.contentType, it.bytes) },
                        )
                    }.getOrNull()
                    val storedAll = queuedMedia != null && queuedMedia.size == photos.size
                    if (storedAll) {
                        val wrote = runCatching {
                            outbox.put(
                                QueuedSend(
                                    localId = key,
                                    companyId = companyId,
                                    conversationId = conversationId,
                                    body = body,
                                    createdAt = pendingRow.createdAt,
                                    media = queuedMedia,
                                ),
                            )
                        }.isSuccess
                        if (wrote) {
                            pendingSends = pendingSends.map {
                                if (it.localId == key) it.copy(queued = true) else it
                            }
                            lastFailedIntent = null
                            return@launch
                        }
                    }
                    // Storage refused us. Fall through to the honest failure
                    // below rather than showing "Queued" over nothing.
                    runCatching { outbox.remove(key) }
                }
                pendingSends = pendingSends - pendingRow
                lastFailedIntent = FailedSendIntent(body, photoIds, key)
                onRestore()
                notify(cause.userMessage())
                if (code == ApiErrorCode.RECIPIENT_OPTED_OUT ||
                    code == ApiErrorCode.SUBSCRIPTION_INACTIVE ||
                    code == ApiErrorCode.REGISTRATION_PENDING ||
                    code == ApiErrorCode.USAGE_CAP_REACHED
                ) {
                    refreshGates()
                }
            }
        }
    }

    // --- #234 outbox ---------------------------------------------------------

    /** Paint the durable queue for this thread back into the timeline. */
    private suspend fun restoreQueued() {
        val rows = runCatching { outbox.forConversation(conversationId) }.getOrNull() ?: return
        val restored = rows.map { row ->
            PendingSend(
                localId = row.localId,
                body = row.body,
                mediaCount = row.media.size,
                createdAt = row.createdAt,
                idempotencyKey = row.localId,
                queued = row.blocked.not(),
                blockedReason = if (row.blocked) row.lastError else null,
            )
        }
        val known = restored.map { it.localId }.toSet()
        pendingSends = pendingSends.filterNot { it.localId in known } + restored
    }

    /**
     * Drain the queue. Safe to call from anywhere and as often as you like —
     * OutboxFlusher holds the mutex that makes an LTE/Wi-Fi handoff firing two
     * callbacks land one message rather than two.
     */
    fun flushOutbox() {
        scope.launch {
            val flusher = OutboxFlusher(outbox) { item ->
                // The photos, read back from our own storage. A file that is
                // gone must NOT become a quiet text-only send: the person
                // attached it for a reason, so the row stops and says so, and
                // "Send now" then sends the words on their own.
                val media = item.media.mapNotNull { queued ->
                    outbox.readMedia(item.localId, queued)?.let { bytes ->
                        OutboundMedia(
                            content_type = queued.contentType,
                            base64 = Base64.encodeToString(bytes, Base64.NO_WRAP),
                        )
                    }
                }
                if (media.size != item.media.size) {
                    return@OutboxFlusher SendOutcome.Refused(OUTBOX_MEDIA_LOST_MESSAGE)
                }
                try {
                    val message = repo.send(
                        companyId = item.companyId,
                        conversationId = item.conversationId,
                        body = item.body,
                        media = media.takeIf { it.isNotEmpty() },
                        // The key minted when the person pressed send, reused
                        // on every attempt — this is what makes the flush
                        // idempotent rather than merely retried.
                        idempotencyKey = item.localId,
                    )
                    if (item.conversationId == conversationId) {
                        pendingSends = pendingSends.filterNot { it.localId == item.localId }
                        messages = mergeMessagesFirstPage(messages, listOf(message))
                    }
                    SendOutcome.Sent
                } catch (cause: Exception) {
                    val code = (cause as? ApiException)?.code
                    if (code == ApiErrorCode.NETWORK) {
                        SendOutcome.Unreachable(cause.userMessage())
                    } else {
                        SendOutcome.Refused(cause.userMessage())
                    }
                }
            }
            val result = runCatching { flusher.flush() }.getOrNull() ?: return@launch
            if (result.sent.isNotEmpty()) {
                persistSnapshot()
                markRead()
            }
            // Sweep photos left behind by a crash between writing files and
            // writing the row. Cheap, and the alternative is a folder that
            // only ever grows on a phone that is usually short of space.
            runCatching { outbox.pruneMedia() }
            // A refusal changes what the row says, so repaint from the store
            // rather than guessing which one was blocked.
            if (result.blocked.isNotEmpty()) {
                restoreQueued()
                refreshGates()
            }
        }
    }

    /** Drop a queued message the person has decided against (#234). */
    fun discardQueued(localId: String) {
        scope.launch {
            runCatching { outbox.remove(localId) }
            pendingSends = pendingSends.filterNot { it.localId == localId }
        }
    }

    /**
     * Try a blocked row again, because the person believes the reason is gone
     * — the cap reset, the registration came back, or the message is old and
     * they still want it sent. Clears the block so the next flush actually
     * asks, rather than reporting the old answer.
     */
    fun retryQueued(localId: String) {
        scope.launch {
            val row = runCatching { outbox.all() }.getOrNull()
                ?.firstOrNull { it.localId == localId } ?: return@launch
            // Photos whose files are gone are dropped HERE rather than at
            // flush, because the row said "send the text on its own" and this
            // is the person taking it up. Leaving them on would make the next
            // flush refuse for the same reason and the button do nothing.
            val surviving = row.media.filter { outbox.readMedia(localId, it) != null }
            runCatching {
                outbox.put(
                    row.copy(
                        blocked = false,
                        lastError = null,
                        media = surviving,
                        // They have been told it is old and chose to send it,
                        // so the age-out must not stop it again.
                        staleAcknowledged = true,
                    ),
                )
            }
            restoreQueued()
            flushOutbox()
        }
    }

    /** Retry a failed row (server-side rules; retryable gate is in the UI). */
    fun retrySend(messageId: String) {
        scope.launch {
            try {
                val updated = repo.retry(companyId, messageId)
                replaceMessage(updated)
            } catch (cause: Exception) {
                if ((cause as? ApiException)?.code == ApiErrorCode.CONFLICT) {
                    // #263: SHOW THE SERVER'S SENTENCE, don't replace it. A 409
                    // used to mean one thing — a carrier-finalized row that is
                    // simply not retryable — and a fixed string was fine for it.
                    // It now also means "only 1 of your 3 photos was saved, write
                    // it again and re-attach them", which is actionable and which
                    // a hardcoded line silently threw away. Web has always shown
                    // the server message here; this is the parity fix. The
                    // refresh stays: both cases mean our copy of the row is
                    // behind.
                    notify(cause.userMessage())
                    runCatching { refreshMessagesFirstPage() }
                } else {
                    notify(cause.userMessage())
                }
            }
        }
    }

    /** Who this member may name on a note here; the server owns the answer. */
    suspend fun mentionableMembers(): List<MentionableMember> =
        runCatching { repo.mentionableMembers(companyId, conversationId) }.getOrDefault(emptyList())

    /** D28 chain: the note row first, then each staged file against its id. */
    fun saveNote(
        body: String,
        files: List<StagedFile>,
        mentionUserIds: List<String> = emptyList(),
        onRestore: () -> Unit,
    ) {
        scope.launch {
            val note = try {
                repo.createNote(companyId, conversationId, body, mentionUserIds = mentionUserIds)
            } catch (cause: Exception) {
                onRestore()
                notify(cause.userMessage())
                return@launch
            }
            messages = mergeMessagesFirstPage(messages, listOf(note))
            persistSnapshot()
            if (files.isEmpty()) return@launch
            var failedCount = 0
            for (file in files) {
                val bytes = readStagedFile(appContext, file)
                if (bytes == null) {
                    failedCount++
                    continue
                }
                try {
                    uploader.upload(companyId, note.id, file.name, file.contentType, bytes)
                } catch (_: Exception) {
                    failedCount++
                }
            }
            // Show the note's Files section with whatever landed.
            val landed = runCatching { repo.noteAttachments(companyId, note.id).data }
            noteFiles = noteFiles + (note.id to landed.fold(
                { LoadState.Ready(it) },
                { LoadState.Failed(it.userMessage()) },
            ))
            if (failedCount > 0) {
                notify(
                    if (failedCount == files.size) {
                        "The note saved, but its files didn't upload."
                    } else {
                        "The note saved, but $failedCount of ${files.size} files didn't upload."
                    },
                )
            }
        }
    }

    // --- Per-message facets ----------------------------------------------------------

    private fun replaceMessage(updated: Message) {
        messages = messages.map { if (it.id == updated.id) updated else it }
        pinnedMessages = pinnedMessages.map { if (it.id == updated.id) updated else it }
        persistSnapshot()
    }

    /** Optimistic done toggle with rollback. */
    fun toggleDone(message: Message) {
        val turningOn = message.done_at == null
        val optimistic = message.copy(
            done_at = if (turningOn) Instant.now().toString() else null,
            done_by_user_id = if (turningOn) meUserId else null,
        )
        replaceMessage(optimistic)
        scope.launch {
            try {
                replaceMessage(repo.setDone(companyId, message.id, turningOn))
                runCatching { refreshEvents() }
            } catch (cause: Exception) {
                replaceMessage(message)
                notify(cause.userMessage())
            }
        }
    }

    fun togglePin(message: Message) {
        val pinning = message.pinned_at == null
        scope.launch {
            try {
                replaceMessage(repo.setMessagePinned(companyId, message.id, pinning))
                refreshPinned()
            } catch (cause: Exception) {
                notify(cause.userMessage())
            }
        }
    }

    fun makeTask(
        message: Message,
        title: String,
        assignedUserId: String? = null,
        dueAtIso: String? = null,
        address: com.loonext.android.core.model.TaskAddressInput? = null,
    ) {
        scope.launch {
            try {
                val task =
                    repo.createTask(companyId, message.id, title, assignedUserId, dueAtIso, address)
                replaceMessage(
                    message.copy(
                        has_task = true,
                        promoted_task = MessageTaskLink(task.id, task.title),
                    ),
                )
                notify("Task created.")
            } catch (cause: ApiDecodeException) {
                // The task WAS created (2xx) — only the response decode failed.
                // Success, honestly reported; the refresh fetches truth.
                notify("Task created.")
                runCatching { refreshMessagesFirstPage() }
            } catch (cause: Exception) {
                if ((cause as? ApiException)?.code == ApiErrorCode.CONFLICT) {
                    notify("This message already has a task.")
                    runCatching { refreshMessagesFirstPage() }
                } else {
                    notify(cause.userMessage())
                }
            }
        }
    }

    // --- Conversation controls --------------------------------------------------------

    private fun applyConversationRow(row: com.loonext.android.core.model.Conversation) {
        conversation = conversation?.copy(
            status = row.status,
            is_spam = row.is_spam,
            assigned_user_id = row.assigned_user_id,
            pinned_at = row.pinned_at,
            pinned_by_user_id = row.pinned_by_user_id,
            closed_at = row.closed_at,
            updated_at = row.updated_at,
        )
        persistSnapshot()
    }

    fun setStatus(status: String) {
        scope.launch {
            try {
                applyConversationRow(repo.setStatus(companyId, conversationId, status))
                runCatching { refreshEvents() }
            } catch (cause: Exception) {
                notify(cause.userMessage())
            }
        }
    }

    fun setAssignee(userId: String?) {
        scope.launch {
            try {
                applyConversationRow(repo.setAssignee(companyId, conversationId, userId))
                runCatching { refreshEvents() }
            } catch (cause: Exception) {
                notify(cause.userMessage())
            }
        }
    }

    fun setSpam(spam: Boolean) {
        scope.launch {
            try {
                applyConversationRow(repo.setSpam(companyId, conversationId, spam))
                runCatching { refreshEvents() }
                if (spam) {
                    notify("Marked as spam.", actionLabel = "Undo") { setSpam(false) }
                } else {
                    notify("Marked as not spam. It stays closed.")
                }
            } catch (cause: Exception) {
                notify(cause.userMessage())
            }
        }
    }

    fun toggleConversationPin() {
        val pinning = conversation?.pinned_at == null
        scope.launch {
            try {
                applyConversationRow(
                    repo.setConversationPinned(companyId, conversationId, pinning),
                )
            } catch (cause: Exception) {
                notify(cause.userMessage())
            }
        }
    }

    fun optOutContact() {
        val contactId = conversation?.contact_id ?: return
        scope.launch {
            try {
                repo.optOut(companyId, contactId)
                runCatching { refreshContact() }
                runCatching { refreshEvents() }
            } catch (cause: Exception) {
                notify(cause.userMessage())
            }
        }
    }

    fun revokeOptOut() {
        val contactId = conversation?.contact_id ?: return
        scope.launch {
            try {
                repo.revokeOptOut(companyId, contactId)
                runCatching { refreshContact() }
                runCatching { refreshEvents() }
            } catch (cause: Exception) {
                notify(cause.userMessage())
            }
        }
    }

    // --- Tags (#165) --------------------------------------------------------

    /**
     * Attach by plan (an existing tag or create-on-attach by name), then
     * refetch the detail — the tags row renders from server rows, never from
     * an optimistic guess (the server may have matched an existing tag
     * case-insensitively).
     */
    fun attachTag(plan: TagAttachPlan) {
        scope.launch {
            try {
                when (plan) {
                    is TagAttachPlan.Existing ->
                        repo.attachTag(companyId, conversationId, plan.tag.id)

                    is TagAttachPlan.CreateNew ->
                        repo.attachTagByName(companyId, conversationId, plan.name)
                }
                runCatching { refreshConversationDetail() }
                runCatching { refreshEvents() }
            } catch (cause: Exception) {
                notify(cause.userMessage())
            }
        }
    }

    fun detachTag(tag: Tag) {
        // Optimistic remove — a chip that lingers after the tap feels broken.
        val before = conversation
        conversation = before?.copy(tags = before.tags.filterNot { it.id == tag.id })
        persistSnapshot()
        scope.launch {
            try {
                repo.detachTag(companyId, conversationId, tag.id)
                runCatching { refreshEvents() }
            } catch (cause: Exception) {
                if ((cause as? ApiException)?.code == ApiErrorCode.NOT_FOUND) {
                    // Already detached elsewhere — the optimistic state is right.
                    runCatching { refreshConversationDetail() }
                } else {
                    conversation = before
                    persistSnapshot()
                    notify(cause.userMessage())
                }
            }
        }
    }

    // --- Contact panel (#165) ----------------------------------------------

    /** Load the sheet's secondary lists; refreshes on every open. */
    fun loadContactPanel() {
        val phone = conversation?.contact?.phone_e164
        if (phone != null) {
            otherConversations = LoadState.Loading
            scope.launch {
                otherConversations = try {
                    val rows = repo.conversationsForPhone(companyId, phone)
                        .data
                        .filter { it.id != conversationId }
                    LoadState.Ready(rows)
                } catch (cause: Exception) {
                    LoadState.Failed(cause.userMessage())
                }
            }
        }
        conversationTasks = LoadState.Loading
        scope.launch {
            conversationTasks = try {
                LoadState.Ready(repo.conversationTasks(companyId, conversationId).data)
            } catch (cause: Exception) {
                LoadState.Failed(cause.userMessage())
            }
        }
    }

    /**
     * One contact field write for the sheet's auto-save (the G6 800ms clock
     * lives in the field composable). Refreshes the header/consent line on
     * success; throws so the field shows its calm failure sentence.
     */
    suspend fun saveContactField(field: String, value: String?) {
        val contactId = conversation?.contact_id ?: return
        contact = repo.updateContactField(companyId, contactId, field, value)
        runCatching { refreshConversationDetail() }
    }

    /**
     * Checklist toggle — completion is ALWAYS the source message's done bit
     * (PATCH /v1/messages/:id), never a task route. Optimistic with rollback.
     */
    fun toggleTaskDone(task: Task) {
        val ready = conversationTasks as? LoadState.Ready ?: return
        val turningOn = !task.done
        fun swap(rows: List<Task>, value: Boolean) = rows.map {
            if (it.id == task.id) it.copy(done = value, status = if (value) "done" else "open")
            else it
        }
        conversationTasks = LoadState.Ready(swap(ready.value, turningOn))
        scope.launch {
            try {
                repo.setDone(companyId, task.message_id, turningOn)
                runCatching { refreshMessagesFirstPage() }
                runCatching { refreshEvents() }
            } catch (cause: Exception) {
                val current = conversationTasks as? LoadState.Ready
                if (current != null) {
                    conversationTasks = LoadState.Ready(swap(current.value, task.done))
                }
                notify(cause.userMessage())
            }
        }
    }

    // --- Note files + pinned jump --------------------------------------------------------

    fun loadNoteFiles(noteId: String) {
        if (noteFiles.containsKey(noteId)) return
        noteFiles = noteFiles + (noteId to LoadState.Loading)
        scope.launch {
            val result = runCatching { repo.noteAttachments(companyId, noteId).data }
            noteFiles = noteFiles + (noteId to result.fold(
                { LoadState.Ready(it) },
                { LoadState.Failed(it.userMessage()) },
            ))
        }
    }

    /** Page back (bounded) until [messageId] is loaded; true when found. */
    suspend fun ensureMessageLoaded(messageId: String): Boolean {
        var guard = 0
        while (messages.none { it.id == messageId } && messagesCursor != null && guard < 20) {
            val cursor = messagesCursor ?: break
            try {
                val page = repo.messages(companyId, conversationId, cursor)
                messages = appendPage(messages, page.data) { it.id }
                messagesCursor = page.next_cursor
                if (page.next_cursor == null) allMessagesLoaded = true
            } catch (cause: Exception) {
                notify(cause.userMessage())
                return false
            }
            guard++
        }
        runCatching { ensureEventsCoverMessages() }
        persistSnapshot()
        return messages.any { it.id == messageId }
    }
}
