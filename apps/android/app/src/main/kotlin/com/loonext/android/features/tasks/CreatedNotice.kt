package com.loonext.android.features.tasks

import com.loonext.android.ui.common.showOpen
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import com.loonext.android.AppGraph

/**
 * #724: "Task created" with an Open that goes to the task.
 *
 * The sheets that create a task close themselves and live on three different
 * screens, so none of them owns a snackbar the confirmation could outlive them
 * on. They post here instead and one host at the app root shows it.
 */
data class CreatedTaskNotice(
    val text: String,
    val openLabel: String,
    val taskId: String,
)

/** Shows each posted [CreatedTaskNotice]; Open calls [onOpenTask]. */
@Composable
fun CreatedTaskNoticeHost(
    graph: AppGraph,
    onOpenTask: (taskId: String) -> Unit,
    modifier: Modifier = Modifier,
) {
    val snackbar = remember { SnackbarHostState() }
    LaunchedEffect(graph) {
        graph.createdTaskNotices.collect { notice ->
            snackbar.showOpen(notice.text, notice.openLabel) { onOpenTask(notice.taskId) }
        }
    }
    SnackbarHost(snackbar, modifier = modifier)
}
