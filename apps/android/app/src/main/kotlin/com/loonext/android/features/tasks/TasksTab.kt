package com.loonext.android.features.tasks

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyListScope
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Close
import androidx.compose.material.icons.outlined.Search
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.loonext.android.AppGraph
import com.loonext.android.core.data.CacheKeys
import com.loonext.android.core.data.StoreCache
import com.loonext.android.core.model.Me
import com.loonext.android.core.model.Member
import com.loonext.android.core.model.Task
import com.loonext.android.ui.common.CenteredError
import com.loonext.android.ui.common.CenteredLoading
import com.loonext.android.ui.common.LoadState
import com.loonext.android.ui.common.RowDivider
import com.loonext.android.ui.common.ScreenTitle
import com.loonext.android.ui.common.SectionHeader
import com.loonext.android.ui.common.rememberCacheFirst
import com.loonext.android.ui.common.userMessage
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

/**
 * /tasks — the "paper & olive" tasks surface (spec 24 / dark 31): ScreenTitle,
 * List ⇄ Board view pills, the filter pill rail (Open | Mine | All | Done +
 * assignee/unassigned/due), debounced title search behind the paper search
 * circle, and rows grouped into paper cards by status. All of the route's
 * exact default-filter semantics, cursor pagination per ordering, and the
 * derived-done invariant (`PATCH /v1/messages/{message_id}`) are unchanged.
 * Row tap opens [TaskDetailScreen] in place.
 *
 * [onOpenConversation] deep-links a task's source thread — the shell wires it
 * to the inbox thread screen (#153); until wired the affordance stays hidden.
 */
@Composable
fun TasksTab(
    graph: AppGraph,
    companyId: String,
    me: Me,
    modifier: Modifier = Modifier,
    onOpenTask: (taskId: String) -> Unit,
) {
    val mutations = remember(companyId) { TaskMutations(graph.api) }
    // Task detail is a ROUTE above the shell now (founder mandate: nothing
    // pushed shows the pill nav) — this tab is only ever the list, so its
    // saveable state (board/filters/scroll) trivially survives detail trips.
    TaskListScreen(
        graph = graph,
        mutations = mutations,
        companyId = companyId,
        me = me,
        onOpenTask = onOpenTask,
        modifier = modifier,
    )
}

