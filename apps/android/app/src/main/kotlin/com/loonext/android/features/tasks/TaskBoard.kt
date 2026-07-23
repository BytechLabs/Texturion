package com.loonext.android.features.tasks

import androidx.compose.foundation.background
import androidx.compose.foundation.interaction.MutableInteractionSource
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
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
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
import com.loonext.android.core.data.CacheKeys
import com.loonext.android.core.data.StoreCache
import com.loonext.android.core.model.Task
import com.loonext.android.ui.common.CenteredError
import com.loonext.android.ui.common.LoadState
import com.loonext.android.ui.common.SectionHeader
import com.loonext.android.ui.common.SkeletonBlock
import com.loonext.android.ui.common.pressScale
import com.loonext.android.ui.common.rememberCacheFirst
import com.loonext.android.ui.common.rememberHaptics
import com.loonext.android.ui.common.rememberShimmerBrush
import kotlinx.coroutines.launch

/**
 * The cached board aggregate (#176): both ACCUMULATED columns plus their live
 * pagers, so returning to the board restores each column's paged depth
 * instantly. Cached under [CacheKeys.tasks] with a "board|…" filterKey — the
 * board's value shape must never share an entry with the list's.
 */
internal data class TaskBoardSnapshot(
    val todo: List<Task>,
    val done: List<Task>,
    val todoHasMore: Boolean,
    val doneHasMore: Boolean,
    val todoLoader: TaskListLoader,
    val doneLoader: TaskListLoader,
)

/**
 * Drain FRESH per-column loaders to the targets (at least one page each) — a
 * quiet refresh re-reads to the depth the user had paged to, and a cursor
 * never crosses filter sets/orderings. [arms] must be the two statusless-tab
 * arms from [taskListArms]: open then done.
 */
internal suspend fun fetchTaskBoardSnapshot(
    mutations: TaskMutations,
    companyId: String,
    arms: List<TaskListFilters>,
    todoTarget: Int,
    doneTarget: Int,
): TaskBoardSnapshot {
    val todoLoader = TaskListLoader(mutations, companyId, listOf(arms[0]))
    val doneLoader = TaskListLoader(mutations, companyId, listOf(arms[1]))
    val todo = mutableListOf<Task>()
    val done = mutableListOf<Task>()
    var pages = 0
    do {
        todo += todoLoader.nextPage()
        pages++
    } while (todoLoader.hasMore && todo.size < maxOf(todoTarget, 1) && pages < 40)
    pages = 0
    do {
        done += doneLoader.nextPage()
        pages++
    } while (doneLoader.hasMore && done.size < maxOf(doneTarget, 1) && pages < 40)
    return TaskBoardSnapshot(
        todo = todo,
        done = done,
        todoHasMore = todoLoader.hasMore,
        doneHasMore = doneLoader.hasMore,
        todoLoader = todoLoader,
        doneLoader = doneLoader,
    )
}

/**
 * Board filterKey for [CacheKeys.tasks]: always "board|…"-prefixed so board
 * snapshots and list snapshots (different value types) can never collide on
 * one key. Never "default" — the warmer's default tasks entry is the list's.
 */
internal fun taskBoardFilterKey(
    tab: TasksTabKind,
    assigneeChip: String?,
    unassignedChip: Boolean,
    dueChip: DueChip?,
    q: String?,
): String = listOf(
    "board",
    tab.name,
    assigneeChip ?: "-",
    if (unassignedChip) "unassigned" else "-",
    dueChip?.name ?: "-",
    "q=${q.orEmpty()}",
).joinToString("|")

/**
 * Board view: two columns, "To do" (status=open) and "Done" (status=done),
 * each with its own cursor pagination. Moving a card between columns is a
 * deliberate tap on the card's move affordance (no fragile drag on touch) —
 * the write is the same derived-done `PATCH /v1/messages/{message_id}`.
 */
