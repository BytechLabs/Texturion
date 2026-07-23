package com.loonext.android.features.inbox

import androidx.activity.compose.BackHandler
import androidx.compose.animation.AnimatedContent
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ArrowForward
import androidx.compose.material.icons.automirrored.outlined.Chat
import androidx.compose.material.icons.automirrored.outlined.Undo
import androidx.compose.material.icons.outlined.Check
import androidx.compose.material.icons.outlined.Close
import androidx.compose.material.icons.outlined.MarkEmailRead
import androidx.compose.material.icons.outlined.MarkEmailUnread
import androidx.compose.material.icons.outlined.Search
import androidx.compose.material.icons.outlined.Tune
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.LoadingIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.SnackbarDuration
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.SnackbarResult
import androidx.compose.material3.Surface
import androidx.compose.material3.Switch
import androidx.compose.material3.SwitchDefaults
import androidx.compose.material3.Text
import androidx.compose.material3.minimumInteractiveComponentSize
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.Stable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.runtime.snapshotFlow
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.loonext.android.AppGraph
import com.loonext.android.core.data.CacheKeys
import com.loonext.android.core.data.StoreCache
import com.loonext.android.core.model.ContactSummary
import com.loonext.android.core.model.ConversationListItem
import com.loonext.android.core.model.ConversationStatus
import com.loonext.android.core.model.Me
import com.loonext.android.core.model.Member
import com.loonext.android.core.model.SearchResult
import com.loonext.android.core.model.Tag
import com.loonext.android.core.net.ApiClient
import com.loonext.android.features.shell.LocalShellPageActive
import com.loonext.android.features.thread.MessagingRepository
import com.loonext.android.features.thread.ThreadScreen
import com.loonext.android.features.thread.appendPage
import com.loonext.android.features.thread.dropVanishedFromFirstWindow
import com.loonext.android.features.thread.mergeFirstPage
import com.loonext.android.ui.common.AppSheet
import com.loonext.android.ui.common.AttentionDot
import com.loonext.android.ui.common.CenteredError
import com.loonext.android.ui.common.CenteredLoading
import com.loonext.android.ui.common.DsChip
import com.loonext.android.ui.common.LoadState
import com.loonext.android.ui.common.PaperCard
import com.loonext.android.ui.common.ResyncOnResume
import com.loonext.android.ui.common.RowDivider
import com.loonext.android.ui.common.ScreenTitle
import com.loonext.android.ui.common.SectionHeader
import com.loonext.android.ui.common.SkeletonList
import com.loonext.android.ui.common.SwipeAction
import com.loonext.android.ui.common.SwipeActionRow
import com.loonext.android.ui.common.formatPhone
import com.loonext.android.ui.common.initialsOf
import com.loonext.android.ui.common.pressScale
import com.loonext.android.ui.common.relativeTime
import com.loonext.android.ui.common.rememberHaptics
import com.loonext.android.ui.common.userMessage
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.FlowPreview
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.debounce
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.launch

private enum class InboxStatusTab(val label: String) {
    Open("Open"), Mine("Mine"), All("All"), Closed("Closed")
}

/**
 * One filter pane's paint-ready state (#176): the ACCUMULATED rows (first
 * page plus every load-more append), the pinned section, and the resume
 * cursor — cached under [CacheKeys.inbox] per filterKey so a return visit
 * renders in the same frame and load-more continues from where it left off.
 * Public (not private) only because the shell warmer prefetches the default
 * key via [fetchInboxDefault].
 */
data class InboxSnapshot(
    val rows: List<ConversationListItem>,
    val pinnedRows: List<ConversationListItem>,
    val cursor: String?,
)

/**
 * The default pane (Open tab, no filter chips) as one cacheable value —
 * exactly the shape [InboxController] stores under
 * CacheKeys.inbox(companyId). The shell warmer replays this verbatim.
 */
suspend fun fetchInboxDefault(api: ApiClient, companyId: String): InboxSnapshot {
    val repo = MessagingRepository(api)
    val page = repo.conversations(
        companyId = companyId,
        status = "open",
        pinned = "exclude",
        limit = 25,
    )
    val pinned = runCatching {
        repo.conversations(companyId = companyId, status = "open", pinned = "only", limit = 100)
    }
    return InboxSnapshot(
        rows = page.data,
        pinnedRows = pinned.getOrNull()?.data ?: emptyList(),
        cursor = page.next_cursor,
    )
}

/**
 * Inbox: pinned section + segmented Open|Mine|All|Closed + filter sheet
 * (assignee/tag/unread/spam) + debounced global search (≥2 chars) + cursor
 * infinite scroll + realtime re-sort. Tapping a row opens [ThreadScreen]
 * in place (state-based detail — no global NavHost).
 */
@Composable
fun InboxTab(
    graph: AppGraph,
    companyId: String,
    me: Me,
    modifier: Modifier = Modifier,
    onOpenThread: ((conversationId: String, highlightMessageId: String?) -> Unit)? = null,
    onOpenTask: ((taskId: String) -> Unit)? = null,
    onComposeNew: ((prefillContactId: String?) -> Unit)? = null,
) {
    // Threads and compose are ROUTES above the shell now (founder mandate:
    // nothing pushed shows the pill nav) — this tab is only ever the list, so
    // its saveable state (filters, search, scroll) trivially survives trips.
    InboxList(
        graph = graph,
        companyId = companyId,
        me = me,
        onOpen = { onOpenThread?.invoke(it, null) },
        onOpenMessage = { conversationId, messageId ->
            onOpenThread?.invoke(conversationId, messageId)
        },
        onOpenTask = { onOpenTask?.invoke(it) },
        onCompose = { onComposeNew?.invoke(null) },
        onTextContact = { contactId -> onComposeNew?.invoke(contactId) },
        modifier = modifier,
    )
}

/**
 * One-shot snackbar payload for swipe outcomes (#185) — the id makes repeats
 * re-fire the LaunchedEffect, same grammar as ThreadNotice.
 */
private data class InboxNotice(
    val id: Long,
    val text: String,
    val actionLabel: String? = null,
    val action: (() -> Unit)? = null,
)

// ---------------------------------------------------------------------------
// List state
// ---------------------------------------------------------------------------

