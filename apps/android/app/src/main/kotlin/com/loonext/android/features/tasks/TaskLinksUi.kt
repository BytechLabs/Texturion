package com.loonext.android.features.tasks

import com.loonext.android.ui.common.IconSize
import androidx.compose.foundation.clickable
import com.loonext.android.ui.common.SearchField
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Close
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
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
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.loonext.android.core.i18n.AppStrings
import com.loonext.android.core.i18n.LocalAppLocale
import com.loonext.android.core.i18n.t
import com.loonext.android.core.model.Task
import com.loonext.android.core.net.ApiErrorCode
import com.loonext.android.core.net.ApiException
import com.loonext.android.ui.common.AppSheet
import com.loonext.android.ui.common.SectionHeader
import com.loonext.android.ui.common.userMessage
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

/** Whose linked tasks to list. */
sealed interface LinkedOwner {
    data class Conversation(val id: String) : LinkedOwner
    data class Contact(val id: String) : LinkedOwner
}

private const val LINK_SEARCH_DEBOUNCE_MS = 200L
private const val LINK_SEARCH_LIMIT = 15

/** "T-142 Title", the way a task is named in a list of links. */
fun taskLinkLabel(number: Int?, title: String): String =
    listOf(number?.let { taskNumberLabel(it) }.orEmpty(), title).filter { it.isNotBlank() }.joinToString(" ")

/**
 * What a refused link says. A loop is a 422 and a second parent a 409; both
 * are said in plain words rather than as the server's error code.
 */
fun linkErrorMessage(cause: Throwable, locale: String): String {
    val api = cause as? ApiException
    return when {
        api?.code == ApiErrorCode.CONFLICT -> AppStrings.translate(locale, "taskLinks.linkHasParent")
        api?.code == ApiErrorCode.VALIDATION_FAILED && api.message.contains("loop", ignoreCase = true) ->
            AppStrings.translate(locale, "taskLinks.linkLoop")

        else -> cause.userMessage(locale)
    }
}

private fun howKey(how: String): String = when (how) {
    "anchored" -> "taskLinks.howAnchored"
    "mentioned" -> "taskLinks.howMentioned"
    else -> "taskLinks.howPointsAt"
}

/** The tasks that point at a conversation or a customer, or were made from it. */
@Composable
fun LinkedTasksList(
    repo: ReferenceRepository,
    companyId: String,
    owner: LinkedOwner,
    onOpenTask: ((taskId: String) -> Unit)?,
    /**
     * #717: tasks a list beside this one already shows, so none appears twice.
     * Passing it also means this list is a continuation of that one, so it
     * says nothing at all rather than "none" when nothing is left.
     */
    shownElsewhere: Set<String>? = null,
) {
    val locale = LocalAppLocale.current
    var tasks by remember(owner) { mutableStateOf<List<LinkedTask>?>(null) }
    var failed by remember(owner) { mutableStateOf(false) }
    LaunchedEffect(owner, companyId) {
        try {
            tasks = when (owner) {
                is LinkedOwner.Conversation -> repo.linkedTasksOfConversation(companyId, owner.id)
                is LinkedOwner.Contact -> repo.linkedTasksOfContact(companyId, owner.id)
            }
            failed = false
        } catch (cancelled: CancellationException) {
            throw cancelled
        } catch (_: Exception) {
            failed = true
        }
    }
    val loaded = tasks?.filter { shownElsewhere == null || it.id !in shownElsewhere }
    when {
        failed -> MutedLine(t("taskLinks.linkedFailed"))
        loaded == null -> Unit
        loaded.isEmpty() -> if (shownElsewhere == null) MutedLine(t("taskLinks.linkedNone"))
        else -> Column {
            loaded.forEach { task ->
                TaskLinkRow(
                    label = taskLinkLabel(task.number, task.title),
                    done = task.done,
                    caption = task.how.distinct().joinToString(" · ") { AppStrings.translate(locale, howKey(it)) },
                    onOpen = onOpenTask?.let { open -> { open(task.id) } },
                    onRemove = null,
                )
            }
        }
    }
}

