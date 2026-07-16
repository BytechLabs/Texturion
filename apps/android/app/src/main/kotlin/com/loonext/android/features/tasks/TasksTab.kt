package com.loonext.android.features.tasks

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.Checkbox
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.SegmentedButton
import androidx.compose.material3.SegmentedButtonDefaults
import androidx.compose.material3.SingleChoiceSegmentedButtonRow
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.unit.dp
import com.loonext.android.AppGraph
import com.loonext.android.core.model.Me
import com.loonext.android.core.model.Task
import com.loonext.android.ui.common.CenteredError
import com.loonext.android.ui.common.CenteredLoading
import com.loonext.android.ui.common.LoadState
import com.loonext.android.ui.common.relativeTime
import com.loonext.android.ui.common.userMessage
import kotlinx.coroutines.launch

private enum class TaskFilter(val label: String) {
    Open("Open"), Mine("Mine"), All("All"), Done("Done")
}

/**
 * Tasks list with the exact server filter-default semantics: no params =
 * open+mine; ANY param disables both defaults (status=open is the sentinel).
 * Done toggles write PATCH /v1/messages/{message_id} — never a task route.
 */
@Composable
fun TasksTab(graph: AppGraph, companyId: String, me: Me, modifier: Modifier = Modifier) {
    var filter by rememberSaveable { mutableStateOf(TaskFilter.Open) }
    var state by remember(companyId) {
        mutableStateOf<LoadState<List<Task>>>(LoadState.Loading)
    }
    var refreshKey by remember { mutableStateOf(0) }
    val scope = rememberCoroutineScope()

    LaunchedEffect(companyId, filter, refreshKey) {
        if (state !is LoadState.Ready) state = LoadState.Loading
        state = try {
            val rows = when (filter) {
                // No params: server default = open + mine.
                TaskFilter.Open -> graph.tasksRepo.tasks(companyId).data
                // Mine, both statuses: two queries merged (no all-statuses mode).
                TaskFilter.Mine -> {
                    val open = graph.tasksRepo
                        .tasks(companyId, status = "open", assignedUserId = me.user_id).data
                    val done = graph.tasksRepo
                        .tasks(companyId, status = "done", assignedUserId = me.user_id).data
                    open + done
                }

                TaskFilter.All -> graph.tasksRepo.tasks(companyId, status = "open").data
                TaskFilter.Done -> graph.tasksRepo
                    .tasks(companyId, status = "done", assignedUserId = me.user_id).data
            }
            LoadState.Ready(rows)
        } catch (cause: Exception) {
            LoadState.Failed(cause.userMessage())
        }
    }
    LaunchedEffect(companyId) {
        graph.realtime.events.collect { event ->
            if (event.event == "task.changed" || event.event == "message.status") refreshKey++
        }
    }

    Column(modifier.fillMaxSize()) {
        SingleChoiceSegmentedButtonRow(
            Modifier
                .fillMaxWidth()
                .padding(horizontal = 16.dp, vertical = 10.dp),
        ) {
            TaskFilter.entries.forEachIndexed { index, item ->
                SegmentedButton(
                    selected = filter == item,
                    onClick = { filter = item },
                    shape = SegmentedButtonDefaults.itemShape(
                        index = index,
                        count = TaskFilter.entries.size,
                    ),
                ) { Text(item.label) }
            }
        }
        when (val current = state) {
            is LoadState.Loading -> CenteredLoading()
            is LoadState.Failed -> CenteredError(current.message, onRetry = { refreshKey++ })
            is LoadState.Ready -> {
                if (current.value.isEmpty()) {
                    Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                        Text(
                            "Nothing on this list.",
                            style = MaterialTheme.typography.bodyLarge,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                } else {
                    LazyColumn(Modifier.fillMaxSize()) {
                        items(current.value, key = { it.id }) { task ->
                            TaskRow(
                                task = task,
                                onToggleDone = { done ->
                                    scope.launch {
                                        // Derived-done invariant: the write path is
                                        // the SOURCE MESSAGE, never a task route.
                                        runCatching {
                                            graph.api.patch<com.loonext.android.core.model.Message, Map<String, Boolean>>(
                                                "/v1/messages/${task.message_id}",
                                                mapOf("done" to done),
                                                companyId = companyId,
                                            )
                                        }
                                        refreshKey++
                                    }
                                },
                            )
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun TaskRow(task: Task, onToggleDone: (Boolean) -> Unit) {
    Row(
        Modifier
            .fillMaxWidth()
            .padding(horizontal = 8.dp, vertical = 4.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Checkbox(checked = task.done, onCheckedChange = onToggleDone)
        Spacer(Modifier.width(4.dp))
        Column(Modifier.weight(1f)) {
            Text(
                task.title,
                style = MaterialTheme.typography.bodyLarge,
                textDecoration = if (task.done) TextDecoration.LineThrough else null,
                color = if (task.done) MaterialTheme.colorScheme.onSurfaceVariant
                else MaterialTheme.colorScheme.onSurface,
            )
            val overdue = !task.done && task.due_at != null &&
                runCatching {
                    java.time.Instant.parse(task.due_at).isBefore(java.time.Instant.now())
                }.getOrDefault(false)
            if (task.due_at != null) {
                Text(
                    if (overdue) "Overdue" else "Due ${relativeTime(task.due_at)}",
                    style = MaterialTheme.typography.labelSmall,
                    // Overdue = amber, never red.
                    color = if (overdue) MaterialTheme.colorScheme.tertiary
                    else MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }
    }
    HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
}