@Stable
private class InboxController(
    private val repo: MessagingRepository,
    private val cache: StoreCache,
    private val companyId: String,
    private val meUserId: String,
    private val scope: CoroutineScope,
) {
    var tab by mutableStateOf(InboxStatusTab.Open)
        private set
    var assignee by mutableStateOf<Member?>(null)
        private set
    var tag by mutableStateOf<Tag?>(null)
        private set
    var unreadOnly by mutableStateOf(false)
        private set
    var spamOnly by mutableStateOf(false)
        private set

    var state by mutableStateOf<LoadState<Unit>>(LoadState.Loading)
        private set
    var rows by mutableStateOf<List<ConversationListItem>>(emptyList())
        private set
    var pinnedRows by mutableStateOf<List<ConversationListItem>>(emptyList())
        private set
    var cursor by mutableStateOf<String?>(null)
        private set
    var loadingMore by mutableStateOf(false)
        private set

    /** True only while a pull-to-refresh revalidation is in flight. */
    var refreshing by mutableStateOf(false)
        private set

    var members by mutableStateOf<List<Member>>(emptyList())
        private set
    var allTags by mutableStateOf<List<Tag>>(emptyList())
        private set

    // Search (≥2 chars flips the pane to grouped global results).
    var query by mutableStateOf("")
    var searchState by mutableStateOf<LoadState<SearchResult>?>(null)
        private set
    var searchLoadingMore by mutableStateOf(false)
        private set
    val searching: Boolean get() = query.trim().length >= 2

    /** Swipe-action snackbar (#185); the tab-level effect shows it. */
    var notice by mutableStateOf<InboxNotice?>(null)
        private set

    private var noticeSeq = 0L
    private var loadSeq = 0
    private var searchSeq = 0
    private var realtimeJob: Job? = null
    private var supportLoaded = false

    // #176: CacheKeys has no entry for these two support lists yet — inline
    // strings until the orchestrator adds them.
    private val membersKey = CacheKeys.inboxMembers(companyId)
    private val tagsKey = CacheKeys.inboxTags(companyId)

    /**
     * Stable cache discriminator for the current filters (#176). The initial
     * state (Open, no chips) is exactly "default" so the shell warmer's
     * prefetch lands on the first frame. Mine excludes the assignee chip
     * because the request does too.
     */
    private val filterKey: String
        get() {
            val assigneeId = if (tab == InboxStatusTab.Mine) null else assignee?.user_id
            val isDefault = tab == InboxStatusTab.Open && assigneeId == null &&
                tag == null && !unreadOnly && !spamOnly
            if (isDefault) return "default"
            return buildString {
                append(tab.name.lowercase())
                assigneeId?.let { append("/a=").append(it) }
                tag?.let { append("/t=").append(it.id) }
                if (unreadOnly) append("/unread")
                if (spamOnly) append("/spam")
            }
        }

    private val cacheKey: String get() = CacheKeys.inbox(companyId, filterKey)

    init {
        // #176 cache-first: seed synchronously at construction so the FIRST
        // composed frame after a return visit paints rows (start() runs in a
        // LaunchedEffect, one frame too late for instant navigation).
        cache.flowOf<InboxSnapshot>(cacheKey).value?.let { snapshot ->
            rows = snapshot.rows
            pinnedRows = snapshot.pinnedRows
            cursor = snapshot.cursor
            state = LoadState.Ready(Unit)
        }
        cache.flowOf<List<Member>>(membersKey).value?.let { members = it }
        cache.flowOf<List<Tag>>(tagsKey).value?.let { allTags = it }
    }

    /** Write the current pane back under its filter's key (#176). */
    private fun persist() {
        cache.put(cacheKey, InboxSnapshot(rows, pinnedRows, cursor))
    }

    val hasFilterChips: Boolean
        get() = assignee != null || tag != null || unreadOnly || spamOnly

    fun selectTab(next: InboxStatusTab) {
        if (tab == next) return
        tab = next
        showPane()
    }

    fun setAssigneeFilter(member: Member?) {
        assignee = member
        showPane()
    }

    fun setTagFilter(next: Tag?) {
        tag = next
        showPane()
    }

    fun toggleUnread() {
        unreadOnly = !unreadOnly
        showPane()
    }

    fun toggleSpam() {
        spamOnly = !spamOnly
        showPane()
    }

    /** One reload for the sheet's Reset (not four chained ones). */
    fun resetFilters() {
        if (!hasFilterChips) return
        assignee = null
        tag = null
        unreadOnly = false
        spamOnly = false
        showPane()
    }

    /**
     * #176 cache-first filter switch: a previously-used filter paints its
     * cached pane in this frame and merge-revalidates silently (the merge —
     * not a reload — so restored deep pages survive the refresh). Only a
     * never-fetched filter may show the pane spinner.
     */
    private fun showPane() {
        val snapshot = cache.flowOf<InboxSnapshot>(cacheKey).value
        if (snapshot == null) {
            reload(showLoading = true)
            return
        }
        // Invalidate any in-flight load for the previous filter so it cannot
        // land its rows under this one.
        loadSeq++
        rows = snapshot.rows
        pinnedRows = snapshot.pinnedRows
        cursor = snapshot.cursor
        state = LoadState.Ready(Unit)
        scheduleRealtimeRefresh()
    }

    private suspend fun fetchPage(cursor: String?, pinned: String) =
        repo.conversations(
            companyId = companyId,
            status = when (tab) {
                InboxStatusTab.Open -> "open"
                InboxStatusTab.Closed -> "closed"
                else -> null
            },
            assignedUserId = when {
                tab == InboxStatusTab.Mine -> meUserId
                else -> assignee?.user_id
            },
            tagId = tag?.id,
            // Spam is hidden from defaults server-side; the chip reveals it.
            spam = if (spamOnly) true else null,
            unread = if (unreadOnly) true else null,
            pinned = pinned,
            cursor = cursor,
            limit = if (pinned == "only") 100 else 25,
        )

    fun start() {
        if (state is LoadState.Ready) {
            // Seeded from cache in init (or already live) — revalidate via
            // the merge path so restored accumulated pages survive.
            scheduleRealtimeRefresh()
        } else {
            reload(showLoading = true)
        }
        loadSupportingLists()
    }

    private fun loadSupportingLists() {
        if (supportLoaded) return
        supportLoaded = true
        scope.launch {
            runCatching {
                members = repo.members(companyId).data
                cache.put(membersKey, members)
            }
        }
        scope.launch {
            runCatching {
                allTags = repo.tags(companyId).data
                cache.put(tagsKey, allTags)
            }
        }
    }

    fun reload(showLoading: Boolean, manual: Boolean = false) {
        val seq = ++loadSeq
        if (showLoading) state = LoadState.Loading
        if (manual) refreshing = true
        scope.launch {
            try {
                val page = fetchPage(cursor = null, pinned = "exclude")
                val pinnedPage = runCatching { fetchPage(null, pinned = "only") }
                if (seq != loadSeq) return@launch
                rows = page.data
                cursor = page.next_cursor
                // A silent refresh keeps shown pinned rows through a partial
                // (pinned-only) miss instead of blanking the section.
                pinnedRows = pinnedPage.getOrNull()?.data
                    ?: if (showLoading) emptyList() else pinnedRows
                state = LoadState.Ready(Unit)
                persist()
            } catch (cause: Exception) {
                // A background refresh miss never replaces shown rows with an
                // error (#176) — only a first fetch may surface Failed.
                if (seq == loadSeq && state !is LoadState.Ready) {
                    state = LoadState.Failed(cause.userMessage())
                }
            } finally {
                // Unconditional: a superseded manual refresh must never leave
                // the crest spinning.
                if (manual) refreshing = false
            }
        }
    }

    fun loadMore() {
        val next = cursor ?: return
        if (loadingMore || state !is LoadState.Ready) return
        loadingMore = true
        val seq = loadSeq
        scope.launch {
            try {
                val page = fetchPage(next, pinned = "exclude")
                if (seq != loadSeq) return@launch
                rows = appendPage(rows, page.data) { it.id }
                cursor = page.next_cursor
                // Persist the ACCUMULATED list so a return visit restores
                // every loaded page, not just page 1.
                persist()
            } catch (_: Exception) {
                // Quiet: the scroll edge simply retries on the next reach.
            } finally {
                loadingMore = false
            }
        }
    }

    /** Realtime tick: debounce 250ms, then merge a fresh page 1 (re-sort). */
    fun scheduleRealtimeRefresh() {
        if (state !is LoadState.Ready) return
        realtimeJob?.cancel()
        realtimeJob = scope.launch {
            delay(250)
            val seq = loadSeq
            runCatching {
                val page = fetchPage(cursor = null, pinned = "exclude")
                val pinnedPage = runCatching { fetchPage(null, pinned = "only") }
                if (seq != loadSeq) return@launch
                val merged = mergeFirstPage(
                    rows,
                    page.data,
                    { it.id },
                    { it.last_message_at },
                )
                rows = dropVanishedFromFirstWindow(
                    merged = merged,
                    freshFirstPageIds = page.data.mapTo(HashSet()) { it.id },
                    oldestFreshSortKey = page.data.lastOrNull()?.last_message_at
                        // A full window means older rows may exist beyond it;
                        // a short page IS the complete filtered set.
                        .takeIf { page.next_cursor != null },
                    idOf = { it.id },
                    sortKey = { it.last_message_at },
                )
                pinnedPage.getOrNull()?.let { pinnedRows = it.data }
                persist()
            }
        }
    }

    /** Reconnect: trim to page 1 and refetch (SPEC §8). */
    fun refreshAfterReconnect() {
        reload(showLoading = false)
    }

    /** Clear the unread dot locally the moment a thread opens. */
    fun markLocallyRead(conversationId: String) {
        rows = rows.map { if (it.id == conversationId) it.copy(unread = false) else it }
        pinnedRows = pinnedRows.map {
            if (it.id == conversationId) it.copy(unread = false) else it
        }
        if (state is LoadState.Ready) persist()
    }

    /** [markLocallyRead]'s counterpart for the swipe toggle: dot back on. */
    private fun markLocallyUnread(conversationId: String) {
        rows = rows.map { if (it.id == conversationId) it.copy(unread = true) else it }
        pinnedRows = pinnedRows.map {
            if (it.id == conversationId) it.copy(unread = true) else it
        }
        if (state is LoadState.Ready) persist()
    }

    // --- Swipe actions (#185) ---------------------------------------------

    private fun notify(
        text: String,
        actionLabel: String? = null,
        action: (() -> Unit)? = null,
    ) {
        notice = InboxNotice(++noticeSeq, text, actionLabel, action)
    }

    /**
     * Swipe read/unread toggle, server-backed in both directions: an unread
     * row gets the SAME read receipt ThreadScreen posts on open; a read row
     * drops the caller's watermark (DELETE /read), so the dot survives
     * revalidation and syncs everywhere. The local flip paints first either
     * way; cache-first semantics untouched.
     */
    fun toggleRead(row: ConversationListItem) {
        if (row.unread) {
            markLocallyRead(row.id)
            scope.launch { runCatching { repo.markRead(companyId, row.id) } }
        } else {
            markLocallyUnread(row.id)
            scope.launch { runCatching { repo.markUnread(companyId, row.id) } }
        }
    }

    /**
     * Swipe close/reopen: the SAME status PATCH the thread's actions sheet
     * commits. No optimistic splice — on success the pane merge-revalidates
     * through the normal realtime path, so the row leaves or rejoins the
     * current filter with animateItem gliding. Closing offers a one-tap
     * Undo that reverts via the reopen mutation.
     */
    fun toggleStatus(row: ConversationListItem) {
        val closing = row.status != ConversationStatus.CLOSED
        val target = if (closing) ConversationStatus.CLOSED else ConversationStatus.OPEN
        scope.launch {
            try {
                repo.setStatus(companyId, row.id, target)
                scheduleRealtimeRefresh()
                if (closing) {
                    notify("Conversation closed", actionLabel = "Undo") { reopen(row.id) }
                } else {
                    notify("Conversation reopened")
                }
            } catch (cause: Exception) {
                notify(cause.userMessage())
            }
        }
    }

    /** The Undo leg of a swipe-close. */
    private fun reopen(conversationId: String) {
        scope.launch {
            try {
                repo.setStatus(companyId, conversationId, ConversationStatus.OPEN)
                scheduleRealtimeRefresh()
            } catch (cause: Exception) {
                notify(cause.userMessage())
            }
        }
    }

    // --- Search -----------------------------------------------------------

    fun runSearch() {
        val q = query.trim()
        if (q.length < 2) {
            searchState = null
            return
        }
        val seq = ++searchSeq
        if (searchState !is LoadState.Ready) searchState = LoadState.Loading
        scope.launch {
            try {
                val result = repo.search(companyId, q)
                if (seq == searchSeq) searchState = LoadState.Ready(result)
            } catch (cause: Exception) {
                if (seq == searchSeq) searchState = LoadState.Failed(cause.userMessage())
            }
        }
    }

    /** Conversations arm load-more (other arms are first-page-only). */
    fun searchMore() {
        val current = (searchState as? LoadState.Ready)?.value ?: return
        val nextCursor = current.next_cursor ?: return
        if (searchLoadingMore) return
        searchLoadingMore = true
        val seq = searchSeq
        scope.launch {
            try {
                val more = repo.search(companyId, query.trim(), nextCursor)
                if (seq != searchSeq) return@launch
                searchState = LoadState.Ready(
                    current.copy(
                        conversations = appendPage(
                            current.conversations,
                            more.conversations,
                        ) { it.matched_message_id },
                        next_cursor = more.next_cursor,
                    ),
                )
            } catch (_: Exception) {
                // Quiet — "More results" stays tappable.
            } finally {
                searchLoadingMore = false
            }
        }
    }
}

