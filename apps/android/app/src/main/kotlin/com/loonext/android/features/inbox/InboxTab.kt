package com.loonext.android.features.inbox

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.PushPin
import androidx.compose.material.icons.filled.Search
import androidx.compose.material3.FilterChip
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.LoadingIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.SegmentedButton
import androidx.compose.material3.SegmentedButtonDefaults
import androidx.compose.material3.SingleChoiceSegmentedButtonRow
import androidx.compose.material3.Text
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
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.loonext.android.AppGraph
import com.loonext.android.core.model.ConversationListItem
import com.loonext.android.core.model.Me
import com.loonext.android.core.model.Member
import com.loonext.android.core.model.SearchResult
import com.loonext.android.core.model.Tag
import com.loonext.android.features.compose.NewConversationScreen
import com.loonext.android.features.thread.MessagingRepository
import com.loonext.android.features.thread.ThreadScreen
import com.loonext.android.features.thread.appendPage
import com.loonext.android.features.thread.dropVanishedFromFirstWindow
import com.loonext.android.features.thread.mergeFirstPage
import com.loonext.android.ui.common.CenteredError
import com.loonext.android.ui.common.CenteredLoading
import com.loonext.android.ui.common.InitialsAvatar
import com.loonext.android.ui.common.LoadState
import com.loonext.android.ui.common.formatPhone
import com.loonext.android.ui.common.relativeTime
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
 * Inbox: pinned section + segmented Open|Mine|All|Closed + filter chips
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
    initialConversationId: String? = null,
    onViewedConversationChanged: ((conversationId: String?) -> Unit)? = null,
) {
    var openConversationId by rememberSaveable(companyId) {
        mutableStateOf(initialConversationId)
    }
    // Report the open thread (null = back on the list) so the shell's
    // inbound toast (#165) can suppress itself while its thread is on screen.
    LaunchedEffect(openConversationId) {
        onViewedConversationChanged?.invoke(openConversationId)
    }
    var composeOpen by rememberSaveable(companyId) { mutableStateOf(false) }
    var composeContactId by rememberSaveable(companyId) { mutableStateOf<String?>(null) }

    val openId = openConversationId
    when {
        openId != null -> ThreadScreen(
            graph = graph,
            companyId = companyId,
            me = me,
            conversationId = openId,
            onBack = { openConversationId = null },
            modifier = modifier,
            onOpenConversation = { openConversationId = it },
        )

        composeOpen -> NewConversationScreen(
            graph = graph,
            companyId = companyId,
            me = me,
            prefillContactId = composeContactId,
            onCreated = { conversationId ->
                composeOpen = false
                composeContactId = null
                openConversationId = conversationId
            },
            onBack = {
                composeOpen = false
                composeContactId = null
            },
            modifier = modifier,
        )

        else -> InboxList(
            graph = graph,
            companyId = companyId,
            me = me,
            onOpen = { openConversationId = it },
            onTextContact = { contactId ->
                composeContactId = contactId
                composeOpen = true
            },
            modifier = modifier,
        )
    }
}

// ---------------------------------------------------------------------------
// List state
// ---------------------------------------------------------------------------