@Composable
private fun TaskListScreen(
    graph: AppGraph,
    mutations: TaskMutations,
    companyId: String,
    me: Me,
    onOpenTask: (String) -> Unit,
    modifier: Modifier = Modifier,
) {
    var tab by rememberSaveable(companyId) { mutableStateOf(TasksTabKind.Open) }
    var board by rememberSaveable(companyId) { mutableStateOf(false) }
    var assigneeChip by rememberSaveable(companyId) { mutableStateOf<String?>(null) }
    var unassignedChip by rememberSaveable(companyId) { mutableStateOf(false) }
    var dueChipName by rememberSaveable(companyId) { mutableStateOf<String?>(null) }
    var search by rememberSaveable(companyId) { mutableStateOf("") }
    var searchOpen by rememberSaveable(companyId) { mutableStateOf(false) }
    var debouncedQ by remember(companyId) { mutableStateOf("") }
    var refreshKey by remember(companyId) { mutableIntStateOf(0) }
    var pickerOpen by remember { mutableStateOf(false) }

    val dueChip = dueChipName?.let { name -> DueChip.entries.firstOrNull { it.name == name } }
    val scope = rememberCoroutineScope()
    val snackbar = remember { SnackbarHostState() }

    // Active members back the assignee chip label and the picker. A quiet
    // fetch — a failure leaves the generic chip label and the picker retries.
    var members by remember(companyId) { mutableStateOf<List<Member>>(emptyList()) }
    LaunchedEffect(companyId) {
        runCatching { mutations.members(companyId) }
            .onSuccess { members = it.data }
    }

    LaunchedEffect(search) {
        if (search.isNotEmpty()) delay(250)
        debouncedQ = search.trim().take(TASK_SEARCH_MAX)
    }

    // Board organizes by status, so the Open/Done dimension is a no-op there
    // (#113): entering the board coerces a status-pinned tab to Mine.
    LaunchedEffect(board) {
        if (board && (tab == TasksTabKind.Open || tab == TasksTabKind.Done)) {
            tab = TasksTabKind.Mine
        }
    }

    // Realtime: any task create/assign/due/delete (task.changed) or done flip
    // (message.status) refreshes the current view quietly.
    LaunchedEffect(companyId) {
        graph.realtime.events.collect { event ->
            if (event.event == "task.changed" || event.event == "message.status") refreshKey++
        }
    }
    LaunchedEffect(companyId) {
        graph.realtime.reconnected.collect { refreshKey++ }
    }

    val onToggleDone: (Task, Boolean) -> Unit = { task, done ->
        scope.launch {
            // Derived-done invariant: the write path is the SOURCE MESSAGE.
            val result = runCatching { mutations.setDone(companyId, task.message_id, done) }
            result.onFailure { snackbar.showSnackbar(it.userMessage()) }
            refreshKey++
        }
    }

    fun memberName(userId: String?): String? = when {
        userId == null -> null
        userId == me.user_id -> me.display_name.ifBlank { "You" }
        else -> members.firstOrNull { it.user_id == userId }
            ?.display_name?.ifBlank { null }
    }

    Box(modifier.fillMaxSize()) {
        Column(Modifier.fillMaxSize()) {
            // ScreenTitle row with the paper search circle (spec 24).
            Row(
                Modifier
                    .fillMaxWidth()
                    .padding(start = 18.dp, end = 18.dp, top = 8.dp),
                verticalAlignment = Alignment.Bottom,
            ) {
                ScreenTitle("Tasks", Modifier.weight(1f))
                PaperCircleButton(
                    icon = Icons.Outlined.Search,
                    contentDescription = if (searchOpen) "Hide search" else "Search task titles",
                    onClick = { searchOpen = !searchOpen },
                )
            }

            Spacer(Modifier.height(14.dp))

            // View pills: ink active, paper idle. (Calendar/Map views from the
            // canvas have no data layer yet — List and Board are the two real
            // views.)
            Row(
                Modifier.padding(horizontal = 18.dp),
                horizontalArrangement = Arrangement.spacedBy(6.dp),
            ) {
                ViewPill("List", selected = !board, onClick = { board = false })
                ViewPill("Board", selected = board, onClick = { board = true })
            }

            if (searchOpen || search.isNotEmpty()) {
                OutlinedTextField(
                    value = search,
                    onValueChange = { search = it.take(TASK_SEARCH_MAX) },
                    placeholder = {
                        Text(
                            "Search task titles",
                            fontSize = 13.sp,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    },
                    singleLine = true,
                    shape = CircleShape,
                    colors = OutlinedTextFieldDefaults.colors(
                        focusedContainerColor = MaterialTheme.colorScheme.surface,
                        unfocusedContainerColor = MaterialTheme.colorScheme.surface,
                        focusedBorderColor = MaterialTheme.colorScheme.outline,
                        unfocusedBorderColor = Color.Transparent,
                    ),
                    trailingIcon = {
                        if (search.isNotEmpty()) {
                            IconButton(onClick = { search = "" }) {
                                Icon(
                                    Icons.Outlined.Close,
                                    contentDescription = "Clear search",
                                    modifier = Modifier.size(18.dp),
                                )
                            }
                        }
                    },
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(start = 18.dp, end = 18.dp, top = 12.dp),
                )
            }

            Spacer(Modifier.height(12.dp))

            // The filter pill rail: status tabs + assignee/unassigned/due.
            Row(
                Modifier
                    .fillMaxWidth()
                    .horizontalScroll(rememberScrollState())
                    .padding(horizontal = 18.dp),
                horizontalArrangement = Arrangement.spacedBy(6.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(
                    "Filter",
                    fontSize = 11.sp,
                    fontWeight = FontWeight.SemiBold,
                    color = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.7f),
                )
                val tabs = if (board) listOf(TasksTabKind.Mine, TasksTabKind.All)
                else TasksTabKind.entries.toList()
                tabs.forEach { item ->
                    FilterPill(
                        text = item.label,
                        selected = tab == item,
                        onClick = { tab = item },
                    )
                }
                val assigneeName = assigneeChip?.let { id ->
                    if (id == me.user_id) "You"
                    else members.firstOrNull { it.user_id == id }
                        ?.display_name?.ifBlank { null } ?: "Teammate"
                }
                FilterPill(
                    text = assigneeName ?: "Assignee",
                    selected = assigneeChip != null,
                    onClick = { pickerOpen = true },
                    trailing = if (assigneeChip != null) {
                        {
                            Icon(
                                Icons.Outlined.Close,
                                contentDescription = "Clear assignee filter",
                                modifier = Modifier
                                    .size(12.dp)
                                    .clickable { assigneeChip = null },
                            )
                        }
                    } else null,
                )
                FilterPill(
                    text = "Unassigned",
                    selected = unassignedChip,
                    onClick = {
                        unassignedChip = !unassignedChip
                        if (unassignedChip) assigneeChip = null
                    },
                )
                DueChip.entries.forEach { chip ->
                    FilterPill(
                        text = chip.label,
                        selected = dueChip == chip,
                        onClick = {
                            dueChipName = if (dueChip == chip) null else chip.name
                        },
                    )
                }
            }

            Spacer(Modifier.height(10.dp))

            val filtersActive = assigneeChip != null || unassignedChip ||
                dueChip != null || debouncedQ.isNotEmpty()

            if (board) {
                TaskBoard(
                    cache = graph.storeCache,
                    mutations = mutations,
                    companyId = companyId,
                    tab = tab,
                    assigneeChip = assigneeChip,
                    unassignedChip = unassignedChip,
                    dueChip = dueChip,
                    q = debouncedQ,
                    refreshKey = refreshKey,
                    onOpenTask = onOpenTask,
                    onToggleDone = onToggleDone,
                )
            } else {
                TaskList(
                    cache = graph.storeCache,
                    mutations = mutations,
                    companyId = companyId,
                    tab = tab,
                    assigneeChip = assigneeChip,
                    unassignedChip = unassignedChip,
                    dueChip = dueChip,
                    q = debouncedQ,
                    refreshKey = refreshKey,
                    filtersActive = filtersActive,
                    memberName = ::memberName,
                    onRetry = { refreshKey++ },
                    onOpenTask = onOpenTask,
                    onToggleDone = onToggleDone,
                )
            }
        }
        SnackbarHost(snackbar, Modifier.align(Alignment.BottomCenter))
    }

    if (pickerOpen) {
        MemberPickerSheet(
            members = members,
            meUserId = me.user_id,
            selectedUserId = assigneeChip,
            showUnassigned = false,
            onPick = { userId ->
                assigneeChip = userId
                if (userId != null) unassignedChip = false
                pickerOpen = false
            },
            onDismiss = { pickerOpen = false },
        )
    }
}

/**
 * The cached tasks-list aggregate (#176): the ACCUMULATED open+done rows plus
 * the live pager that produced them, so returning to the screen (or to a
 * previously-used filter) restores the full paged depth instantly. Internal
 * so the shell warmer can replay the default fetch.
 */
internal data class TaskListSnapshot(
    val rows: List<Task>,
    val hasMore: Boolean,
    val loader: TaskListLoader,
)

/**
 * Drain a FRESH loader to [targetRows] (at least one page) — a quiet refresh
 * re-reads to the depth the user had paged to, and a cursor never crosses
 * filter sets/orderings because every fetch builds its own loader.
 */
internal suspend fun fetchTaskListSnapshot(
    mutations: TaskMutations,
    companyId: String,
    arms: List<TaskListFilters>,
    targetRows: Int,
): TaskListSnapshot {
    val loader = TaskListLoader(mutations, companyId, arms)
    val acc = mutableListOf<Task>()
    var pages = 0
    do {
        acc += loader.nextPage()
        pages++
    } while (loader.hasMore && acc.size < maxOf(targetRows, 1) && pages < 40)
    return TaskListSnapshot(acc, loader.hasMore, loader)
}

/**
 * Stable filterKey for [CacheKeys.tasks]: the list's INITIAL state (Open tab,
 * no chips, no search) is exactly "default" — the key the shell warmer
 * prefetches. Board keys carry a "board|" prefix ([taskBoardFilterKey]) so
 * the two view shapes never share one entry.
 */
internal fun taskListFilterKey(
    tab: TasksTabKind,
    assigneeChip: String?,
    unassignedChip: Boolean,
    dueChip: DueChip?,
    q: String?,
): String =
    if (tab == TasksTabKind.Open && assigneeChip == null && !unassignedChip &&
        dueChip == null && q.isNullOrEmpty()
    ) {
        "default"
    } else {
        listOf(
            tab.name,
            assigneeChip ?: "-",
            if (unassignedChip) "unassigned" else "-",
            dueChip?.name ?: "-",
            "q=${q.orEmpty()}",
        ).joinToString("|")
    }

@Composable
private fun TaskList(
    cache: StoreCache,
    mutations: TaskMutations,
    companyId: String,
    tab: TasksTabKind,
    assigneeChip: String?,
    unassignedChip: Boolean,
    dueChip: DueChip?,
    q: String?,
    refreshKey: Int,
    filtersActive: Boolean,
    memberName: (String?) -> String?,
    onRetry: () -> Unit,
    onOpenTask: (String) -> Unit,
    onToggleDone: (Task, Boolean) -> Unit,
) {
    var loadingMore by remember(companyId) { mutableStateOf(false) }
    val scope = rememberCoroutineScope()

    // #176 cache-first: every filter combination is its own key, so a revisit
    // (or a return to a previously-used filter) paints instantly from
    // StoreCache while the snapshot revalidates silently; only a never-fetched
    // filter may show the loading state.
    val cacheKey = CacheKeys.tasks(
        companyId,
        taskListFilterKey(tab, assigneeChip, unassignedChip, dueChip, q),
    )
    val state = rememberCacheFirst(
        cache = cache,
        key = cacheKey,
        refreshKey = refreshKey,
    ) {
        fetchTaskListSnapshot(
            mutations = mutations,
            companyId = companyId,
            arms = taskListArms(tab, assigneeChip, unassignedChip, dueChip, q),
            targetRows = cache.flowOf<TaskListSnapshot>(cacheKey).value?.rows?.size ?: 0,
        )
    }

    when (val current = state) {
        is LoadState.Loading -> CenteredLoading()
        is LoadState.Failed -> CenteredError(current.message, onRetry = onRetry)
        is LoadState.Ready -> {
            val rows = current.value.rows
            if (rows.isEmpty()) {
                Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                    Text(
                        if (filtersActive || tab != TasksTabKind.Open) "Nothing on this list."
                        else "No tasks yet. Promote a message from its ⋯ menu in a conversation.",
                        style = MaterialTheme.typography.bodyLarge,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        modifier = Modifier.padding(horizontal = 32.dp),
                    )
                }
            } else {
                // Rows arrive open-first (the loader drains the open arm
                // before done), so the status partition preserves order.
                val openRows = rows.filter { !it.done }
                val doneRows = rows.filter { it.done }
                LazyColumn(
                    Modifier.fillMaxSize(),
                    contentPadding = PaddingValues(bottom = 24.dp),
                ) {
                    taskSection(
                        label = "To do",
                        tasks = openRows,
                        memberName = memberName,
                        onOpenTask = onOpenTask,
                        onToggleDone = onToggleDone,
                    )
                    taskSection(
                        label = "Done",
                        tasks = doneRows,
                        memberName = memberName,
                        onOpenTask = onOpenTask,
                        onToggleDone = onToggleDone,
                    )
                    if (current.value.hasMore) {
                        item(key = "load-more") {
                            Box(
                                Modifier
                                    .fillMaxWidth()
                                    .padding(vertical = 8.dp),
                                contentAlignment = Alignment.Center,
                            ) {
                                TextButton(
                                    enabled = !loadingMore,
                                    onClick = {
                                        val snapshot = current.value
                                        loadingMore = true
                                        scope.launch {
                                            try {
                                                // Append INTO the cache so a
                                                // return restores the depth.
                                                val page = snapshot.loader.nextPage()
                                                cache.put(
                                                    cacheKey,
                                                    snapshot.copy(
                                                        rows = snapshot.rows + page,
                                                        hasMore = snapshot.loader.hasMore,
                                                    ),
                                                )
                                            } catch (_: Exception) {
                                                // Leave the button; the user retries.
                                            } finally {
                                                loadingMore = false
                                            }
                                        }
                                    },
                                ) { Text(if (loadingMore) "Loading…" else "Load more") }
                            }
                        }
                    }
                }
            }
        }
    }
}