@Composable
private fun MutedLine(text: String) {
    Text(
        text,
        style = MaterialTheme.typography.bodySmall,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
        modifier = Modifier.padding(vertical = 4.dp),
    )
}

@Composable
private fun TaskLinkRow(
    label: String,
    done: Boolean,
    caption: String?,
    onOpen: (() -> Unit)?,
    onRemove: (() -> Unit)?,
    removeDescription: String = "",
) {
    Row(
        Modifier
            .fillMaxWidth()
            .heightIn(min = 48.dp)
            .let { if (onOpen != null) it.clickable(role = Role.Button, onClick = onOpen) else it },
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Column(Modifier.weight(1f).padding(vertical = 6.dp)) {
            Text(
                if (done) t("taskLinks.chipFinished", "label" to label) else label,
                style = MaterialTheme.typography.bodyMedium,
                textDecoration = if (done) TextDecoration.LineThrough else null,
                color = if (done) MaterialTheme.colorScheme.onSurfaceVariant else MaterialTheme.colorScheme.onSurface,
                maxLines = 2,
                overflow = TextOverflow.Ellipsis,
            )
            if (!caption.isNullOrBlank()) {
                Text(
                    caption,
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }
        if (onRemove != null) {
            IconButton(onClick = onRemove, modifier = Modifier.size(48.dp)) {
                Icon(
                    Icons.Outlined.Close,
                    contentDescription = removeDescription,
                    tint = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.size(IconSize.Default),
                )
            }
        }
    }
}

/**
 * The Links section of a task: blocked by, blocks, parent, sub-tasks, each with
 * the other task's live title and finished state. Done stays per task: nothing
 * here finishes a parent.
 */
@Composable
fun TaskLinksSection(
    repo: ReferenceRepository,
    companyId: String,
    taskId: String,
    canEdit: Boolean,
    reloadKey: Int,
    onOpenTask: ((taskId: String) -> Unit)?,
    modifier: Modifier = Modifier,
    /** Called after a link was added or removed, so the activity feed can reload. */
    onLinksChanged: () -> Unit = {},
) {
    val locale = LocalAppLocale.current
    val scope = rememberCoroutineScope()
    var links by remember(taskId) { mutableStateOf<List<TaskLink>?>(null) }
    var failed by remember(taskId) { mutableStateOf(false) }
    var error by remember(taskId) { mutableStateOf<String?>(null) }
    var bump by remember(taskId) { mutableIntStateOf(0) }
    var choosingRelation by remember(taskId) { mutableStateOf(false) }
    var pickingFor by remember(taskId) { mutableStateOf<String?>(null) }

    LaunchedEffect(taskId, reloadKey, bump) {
        try {
            links = repo.links(companyId, taskId)
            failed = false
        } catch (cancelled: CancellationException) {
            throw cancelled
        } catch (_: Exception) {
            failed = true
        }
    }

    Column(modifier) {
        SectionHeader(t("taskLinks.sectionLinks"), count = links?.size?.takeIf { it > 0 })
        val loaded = links
        when {
            failed && loaded == null -> MutedLine(t("taskLinks.linksFailed"))
            loaded == null -> Unit
            loaded.isEmpty() -> MutedLine(t("taskLinks.linksEmpty"))
            else -> TaskRelation.ALL.forEach { relation ->
                val group = loaded.filter { it.relation == relation }
                if (group.isNotEmpty()) {
                    Text(
                        t(TaskRelation.labelKey(relation)),
                        style = MaterialTheme.typography.labelMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        modifier = Modifier.padding(top = 4.dp),
                    )
                    group.forEach { link ->
                        val label = taskLinkLabel(link.number, link.title)
                        TaskLinkRow(
                            label = label,
                            done = link.done,
                            caption = null,
                            onOpen = onOpenTask?.let { open -> { open(link.task_id) } },
                            onRemove = if (canEdit) {
                                {
                                    scope.launch {
                                        error = null
                                        try {
                                            links = repo.removeLink(companyId, taskId, link.task_id, link.relation)
                                            onLinksChanged()
                                        } catch (cancelled: CancellationException) {
                                            throw cancelled
                                        } catch (cause: Exception) {
                                            error = linkErrorMessage(cause, locale)
                                        }
                                    }
                                }
                            } else {
                                null
                            },
                            removeDescription = t("taskLinks.removeLink", "task" to label),
                        )
                    }
                }
            }
        }
        if (loaded?.any { it.relation == TaskRelation.PARENT || it.relation == TaskRelation.SUB_TASK } == true) {
            MutedLine(t("taskLinks.doneNote"))
        }
        error?.let {
            Text(
                it,
                style = MaterialTheme.typography.labelMedium,
                color = MaterialTheme.colorScheme.error,
                modifier = Modifier.padding(vertical = 4.dp),
            )
        }
        if (canEdit) {
            TextButton(onClick = { choosingRelation = true }) { Text(t("taskLinks.addLink")) }
        }
    }

    if (choosingRelation) {
        AlertDialog(
            onDismissRequest = { choosingRelation = false },
            title = { Text(t("taskLinks.addLinkTitle")) },
            text = {
                Column {
                    TaskRelation.ALL.forEach { relation ->
                        TextButton(
                            onClick = {
                                choosingRelation = false
                                pickingFor = relation
                            },
                            modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp),
                        ) { Text(t(TaskRelation.labelKey(relation)), modifier = Modifier.fillMaxWidth()) }
                    }
                }
            },
            confirmButton = {},
            dismissButton = { TextButton(onClick = { choosingRelation = false }) { Text(t("common.cancel")) } },
        )
    }
    pickingFor?.let { relation ->
        TaskPickerSheet(
            repo = repo,
            companyId = companyId,
            excludeTaskId = taskId,
            onPick = { other ->
                pickingFor = null
                scope.launch {
                    error = null
                    try {
                        links = repo.addLink(companyId, taskId, relation, other.id)
                        onLinksChanged()
                    } catch (cancelled: CancellationException) {
                        throw cancelled
                    } catch (cause: Exception) {
                        error = linkErrorMessage(cause, locale)
                    }
                }
            },
            onDismiss = { pickingFor = null },
        )
    }
}

/** Pick one task by number or title. */
@Composable
fun TaskPickerSheet(
    repo: ReferenceRepository,
    companyId: String,
    excludeTaskId: String?,
    onPick: (Task) -> Unit,
    onDismiss: () -> Unit,
) {
    var query by remember { mutableStateOf("") }
    var results by remember { mutableStateOf<List<Task>?>(null) }
    var failed by remember { mutableStateOf(false) }
    LaunchedEffect(query) {
        delay(LINK_SEARCH_DEBOUNCE_MS)
        try {
            results = repo.searchTasks(companyId, query, LINK_SEARCH_LIMIT).filter { it.id != excludeTaskId }
            failed = false
        } catch (cancelled: CancellationException) {
            throw cancelled
        } catch (_: Exception) {
            failed = true
        }
    }
    AppSheet(onDismissRequest = onDismiss) {
        Column(Modifier.fillMaxWidth().padding(horizontal = 18.dp)) {
            Text(t("taskLinks.pickTaskTitle"), style = MaterialTheme.typography.titleMedium)
            SearchField(
                value = query,
                onValueChange = { query = it },
                placeholder = t("taskLinks.searchTasks"),
                maxLength = 80,
                modifier = Modifier.padding(vertical = 10.dp),
            )
            Column(Modifier.heightIn(max = 360.dp).verticalScroll(rememberScrollState())) {
                val shown = results
                when {
                    failed -> MutedLine(t("taskLinks.pickerFailed"))
                    shown == null -> Unit
                    shown.isEmpty() -> MutedLine(t("taskLinks.pickerEmpty"))
                    else -> shown.forEach { task ->
                        TaskLinkRow(
                            label = taskLinkLabel(task.number, task.title),
                            done = task.done,
                            caption = null,
                            onOpen = { onPick(task) },
                            onRemove = null,
                        )
                    }
                }
            }
        }
    }
}
