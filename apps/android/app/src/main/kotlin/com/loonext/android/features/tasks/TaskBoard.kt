package com.loonext.android.features.tasks

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ArrowForward
import androidx.compose.material.icons.automirrored.outlined.Undo
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.loonext.android.core.model.Task
import com.loonext.android.ui.common.CenteredError
import com.loonext.android.ui.common.CenteredLoading
import com.loonext.android.ui.common.LoadState
import com.loonext.android.ui.common.SectionHeader
import com.loonext.android.ui.common.userMessage
import kotlinx.coroutines.launch

/**
 * Board view: two columns, "To do" (status=open) and "Done" (status=done),
 * each with its own cursor pagination. Moving a card between columns is a
 * deliberate tap on the card's move affordance (no fragile drag on touch) —
 * the write is the same derived-done `PATCH /v1/messages/{message_id}`.
 */
@Composable
internal fun TaskBoard(
    mutations: TaskMutations,
    companyId: String,
    tab: TasksTabKind,
    assigneeChip: String?,
    unassignedChip: Boolean,
    dueChip: DueChip?,
    q: String?,
    refreshKey: Int,
    onOpenTask: (String) -> Unit,
    onToggleDone: (Task, Boolean) -> Unit,
) {
    // The board's assignee scope: Mine or All (status tabs are meaningless
    // here — columns ARE the status dimension). taskListArms for a statusless
    // tab yields exactly the two column arms: [open, done].
    val boardTab = if (tab == TasksTabKind.All) TasksTabKind.All else TasksTabKind.Mine

    var state by remember(companyId) { mutableStateOf<LoadState<Unit>>(LoadState.Loading) }
    var todo by remember(companyId) { mutableStateOf(listOf<Task>()) }
    var done by remember(companyId) { mutableStateOf(listOf<Task>()) }
    var todoLoader by remember(companyId) { mutableStateOf<TaskListLoader?>(null) }
    var doneLoader by remember(companyId) { mutableStateOf<TaskListLoader?>(null) }
    var todoHasMore by remember(companyId) { mutableStateOf(false) }
    var doneHasMore by remember(companyId) { mutableStateOf(false) }
    var localRefresh by remember(companyId) { mutableIntStateOf(0) }
    val scope = rememberCoroutineScope()

    LaunchedEffect(
        companyId, boardTab, assigneeChip, unassignedChip, dueChip, q, refreshKey, localRefresh,
    ) {
        if (todo.isEmpty() && done.isEmpty()) state = LoadState.Loading
        val arms = taskListArms(boardTab, assigneeChip, unassignedChip, dueChip, q)
        val openArm = TaskListLoader(mutations, companyId, listOf(arms[0]))
        val doneArm = TaskListLoader(mutations, companyId, listOf(arms[1]))
        try {
            val todoTarget = maxOf(todo.size, 1)
            val doneTarget = maxOf(done.size, 1)
            val todoAcc = mutableListOf<Task>()
            val doneAcc = mutableListOf<Task>()
            var pages = 0
            do {
                todoAcc += openArm.nextPage()
                pages++
            } while (openArm.hasMore && todoAcc.size < todoTarget && pages < 40)
            pages = 0
            do {
                doneAcc += doneArm.nextPage()
                pages++
            } while (doneArm.hasMore && doneAcc.size < doneTarget && pages < 40)
            todo = todoAcc
            done = doneAcc
            todoLoader = openArm
            doneLoader = doneArm
            todoHasMore = openArm.hasMore
            doneHasMore = doneArm.hasMore
            state = LoadState.Ready(Unit)
        } catch (cause: Exception) {
            if (todo.isEmpty() && done.isEmpty()) {
                state = LoadState.Failed(cause.userMessage())
            }
        }
    }

    when (val current = state) {
        is LoadState.Loading -> CenteredLoading()
        is LoadState.Failed -> CenteredError(current.message, onRetry = { localRefresh++ })

        is LoadState.Ready -> Row(
            Modifier
                .fillMaxSize()
                .padding(horizontal = 18.dp),
            horizontalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            BoardColumn(
                title = "To do",
                count = todo.size,
                tasks = todo,
                emptyCopy = "Nothing to do here.",
                hasMore = todoHasMore,
                moveLabel = "Move to Done",
                moveIcon = { Icons.AutoMirrored.Outlined.ArrowForward },
                onLoadMore = {
                    val loader = todoLoader ?: return@BoardColumn
                    scope.launch {
                        runCatching {
                            todo = todo + loader.nextPage()
                            todoHasMore = loader.hasMore
                        }
                    }
                },
                onOpenTask = onOpenTask,
                onMove = { task -> onToggleDone(task, true) },
                modifier = Modifier.weight(1f),
            )
            BoardColumn(
                title = "Done",
                count = done.size,
                tasks = done,
                emptyCopy = "Nothing marked done yet.",
                hasMore = doneHasMore,
                moveLabel = "Move to To do",
                moveIcon = { Icons.AutoMirrored.Outlined.Undo },
                onLoadMore = {
                    val loader = doneLoader ?: return@BoardColumn
                    scope.launch {
                        runCatching {
                            done = done + loader.nextPage()
                            doneHasMore = loader.hasMore
                        }
                    }
                },
                onOpenTask = onOpenTask,
                onMove = { task -> onToggleDone(task, false) },
                modifier = Modifier.weight(1f),
            )
        }
    }
}