// ---------------------------------------------------------------------------
// List UI (Paper & Olive — spec 20)
// ---------------------------------------------------------------------------

@OptIn(FlowPreview::class, ExperimentalMaterial3Api::class)
@Composable
private fun InboxList(
    graph: AppGraph,
    companyId: String,
    me: Me,
    onOpen: (String) -> Unit,
    onOpenMessage: (conversationId: String, messageId: String) -> Unit,
    onOpenTask: (taskId: String) -> Unit,
    onCompose: () -> Unit,
    onTextContact: (String) -> Unit,
    modifier: Modifier = Modifier,
) {
    val repo = remember(graph) { MessagingRepository(graph.api) }
    val controller = remember(companyId) {
        InboxController(repo, graph.storeCache, companyId, me.user_id, graph.appScope)
    }
    LaunchedEffect(controller) { controller.start() }
    LaunchedEffect(controller) {
        graph.realtime.events.collect { event ->
            if (event.event == "message.created" || event.event == "conversation.updated") {
                controller.scheduleRealtimeRefresh()
            }
        }
    }
    LaunchedEffect(controller) {
        graph.realtime.reconnected.collect { controller.refreshAfterReconnect() }
    }
    // #215: self-heal a frame missed while backgrounded/blurred by rerunning
    // the reconnect refetch on return to the foreground.
    ResyncOnResume(controller) { controller.refreshAfterReconnect() }
    // Debounced search over the query field.
    LaunchedEffect(controller) {
        snapshotFlow { controller.query }
            .debounce(300)
            .distinctUntilChanged()
            .collect { controller.runSearch() }
    }

    var searchOpen by rememberSaveable(companyId) { mutableStateOf(false) }
    var filterSheetOpen by remember { mutableStateOf(false) }
    val haptics = rememberHaptics()

    // Swipe-action outcomes (#185) surface here, at TAB scope, so the close
    // Undo outlives the row it came from (a closed row leaves the pane on
    // the next merge, taking any row-scoped coroutine with it).
    val snackbar = remember { SnackbarHostState() }
    LaunchedEffect(controller.notice) {
        val notice = controller.notice ?: return@LaunchedEffect
        val result = snackbar.showSnackbar(
            message = notice.text,
            actionLabel = notice.actionLabel,
            duration = if (notice.actionLabel != null) SnackbarDuration.Long
            else SnackbarDuration.Short,
        )
        if (result == SnackbarResult.ActionPerformed) notice.action?.invoke()
    }

    Box(modifier.fillMaxSize()) {
        if (searchOpen) {
            SearchSurface(
                controller = controller,
                onCancel = {
                    controller.query = ""
                    searchOpen = false
                },
                onOpen = { id ->
                    controller.markLocallyRead(id)
                    onOpen(id)
                },
                onOpenMessage = { conversationId, messageId ->
                    controller.markLocallyRead(conversationId)
                    onOpenMessage(conversationId, messageId)
                },
                onOpenTask = onOpenTask,
                onTextContact = onTextContact,
            )
        } else {
            Column(
                Modifier
                    .fillMaxSize()
                    .padding(horizontal = 18.dp),
            ) {
                Spacer(Modifier.height(8.dp))
                InboxHeader(
                    unreadCount = controller.pinnedRows.count { it.unread } +
                        controller.rows.count { it.unread },
                    filtersActive = controller.hasFilterChips,
                    onSearch = { searchOpen = true },
                    onFilters = { filterSheetOpen = true },
                )
                Spacer(Modifier.height(14.dp))
                Row(
                    Modifier
                        .fillMaxWidth()
                        .horizontalScroll(rememberScrollState()),
                    horizontalArrangement = Arrangement.spacedBy(7.dp),
                ) {
                    InboxStatusTab.entries.forEach { item ->
                        FilterPill(
                            text = item.label,
                            selected = controller.tab == item,
                            onClick = { controller.selectTab(item) },
                        )
                    }
                }
                Spacer(Modifier.height(14.dp))
                Box(Modifier.weight(1f)) {
                    when (val current = controller.state) {
                        // First fetch only (#176 keeps every revisit cached):
                        // shimmer in the conversation-row grammar, not a spinner.
                        is LoadState.Loading -> PaperCard(Modifier.fillMaxWidth()) {
                            SkeletonList(rows = 8)
                        }

                        is LoadState.Failed -> CenteredError(
                            current.message,
                            onRetry = { controller.reload(showLoading = true) },
                        )

                        is LoadState.Ready -> PullToRefreshBox(
                            isRefreshing = controller.refreshing,
                            onRefresh = {
                                haptics.tick()
                                controller.reload(showLoading = false, manual = true)
                            },
                        ) {
                            ConversationListPane(
                                controller = controller,
                                meUserId = me.user_id,
                                onOpen = { id ->
                                    controller.markLocallyRead(id)
                                    onOpen(id)
                                },
                            )
                        }
                    }
                }
            }
        }

        if (filterSheetOpen) {
            FiltersSheet(
                controller = controller,
                meUserId = me.user_id,
                onDismiss = { filterSheetOpen = false },
            )
        }

        SnackbarHost(snackbar, Modifier.align(Alignment.BottomCenter))
    }
}

