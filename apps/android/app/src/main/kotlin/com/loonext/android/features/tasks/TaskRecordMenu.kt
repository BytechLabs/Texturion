package com.loonext.android.features.tasks

import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.compositionLocalOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.text.AnnotatedString
import com.loonext.android.BuildConfig
import com.loonext.android.core.i18n.AppStrings
import com.loonext.android.core.i18n.LocalAppLocale
import com.loonext.android.core.i18n.t
import com.loonext.android.core.model.Task
import com.loonext.android.ui.common.RecordMenu
import com.loonext.android.ui.common.TASK_DUE_MOVES
import com.loonext.android.ui.common.TaskActionId
import com.loonext.android.ui.common.TaskActionsInput
import com.loonext.android.ui.common.rememberHaptics
import com.loonext.android.ui.common.taskActions
import com.loonext.android.ui.common.userMessage
import java.time.Instant
import java.time.ZoneId
import kotlinx.coroutines.launch

/**
 * #712: a task's action menu, for every place a task is drawn as a row, a card or
 * a calendar entry. A host that can offer it provides this; a view that finds none
 * simply has no long-press menu.
 *
 * It is a composable lambda rather than a pile of parameters because the list, the
 * board and the calendar are three screens deep and each would otherwise carry the
 * same six callbacks only to hand them to one menu.
 */
internal val LocalTaskMenu =
    compositionLocalOf<(@Composable (task: Task, expanded: Boolean, onDismiss: () -> Unit) -> Unit)?> { null }

/** The link a task opens at on the web: the tasks board with the drawer on that task. */
internal fun taskLink(origin: String, taskId: String): String =
    "$origin/tasks?task=${java.net.URLEncoder.encode(taskId, "UTF-8")}"

/**
 * The new due instant for a relative move, keeping the time of day (the move
 * changes the date and leaves the appointment time alone). A task with no due
 * date moves from [now].
 */
internal fun movedDueAt(dueAt: String?, days: Int, now: Instant, zone: ZoneId): String {
    val from = (parseInstant(dueAt) ?: now).atZone(zone)
    return encodeDueAt(from.plusDays(days.toLong()).toLocalDateTime(), zone)
}

/**
 * The task's menu with its own writes: done, a due move, copy link, open and delete.
 *
 * Delete asks first with a plain confirmation, because a row does not carry the
 * notes and files the detail screen weighs before it asks. A repeating job deletes
 * only the occurrence that was pointed at, the same as the web row menu.
 */
@Composable
internal fun TaskRecordMenu(
    task: Task,
    expanded: Boolean,
    onDismiss: () -> Unit,
    canDelete: Boolean,
    mutations: TaskMutations,
    companyId: String,
    onToggleDone: (Task, Boolean) -> Unit,
    onOpen: ((String) -> Unit)?,
    onChanged: () -> Unit,
    onMessage: (String) -> Unit,
) {
    val scope = rememberCoroutineScope()
    val clipboard = LocalClipboardManager.current
    val haptics = rememberHaptics()
    val locale = LocalAppLocale.current
    var confirmDelete by remember { mutableStateOf(false) }

    RecordMenu(
        expanded = expanded,
        onDismiss = onDismiss,
        actions = taskActions(
            TaskActionsInput(
                done = task.done,
                // A list row does not carry the viewer's level; the server refuses what is not theirs.
                hasAccess = true,
                canDelete = canDelete,
                canOpen = onOpen != null,
                canCopyLink = true,
            ),
        ),
        onSelect = { actionId, subId ->
            when (actionId) {
                TaskActionId.OPEN -> onOpen?.invoke(task.id)
                TaskActionId.COPY_LINK -> {
                    haptics.tap()
                    clipboard.setText(AnnotatedString(taskLink(BuildConfig.APP_ORIGIN, task.id)))
                    onMessage(AppStrings.translate(locale, "recordMenu.linkCopied"))
                }
                TaskActionId.DONE -> onToggleDone(task, !task.done)
                TaskActionId.DUE -> {
                    val days = TASK_DUE_MOVES.firstOrNull { it.id == subId }?.id?.toIntOrNull() ?: return@RecordMenu
                    val next = movedDueAt(task.due_at, days, Instant.now(), ZoneId.systemDefault())
                    scope.launch {
                        try {
                            mutations.setDue(companyId, task.id, next, scope = if (needsScopeChoice(task.repeat)) TaskScope.This else null)
                            onChanged()
                        } catch (cause: Exception) {
                            onMessage(cause.userMessage(locale))
                        }
                    }
                }
                TaskActionId.DELETE -> confirmDelete = true
            }
        },
    )

    if (confirmDelete) {
        AlertDialog(
            onDismissRequest = { confirmDelete = false },
            title = { Text(t("contactsTasks.deleteTaskTitle")) },
            text = { Text(t("contactsTasks.deleteTaskBody")) },
            confirmButton = {
                TextButton(onClick = {
                    confirmDelete = false
                    haptics.reject()
                    scope.launch {
                        try {
                            mutations.delete(
                                companyId,
                                task.id,
                                scope = if (needsScopeChoice(task.repeat)) TaskScope.This else null,
                            )
                            onChanged()
                        } catch (cause: Exception) {
                            onMessage(cause.userMessage(locale))
                        }
                    }
                }) { Text(t("contactsTasks.deleteTask")) }
            },
            dismissButton = {
                TextButton(onClick = { confirmDelete = false }) { Text(t("common.cancel")) }
            },
        )
    }
}
