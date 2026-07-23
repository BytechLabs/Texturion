package com.loonext.android.features.thread

import android.content.Context
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
            messages = mergeFirstPage(
                messages,
                detail.messages.data,
                { it.id },
                { it.created_at },
            )
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
        messages = mergeFirstPage(messages, page.data, { it.id }, { it.created_at })
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
        messages = mergeFirstPage(messages, detail.messages.data, { it.id }, { it.created_at })
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
                messages = mergeFirstPage(
                    messages,
                    detail.messages.data,
                    { it.id },
                    { it.created_at },
                )
                // Only adopt the fresh cursor from a blank slate; when the user
                // has already paged deeper, the existing cursor still points to
                // the oldest UNloaded message and the merge kept the rest.
                if (messagesCursor == null && detail.messages.next_cursor != null &&
                    !allMessagesLoaded
                ) {
                    messagesCursor = detail.messages.next_cursor
                }
            }
            runCatching {
                val page = repo.events(companyId, conversationId)
                events = page.data
                eventsCursor = page.next_cursor
                eventsExhausted = page.next_cursor == null
            }
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
                messages = mergeFirstPage(
                    messages,
                    listOf(message),
                    { it.id },
                    { it.created_at },
                )
                persistSnapshot()
                markRead()
            } catch (cause: Exception) {
                pendingSends = pendingSends - pendingRow
                lastFailedIntent = FailedSendIntent(body, photoIds, key)
                onRestore()
                notify(cause.userMessage())
                val code = (cause as? ApiException)?.code
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

    /** Retry a failed row (server-side rules; retryable gate is in the UI). */
    fun retrySend(messageId: String) {
        scope.launch {
            try {
                val updated = repo.retry(companyId, messageId)
                replaceMessage(updated)
            } catch (cause: Exception) {
                if ((cause as? ApiException)?.code == ApiErrorCode.CONFLICT) {
                    notify("This message can't be retried.")
                    runCatching { refreshMessagesFirstPage() }
                } else {
                    notify(cause.userMessage())
                }
            }
        }
    }

    /** D28 chain: the note row first, then each staged file against its id. */
    fun saveNote(body: String, files: List<StagedFile>, onRestore: () -> Unit) {
        scope.launch {
            val note = try {
                repo.createNote(companyId, conversationId, body)
            } catch (cause: Exception) {
                onRestore()
                notify(cause.userMessage())
                return@launch
            }
            messages = mergeFirstPage(messages, listOf(note), { it.id }, { it.created_at })
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
    ) {
        scope.launch {
            try {
                val task = repo.createTask(companyId, message.id, title, assignedUserId, dueAtIso)
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
