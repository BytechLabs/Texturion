package com.loonext.android.features.inbox

import androidx.activity.compose.BackHandler
import androidx.compose.animation.AnimatedContent
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.combinedClickable
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
import androidx.compose.material.icons.outlined.AttachFile
import androidx.compose.material.icons.outlined.Check
import androidx.compose.material.icons.outlined.WarningAmber
import androidx.compose.material.icons.outlined.Close
import androidx.compose.material.icons.outlined.MarkEmailRead
import androidx.compose.material.icons.outlined.MarkEmailUnread
import androidx.compose.material.icons.outlined.Search
import androidx.compose.material.icons.outlined.Tune
import com.loonext.android.core.model.Capability
import com.loonext.android.core.model.MemberRole
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Checkbox
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.OutlinedTextField
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
import androidx.compose.ui.semantics.CustomAccessibilityAction
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.customActions
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
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
import com.loonext.android.core.snooze.isSnoozed
import com.loonext.android.core.snooze.snoozeReturnLabel
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
import com.loonext.android.features.compose.attachmentLabel
import com.loonext.android.features.compose.mmsKindFromName
import androidx.compose.material.icons.outlined.MoreVert
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.IconButton
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.TextButton

// #280: internal rather than file-private so SavedViews.kt can translate a
// stored view into a tab selection. Same module, same package.
internal enum class InboxStatusTab(val label: String) {
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
    /**
     * #293: the Snoozed view. Same shape as [spamOnly] — a population hidden
     * from the default list, revealed by one chip — because that pattern
     * already exists here and a second invention of it is how two hidden
     * populations end up behaving differently.
     */
    var snoozedOnly by mutableStateOf(false)
        private set

    /**
     * #280 — the member's saved views, which one they land on, and the bounded
     * badges. Loaded alongside the other supporting lists: the inbox must paint
     * whether or not this request has landed, so nothing here gates the list.
     */
    var savedViews by mutableStateOf<List<SavedView>>(emptyList())
        private set
    var defaultViewId by mutableStateOf<String?>(null)
        private set
    var viewCounts by mutableStateOf<Map<String, Int>>(emptyMap())
        private set