/** One status group: a SectionHeader + its rows fused into one paper card. */
private fun LazyListScope.taskSection(
    label: String,
    tasks: List<Task>,
    memberName: (String?) -> String?,
    onOpenTask: (String) -> Unit,
    onToggleDone: (Task, Boolean) -> Unit,
) {
    if (tasks.isEmpty()) return
    item(key = "hdr-$label") {
        SectionHeader(
            label,
            Modifier.padding(start = 18.dp, top = 10.dp),
            count = tasks.size,
        )
    }
    itemsIndexed(tasks, key = { _, task -> task.id }) { index, task ->
        Column(
            Modifier
                .padding(horizontal = 18.dp)
                .clip(cardGroupShape(index, tasks.size))
                .background(MaterialTheme.colorScheme.surface),
        ) {
            TaskListRow(
                task = task,
                assigneeName = memberName(task.assigned_user_id),
                onClick = { onOpenTask(task.id) },
                onToggleDone = { done -> onToggleDone(task, done) },
            )
            if (index < tasks.lastIndex) RowDivider()
        }
    }
}

/**
 * One task row (spec 24): done ring, 13.5sp SemiBold title (struck when
 * done), the muted due/context ladder with overdue emphasis, and the 28dp
 * assignee avatar. Done rows fade to ~62%.
 */