@Composable
private fun InboxHeader(
    unreadCount: Int,
    filtersActive: Boolean,
    onSearch: () -> Unit,
    onFilters: () -> Unit,
) {
    Row(
        Modifier.fillMaxWidth(),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        ScreenTitle("Inbox")
        // Animated so the chip grows in, ticks its count, and shrinks away.
        AnimatedContent(targetState = unreadCount, label = "unreadBadge") { count ->
            if (count > 0) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Spacer(Modifier.width(9.dp))
                    DsChip("$count unread")
                }
            }
        }
        Spacer(Modifier.weight(1f))
        PaperIconButton(
            icon = Icons.Outlined.Search,
            contentDescription = "Search",
            onClick = onSearch,
        )
        Spacer(Modifier.width(8.dp))
        PaperIconButton(
            icon = Icons.Outlined.Tune,
            contentDescription = "Filters",
            onClick = onFilters,
            badge = filtersActive,
        )
    }
}

/** 44dp paper circle with a 17dp stroke icon (design grammar). */
@Composable
private fun PaperIconButton(
    icon: androidx.compose.ui.graphics.vector.ImageVector,
    contentDescription: String,
    onClick: () -> Unit,
    badge: Boolean = false,
) {
    val haptics = rememberHaptics()
    val pressSource = remember { MutableInteractionSource() }
    // pressScale on the wrapper so the badge dot gives with the circle.
    Box(Modifier.pressScale(pressSource)) {
        Surface(
            onClick = {
                haptics.tap()
                onClick()
            },
            shape = CircleShape,
            color = MaterialTheme.colorScheme.surface,
            contentColor = MaterialTheme.colorScheme.onSurface,
            shadowElevation = 1.dp,
            interactionSource = pressSource,
            modifier = Modifier.size(44.dp),
        ) {
            Box(contentAlignment = Alignment.Center) {
                Icon(icon, contentDescription = contentDescription, modifier = Modifier.size(18.dp))
            }
        }
        if (badge) {
            Box(
                Modifier
                    .align(Alignment.TopEnd)
                    .size(9.dp)
                    .background(MaterialTheme.colorScheme.secondary, CircleShape),
            )
        }
    }
}

/**
 * Paper/ink filter pill (spec 20/01). `outlined` = selected-with-ink-ring
 * (the tag style) instead of the solid ink fill.
 */
@Composable
private fun FilterPill(
    text: String,
    selected: Boolean,
    onClick: () -> Unit,
    outlined: Boolean = false,
    leading: (@Composable () -> Unit)? = null,
) {
    val solid = selected && !outlined
    val haptics = rememberHaptics()
    Surface(
        onClick = {
            haptics.tap()
            onClick()
        },
        shape = CircleShape,
        color = if (solid) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.surface,
        contentColor = when {
            solid -> MaterialTheme.colorScheme.onPrimary
            selected -> MaterialTheme.colorScheme.onSurface
            else -> MaterialTheme.colorScheme.onSurfaceVariant
        },
        border = if (selected && outlined) {
            BorderStroke(2.dp, MaterialTheme.colorScheme.primary)
        } else {
            null
        },
    ) {
        // Avatar-leading pills tuck the padding in around the 24dp circle;
        // dot-leading (tag) pills keep the standard 10x16 (spec 01).
        val avatarLeading = leading != null && !outlined
        Row(
            Modifier.padding(
                start = if (avatarLeading) 8.dp else 16.dp,
                end = 16.dp,
                top = if (avatarLeading) 8.dp else 10.dp,
                bottom = if (avatarLeading) 8.dp else 10.dp,
            ),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(6.dp),
        ) {
            leading?.invoke()
            Text(
                text,
                style = MaterialTheme.typography.labelLarge.copy(
                    fontSize = 12.5.sp,
                    fontWeight = if (selected) FontWeight.SemiBold else FontWeight.Medium,
                ),
                maxLines = 1,
            )
        }
    }
}

// ---------------------------------------------------------------------------
// Conversation list
// ---------------------------------------------------------------------------

/**
 * One row of a "card" that actually lives in a LazyColumn: first/last rows
 * carry the 22dp paper-card corners so a run of rows reads as one PaperCard
 * while staying lazy for paging.
 */
@Composable
private fun GroupedRow(
    first: Boolean,
    last: Boolean,
    modifier: Modifier = Modifier,
    onClick: (() -> Unit)? = null,
    content: @Composable () -> Unit,
) {
    val radius = 22.dp
    val shape = RoundedCornerShape(
        topStart = if (first) radius else 0.dp,
        topEnd = if (first) radius else 0.dp,
        bottomStart = if (last) radius else 0.dp,
        bottomEnd = if (last) radius else 0.dp,
    )
    Column(
        modifier
            .fillMaxWidth()
            .clip(shape)
            .background(MaterialTheme.colorScheme.surface)
            .let { if (onClick != null) it.clickable(onClick = onClick) else it },
    ) {
        content()
        if (!last) RowDivider()
    }
}