    var state by mutableStateOf<LoadState<Unit>>(LoadState.Loading)
        private set
    var rows by mutableStateOf<List<ConversationListItem>>(emptyList())
        private set
    var pinnedRows by mutableStateOf<List<ConversationListItem>>(emptyList())
        private set
    var cursor by mutableStateOf<String?>(null)
        private set
    /**
     * #275: whether another page exists. The escalation to "all matching this
     * filter" is only offered when it would reach MORE than what is on screen —
     * otherwise it is the same set with a bigger-sounding name.
     */
    val hasMorePages: Boolean get() = cursor != null

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
                tag == null && !unreadOnly && !spamOnly && !snoozedOnly
            if (isDefault) return "default"
            return buildString {
                append(tab.name.lowercase())
                assigneeId?.let { append("/a=").append(it) }
                tag?.let { append("/t=").append(it.id) }
                if (unreadOnly) append("/unread")
                if (spamOnly) append("/spam")
                if (snoozedOnly) append("/snoozed")
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
        get() = assignee != null || tag != null || unreadOnly || spamOnly ||
            snoozedOnly

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

    fun toggleSnoozed() {
        snoozedOnly = !snoozedOnly
        showPane()
    }

    /** One reload for the sheet's Reset (not four chained ones). */
    fun resetFilters() {
        if (!hasFilterChips) return
        assignee = null
        tag = null
        unreadOnly = false
        spamOnly = false
        snoozedOnly = false
        showPane()
    }

    // --- #280 saved views -------------------------------------------------

    /** The arrangement currently on screen, in the shape a view stores. */
    internal val currentSelection: ViewSelection
        get() = ViewSelection(
            tab = tab,
            assigneeUserId = if (tab == InboxStatusTab.Mine) null else assignee?.user_id,
            assignedToMe = tab == InboxStatusTab.Mine,
            tagId = tag?.id,
            unreadOnly = unreadOnly,
            spamOnly = spamOnly,
            snoozedOnly = snoozedOnly,
        )

    /**
     * Apply a saved view: every control at once, then ONE reload.
     *
     * Setting them one at a time would fire a request per filter and leave the
     * list flickering through arrangements nobody asked for.
     */
    fun applyView(view: SavedView) {
        val selection = viewToSelection(view.filters)
        tab = selection.tab
        assignee = selection.assigneeUserId?.let { id -> members.find { it.user_id == id } }
        tag = selection.tagId?.let { id -> allTags.find { it.id == id } }
        unreadOnly = selection.unreadOnly
        spamOnly = selection.spamOnly
        snoozedOnly = selection.snoozedOnly
        showPane()
    }

    fun loadSavedViews(landIfUntouched: Boolean = false) {
        scope.launch {
            runCatching { repo.savedViews(companyId) }.onSuccess { page ->
                savedViews = page.data
                defaultViewId = page.defaults.conversations
                // Land on the chosen view only from an untouched inbox. Somebody
                // who has already filtered has said what they want to see, and a
                // default that overrode that would be a screen that argues.
                if (landIfUntouched && !hasFilterChips && tab == InboxStatusTab.Open) {
                    page.data.find { it.id == page.defaults.conversations }?.let(::applyView)
                }
                loadViewCounts()
            }
        }
    }

    private fun loadViewCounts() {
        val ids = savedViews.map { it.id }.take(SAVED_VIEW_COUNT_MAX_VIEWS)
        if (ids.isEmpty()) return
        scope.launch {
            runCatching { repo.savedViewCounts(companyId, ids) }
                .onSuccess { viewCounts = it.counts }
        }
    }

    fun saveCurrentView(name: String, shared: Boolean, onDone: (String?) -> Unit) {
        scope.launch {
            runCatching {
                repo.createSavedView(
                    companyId = companyId,
                    name = name.trim(),
                    filters = selectionToView(currentSelection),
                    shared = shared,
                )
            }.onSuccess {
                loadSavedViews()
                onDone(null)
            }.onFailure { onDone(it.message ?: "Could not save that view.") }
        }
    }

    fun renameView(id: String, name: String) {
        scope.launch {
            runCatching { repo.renameSavedView(companyId, id, name.trim()) }
                .onSuccess { loadSavedViews() }
        }
    }

    fun deleteView(id: String) {
        scope.launch {
            runCatching { repo.deleteSavedView(companyId, id) }.onSuccess { loadSavedViews() }
        }
    }

    fun setDefaultView(id: String?) {
        scope.launch {
            runCatching { repo.setDefaultSavedView(companyId, id) }
                .onSuccess { defaultViewId = id }
        }
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
            // #293: same for deferrals. Null leaves the field off entirely,
            // which IS the server's hide-them default — sending "exclude"
            // would say the same thing twice.
            snoozed = if (snoozedOnly) "only" else null,
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
        // #280: the landing view is only applied on this first load, so a later
        // refresh never yanks somebody out of what they are looking at.
        loadSavedViews(landIfUntouched = true)
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

    // ---------------------------------------------------------------------
    // #275 multi-select. `selection` is either the ids the user pointed at or the
    // filter-wide mode the SERVER resolves — see BulkSelection.kt for why those
    // are different things and why the bar never shows a number it was not told.
    // ---------------------------------------------------------------------
    var selection by mutableStateOf(BulkSelection.EMPTY)
        private set
    var bulkRunning by mutableStateOf(false)
        private set

    fun toggleSelected(conversationId: String) {
        selection = selection.toggleRow(conversationId, rows.map { it.id })
    }

    fun selectAllLoaded() {
        selection = selectLoaded(rows.map { it.id })
    }

    fun selectAllMatchingFilter() {
        selection = BulkSelection.Filter
    }

    fun clearSelection() {
        selection = BulkSelection.EMPTY
    }

    /**
     * Run one bulk action over the current selection, then say what actually
     * happened.
     *
     * The message comes from the RESPONSE, never from the selection: those two
     * differ whenever a row was on a denied number, already gone, or past the cap,
     * and #275 requires that difference be named rather than swallowed.
     *
     * mark_read carries no undo — "unread" is the absence of a read receipt, and
     * nobody asks to un-read three hundred threads. The reversible actions offer
     * one Undo for the whole operation, replaying the server's own prior values.
     */
    fun runBulk(
        action: String,
        verb: String,
        targetStatus: String? = null,
        targetSpam: Boolean? = null,
        targetUserId: String? = null,
        unassign: Boolean = false,
    ) {
        val ids = selection.idsOrNull()
        // Filter mode sends the tab's own status so "everything matching" means the
        // set the user is looking at, not every conversation in the company.
        val filterStatus = if (ids == null) statusFilterForBulk() else null
        scope.launch {
            bulkRunning = true
            try {
                val result = repo.bulkConversations(
                    companyId = companyId,
                    action = action,
                    ids = ids,
                    filterStatus = filterStatus,
                    targetStatus = targetStatus,
                    targetSpam = targetSpam,
                    targetUserId = targetUserId,
                    unassign = unassign,
                )
                clearSelection()
                scheduleRealtimeRefresh()
                val message = bulkResultMessage(
                    verb = verb,
                    applied = result.applied.size,
                    failed = result.failed.size,
                    matched = result.matched,
                    capped = result.capped,
                )
                val undo = bulkUndoPlan(result)
                if (undo == null) {
                    notify(message)
                } else {
                    notify(message, actionLabel = "Undo") { runUndo(undo) }
                }
            } catch (cause: Exception) {
                notify(cause.userMessage())
            } finally {
                bulkRunning = false
            }
        }
    }

    /** Replay a plan's groups back, then re-read the page. No toast for an undo. */
    private fun runUndo(plan: List<BulkUndoGroup>) {
        scope.launch {
            try {
                for (group in plan) {
                    repo.bulkConversations(
                        companyId = companyId,
                        action = group.action,
                        ids = group.ids,
                        targetStatus = group.targetStatus,
                        targetSpam = group.targetSpam,
                        targetUserId = group.targetUserId,
                        unassign = group.unassign,
                    )
                }
                scheduleRealtimeRefresh()
            } catch (cause: Exception) {
                notify(cause.userMessage())
            }
        }
    }

    /** The status the current tab is showing, for filter-mode bulk calls. */
    private fun statusFilterForBulk(): String? = when (tab) {
        InboxStatusTab.Closed -> ConversationStatus.CLOSED
        else -> null
    }

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
        // The optimistic flip must be ROLLED BACK when the server refuses it.
        // runCatching swallowed the failure, so the dot stayed flipped while the
        // server still disagreed — the next revalidation silently flipped it
        // back, and the user was never told the action failed. Mirrors
        // toggleStatus's notify-on-failure below.
        if (row.unread) {
            markLocallyRead(row.id)
            scope.launch {
                try {
                    repo.markRead(companyId, row.id)
                } catch (cause: Exception) {
                    markLocallyUnread(row.id)
                    notify(cause.userMessage())
                }
            }
        } else {
            markLocallyUnread(row.id)
            scope.launch {
                try {
                    repo.markUnread(companyId, row.id)
                } catch (cause: Exception) {
                    markLocallyRead(row.id)
                    notify(cause.userMessage())
                }
            }
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
                    // #295: revert to the status the row ACTUALLY had, not a
                    // hardcoded OPEN. A conversation swiped away while it was
                    // `new` or `waiting` used to come back as `open`, quietly
                    // losing the fact that nobody had replied to it yet, which
                    // is the entire distinction those statuses carry.
                    notify("Conversation closed", actionLabel = "Undo") {
                        reopen(row.id, row.status)
                    }
                } else {
                    notify("Conversation reopened")
                }
            } catch (cause: Exception) {
                notify(cause.userMessage())
            }
        }
    }

    /** The Undo leg of a swipe-close: back to the status the row actually had. */
    private fun reopen(
        conversationId: String,
        previous: String = ConversationStatus.OPEN,
    ) {
        val target =
            if (previous == ConversationStatus.CLOSED) ConversationStatus.OPEN else previous
        scope.launch {
            try {
                repo.setStatus(companyId, conversationId, target)
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
                SavedViewsRow(
                    controller = controller,
                    // Sharing a view is workspace configuration, so it rides
                    // the same capability the server gates it on.
                    canShare = MemberRole.has(
                        me.memberships.firstOrNull { it.company_id == companyId }?.role,
                        Capability.SETTINGS_MANAGE,
                    ),
                )
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
    /**
     * #280: a saved view's own actions. Null for the status pills, which have
     * none, so a long press there stays the no-op it has always been.
     */
    onLongClick: (() -> Unit)? = null,
) {
    val solid = selected && !outlined
    val haptics = rememberHaptics()
    Surface(
        modifier = if (onLongClick == null) {
            Modifier
        } else {
            Modifier.combinedClickable(
                onClick = {
                    haptics.tap()
                    onClick()
                },
                onLongClick = {
                    haptics.tick()
                    onLongClick()
                },
            )
        },
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
    /** #275: long-press enters selection mode. Null on rows that cannot be selected. */
    onLongClick: (() -> Unit)? = null,
    /** #275: Material's selection treatment — a tinted card, not a checkbox column. */
    selected: Boolean = false,
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
            .background(
                if (selected) MaterialTheme.colorScheme.secondaryContainer
                else MaterialTheme.colorScheme.surface,
            )
            .let {
                when {
                    onClick != null && onLongClick != null ->
                        it.combinedClickable(onClick = onClick, onLongClick = onLongClick)
                    onClick != null -> it.clickable(onClick = onClick)
                    else -> it
                }
            },
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

    val selecting = !controller.selection.isEmpty()
    val membersById = controller.members.associateBy { it.user_id }
    fun assigneeName(row: ConversationListItem): String? =
        row.assigned_user_id?.let { userId ->
            if (userId == meUserId) {
                "You"
            } else {
                membersById[userId]?.display_name?.ifBlank { "Teammate" }
            }
        }

    Column(Modifier.fillMaxSize()) {
    // #275: only while something is selected, and above the list so ticking a row
    // does not shove the list under the thumb.
    if (selecting) {
        BulkSelectionBar(controller = controller)
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
                    onClick = {
                        if (selecting) controller.toggleSelected(row.id) else onOpen(row.id)
                    },
                    onLongClick = { controller.toggleSelected(row.id) },
                    selected = controller.selection.isRowSelected(row.id),
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
                // #275: in selection mode a tap toggles rather than opens. That is
                // the Android convention and it is also the only workable one — a
                // long-press to start and then taps to continue, rather than
                // long-pressing every row.
                onClick = {
                    if (selecting) controller.toggleSelected(row.id) else onOpen(row.id)
                },
                onLongClick = { controller.toggleSelected(row.id) },
                selected = controller.selection.isRowSelected(row.id),
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
        // #185 says a swipe is a shortcut, never the ONLY path — but marking a
        // conversation UNREAD had no other path at all (opening the thread only
        // ever clears the dot), so it was unreachable for anyone who cannot
        // perform the drag. Exposing both as accessibility custom actions puts
        // them in TalkBack's actions menu without changing the visual row.
        modifier = Modifier.semantics {
            customActions = listOf(
                CustomAccessibilityAction(
                    if (row.unread) "Mark read" else "Mark unread",
                ) { controller.toggleRead(row); true },
                CustomAccessibilityAction(
                    if (closed) "Reopen conversation" else "Close conversation",
                ) { controller.toggleStatus(row); true },
            )
        },
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

/**
 * #414: the one row state worth breaking the row's own visual rhythm for.
 *
 * A fourth quiet icon beside the attachment clip and the unread dot would
 * blend into that rhythm, which is the opposite of what this state needs — the
 * whole point is to be found at a glance, at 11pm, by someone a push
 * notification just woke.
 */
@Composable
private fun UrgentBadge() {
    Row(
        Modifier
            .background(
                MaterialTheme.colorScheme.errorContainer,
                RoundedCornerShape(999.dp),
            )
            .padding(horizontal = 6.dp, vertical = 2.dp)
            .semantics { contentDescription = "Urgent" },
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(
            Icons.Outlined.WarningAmber,
            contentDescription = null,
            tint = MaterialTheme.colorScheme.onErrorContainer,
            modifier = Modifier.size(11.dp),
        )
        Spacer(Modifier.width(3.dp))
        Text(
            "URGENT",
            style = MaterialTheme.typography.labelSmall.copy(
                fontSize = 9.5.sp,
                fontWeight = FontWeight.SemiBold,
                letterSpacing = 0.4.sp,
            ),
            color = MaterialTheme.colorScheme.onErrorContainer,
        )
    }
}

@Composable
private fun ConversationRow(row: ConversationListItem, assigneeName: String?) {
    val name = row.contact.name ?: formatPhone(row.contact.phone_e164)
    Row(
        Modifier
            .fillMaxWidth()
            // Unread was carried ONLY by the coral dot, so TalkBack read a read
            // and an unread conversation identically — the single most important
            // piece of state on the inbox row was invisible to screen readers.
            .semantics { stateDescription = if (row.unread) "Unread" else "Read" }
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
                // #414 ask 2 — "visibly flagged in the inbox". Flagged until
                // the crew CLOSES the thread: closing is the product's
                // existing word for "handled", so nothing here invents a
                // second notion of resolved or lets a timer quietly decide an
                // emergency stopped mattering.
                if (row.emergency_at != null && row.closed_at == null) {
                    Spacer(Modifier.width(6.dp))
                    UrgentBadge()
                }
                Spacer(Modifier.width(8.dp))
                Text(
                    relativeTime(row.last_message_at),
                    style = MaterialTheme.typography.labelSmall.copy(fontSize = 11.sp),
                    color = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.7f),
                )
            }
            val snippet = row.last_message?.let { last ->
                // Name what actually arrived: a voice message is not a "Photo",
                // which is what this row used to call every attachment.
                val body = if (last.body.isBlank() && last.has_attachments) {
                    attachmentLabel(
                        mmsKindFromName(last.attachment_kind),
                        last.attachment_count ?: 1,
                    )
                } else {
                    last.body
                }
                when (last.direction) {
                    "note" -> "Note · $body"
                    // Whose turn it is, at a glance: without this a row you
                    // already answered looks exactly like one still waiting.
                    "outbound" -> "You: $body"
                    else -> body
                }
            }.orEmpty()
            // A message carrying media reads differently at a glance from one
            // that is only text. The clip shows whenever there is an attachment,
            // including alongside a caption, where the label alone would not
            // appear at all.
            Row(
                Modifier.padding(top = 2.dp),
                horizontalArrangement = Arrangement.spacedBy(4.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                if (row.last_message?.has_attachments == true) {
                    Icon(
                        Icons.Outlined.AttachFile,
                        contentDescription = null,
                        tint = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.7f),
                        modifier = Modifier.size(13.dp),
                    )
                }
                Text(
                    snippet,
                    style = MaterialTheme.typography.bodySmall.copy(fontSize = 12.sp),
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
            }
            // #293: only in the Snoozed view does this row normally exist —
            // but it also survives a mid-session return, and a row that came
            // back with no explanation is what makes people stop trusting the
            // list. The return time IS its reason for being here, so it leads.
            val snoozeLabel = row.snoozed_until
                ?.takeIf { isSnoozed(it) }
                ?.let { until ->
                    // The reason, when one was left. "Waiting on the supplier"
                    // three days later is the difference between a list you can
                    // read and a list of names.
                    val back = snoozeReturnLabel(until)
                    row.snooze_note?.takeIf { it.isNotBlank() }
                        ?.let { "$back · $it" } ?: back
                }
            if (row.tags.isNotEmpty() || row.is_spam || assigneeName != null ||
                snoozeLabel != null
            ) {
                Row(
                    Modifier.padding(top = 6.dp),
                    horizontalArrangement = Arrangement.spacedBy(6.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    if (snoozeLabel != null) {
                        DsChip(
                            snoozeLabel,
                            container = MaterialTheme.colorScheme.surfaceContainerHigh,
                            content = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
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
            // #293: the way back to what you deferred. A snooze that hid a
            // thread with no way to find it would be worse than the clutter it
            // solved, and this sheet is where every other hidden population in
            // the inbox already lives.
            ToggleCard(
                label = "Snoozed only",
                checked = controller.snoozedOnly,
                onToggle = { controller.toggleSnoozed() },
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
        (!showExtras || (result.attachments.isEmpty() && result.templates.isEmpty() &&
            result.voicemails.isEmpty()))
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

        // #409: the words somebody SPOKE. Above saved replies because a
        // customer's voice outranks our own copy when both match.
        //
        // NOT TAPPABLE, and that is a deliberate call rather than an omission.
        // #336 gave a call a permalink on WEB; the phones have no call-detail
        // screen to open, and routing a tap to the calls tab would drop the
        // reader in a list to scroll — most of the way back to the problem
        // this arm exists to solve. The snippet already answers the question
        // somebody is actually asking ("what did that guy say about the boiler
        // on Elm Street"), so the row earns its place unlinked. A row that
        // looks tappable and lands nowhere useful is worse than one that
        // does not.
        if (showExtras && result.voicemails.isNotEmpty()) {
            item(key = "sh-voicemails") {
                SectionHeader("Voicemails", count = result.voicemails.size)
                PaperCard {
                    result.voicemails.forEachIndexed { index, hit ->
                        Column(
                            Modifier
                                .fillMaxWidth()
                                .padding(horizontal = 15.dp, vertical = 12.dp),
                        ) {
                            Text(
                                hit.caller_e164?.let { formatPhone(it) } ?: "Voicemail",
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
                        if (index != result.voicemails.lastIndex) RowDivider()
                    }
                }
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

/**
 * #275 — the selection bar, shown only while something is selected.
 *
 * DESIGN NOTES, matching the web twin's reasoning rather than its pixels.
 *
 * *The count is never invented.* In filter mode the label reads "All matching this
 * filter" with no number in it, because the client does not know the number — the
 * server counts the set when it runs the action. A confident "340 selected" that
 * acts on the paged rows is the trap #275 names, and `BulkSelection.label()` owns
 * that rule for both clients.
 *
 * *Progressive disclosure.* Long-press one row, then "Select all N loaded", then —
 * only if more pages exist — "Select all matching this filter". Each step says
 * what it will do.
 *
 * *Three actions, then a menu.* Mark read, Close and Spam are the ones #275's own
 * scenarios name (back from a week off; a robotext blast). Assign lives behind the
 * overflow. A row of six icons on a phone is a menu that forgot to collapse.
 *
 * There is no send action here and nothing to add one to: bulk management only.
 */
@Composable
private fun BulkSelectionBar(controller: InboxController) {
    val selection = controller.selection
    val loadedIds = controller.rows.map { it.id }
    val running = controller.bulkRunning
    var menuOpen by remember { mutableStateOf(false) }
    val showSelectLoaded = selection is BulkSelection.Ids &&
        loadedIds.isNotEmpty() &&
        !loadedIds.all { it in selection.ids }

    Surface(color = MaterialTheme.colorScheme.secondaryContainer) {
        Column(Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 8.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                IconButton(
                    onClick = { controller.clearSelection() },
                    enabled = !running,
                ) {
                    Icon(Icons.Outlined.Close, contentDescription = "Clear selection")
                }
                Text(
                    selection.label(),
                    style = MaterialTheme.typography.titleSmall,
                    color = MaterialTheme.colorScheme.onSecondaryContainer,
                )
                Spacer(Modifier.weight(1f))
                if (running) LoadingIndicator()
                Box {
                    IconButton(onClick = { menuOpen = true }, enabled = !running) {
                        Icon(Icons.Outlined.MoreVert, contentDescription = "More bulk actions")
                    }
                    DropdownMenu(expanded = menuOpen, onDismissRequest = { menuOpen = false }) {
                        for (member in controller.members) {
                            DropdownMenuItem(
                                text = {
                                    Text("Assign to ${member.display_name.ifBlank { "Teammate" }}")
                                },
                                onClick = {
                                    menuOpen = false
                                    controller.runBulk(
                                        action = "assign",
                                        verb = "Assigned",
                                        targetUserId = member.user_id,
                                    )
                                },
                            )
                        }
                        DropdownMenuItem(
                            text = { Text("Unassign") },
                            onClick = {
                                menuOpen = false
                                controller.runBulk(
                                    action = "assign",
                                    verb = "Unassigned",
                                    unassign = true,
                                )
                            },
                        )
                    }
                }
            }

            // The escalation ladder: the page first, then the filter. Never one
            // "select all" that quietly means whichever of the two it feels like.
            if (showSelectLoaded) {
                TextButton(
                    onClick = { controller.selectAllLoaded() },
                    enabled = !running,
                ) { Text("Select all ${loadedIds.size} loaded") }
            }
            if (selection.canEscalate(loadedIds, hasMore = controller.hasMorePages)) {
                TextButton(
                    onClick = { controller.selectAllMatchingFilter() },
                    enabled = !running,
                ) { Text("Select all matching this filter") }
            }

            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                OutlinedButton(
                    onClick = { controller.runBulk("mark_read", "Marked read") },
                    enabled = !running,
                ) { Text("Mark read") }
                OutlinedButton(
                    onClick = {
                        controller.runBulk(
                            action = "set_status",
                            verb = "Closed",
                            targetStatus = ConversationStatus.CLOSED,
                        )
                    },
                    enabled = !running,
                ) { Text("Close") }
                OutlinedButton(
                    onClick = {
                        controller.runBulk(
                            action = "set_spam",
                            verb = "Marked as spam",
                            targetSpam = true,
                        )
                    },
                    enabled = !running,
                ) { Text("Spam") }
            }
        }
    }
}


// ---------------------------------------------------------------------------
// #280 saved views
// ---------------------------------------------------------------------------

/**
 * The row of saved views, and the one affordance for keeping the arrangement on
 * screen.
 *
 * Applying: the Safety Principle (a horizontal strip of named queries directly
 * under the status pills is where saved views live in every product that has
 * them), Zen of Clarity (per-view actions are a long-press menu rather than
 * three controls crowded onto a pill), Chunking (its own band, spaced away from
 * the pills above and the list below), and Smart Defaults (the save sheet opens
 * with a name already derived from the filters, because typing one is the whole
 * friction between arranging a useful screen and keeping it).
 *
 * The row is absent until a view exists. A permanent empty rail on the busiest
 * screen in the product would be an advertisement, and the save affordance sits
 * where the arrangement being kept actually is.
 */
@Composable
private fun SavedViewsRow(controller: InboxController, canShare: Boolean) {
    var saveOpen by remember { mutableStateOf(false) }
    var menuFor by remember { mutableStateOf<SavedView?>(null) }
    val selection = controller.currentSelection

    Spacer(Modifier.height(10.dp))
    Row(
        Modifier
            .fillMaxWidth()
            .horizontalScroll(rememberScrollState()),
        horizontalArrangement = Arrangement.spacedBy(7.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        controller.savedViews.forEach { view ->
            val count = controller.viewCounts[view.id] ?: 0
            val label = if (count > 0) view.name + "  " + formatViewCount(count) else view.name
            FilterPill(
                text = label,
                selected = viewMatchesSelection(view.filters, selection),
                onClick = { controller.applyView(view) },
                onLongClick = { menuFor = view },
            )
        }
        TextButton(onClick = { saveOpen = true }) {
            Text(
                if (controller.savedViews.isEmpty()) "Save this view" else "Save",
                style = MaterialTheme.typography.labelLarge,
            )
        }
    }

    if (saveOpen) {
        SaveViewSheet(
            controller = controller,
            canShare = canShare,
            onDismiss = { saveOpen = false },
        )
    }
    menuFor?.let { view ->
        SavedViewMenu(
            view = view,
            isDefault = view.id == controller.defaultViewId,
            canManage = !view.shared || canShare,
            controller = controller,
            onDismiss = { menuFor = null },
        )
    }
}

@Composable
private fun SaveViewSheet(
    controller: InboxController,
    canShare: Boolean,
    onDismiss: () -> Unit,
) {
    // Smart Defaults: never an empty field. The person already said what the
    // view is by building it, and "Open . Unread" beats what most would type.
    var name by remember {
        mutableStateOf(
            suggestViewName(
                controller.currentSelection,
                assignee = controller.assignee,
                tag = controller.tag,
            ),
        )
    }
    var shared by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    var saving by remember { mutableStateOf(false) }

    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Save this view") },
        text = {
            Column {
                Text(
                    "The filters you have on now, under a name, one tap away tomorrow.",
                    style = MaterialTheme.typography.bodyMedium,
                )
                Spacer(Modifier.height(12.dp))
                OutlinedTextField(
                    value = name,
                    onValueChange = { if (it.length <= SAVED_VIEW_NAME_MAX) name = it },
                    label = { Text("Name") },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth(),
                )
                if (canShare) {
                    Spacer(Modifier.height(8.dp))
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Checkbox(checked = shared, onCheckedChange = { shared = it })
                        Spacer(Modifier.width(4.dp))
                        Text(
                            "Share it with the crew",
                            style = MaterialTheme.typography.bodyMedium,
                        )
                    }
                    Text(
                        "Everyone gets the same view, and each person sees only the numbers they already have access to.",
                        style = MaterialTheme.typography.bodySmall,
                    )
                }
                error?.let {
                    Spacer(Modifier.height(8.dp))
                    Text(it, style = MaterialTheme.typography.bodySmall)
                }
            }
        },
        confirmButton = {
            TextButton(
                enabled = name.isNotBlank() && !saving,
                onClick = {
                    saving = true
                    controller.saveCurrentView(name, shared) { failure ->
                        saving = false
                        if (failure == null) onDismiss() else error = failure
                    }
                },
            ) { Text(if (saving) "Saving" else "Save") }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Cancel") } },
    )
}

/**
 * Per-view actions.
 *
 * Ethical Friction applied only where it is earned: deleting your own view goes
 * immediately, because it is yours and rebuilding it is two taps. Deleting a
 * shared one removes a screen the rest of the crew opens every morning, and the
 * person doing it cannot see who that affects.
 */
@Composable
private fun SavedViewMenu(
    view: SavedView,
    isDefault: Boolean,
    canManage: Boolean,
    controller: InboxController,
    onDismiss: () -> Unit,
) {
    var confirmingDelete by remember { mutableStateOf(false) }
    var renaming by remember { mutableStateOf(false) }
    var draft by remember { mutableStateOf(view.name) }

    if (confirmingDelete) {
        AlertDialog(
            onDismissRequest = onDismiss,
            title = { Text("Delete this crew view?") },
            text = {
                Text(
                    "The whole crew uses " + view.name + ". Anyone who opens the app there will land on the ordinary inbox instead.",
                )
            },
            confirmButton = {
                TextButton(onClick = {
                    controller.deleteView(view.id)
                    onDismiss()
                }) { Text("Delete for everyone") }
            },
            dismissButton = { TextButton(onClick = onDismiss) { Text("Keep it") } },
        )
        return
    }

    if (renaming) {
        AlertDialog(
            onDismissRequest = onDismiss,
            title = { Text("Rename view") },
            text = {
                OutlinedTextField(
                    value = draft,
                    onValueChange = { if (it.length <= SAVED_VIEW_NAME_MAX) draft = it },
                    label = { Text("Name") },
                    singleLine = true,
                )
            },
            confirmButton = {
                TextButton(enabled = draft.isNotBlank(), onClick = {
                    controller.renameView(view.id, draft)
                    onDismiss()
                }) { Text("Save") }
            },
            dismissButton = { TextButton(onClick = onDismiss) { Text("Cancel") } },
        )
        return
    }

    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(view.name) },
        text = {
            Column {
                TextButton(onClick = {
                    controller.setDefaultView(if (isDefault) null else view.id)
                    onDismiss()
                }) {
                    Text(if (isDefault) "Stop opening here" else "Open here by default")
                }
                if (canManage) {
                    TextButton(onClick = { renaming = true }) { Text("Rename") }
                    TextButton(onClick = {
                        if (view.shared) {
                            confirmingDelete = true
                        } else {
                            controller.deleteView(view.id)
                            onDismiss()
                        }
                    }) { Text("Delete") }
                }
            }
        },
        confirmButton = { TextButton(onClick = onDismiss) { Text("Close") } },
    )
}
