package com.loonext.android.features.tasks

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.unit.dp
import com.loonext.android.core.i18n.LocalAppLocale
import com.loonext.android.core.i18n.t
import com.loonext.android.core.model.Member
import com.loonext.android.core.model.Tag
import com.loonext.android.ui.common.AppSheet
import com.loonext.android.ui.common.userMessage
import java.time.Instant
import java.time.ZoneId
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch

/** What the preview says it understood, as label and value pairs, in reading order. */
data class QuickAddLine(val labelKey: String, val value: String)

/**
 * The preview rows for a parsed line. Pure, so the wording around what was
 * understood is testable: [dueText] and [priorityText] come from the caller
 * because they are translated and zone-formatted.
 */
fun quickAddPreviewLines(
    result: QuickAddResult,
    dueText: (String) -> String,
    priorityText: (String) -> String,
): List<QuickAddLine> = buildList {
    result.assignee?.let { add(QuickAddLine("quickAdd.assigneeLabel", it.name)) }
    result.dueAt?.let { add(QuickAddLine("quickAdd.dueLabel", dueText(it))) }
    result.priority?.let { add(QuickAddLine("quickAdd.priorityLabel", priorityText(it))) }
    if (result.labels.isNotEmpty()) {
        add(QuickAddLine("quickAdd.labelsLabel", result.labels.joinToString(", ") { it.name }))
    }
}

/**
 * Quick add (#689 A): one line becomes a title, a person, a time, a priority
 * and labels. What was understood is SHOWN before anything is saved; the task is
 * created only when the member taps Add task.
 *
 * Times are read in the device's zone, the same zone every due date in this app
 * is shown and written in.
 */
@Composable
internal fun QuickAddSheet(
    mutations: TaskMutations,
    companyId: String,
    meUserId: String,
    members: List<Member>,
    onDismiss: () -> Unit,
    onCreated: () -> Unit,
    /** The full form, for what one line cannot say. */
    onMoreOptions: () -> Unit,
) {
    val locale = LocalAppLocale.current
    val scope = rememberCoroutineScope()
    val zone = remember { ZoneId.systemDefault() }
    var line by remember { mutableStateOf("") }
    var tags by remember { mutableStateOf<List<Tag>>(emptyList()) }
    var saving by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    val focus = remember { FocusRequester() }

    LaunchedEffect(companyId) {
        tags = runCatching { mutations.tags(companyId).data }.getOrDefault(emptyList())
        focus.requestFocus()
    }

    val context = remember(members, tags, meUserId) {
        QuickAddContext(
            now = Instant.now(),
            timeZone = zone.id,
            selfUserId = meUserId,
            members = members
                .filter { it.deactivated_at == null && it.display_name.isNotBlank() }
                .map { QuickAddMember(it.user_id, it.display_name) },
            labels = tags.map { QuickAddLabel(it.id, it.name) },
        )
    }
    // "Now" is taken when the line changes, so "in 2 hours" means two hours from typing.
    val result = remember(line, context) { parseQuickAdd(line, context.copy(now = Instant.now())) }
    val lines = quickAddPreviewLines(
        result,
        dueText = { dueSentenceTime(it, java.time.Clock.system(zone), locale) },
        priorityText = { com.loonext.android.core.i18n.AppStrings.translate(locale, TaskPriority.labelKey(it)) },
    )
    val canAdd = result.title.isNotBlank() && !saving

    fun add() {
        if (!canAdd) return
        saving = true
        error = null
        scope.launch {
            try {
                mutations.create(
                    companyId = companyId,
                    title = result.title.take(TASK_TITLE_MAX),
                    assignedUserId = null,
                    assigneeIds = result.assignee?.let { listOf(it.userId) },
                    dueAt = result.dueAt?.let {
                        encodeDueAt(Instant.parse(it).atZone(zone).toLocalDateTime(), zone)
                    },
                    priority = result.priority,
                    labelIds = result.labels.map { it.id },
                )
                onCreated()
                onDismiss()
            } catch (cancelled: CancellationException) {
                throw cancelled
            } catch (cause: Exception) {
                error = cause.userMessage(locale)
            } finally {
                saving = false
            }
        }
    }

    AppSheet(onDismissRequest = onDismiss) {
        Column(
            Modifier
                .fillMaxWidth()
                .verticalScroll(rememberScrollState())
                .padding(horizontal = 18.dp)
                .padding(bottom = 20.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Text(t("quickAdd.title"), style = MaterialTheme.typography.titleMedium)
            OutlinedTextField(
                value = line,
                onValueChange = { line = it.take(TASK_TITLE_MAX) },
                label = { Text(t("quickAdd.field")) },
                placeholder = { Text(t("quickAdd.hint")) },
                singleLine = true,
                keyboardOptions = KeyboardOptions(imeAction = ImeAction.Done),
                keyboardActions = KeyboardActions(onDone = { add() }),
                modifier = Modifier.fillMaxWidth().focusRequester(focus),
            )
            Text(
                t("quickAdd.help"),
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )

            Surface(
                shape = MaterialTheme.shapes.medium,
                color = MaterialTheme.colorScheme.surfaceContainer,
                modifier = Modifier.fillMaxWidth(),
            ) {
                Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    Text(
                        t("quickAdd.preview"),
                        style = MaterialTheme.typography.labelMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                    if (line.isBlank()) {
                        Text(t("quickAdd.nothingYet"), style = MaterialTheme.typography.bodyMedium)
                    } else {
                        PreviewRow(
                            t("quickAdd.titleLabel"),
                            result.title.ifBlank { t("quickAdd.noTitle") },
                        )
                        lines.forEach { PreviewRow(t(it.labelKey), it.value) }
                        if (result.ignored.isNotEmpty()) {
                            Text(
                                t("quickAdd.ignored", "words" to result.ignored.joinToString(" ")),
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        }
                    }
                }
            }

            error?.let {
                Text(it, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.error)
            }
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Button(enabled = canAdd, onClick = { add() }) {
                    Text(if (saving) t("quickAdd.adding") else t("quickAdd.add"))
                }
                TextButton(onClick = onMoreOptions) { Text(t("quickAdd.more")) }
            }
        }
    }
}

@Composable
private fun PreviewRow(label: String, value: String) {
    Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
        Text(
            label,
            style = MaterialTheme.typography.labelMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.padding(top = 2.dp),
        )
        Text(value, style = MaterialTheme.typography.bodyMedium)
    }
}