@Composable
private fun BoardColumn(
    title: String,
    count: Int,
    tasks: List<Task>,
    emptyCopy: String,
    hasMore: Boolean,
    moveLabel: String,
    moveIcon: () -> androidx.compose.ui.graphics.vector.ImageVector,
    onLoadMore: () -> Unit,
    onOpenTask: (String) -> Unit,
    onMove: (Task) -> Unit,
    modifier: Modifier = Modifier,
) {
    Column(modifier.fillMaxSize()) {
        SectionHeader(
            title,
            Modifier.padding(top = 4.dp, bottom = 2.dp),
            count = count,
        )
        if (tasks.isEmpty()) {
            Text(
                emptyCopy,
                fontSize = 12.sp,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.padding(horizontal = 6.dp, vertical = 8.dp),
            )
        } else {
            LazyColumn(
                Modifier.fillMaxSize(),
                verticalArrangement = Arrangement.spacedBy(8.dp),
                contentPadding = PaddingValues(bottom = 24.dp),
            ) {
                items(tasks, key = { it.id }) { task ->
                    BoardCard(
                        task = task,
                        moveLabel = moveLabel,
                        moveIcon = moveIcon(),
                        onOpen = { onOpenTask(task.id) },
                        onMove = { onMove(task) },
                    )
                }
                if (hasMore) {
                    item(key = "more") {
                        Box(Modifier.fillMaxWidth(), contentAlignment = Alignment.Center) {
                            TextButton(onClick = onLoadMore) { Text("Load more") }
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun BoardCard(
    task: Task,
    moveLabel: String,
    moveIcon: androidx.compose.ui.graphics.vector.ImageVector,
    onOpen: () -> Unit,
    onMove: () -> Unit,
) {
    Surface(
        shape = MaterialTheme.shapes.medium,
        color = MaterialTheme.colorScheme.surface,
        modifier = Modifier.fillMaxWidth(),
    ) {
        Column(
            Modifier
                .fillMaxWidth()
                .clickable(onClick = onOpen)
                .padding(start = 12.dp, top = 10.dp, end = 4.dp, bottom = 4.dp)
                .alpha(if (task.done) 0.62f else 1f),
        ) {
            Text(
                task.title,
                fontSize = 13.5.sp,
                fontWeight = FontWeight.SemiBold,
                lineHeight = 18.sp,
                maxLines = 3,
                overflow = TextOverflow.Ellipsis,
                textDecoration = if (task.done) TextDecoration.LineThrough else null,
                color = MaterialTheme.colorScheme.onSurface,
            )
            Row(
                Modifier.fillMaxWidth(),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                val overdue = isOverdue(task)
                Text(
                    when {
                        task.due_at == null -> ""
                        overdue -> "Overdue"
                        else -> "Due ${formatDue(task.due_at)}"
                    },
                    fontSize = 11.5.sp,
                    fontWeight = if (overdue) FontWeight.SemiBold else FontWeight.Normal,
                    // Overdue = olive emphasis, never a red scare.
                    color = if (overdue) MaterialTheme.colorScheme.secondary
                    else MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.weight(1f),
                )
                IconButton(onClick = onMove) {
                    Icon(
                        moveIcon,
                        contentDescription = moveLabel,
                        tint = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }
        }
    }
}
