package com.loonext.android.features.tasks

import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.ViewAgenda
import androidx.compose.material.icons.filled.ViewKanban
import androidx.compose.material.icons.outlined.Circle
import androidx.compose.material3.FilterChip
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.SegmentedButton
import androidx.compose.material3.SegmentedButtonDefaults
import androidx.compose.material3.SingleChoiceSegmentedButtonRow
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
import androidx.compose.ui.unit.dp
import com.loonext.android.AppGraph
import com.loonext.android.core.model.Me
import com.loonext.android.core.model.Member
import com.loonext.android.core.model.Task
import com.loonext.android.ui.common.CenteredError
import com.loonext.android.ui.common.CenteredLoading
import com.loonext.android.ui.common.LoadState
import com.loonext.android.ui.common.userMessage
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

/**
 * /tasks — segmented Open | Mine | All | Done with the route's exact
 * default-filter semantics, assignee/unassigned/due chips, debounced title
 * search, real cursor pagination per ordering, and a List ⇄ Board toggle.
 * Done toggles ALWAYS write `PATCH /v1/messages/{message_id}` (derived done).
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
    onOpenConversation: ((conversationId: String, messageId: String) -> Unit)? = null,
) {
    val mutations = remember(companyId) { TaskMutations(graph.api) }
    var openTaskId by rememberSaveable(companyId) { mutableStateOf<String?>(null) }

    val detailId = openTaskId
    if (detailId != null) {
        TaskDetailScreen(
            graph = graph,
            mutations = mutations,
            companyId = companyId,
            me = me,
            taskId = detailId,
            onBack = { openTaskId = null },
            onOpenConversation = onOpenConversation,
            modifier = modifier,
        )
    } else {
        TaskListScreen(
            graph = graph,
            mutations = mutations,
            companyId = companyId,
            me = me,
            onOpenTask = { openTaskId = it },
            modifier = modifier,
        )
    }
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

    Box(modifier.fillMaxSize()) {
        Column(Modifier.fillMaxSize()) {
            val tabs = if (board) listOf(TasksTabKind.Mine, TasksTabKind.All)
            else TasksTabKind.entries.toList()
            Row(
                Modifier
                    .fillMaxWidth()
                    .padding(start = 16.dp, end = 8.dp, top = 10.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                SingleChoiceSegmentedButtonRow(Modifier.weight(1f)) {
                    tabs.forEachIndexed { index, item ->
                        SegmentedButton(
                            selected = tab == item,
                            onClick = { tab = item },
                            shape = SegmentedButtonDefaults.itemShape(
                                index = index,
                                count = tabs.size,
                            ),
                        ) { Text(item.label) }
                    }
                }
                IconButton(onClick = { board = !board }) {
                    Icon(
                        if (board) Icons.Filled.ViewAgenda else Icons.Filled.ViewKanban,
                        contentDescription = if (board) "List view" else "Board view",
                    )
                }
            }

            OutlinedTextField(
                value = search,
                onValueChange = { search = it.take(TASK_SEARCH_MAX) },
                label = { Text("Search task titles") },
                singleLine = true,
                trailingIcon = {
                    if (search.isNotEmpty()) {
                        IconButton(onClick = { search = "" }) {
                            Icon(Icons.Filled.Close, contentDescription = "Clear search")
                        }
                    }
                },
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 16.dp, vertical = 6.dp),
            )

            Row(
                Modifier
                    .fillMaxWidth()
                    .horizontalScroll(rememberScrollState())
                    .padding(horizontal = 16.dp),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                val assigneeName = assigneeChip?.let { id ->
                    if (id == me.user_id) "You"
                    else members.firstOrNull { it.user_id == id }
                        ?.display_name?.ifBlank { null } ?: "Teammate"
                }
                FilterChip(
                    selected = assigneeChip != null,
                    onClick = { pickerOpen = true },
                    label = { Text(assigneeName ?: "Assignee") },
                    trailingIcon = if (assigneeChip != null) {
                        {
                            Icon(
                                Icons.Filled.Close,
                                contentDescription = "Clear assignee filter",
                                modifier = Modifier
                                    .size(16.dp)
                                    .clickable { assigneeChip = null },
                            )
                        }
                    } else null,
                )
                FilterChip(
                    selected = unassignedChip,
                    onClick = {
                        unassignedChip = !unassignedChip
                        if (unassignedChip) assigneeChip = null
                    },
                    label = { Text("Unassigned") },
                )
                DueChip.entries.forEach { chip ->
                    FilterChip(
                        selected = dueChip == chip,
                        onClick = {
                            dueChipName = if (dueChip == chip) null else chip.name
                        },
                        label = { Text(chip.label) },
                    )
                }
            }

            val filtersActive = assigneeChip != null || unassignedChip ||
                dueChip != null || debouncedQ.isNotEmpty()

            if (board) {
                TaskBoard(
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
                    mutations = mutations,
                    companyId = companyId,
                    tab = tab,
                    assigneeChip = assigneeChip,
                    unassignedChip = unassignedChip,
                    dueChip = dueChip,
                    q = debouncedQ,
                    refreshKey = refreshKey,
                    filtersActive = filtersActive,
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

@Composable
private fun TaskList(
    mutations: TaskMutations,
    companyId: String,
    tab: TasksTabKind,
    assigneeChip: String?,
    unassignedChip: Boolean,
    dueChip: DueChip?,
    q: String?,
    refreshKey: Int,
    filtersActive: Boolean,
    onRetry: () -> Unit,
    onOpenTask: (String) -> Unit,
    onToggleDone: (Task, Boolean) -> Unit,
) {
    var state by remember(companyId) { mutableStateOf<LoadState<Unit>>(LoadState.Loading) }
    var rows by remember(companyId) { mutableStateOf(listOf<Task>()) }
    var hasMore by remember(companyId) { mutableStateOf(false) }
    var loadingMore by remember(companyId) { mutableStateOf(false) }
    val loaderHolder = remember(companyId) { mutableStateOf<TaskListLoader?>(null) }
    val scope = rememberCoroutineScope()

    // Any filter change (including the ordering-flipping due chips) rebuilds
    // the loader from scratch — a cursor never crosses filter sets/orderings.
    LaunchedEffect(companyId, tab, assigneeChip, unassignedChip, dueChip, q, refreshKey) {
        if (rows.isEmpty()) state = LoadState.Loading
        val arms = taskListArms(tab, assigneeChip, unassignedChip, dueChip, q)
        val loader = TaskListLoader(mutations, companyId, arms)
        val target = rows.size // preserve pagination depth on quiet refreshes
        val acc = mutableListOf<Task>()
        try {
            var pages = 0
            do {
                acc += loader.nextPage()
                pages++
            } while (loader.hasMore && acc.size < maxOf(target, 1) && pages < 40)
            rows = acc
            hasMore = loader.hasMore
            loaderHolder.value = loader
            state = LoadState.Ready(Unit)
        } catch (cause: Exception) {
            if (rows.isEmpty()) state = LoadState.Failed(cause.userMessage())
        }
    }

    when (val current = state) {
        is LoadState.Loading -> CenteredLoading()
        is LoadState.Failed -> CenteredError(current.message, onRetry = onRetry)
        is LoadState.Ready -> {
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
                LazyColumn(Modifier.fillMaxSize()) {
                    items(rows, key = { it.id }) { task ->
                        TaskListRow(
                            task = task,
                            onClick = { onOpenTask(task.id) },
                            onToggleDone = { done -> onToggleDone(task, done) },
                        )
                    }
                    if (hasMore) {
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
                                        val loader = loaderHolder.value ?: return@TextButton
                                        loadingMore = true
                                        scope.launch {
                                            try {
                                                rows = rows + loader.nextPage()
                                                hasMore = loader.hasMore
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

@Composable
internal fun TaskListRow(
    task: Task,
    onClick: () -> Unit,
    onToggleDone: (Boolean) -> Unit,
) {
    Row(
        Modifier
            .fillMaxWidth()
            .clickable(onClick = onClick)
            .padding(horizontal = 8.dp, vertical = 6.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        DoneCircle(done = task.done, onToggle = onToggleDone)
        Spacer(Modifier.width(4.dp))
        Column(Modifier.weight(1f)) {
            Text(
                task.title,
                style = MaterialTheme.typography.bodyLarge,
                textDecoration = if (task.done) {
                    androidx.compose.ui.text.style.TextDecoration.LineThrough
                } else null,
                color = if (task.done) MaterialTheme.colorScheme.onSurfaceVariant
                else MaterialTheme.colorScheme.onSurface,
            )
            val overdue = isOverdue(task)
            if (task.due_at != null) {
                Text(
                    if (overdue) "Overdue · due ${formatDue(task.due_at)}"
                    else "Due ${formatDue(task.due_at)}",
                    style = MaterialTheme.typography.labelSmall,
                    // Overdue = amber (tertiary), never red.
                    color = if (overdue) MaterialTheme.colorScheme.tertiary
                    else MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }
    }
    HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
}

/** The round derived-done toggle: hollow circle → filled petrol check. */
@Composable
internal fun DoneCircle(done: Boolean, onToggle: (Boolean) -> Unit) {
    IconButton(onClick = { onToggle(!done) }) {
        Icon(
            if (done) Icons.Filled.CheckCircle else Icons.Outlined.Circle,
            contentDescription = if (done) "Mark not done" else "Mark done",
            tint = if (done) MaterialTheme.colorScheme.primary
            else MaterialTheme.colorScheme.onSurfaceVariant,
        )
    }
}