@Composable
internal fun TaskListRow(
    task: Task,
    assigneeName: String?,
    onClick: () -> Unit,
    onToggleDone: (Boolean) -> Unit,
) {
    Row(
        Modifier
            .fillMaxWidth()
            .clickable(onClick = onClick)
            .padding(start = 9.dp, end = 15.dp, top = 7.dp, bottom = 7.dp)
            .alpha(if (task.done) 0.62f else 1f),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        DoneCircle(done = task.done, onToggle = onToggleDone)
        Spacer(Modifier.width(6.dp))
        Column(Modifier.weight(1f)) {
            Text(
                task.title,
                fontSize = 13.5.sp,
                fontWeight = FontWeight.SemiBold,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                textDecoration = if (task.done) TextDecoration.LineThrough else null,
                color = MaterialTheme.colorScheme.onSurface,
            )
            val overdue = isOverdue(task)
            val dueText = task.due_at?.let {
                if (overdue) "Overdue · due ${formatDue(it)}" else "Due ${formatDue(it)}"
            }
            val context = task.contact?.name?.ifBlank { null }
            if (dueText != null || context != null) {
                Row(
                    Modifier.padding(top = 3.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(7.dp),
                ) {
                    if (dueText != null) {
                        Text(
                            dueText,
                            fontSize = 11.5.sp,
                            fontWeight = if (overdue) FontWeight.SemiBold
                            else FontWeight.Normal,
                            // Overdue = olive emphasis, never a red scare.
                            color = if (overdue) MaterialTheme.colorScheme.secondary
                            else MaterialTheme.colorScheme.onSurfaceVariant,
                            maxLines = 1,
                        )
                    }
                    if (dueText != null && context != null) {
                        Box(
                            Modifier
                                .size(3.dp)
                                .background(MaterialTheme.colorScheme.outline, CircleShape),
                        )
                    }
                    if (context != null) {
                        Text(
                            context,
                            fontSize = 11.5.sp,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis,
                        )
                    }
                }
            }
        }
        if (task.assigned_user_id != null) {
            Spacer(Modifier.width(12.dp))
            TaskAvatar(assigneeName, size = 28.dp)
        }
    }
}