@Composable
internal fun TaskBoard(
    cache: StoreCache,
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

    var localRefresh by remember(companyId) { mutableIntStateOf(0) }
    val scope = rememberCoroutineScope()

    // #176 cache-first: each board filter combination is its own key, so a
    // revisit paints instantly from StoreCache while both columns revalidate
    // silently; only a never-fetched filter may show the loading state.
    val cacheKey = CacheKeys.tasks(
        companyId,
        taskBoardFilterKey(boardTab, assigneeChip, unassignedChip, dueChip, q),
    )
    val state = rememberCacheFirst(
        cache = cache,
        key = cacheKey,
        refreshKey = refreshKey + localRefresh,
    ) {
        val previous = cache.flowOf<TaskBoardSnapshot>(cacheKey).value
        fetchTaskBoardSnapshot(
            mutations = mutations,
            companyId = companyId,
            arms = taskListArms(boardTab, assigneeChip, unassignedChip, dueChip, q),
            todoTarget = previous?.todo?.size ?: 0,
            doneTarget = previous?.done?.size ?: 0,
        )
    }

    when (val current = state) {
        is LoadState.Loading -> BoardSkeleton()
        is LoadState.Failed -> CenteredError(current.message, onRetry = { localRefresh++ })

        is LoadState.Ready -> {
            val snapshot = current.value
            Row(
                Modifier
                    .fillMaxSize()
                    .padding(horizontal = 18.dp),
                horizontalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                BoardColumn(
                    title = "To do",
                    count = snapshot.todo.size,
                    tasks = snapshot.todo,
                    emptyCopy = "Nothing to do here.",
                    hasMore = snapshot.todoHasMore,
                    moveLabel = "Move to Done",
                    moveIcon = { Icons.AutoMirrored.Outlined.ArrowForward },
                    onLoadMore = {
                        scope.launch {
                            runCatching {
                                // Append INTO the cache so a return restores
                                // the paged depth.
                                val page = snapshot.todoLoader.nextPage()
                                cache.put(
                                    cacheKey,
                                    snapshot.copy(
                                        todo = snapshot.todo + page,
                                        todoHasMore = snapshot.todoLoader.hasMore,
                                    ),
                                )
                            }
                        }
                    },
                    onOpenTask = onOpenTask,
                    onMove = { task -> onToggleDone(task, true) },
                    modifier = Modifier.weight(1f),
                )
                BoardColumn(
                    title = "Done",
                    count = snapshot.done.size,
                    tasks = snapshot.done,
                    emptyCopy = "Nothing marked done yet.",
                    hasMore = snapshot.doneHasMore,
                    moveLabel = "Move to To do",
                    moveIcon = { Icons.AutoMirrored.Outlined.Undo },
                    onLoadMore = {
                        scope.launch {
                            runCatching {
                                val page = snapshot.doneLoader.nextPage()
                                cache.put(
                                    cacheKey,
                                    snapshot.copy(
                                        done = snapshot.done + page,
                                        doneHasMore = snapshot.doneLoader.hasMore,
                                    ),
                                )
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
    val haptics = rememberHaptics()
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
                // animateItem: a moved card leaves one column and lands in the
                // other under the same key, so reflows glide; cached repaints
                // rebuild the composition and never animate.
                items(tasks, key = { it.id }) { task ->
                    BoardCard(
                        task = task,
                        moveLabel = moveLabel,
                        moveIcon = moveIcon(),
                        onOpen = { onOpenTask(task.id) },
                        onMove = { onMove(task) },
                        modifier = Modifier.animateItem(),
                    )
                }
                if (hasMore) {
                    item(key = "more") {
                        Box(
                            Modifier
                                .animateItem()
                                .fillMaxWidth(),
                            contentAlignment = Alignment.Center,
                        ) {
                            TextButton(onClick = {
                                haptics.tap()
                                onLoadMore()
                            }) { Text("Load more") }
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
    modifier: Modifier = Modifier,
) {
    // The paper card gives under the finger: pressScale shares the click's
    // interaction source so the ripple and the settle are one gesture.
    val pressInteraction = remember { MutableInteractionSource() }
    Surface(
        onClick = onOpen,
        shape = MaterialTheme.shapes.medium,
        color = MaterialTheme.colorScheme.surface,
        interactionSource = pressInteraction,
        modifier = modifier
            .fillMaxWidth()
            .pressScale(pressInteraction),
    ) {
        Column(
            Modifier
                .fillMaxWidth()
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

/**
 * First-fetch stand-in in the board grammar: two columns of shimmering card
 * blanks under header stubs, the To do column visibly fuller. With
 * cache-first (#176) this can only ever appear once per filter key per
 * process; failed states are untouched.
 */
@Composable
private fun BoardSkeleton() {
    Row(
        Modifier
            .fillMaxSize()
            .padding(horizontal = 18.dp),
        horizontalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        repeat(2) { column ->
            Column(Modifier.weight(1f)) {
                SkeletonBlock(
                    52.dp,
                    10.dp,
                    Modifier.padding(start = 6.dp, top = 8.dp, bottom = 9.dp),
                )
                repeat(if (column == 0) 4 else 2) {
                    Box(
                        Modifier
                            .fillMaxWidth()
                            .height(76.dp)
                            .background(rememberShimmerBrush(), MaterialTheme.shapes.medium),
                    )
                    Spacer(Modifier.height(8.dp))
                }
            }
        }
    }
}