@Composable
private fun ConversationListPane(
    controller: InboxController,
    meUserId: String,
    onOpen: (String) -> Unit,
) {
    val listState = rememberLazyListState()
    LaunchedEffect(listState, controller) {
        snapshotFlow {
            val info = listState.layoutInfo
            (info.visibleItemsInfo.lastOrNull()?.index ?: 0) to info.totalItemsCount
        }
            .distinctUntilChanged()
            .collect { (last, total) ->
                if (total > 0 && last >= total - 5) controller.loadMore()
            }
    }

    val empty = controller.rows.isEmpty() && controller.pinnedRows.isEmpty()
    if (empty) {
        Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
            Text(
                when {
                    controller.hasFilterChips -> "Nothing matches these filters."
                    controller.tab == InboxStatusTab.Open -> "Nothing waiting on you."
                    controller.tab == InboxStatusTab.Mine -> "Nothing assigned to you."
                    controller.tab == InboxStatusTab.Closed -> "No closed conversations."
                    else -> "No conversations yet."
                },
                style = MaterialTheme.typography.bodyLarge,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        return
    }

    val membersById = controller.members.associateBy { it.user_id }
    fun assigneeName(row: ConversationListItem): String? =
        row.assigned_user_id?.let { userId ->
            if (userId == meUserId) {
                "You"
            } else {
                membersById[userId]?.display_name?.ifBlank { "Teammate" }
            }
        }

    LazyColumn(
        state = listState,
        modifier = Modifier.fillMaxSize(),
        contentPadding = PaddingValues(bottom = 24.dp),
    ) {
        val hasPinned = controller.pinnedRows.isNotEmpty()
        if (hasPinned) {
            item(key = "pinned-header") {
                SectionHeader("Pinned", count = controller.pinnedRows.size)
            }
            itemsIndexed(
                controller.pinnedRows,
                key = { _, row -> "pin:${row.id}" },
            ) { index, row ->
                GroupedRow(
                    first = index == 0,
                    last = index == controller.pinnedRows.lastIndex,
                    // Realtime arrivals fade in; re-sorts glide instead of jump.
                    modifier = Modifier.animateItem(),
                    onClick = { onOpen(row.id) },
                ) { SwipeableConversationRow(row, controller, assigneeName(row)) }
            }
            if (controller.rows.isNotEmpty()) {
                item(key = "rest-header") {
                    Spacer(Modifier.height(14.dp))
                    SectionHeader("Conversations")
                }
            }
        }
        itemsIndexed(controller.rows, key = { _, row -> row.id }) { index, row ->
            GroupedRow(
                first = index == 0,
                last = index == controller.rows.lastIndex,
                modifier = Modifier.animateItem(),
                onClick = { onOpen(row.id) },
            ) { SwipeableConversationRow(row, controller, assigneeName(row)) }
        }
        if (controller.loadingMore) {
            item(key = "loading-more") {
                Box(
                    Modifier
                        .fillMaxWidth()
                        .padding(12.dp),
                    contentAlignment = Alignment.Center,
                ) { LoadingIndicator() }
            }
        }
    }
}

/**
 * The inbox row wrapped in reveal-behind swipe actions (#185). Swipe right
 * toggles the unread dot; swipe left closes (or, on a closed row, reopens).
 * Both are shortcuts, never the only path (#185): opening the thread clears
 * the dot, and status lives in the thread's actions sheet. Placed INSIDE
 * [GroupedRow] so the revealed gutter clips to the card's corner radius; the
 * gesture only claims horizontal slop, so the row tap and the LazyColumn's
 * vertical scroll (and animateItem) keep working untouched.
 *
 * Commit haptics per the SwipeActionRow contract: tap() for the dot toggle,
 * confirm() for the status commit (the arming tick lives in the component).
 */
@Composable
private fun SwipeableConversationRow(
    row: ConversationListItem,
    controller: InboxController,
    assigneeName: String?,
) {
    val haptics = rememberHaptics()
    val closed = row.status == ConversationStatus.CLOSED
    SwipeActionRow(
        startAction = SwipeAction(
            icon = if (row.unread) {
                Icons.Outlined.MarkEmailRead
            } else {
                Icons.Outlined.MarkEmailUnread
            },
            label = if (row.unread) "Read" else "Unread",
            tint = MaterialTheme.colorScheme.onSecondaryContainer,
            container = MaterialTheme.colorScheme.secondaryContainer,
            onCommit = {
                haptics.tap()
                controller.toggleRead(row)
            },
        ),
        endAction = SwipeAction(
            icon = if (closed) Icons.AutoMirrored.Outlined.Undo else Icons.Outlined.Check,
            label = if (closed) "Reopen" else "Close",
            tint = MaterialTheme.colorScheme.onTertiaryContainer,
            container = MaterialTheme.colorScheme.tertiaryContainer,
            onCommit = {
                haptics.confirm()
                controller.toggleStatus(row)
            },
        ),
    ) { ConversationRow(row, assigneeName) }
}

@Composable
private fun ConversationRow(row: ConversationListItem, assigneeName: String?) {
    val name = row.contact.name ?: formatPhone(row.contact.phone_e164)
    Row(
        Modifier
            .fillMaxWidth()
            .padding(horizontal = 14.dp, vertical = 12.dp),
        verticalAlignment = Alignment.Top,
    ) {
        // 42dp squircle avatar; unread = coral dot ringed in paper (spec 20).
        Box {
            Box(
                Modifier
                    .size(42.dp)
                    .background(
                        MaterialTheme.colorScheme.secondaryContainer,
                        RoundedCornerShape(15.dp),
                    ),
                contentAlignment = Alignment.Center,
            ) {
                Text(
                    initialsOf(name),
                    style = MaterialTheme.typography.labelLarge.copy(
                        fontSize = 12.5.sp,
                        fontWeight = FontWeight.SemiBold,
                    ),
                    color = MaterialTheme.colorScheme.onSecondaryContainer,
                )
            }
            if (row.unread) {
                Box(
                    Modifier
                        .align(Alignment.TopStart)
                        .offset((-3).dp, (-3).dp)
                        .size(13.dp)
                        .background(MaterialTheme.colorScheme.surface, CircleShape),
                    contentAlignment = Alignment.Center,
                ) { AttentionDot(size = 9.dp) }
            }
        }
        Spacer(Modifier.width(11.dp))
        Column(Modifier.weight(1f)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(
                    name,
                    style = MaterialTheme.typography.bodyMedium.copy(
                        fontSize = 14.sp,
                        fontWeight = if (row.unread) FontWeight.SemiBold else FontWeight.Medium,
                    ),
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.weight(1f),
                )
                Spacer(Modifier.width(8.dp))
                Text(
                    relativeTime(row.last_message_at),
                    style = MaterialTheme.typography.labelSmall.copy(fontSize = 11.sp),
                    color = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.7f),
                )
            }
            val snippet = row.last_message?.let { last ->
                val body = if (last.body.isBlank() && last.has_attachments) "Photo"
                else last.body
                if (last.direction == "note") "Note · $body" else body
            }.orEmpty()
            Text(
                snippet,
                style = MaterialTheme.typography.bodySmall.copy(fontSize = 12.sp),
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                modifier = Modifier.padding(top = 2.dp),
            )
            if (row.tags.isNotEmpty() || row.is_spam || assigneeName != null) {
                Row(
                    Modifier.padding(top = 6.dp),
                    horizontalArrangement = Arrangement.spacedBy(6.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    row.tags.take(3).forEach { tag -> TagChip(tag) }
                    if (row.tags.size > 3) {
                        Text(
                            "+${row.tags.size - 3}",
                            style = MaterialTheme.typography.labelSmall.copy(fontSize = 10.5.sp),
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                    if (row.is_spam) {
                        DsChip(
                            "Spam",
                            container = MaterialTheme.colorScheme.surfaceContainerHigh,
                            content = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                    if (assigneeName != null) {
                        Text(
                            assigneeName,
                            style = MaterialTheme.typography.labelSmall.copy(
                                fontSize = 10.5.sp,
                                fontWeight = FontWeight.SemiBold,
                            ),
                            color = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.85f),
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis,
                        )
                    }
                }
            }
        }
    }
}

@Composable
private fun TagChip(tag: Tag) {
    val tint = tag.color?.let { hex ->
        runCatching { Color(android.graphics.Color.parseColor(hex)) }.getOrNull()
    }
    Surface(shape = CircleShape, color = MaterialTheme.colorScheme.surfaceContainer) {
        Row(
            Modifier.padding(horizontal = 8.dp, vertical = 3.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            if (tint != null) {
                Box(
                    Modifier
                        .size(6.dp)
                        .background(tint, CircleShape),
                )
                Spacer(Modifier.width(4.dp))
            }
            Text(
                tag.name,
                style = MaterialTheme.typography.labelSmall.copy(
                    fontSize = 10.sp,
                    fontWeight = FontWeight.Bold,
                ),
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
        }
    }
}

// ---------------------------------------------------------------------------
// Filter sheet (spec 01 — the sliders button)
// ---------------------------------------------------------------------------

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun FiltersSheet(
    controller: InboxController,
    meUserId: String,
    onDismiss: () -> Unit,
) {
    val haptics = rememberHaptics()
    AppSheet(
        onDismissRequest = onDismiss,
        shape = MaterialTheme.shapes.extraLarge,
        containerColor = MaterialTheme.colorScheme.background,
    ) {
        Column(
            Modifier
                .fillMaxWidth()
                .verticalScroll(rememberScrollState())
                .padding(start = 20.dp, end = 20.dp, bottom = 22.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(
                    "Filters",
                    style = MaterialTheme.typography.headlineMedium.copy(fontSize = 21.sp),
                    color = MaterialTheme.colorScheme.onBackground,
                )
                Spacer(Modifier.weight(1f))
                Text(
                    "Reset",
                    style = MaterialTheme.typography.labelMedium.copy(
                        fontSize = 12.sp,
                        fontWeight = FontWeight.Bold,
                    ),
                    color = MaterialTheme.colorScheme.secondary,
                    modifier = Modifier
                        .minimumInteractiveComponentSize()
                        .clip(CircleShape)
                        .clickable {
                            haptics.tap()
                            controller.resetFilters()
                        }
                        .padding(horizontal = 8.dp, vertical = 6.dp),
                )
            }

            Column {
                SectionHeader("Status")
                FlowRow(
                    horizontalArrangement = Arrangement.spacedBy(7.dp),
                    verticalArrangement = Arrangement.spacedBy(7.dp),
                ) {
                    InboxStatusTab.entries.forEach { item ->
                        FilterPill(
                            text = item.label,
                            selected = controller.tab == item,
                            onClick = { controller.selectTab(item) },
                        )
                    }
                }
            }

            if (controller.tab != InboxStatusTab.Mine) {
                Column {
                    SectionHeader("Assignee")
                    FlowRow(
                        horizontalArrangement = Arrangement.spacedBy(7.dp),
                        verticalArrangement = Arrangement.spacedBy(7.dp),
                    ) {
                        FilterPill(
                            text = "Anyone",
                            selected = controller.assignee == null,
                            onClick = { controller.setAssigneeFilter(null) },
                        )
                        controller.members.filter { it.deactivated_at == null }.forEach { member ->
                            val label = if (member.user_id == meUserId) {
                                "Me"
                            } else {
                                member.display_name.ifBlank { "Teammate" }
                            }
                            FilterPill(
                                text = label,
                                selected = controller.assignee?.user_id == member.user_id,
                                onClick = { controller.setAssigneeFilter(member) },
                                leading = {
                                    Box(
                                        Modifier
                                            .size(24.dp)
                                            .background(
                                                MaterialTheme.colorScheme.secondaryContainer,
                                                CircleShape,
                                            ),
                                        contentAlignment = Alignment.Center,
                                    ) {
                                        Text(
                                            initialsOf(member.display_name.ifBlank { null }),
                                            style = MaterialTheme.typography.labelSmall.copy(
                                                fontSize = 9.sp,
                                                fontWeight = FontWeight.SemiBold,
                                            ),
                                            color = MaterialTheme.colorScheme.onSecondaryContainer,
                                        )
                                    }
                                },
                            )
                        }
                    }
                }
            }

            Column {
                SectionHeader("Tags")
                if (controller.allTags.isEmpty()) {
                    Text(
                        "No tags yet. Add tags from a conversation on the web.",
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        modifier = Modifier.padding(horizontal = 4.dp),
                    )
                } else {
                    FlowRow(
                        horizontalArrangement = Arrangement.spacedBy(7.dp),
                        verticalArrangement = Arrangement.spacedBy(7.dp),
                    ) {
                        FilterPill(
                            text = "Any tag",
                            selected = controller.tag == null,
                            onClick = { controller.setTagFilter(null) },
                        )
                        controller.allTags.forEach { tag ->
                            val tint = tag.color?.let { hex ->
                                runCatching {
                                    Color(android.graphics.Color.parseColor(hex))
                                }.getOrNull()
                            }
                            FilterPill(
                                text = tag.name,
                                selected = controller.tag?.id == tag.id,
                                onClick = { controller.setTagFilter(tag) },
                                outlined = true,
                                leading = tint?.let { dot ->
                                    {
                                        Box(
                                            Modifier
                                                .size(6.dp)
                                                .background(dot, CircleShape),
                                        )
                                    }
                                },
                            )
                        }
                    }
                }
            }

            ToggleCard(
                label = "Unread only",
                checked = controller.unreadOnly,
                onToggle = { controller.toggleUnread() },
            )
            ToggleCard(
                label = "Spam only",
                checked = controller.spamOnly,
                onToggle = { controller.toggleSpam() },
            )

            // Filters apply live; this just closes the sheet (ink pill + lime
            // arrow, spec 01).
            Surface(
                onClick = {
                    haptics.tap()
                    onDismiss()
                },
                shape = CircleShape,
                color = MaterialTheme.colorScheme.primary,
                contentColor = MaterialTheme.colorScheme.onPrimary,
            ) {
                Row(
                    Modifier
                        .fillMaxWidth()
                        .padding(start = 22.dp, top = 8.dp, bottom = 8.dp, end = 8.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Text(
                        "Show conversations",
                        style = MaterialTheme.typography.titleMedium.copy(fontSize = 15.sp),
                        modifier = Modifier.weight(1f),
                    )
                    Box(
                        Modifier
                            .size(42.dp)
                            .background(MaterialTheme.colorScheme.tertiary, CircleShape),
                        contentAlignment = Alignment.Center,
                    ) {
                        Icon(
                            Icons.AutoMirrored.Outlined.ArrowForward,
                            contentDescription = null,
                            tint = MaterialTheme.colorScheme.onTertiary,
                            modifier = Modifier.size(17.dp),
                        )
                    }
                }
            }
        }
    }
}

/** Paper toggle row (radius 18) with a lime-tracked switch (spec 01). */
@Composable
private fun ToggleCard(label: String, checked: Boolean, onToggle: () -> Unit) {
    val haptics = rememberHaptics()
    // One shared path so the row tap and the switch never double-fire.
    val toggle = {
        haptics.tap()
        onToggle()
    }
    Surface(
        onClick = toggle,
        shape = RoundedCornerShape(18.dp),
        color = MaterialTheme.colorScheme.surface,
    ) {
        Row(
            Modifier
                .fillMaxWidth()
                .padding(horizontal = 16.dp, vertical = 8.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(
                label,
                style = MaterialTheme.typography.titleSmall.copy(fontSize = 13.5.sp),
                color = MaterialTheme.colorScheme.onSurface,
                modifier = Modifier.weight(1f),
            )
            Switch(
                checked = checked,
                onCheckedChange = { toggle() },
                colors = SwitchDefaults.colors(
                    checkedTrackColor = MaterialTheme.colorScheme.tertiary,
                    checkedThumbColor = MaterialTheme.colorScheme.surface,
                    checkedBorderColor = Color.Transparent,
                ),
            )
        }
    }
}

// ---------------------------------------------------------------------------
// Search (spec 00 — texts, tasks, contacts)
// ---------------------------------------------------------------------------

private enum class SearchScope(val label: String) {
    All("All"), Texts("Texts"), Tasks("Tasks"), Contacts("Contacts")
}

/** ts_headline wraps matches in <b>…</b>; render them as lime marks. */
@Composable
private fun highlightSnippet(snippet: String): AnnotatedString {
    val container = MaterialTheme.colorScheme.primaryContainer
    val content = MaterialTheme.colorScheme.onPrimaryContainer
    return remember(snippet, container, content) {
        buildAnnotatedString {
            var rest = snippet
            while (true) {
                val start = rest.indexOf("<b>")
                if (start < 0) {
                    append(rest)
                    break
                }
                append(rest.substring(0, start))
                val after = rest.substring(start + 3)
                val end = after.indexOf("</b>")
                if (end < 0) {
                    append(after)
                    break
                }
                withStyle(
                    SpanStyle(
                        background = container,
                        color = content,
                        fontWeight = FontWeight.SemiBold,
                    ),
                ) { append(after.substring(0, end)) }
                rest = after.substring(end + 4)
            }
        }
    }
}

@Composable
private fun SearchSurface(
    controller: InboxController,
    onCancel: () -> Unit,
    onOpen: (String) -> Unit,
    onOpenMessage: (conversationId: String, messageId: String) -> Unit,
    onOpenTask: (taskId: String) -> Unit,
    onTextContact: (String) -> Unit,
) {
    var scope by rememberSaveable { mutableStateOf(SearchScope.All) }
    val focusRequester = remember { FocusRequester() }
    LaunchedEffect(Unit) { focusRequester.requestFocus() }
    // #203: the shell keeps this page composed while a NEIGHBOR shows, so an
    // always-enabled handler would intercept the back button from other tabs;
    // it may only claim back while Inbox is the settled page.
    BackHandler(enabled = LocalShellPageActive.current, onBack = onCancel)

    Column(
        Modifier
            .fillMaxSize()
            .padding(horizontal = 18.dp),
    ) {
        Spacer(Modifier.height(8.dp))
        Row(verticalAlignment = Alignment.CenterVertically) {
            // The paper search pill with the ink focus ring (spec 00).
            Surface(
                shape = CircleShape,
                color = MaterialTheme.colorScheme.surface,
                border = BorderStroke(2.dp, MaterialTheme.colorScheme.primary),
                modifier = Modifier.weight(1f),
            ) {
                Row(
                    Modifier.padding(horizontal = 16.dp, vertical = 12.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(9.dp),
                ) {
                    Icon(
                        Icons.Outlined.Search,
                        contentDescription = null,
                        tint = MaterialTheme.colorScheme.onSurfaceVariant,
                        modifier = Modifier.size(16.dp),
                    )
                    Box(Modifier.weight(1f)) {
                        if (controller.query.isEmpty()) {
                            Text(
                                "Search texts, tasks, contacts…",
                                style = MaterialTheme.typography.bodyMedium.copy(fontSize = 15.sp),
                                color = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.7f),
                                maxLines = 1,
                            )
                        }
                        BasicTextField(
                            value = controller.query,
                            onValueChange = { controller.query = it.take(200) },
                            singleLine = true,
                            textStyle = MaterialTheme.typography.bodyMedium.copy(
                                fontSize = 15.sp,
                                fontWeight = FontWeight.SemiBold,
                                color = MaterialTheme.colorScheme.onSurface,
                            ),
                            cursorBrush = SolidColor(MaterialTheme.colorScheme.primary),
                            modifier = Modifier
                                .fillMaxWidth()
                                .focusRequester(focusRequester),
                        )
                    }
                    if (controller.query.isNotEmpty()) {
                        Icon(
                            Icons.Outlined.Close,
                            contentDescription = "Clear search",
                            tint = MaterialTheme.colorScheme.onSurfaceVariant,
                            modifier = Modifier
                                .size(16.dp)
                                .clickable { controller.query = "" },
                        )
                    }
                }
            }
            Text(
                "Cancel",
                style = MaterialTheme.typography.labelLarge.copy(
                    fontSize = 13.sp,
                    fontWeight = FontWeight.SemiBold,
                ),
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier
                    .clip(CircleShape)
                    .clickable(onClick = onCancel)
                    .padding(horizontal = 12.dp, vertical = 10.dp),
            )
        }
        Spacer(Modifier.height(13.dp))
        Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            SearchScope.entries.forEach { item ->
                FilterPill(
                    text = item.label,
                    selected = scope == item,
                    onClick = { scope = item },
                )
            }
        }
        Spacer(Modifier.height(13.dp))

        if (!controller.searching) {
            Box(Modifier.weight(1f).fillMaxWidth(), contentAlignment = Alignment.Center) {
                Text(
                    "Search your texts, tasks, and contacts.",
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            return
        }

        when (val current = controller.searchState) {
            null, is LoadState.Loading -> CenteredLoading(Modifier.weight(1f))
            is LoadState.Failed -> CenteredError(
                current.message,
                onRetry = { controller.runSearch() },
                modifier = Modifier.weight(1f),
            )

            is LoadState.Ready -> SearchResultsPane(
                result = current.value,
                scope = scope,
                controller = controller,
                onOpen = onOpen,
                onOpenMessage = onOpenMessage,
                onOpenTask = onOpenTask,
                onTextContact = onTextContact,
                modifier = Modifier.weight(1f),
            )
        }
    }
}

@Composable
private fun SearchResultsPane(
    result: SearchResult,
    scope: SearchScope,
    controller: InboxController,
    onOpen: (String) -> Unit,
    onOpenMessage: (conversationId: String, messageId: String) -> Unit,
    onOpenTask: (taskId: String) -> Unit,
    onTextContact: (String) -> Unit,
    modifier: Modifier = Modifier,
) {
    val showTexts = scope == SearchScope.All || scope == SearchScope.Texts
    val showTasks = scope == SearchScope.All || scope == SearchScope.Tasks
    val showContacts = scope == SearchScope.All || scope == SearchScope.Contacts
    val showExtras = scope == SearchScope.All

    val empty = (!showTexts || result.conversations.isEmpty()) &&
        (!showTasks || result.tasks.isEmpty()) &&
        (!showContacts || result.contacts.isEmpty()) &&
        (!showExtras || (result.attachments.isEmpty() && result.templates.isEmpty()))
    if (empty) {
        Box(modifier.fillMaxWidth(), contentAlignment = Alignment.Center) {
            Text(
                "Nothing matches \"${controller.query.trim()}\".",
                style = MaterialTheme.typography.bodyLarge,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        return
    }

    LazyColumn(modifier.fillMaxWidth(), contentPadding = PaddingValues(bottom = 24.dp)) {
        if (showTexts && result.conversations.isNotEmpty()) {
            item(key = "sh-conv") {
                SectionHeader("Conversations", count = result.conversations.size)
            }
            val hasMore = result.next_cursor != null
            itemsIndexed(
                result.conversations,
                key = { _, hit -> "sc:${hit.matched_message_id}" },
            ) { index, hit ->
                GroupedRow(
                    first = index == 0,
                    last = index == result.conversations.lastIndex && !hasMore,
                    // Jump to the MATCHED message, not just the thread — the
                    // route carries the id so the thread scrolls + flashes it.
                    onClick = { onOpenMessage(hit.id, hit.matched_message_id) },
                ) {
                    val name = hit.contact.name ?: formatPhone(hit.contact.phone_e164)
                    Row(
                        Modifier
                            .fillMaxWidth()
                            .padding(horizontal = 15.dp, vertical = 12.dp),
                        verticalAlignment = Alignment.Top,
                    ) {
                        SearchAvatar(name, size = 40.dp)
                        Spacer(Modifier.width(11.dp))
                        Column(Modifier.weight(1f)) {
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                Text(
                                    name,
                                    style = MaterialTheme.typography.titleSmall.copy(
                                        fontSize = 13.5.sp,
                                    ),
                                    maxLines = 1,
                                    overflow = TextOverflow.Ellipsis,
                                    modifier = Modifier.weight(1f),
                                )
                                Spacer(Modifier.width(8.dp))
                                Text(
                                    relativeTime(hit.matched_at),
                                    style = MaterialTheme.typography.labelSmall.copy(
                                        fontSize = 11.sp,
                                    ),
                                    color = MaterialTheme.colorScheme.onSurfaceVariant
                                        .copy(alpha = 0.7f),
                                )
                            }
                            val snippet = highlightSnippet(hit.snippet)
                            Text(
                                buildAnnotatedString {
                                    if (hit.direction == "note") append("Note · ")
                                    append(snippet)
                                },
                                style = MaterialTheme.typography.bodySmall.copy(fontSize = 12.sp),
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                                maxLines = 2,
                                overflow = TextOverflow.Ellipsis,
                                modifier = Modifier.padding(top = 2.dp),
                            )
                        }
                    }
                }
            }
            if (hasMore) {
                item(key = "sh-more") {
                    GroupedRow(
                        first = result.conversations.isEmpty(),
                        last = true,
                        onClick = { controller.searchMore() },
                    ) {
                        Text(
                            if (controller.searchLoadingMore) "Loading…" else "More results",
                            style = MaterialTheme.typography.labelLarge.copy(
                                fontWeight = FontWeight.SemiBold,
                            ),
                            color = MaterialTheme.colorScheme.secondary,
                            modifier = Modifier.padding(horizontal = 15.dp, vertical = 13.dp),
                        )
                    }
                }
            }
            item(key = "sh-conv-gap") { Spacer(Modifier.height(13.dp)) }
        }

        if (showTasks && result.tasks.isNotEmpty()) {
            item(key = "sh-tasks") {
                SectionHeader("Tasks", count = result.tasks.size)
                PaperCard {
                    result.tasks.forEachIndexed { index, task ->
                        Row(
                            Modifier
                                .fillMaxWidth()
                                .clickable { onOpenTask(task.id) }
                                .padding(horizontal = 15.dp, vertical = 12.dp),
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            TaskRing(done = task.done)
                            Spacer(Modifier.width(11.dp))
                            Column(Modifier.weight(1f)) {
                                Text(
                                    task.title,
                                    style = MaterialTheme.typography.titleSmall.copy(
                                        fontSize = 13.sp,
                                    ),
                                    maxLines = 1,
                                    overflow = TextOverflow.Ellipsis,
                                )
                                Text(
                                    if (task.done) "Done" else "Open task",
                                    style = MaterialTheme.typography.labelSmall.copy(
                                        fontSize = 11.sp,
                                    ),
                                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                                    modifier = Modifier.padding(top = 1.dp),
                                )
                            }
                        }
                        if (index != result.tasks.lastIndex) RowDivider()
                    }
                }
                Spacer(Modifier.height(13.dp))
            }
        }

        if (showContacts && result.contacts.isNotEmpty()) {
            item(key = "sh-contacts") {
                SectionHeader("Contacts", count = result.contacts.size)
                PaperCard {
                    result.contacts.forEachIndexed { index, contact ->
                        SearchContactRow(contact, onClick = { onTextContact(contact.id) })
                        if (index != result.contacts.lastIndex) RowDivider()
                    }
                }
                Spacer(Modifier.height(13.dp))
            }
        }

        if (showExtras && result.attachments.isNotEmpty()) {
            item(key = "sh-att") {
                SectionHeader("Attachments", count = result.attachments.size)
                PaperCard {
                    result.attachments.forEachIndexed { index, hit ->
                        Column(
                            Modifier
                                .fillMaxWidth()
                                .let { base ->
                                    val convId = hit.conversation_id
                                    if (convId != null) base.clickable { onOpen(convId) }
                                    else base
                                }
                                .padding(horizontal = 15.dp, vertical = 12.dp),
                        ) {
                            Text(
                                hit.file_name,
                                style = MaterialTheme.typography.titleSmall.copy(fontSize = 13.sp),
                                maxLines = 1,
                                overflow = TextOverflow.Ellipsis,
                            )
                            Text(
                                relativeTime(hit.created_at),
                                style = MaterialTheme.typography.labelSmall.copy(fontSize = 11.sp),
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                                modifier = Modifier.padding(top = 1.dp),
                            )
                        }
                        if (index != result.attachments.lastIndex) RowDivider()
                    }
                }
                Spacer(Modifier.height(13.dp))
            }
        }

        if (showExtras && result.templates.isNotEmpty()) {
            item(key = "sh-templates") {
                SectionHeader("Saved replies", count = result.templates.size)
                PaperCard {
                    result.templates.forEachIndexed { index, hit ->
                        Column(
                            Modifier
                                .fillMaxWidth()
                                .padding(horizontal = 15.dp, vertical = 12.dp),
                        ) {
                            Text(
                                hit.name,
                                style = MaterialTheme.typography.titleSmall.copy(fontSize = 13.sp),
                                maxLines = 1,
                                overflow = TextOverflow.Ellipsis,
                            )
                            Text(
                                highlightSnippet(hit.snippet),
                                style = MaterialTheme.typography.bodySmall.copy(fontSize = 12.sp),
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                                maxLines = 2,
                                overflow = TextOverflow.Ellipsis,
                                modifier = Modifier.padding(top = 2.dp),
                            )
                        }
                        if (index != result.templates.lastIndex) RowDivider()
                    }
                }
            }
        }
    }
}

/** 38–40dp squircle initials avatar on the inset tint (spec 00). */
@Composable
private fun SearchAvatar(name: String, size: androidx.compose.ui.unit.Dp) {
    Box(
        Modifier
            .size(size)
            .background(
                MaterialTheme.colorScheme.surfaceContainerHigh,
                RoundedCornerShape(14.dp),
            ),
        contentAlignment = Alignment.Center,
    ) {
        Text(
            initialsOf(name),
            style = MaterialTheme.typography.labelLarge.copy(
                fontSize = 12.sp,
                fontWeight = FontWeight.SemiBold,
            ),
            color = MaterialTheme.colorScheme.onSurface,
        )
    }
}

/** 22dp outline ring; done = lime fill + check (spec 00 task rows). */
@Composable
private fun TaskRing(done: Boolean) {
    val ring = Modifier.size(22.dp)
    if (done) {
        Box(
            ring.background(MaterialTheme.colorScheme.tertiary, CircleShape),
            contentAlignment = Alignment.Center,
        ) {
            Icon(
                Icons.Outlined.Check,
                contentDescription = "Done",
                tint = MaterialTheme.colorScheme.onTertiary,
                modifier = Modifier.size(13.dp),
            )
        }
    } else {
        Box(ring.border(1.8.dp, MaterialTheme.colorScheme.outline, CircleShape))
    }
}

@Composable
private fun SearchContactRow(contact: ContactSummary, onClick: () -> Unit) {
    val name = contact.name ?: formatPhone(contact.phone_e164)
    Row(
        Modifier
            .fillMaxWidth()
            .clickable(onClick = onClick)
            .padding(horizontal = 15.dp, vertical = 11.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        SearchAvatar(name, size = 38.dp)
        Spacer(Modifier.width(11.dp))
        Column(Modifier.weight(1f)) {
            Text(
                name,
                style = MaterialTheme.typography.titleSmall.copy(fontSize = 13.5.sp),
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            Text(
                formatPhone(contact.phone_e164),
                style = MaterialTheme.typography.labelSmall.copy(fontSize = 11.5.sp),
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.padding(top = 1.dp),
            )
        }
        Spacer(Modifier.width(8.dp))
        Box(
            Modifier
                .size(34.dp)
                .background(MaterialTheme.colorScheme.surfaceContainer, CircleShape),
            contentAlignment = Alignment.Center,
        ) {
            Icon(
                Icons.AutoMirrored.Outlined.Chat,
                contentDescription = "Text ${contact.name ?: "contact"}",
                tint = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.size(15.dp),
            )
        }
    }
}