@Stable
private class InboxController(
    private val repo: MessagingRepository,
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

    private var loadSeq = 0
    private var searchSeq = 0
    private var realtimeJob: Job? = null
    private var supportLoaded = false

    val hasFilterChips: Boolean
        get() = assignee != null || tag != null || unreadOnly || spamOnly

    fun selectTab(next: InboxStatusTab) {
        if (tab == next) return
        tab = next
        reload(showLoading = true)
    }

    fun setAssigneeFilter(member: Member?) {
        assignee = member
        reload(showLoading = true)
    }

    fun setTagFilter(next: Tag?) {
        tag = next
        reload(showLoading = true)
    }

    fun toggleUnread() {
        unreadOnly = !unreadOnly
        reload(showLoading = true)
    }

    fun toggleSpam() {
        spamOnly = !spamOnly
        reload(showLoading = true)
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
        if (state is LoadState.Ready) return
        reload(showLoading = true)
        loadSupportingLists()
    }

    private fun loadSupportingLists() {
        if (supportLoaded) return
        supportLoaded = true
        scope.launch { runCatching { members = repo.members(companyId).data } }
        scope.launch { runCatching { allTags = repo.tags(companyId).data } }
    }

    fun reload(showLoading: Boolean) {
        val seq = ++loadSeq
        if (showLoading) state = LoadState.Loading
        scope.launch {
            try {
                val page = fetchPage(cursor = null, pinned = "exclude")
                val pinnedPage = runCatching { fetchPage(null, pinned = "only") }
                if (seq != loadSeq) return@launch
                rows = page.data
                cursor = page.next_cursor
                pinnedRows = pinnedPage.getOrNull()?.data ?: emptyList()
                state = LoadState.Ready(Unit)
            } catch (cause: Exception) {
                if (seq == loadSeq) state = LoadState.Failed(cause.userMessage())
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
// List UI
// ---------------------------------------------------------------------------

@OptIn(FlowPreview::class)
@Composable
private fun InboxList(
    graph: AppGraph,
    companyId: String,
    me: Me,
    onOpen: (String) -> Unit,
    onTextContact: (String) -> Unit,
    modifier: Modifier = Modifier,
) {
    val repo = remember(graph) { MessagingRepository(graph.api) }
    val controller = remember(companyId) {
        InboxController(repo, companyId, me.user_id, graph.appScope)
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
    // Debounced search over the query field.
    LaunchedEffect(controller) {
        snapshotFlow { controller.query }
            .debounce(300)
            .distinctUntilChanged()
            .collect { controller.runSearch() }
    }

    var assigneeSheetOpen by remember { mutableStateOf(false) }
    var tagSheetOpen by remember { mutableStateOf(false) }

    Column(modifier.fillMaxSize()) {
        OutlinedTextField(
            value = controller.query,
            onValueChange = { controller.query = it.take(200) },
            placeholder = { Text("Search conversations, contacts, tasks…") },
            leadingIcon = { Icon(Icons.Filled.Search, contentDescription = null) },
            trailingIcon = {
                if (controller.query.isNotEmpty()) {
                    Icon(
                        Icons.Filled.Close,
                        contentDescription = "Clear search",
                        modifier = Modifier.clickable { controller.query = "" },
                    )
                }
            },
            singleLine = true,
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 16.dp, vertical = 8.dp),
        )

        if (controller.searching) {
            SearchResultsPane(
                controller = controller,
                onOpen = { id ->
                    controller.markLocallyRead(id)
                    onOpen(id)
                },
                onTextContact = onTextContact,
            )
            return@Column
        }

        SingleChoiceSegmentedButtonRow(
            Modifier
                .fillMaxWidth()
                .padding(horizontal = 16.dp, vertical = 4.dp),
        ) {
            InboxStatusTab.entries.forEachIndexed { index, item ->
                SegmentedButton(
                    selected = controller.tab == item,
                    onClick = { controller.selectTab(item) },
                    shape = SegmentedButtonDefaults.itemShape(
                        index = index,
                        count = InboxStatusTab.entries.size,
                    ),
                ) { Text(item.label) }
            }
        }

        FilterChipRow(
            controller = controller,
            onPickAssignee = { assigneeSheetOpen = true },
            onPickTag = { tagSheetOpen = true },
        )

        when (val current = controller.state) {
            is LoadState.Loading -> CenteredLoading()
            is LoadState.Failed -> CenteredError(
                current.message,
                onRetry = { controller.reload(showLoading = true) },
            )

            is LoadState.Ready -> ConversationListPane(
                controller = controller,
                onOpen = { id ->
                    controller.markLocallyRead(id)
                    onOpen(id)
                },
            )
        }
    }

    if (assigneeSheetOpen) {
        AssigneeFilterSheet(
            members = controller.members,
            meUserId = me.user_id,
            selected = controller.assignee,
            onPick = { member ->
                assigneeSheetOpen = false
                controller.setAssigneeFilter(member)
            },
            onDismiss = { assigneeSheetOpen = false },
        )
    }
    if (tagSheetOpen) {
        TagFilterSheet(
            tags = controller.allTags,
            selected = controller.tag,
            onPick = { tag ->
                tagSheetOpen = false
                controller.setTagFilter(tag)
            },
            onDismiss = { tagSheetOpen = false },
        )
    }
}

@Composable
private fun FilterChipRow(
    controller: InboxController,
    onPickAssignee: () -> Unit,
    onPickTag: () -> Unit,
) {
    Row(
        Modifier
            .fillMaxWidth()
            .horizontalScroll(rememberScrollState())
            .padding(horizontal = 16.dp, vertical = 2.dp),
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        if (controller.tab != InboxStatusTab.Mine) {
            FilterChip(
                selected = controller.assignee != null,
                onClick = onPickAssignee,
                label = {
                    Text(
                        controller.assignee?.let {
                            "Assignee: ${it.display_name.ifBlank { "Teammate" }}"
                        } ?: "Assignee",
                    )
                },
                trailingIcon = {
                    if (controller.assignee != null) {
                        Icon(
                            Icons.Filled.Close,
                            contentDescription = "Clear assignee filter",
                            modifier = Modifier
                                .size(16.dp)
                                .clickable { controller.setAssigneeFilter(null) },
                        )
                    }
                },
            )
        }
        FilterChip(
            selected = controller.tag != null,
            onClick = onPickTag,
            label = { Text(controller.tag?.let { "Tag: ${it.name}" } ?: "Tag") },
            trailingIcon = {
                if (controller.tag != null) {
                    Icon(
                        Icons.Filled.Close,
                        contentDescription = "Clear tag filter",
                        modifier = Modifier
                            .size(16.dp)
                            .clickable { controller.setTagFilter(null) },
                    )
                }
            },
        )
        FilterChip(
            selected = controller.unreadOnly,
            onClick = { controller.toggleUnread() },
            label = { Text("Unread") },
        )
        FilterChip(
            selected = controller.spamOnly,
            onClick = { controller.toggleSpam() },
            label = { Text("Spam") },
        )
    }
}

@Composable
private fun ConversationListPane(
    controller: InboxController,
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

    LazyColumn(state = listState, modifier = Modifier.fillMaxSize()) {
        if (controller.pinnedRows.isNotEmpty()) {
            item(key = "pinned-header") {
                SectionLabel("Pinned", icon = true)
            }
            items(controller.pinnedRows, key = { "pin:${it.id}" }) { row ->
                ConversationRow(row, onClick = { onOpen(row.id) })
            }
            if (controller.rows.isNotEmpty()) {
                item(key = "rest-header") { SectionLabel("Conversations", icon = false) }
            }
        }
        items(controller.rows, key = { it.id }) { row ->
            ConversationRow(row, onClick = { onOpen(row.id) })
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

@Composable
private fun SectionLabel(label: String, icon: Boolean) {
    Row(
        Modifier.padding(start = 16.dp, top = 10.dp, bottom = 4.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        if (icon) {
            Icon(
                Icons.Filled.PushPin,
                contentDescription = null,
                tint = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.size(13.dp),
            )
            Spacer(Modifier.width(6.dp))
        }
        Text(
            label,
            style = MaterialTheme.typography.titleSmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
    }
}

@Composable
private fun ConversationRow(row: ConversationListItem, onClick: () -> Unit) {
    val name = row.contact.name ?: formatPhone(row.contact.phone_e164)
    Row(
        Modifier
            .fillMaxWidth()
            .clickable(onClick = onClick)
            .padding(horizontal = 16.dp, vertical = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        InitialsAvatar(name)
        Spacer(Modifier.width(12.dp))
        Column(Modifier.weight(1f)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(
                    name,
                    style = MaterialTheme.typography.bodyLarge,
                    fontWeight = if (row.unread) FontWeight.SemiBold else FontWeight.Normal,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.weight(1f, fill = false),
                )
                if (row.is_spam) {
                    Spacer(Modifier.width(6.dp))
                    Text(
                        "Spam",
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        modifier = Modifier
                            .background(
                                MaterialTheme.colorScheme.surfaceContainerHigh,
                                RoundedCornerShape(50),
                            )
                            .padding(horizontal = 6.dp, vertical = 1.dp),
                    )
                }
            }
            val snippet = row.last_message?.let { last ->
                val body = if (last.body.isBlank() && last.has_attachments) "Photo"
                else last.body
                if (last.direction == "note") "Note · $body" else body
            }.orEmpty()
            Text(
                snippet,
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                maxLines = 2,
                overflow = TextOverflow.Ellipsis,
            )
            if (row.tags.isNotEmpty()) {
                Row(
                    Modifier.padding(top = 3.dp),
                    horizontalArrangement = Arrangement.spacedBy(4.dp),
                ) {
                    row.tags.take(3).forEach { tag -> TagChip(tag) }
                    if (row.tags.size > 3) {
                        Text(
                            "+${row.tags.size - 3}",
                            style = MaterialTheme.typography.labelSmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                }
            }
        }
        Spacer(Modifier.width(8.dp))
        Column(horizontalAlignment = Alignment.End) {
            Text(
                relativeTime(row.last_message_at),
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            if (row.unread) {
                Spacer(Modifier.size(6.dp))
                Box(
                    Modifier
                        .size(8.dp)
                        .background(MaterialTheme.colorScheme.primary, CircleShape),
                )
            }
        }
    }
    HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
}

@Composable
private fun TagChip(tag: Tag) {
    val tint = tag.color?.let { hex ->
        runCatching { Color(android.graphics.Color.parseColor(hex)) }.getOrNull()
    }
    Row(
        Modifier
            .background(
                MaterialTheme.colorScheme.surfaceContainerHigh,
                RoundedCornerShape(50),
            )
            .padding(horizontal = 6.dp, vertical = 1.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        if (tint != null) {
            Box(
                Modifier
                    .size(6.dp)
                    .background(tint, CircleShape),
            )
            Spacer(Modifier.width(3.dp))
        }
        Text(
            tag.name,
            style = MaterialTheme.typography.labelSmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
    }
}

// ---------------------------------------------------------------------------
// Filter picker sheets
// ---------------------------------------------------------------------------

@Composable
private fun AssigneeFilterSheet(
    members: List<Member>,
    meUserId: String,
    selected: Member?,
    onPick: (Member?) -> Unit,
    onDismiss: () -> Unit,
) {
    ModalBottomSheet(onDismissRequest = onDismiss) {
        Column(Modifier.fillMaxWidth()) {
            Text(
                "Filter by assignee",
                style = MaterialTheme.typography.titleMedium,
                modifier = Modifier.padding(horizontal = 20.dp, vertical = 8.dp),
            )
            PickerRow(
                label = "Anyone",
                selected = selected == null,
                avatarName = null,
                onClick = { onPick(null) },
            )
            members.filter { it.deactivated_at == null }.forEach { member ->
                PickerRow(
                    label = member.display_name.ifBlank { "Teammate" } +
                        if (member.user_id == meUserId) " (you)" else "",
                    selected = selected?.user_id == member.user_id,
                    avatarName = member.display_name.ifBlank { null },
                    onClick = { onPick(member) },
                )
            }
            Spacer(Modifier.height(24.dp))
        }
    }
}

@Composable
private fun TagFilterSheet(
    tags: List<Tag>,
    selected: Tag?,
    onPick: (Tag?) -> Unit,
    onDismiss: () -> Unit,
) {
    ModalBottomSheet(onDismissRequest = onDismiss) {
        Column(Modifier.fillMaxWidth()) {
            Text(
                "Filter by tag",
                style = MaterialTheme.typography.titleMedium,
                modifier = Modifier.padding(horizontal = 20.dp, vertical = 8.dp),
            )
            PickerRow(
                label = "Any tag",
                selected = selected == null,
                avatarName = null,
                onClick = { onPick(null) },
            )
            if (tags.isEmpty()) {
                Text(
                    "No tags yet. Add tags from a conversation on the web.",
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.padding(20.dp),
                )
            }
            tags.forEach { tag ->
                PickerRow(
                    label = tag.name,
                    selected = selected?.id == tag.id,
                    avatarName = null,
                    onClick = { onPick(tag) },
                )
            }
            Spacer(Modifier.height(24.dp))
        }
    }
}

@Composable
private fun PickerRow(
    label: String,
    selected: Boolean,
    avatarName: String?,
    onClick: () -> Unit,
) {
    Row(
        Modifier
            .fillMaxWidth()
            .clickable(onClick = onClick)
            .padding(horizontal = 20.dp, vertical = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        if (avatarName != null) {
            InitialsAvatar(avatarName, size = 30.dp)
            Spacer(Modifier.width(12.dp))
        }
        Text(
            label,
            style = MaterialTheme.typography.bodyLarge,
            modifier = Modifier.weight(1f),
        )
        if (selected) {
            Icon(
                Icons.Filled.Check,
                contentDescription = "Selected",
                tint = MaterialTheme.colorScheme.primary,
            )
        }
    }
    HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
}

// ---------------------------------------------------------------------------
// Search results
// ---------------------------------------------------------------------------

/** ts_headline wraps matches in <b>…</b>; render plain on mobile. */
private fun stripHighlight(snippet: String): String =
    snippet.replace("<b>", "").replace("</b>", "")

@Composable
private fun SearchResultsPane(
    controller: InboxController,
    onOpen: (String) -> Unit,
    onTextContact: (String) -> Unit,
) {
    when (val current = controller.searchState) {
        null, is LoadState.Loading -> CenteredLoading()
        is LoadState.Failed -> CenteredError(
            current.message,
            onRetry = { controller.runSearch() },
        )

        is LoadState.Ready -> {
            val result = current.value
            val empty = result.conversations.isEmpty() && result.contacts.isEmpty() &&
                result.tasks.isEmpty() && result.attachments.isEmpty() &&
                result.templates.isEmpty()
            if (empty) {
                Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                    Text(
                        "Nothing matches \"${controller.query.trim()}\".",
                        style = MaterialTheme.typography.bodyLarge,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
                return
            }
            LazyColumn(Modifier.fillMaxSize()) {
                if (result.conversations.isNotEmpty()) {
                    item(key = "sh-conv") { SectionLabel("Conversations", icon = false) }
                    items(
                        result.conversations,
                        key = { "sc:${it.matched_message_id}" },
                    ) { hit ->
                        val name = hit.contact.name ?: formatPhone(hit.contact.phone_e164)
                        Row(
                            Modifier
                                .fillMaxWidth()
                                .clickable { onOpen(hit.id) }
                                .padding(horizontal = 16.dp, vertical = 10.dp),
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            InitialsAvatar(name, size = 36.dp)
                            Spacer(Modifier.width(12.dp))
                            Column(Modifier.weight(1f)) {
                                Text(name, style = MaterialTheme.typography.bodyLarge)
                                Text(
                                    (if (hit.direction == "note") "Note · " else "") +
                                        stripHighlight(hit.snippet),
                                    style = MaterialTheme.typography.bodyMedium,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                                    maxLines = 2,
                                    overflow = TextOverflow.Ellipsis,
                                )
                            }
                            Spacer(Modifier.width(8.dp))
                            Text(
                                relativeTime(hit.matched_at),
                                style = MaterialTheme.typography.labelSmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        }
                        HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
                    }
                    if (result.next_cursor != null) {
                        item(key = "sh-more") {
                            Text(
                                if (controller.searchLoadingMore) "Loading…"
                                else "More results",
                                style = MaterialTheme.typography.labelLarge,
                                color = MaterialTheme.colorScheme.primary,
                                modifier = Modifier
                                    .clickable { controller.searchMore() }
                                    .padding(16.dp),
                            )
                        }
                    }
                }
                if (result.contacts.isNotEmpty()) {
                    item(key = "sh-contacts") { SectionLabel("Contacts", icon = false) }
                    items(result.contacts, key = { "sct:${it.id}" }) { contact ->
                        val name = contact.name ?: formatPhone(contact.phone_e164)
                        Row(
                            Modifier
                                .fillMaxWidth()
                                .clickable { onTextContact(contact.id) }
                                .padding(horizontal = 16.dp, vertical = 10.dp),
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            InitialsAvatar(name, size = 36.dp)
                            Spacer(Modifier.width(12.dp))
                            Column(Modifier.weight(1f)) {
                                Text(name, style = MaterialTheme.typography.bodyLarge)
                                Text(
                                    formatPhone(contact.phone_e164),
                                    style = MaterialTheme.typography.labelSmall,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                                )
                            }
                        }
                        HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
                    }
                }
                if (result.tasks.isNotEmpty()) {
                    item(key = "sh-tasks") { SectionLabel("Tasks", icon = false) }
                    items(result.tasks, key = { "st:${it.id}" }) { task ->
                        Row(
                            Modifier
                                .fillMaxWidth()
                                .clickable { onOpen(task.conversation_id) }
                                .padding(horizontal = 16.dp, vertical = 10.dp),
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            Column(Modifier.weight(1f)) {
                                Text(task.title, style = MaterialTheme.typography.bodyLarge)
                                Text(
                                    if (task.done) "Done" else "Open task",
                                    style = MaterialTheme.typography.labelSmall,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                                )
                            }
                        }
                        HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
                    }
                }
                if (result.attachments.isNotEmpty()) {
                    item(key = "sh-att") { SectionLabel("Attachments", icon = false) }
                    items(result.attachments, key = { "sa:${it.id}" }) { hit ->
                        Row(
                            Modifier
                                .fillMaxWidth()
                                .let { base ->
                                    val convId = hit.conversation_id
                                    if (convId != null) base.clickable { onOpen(convId) }
                                    else base
                                }
                                .padding(horizontal = 16.dp, vertical = 10.dp),
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            Column(Modifier.weight(1f)) {
                                Text(
                                    hit.file_name,
                                    style = MaterialTheme.typography.bodyLarge,
                                    maxLines = 1,
                                    overflow = TextOverflow.Ellipsis,
                                )
                                Text(
                                    relativeTime(hit.created_at),
                                    style = MaterialTheme.typography.labelSmall,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                                )
                            }
                        }
                        HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
                    }
                }
                if (result.templates.isNotEmpty()) {
                    item(key = "sh-templates") { SectionLabel("Saved replies", icon = false) }
                    items(result.templates, key = { "stp:${it.id}" }) { hit ->
                        Column(
                            Modifier
                                .fillMaxWidth()
                                .padding(horizontal = 16.dp, vertical = 10.dp),
                        ) {
                            Text(hit.name, style = MaterialTheme.typography.bodyLarge)
                            Text(
                                stripHighlight(hit.snippet),
                                style = MaterialTheme.typography.bodyMedium,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                                maxLines = 2,
                                overflow = TextOverflow.Ellipsis,
                            )
                        }
                        HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
                    }
                }
                item(key = "sh-bottom") { Spacer(Modifier.height(24.dp)) }
            }
        }
    }
}
