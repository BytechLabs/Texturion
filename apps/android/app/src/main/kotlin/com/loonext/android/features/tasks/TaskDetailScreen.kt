package com.loonext.android.features.tasks

import android.content.Intent
import android.net.Uri
import android.provider.OpenableColumns
import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.clickable
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
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.Send
import androidx.compose.material.icons.filled.AttachFile
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Event
import androidx.compose.material.icons.filled.MoreVert
import androidx.compose.material.icons.filled.Person
import androidx.compose.material.icons.outlined.Description
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.AssistChip
import androidx.compose.material3.DatePicker
import androidx.compose.material3.DatePickerDialog
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedCard
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TimePicker
import androidx.compose.material3.rememberDatePickerState
import androidx.compose.material3.rememberTimePickerState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import coil3.compose.AsyncImage
import com.loonext.android.AppGraph
import com.loonext.android.BuildConfig
import com.loonext.android.core.model.Me
import com.loonext.android.core.model.Member
import com.loonext.android.core.model.MemberRole
import com.loonext.android.core.model.TaskAttachmentItem
import com.loonext.android.core.model.TaskDetail
import com.loonext.android.core.net.ApiErrorCode
import com.loonext.android.core.net.ApiException
import com.loonext.android.features.contacts.MultipartClient
import com.loonext.android.features.contacts.uploadNoteFile
import com.loonext.android.ui.common.CenteredError
import com.loonext.android.ui.common.CenteredLoading
import com.loonext.android.ui.common.InitialsAvatar
import com.loonext.android.ui.common.LoadState
import com.loonext.android.ui.common.relativeTime
import com.loonext.android.ui.common.userMessage
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.JsonPrimitive
import java.time.Instant
import java.time.LocalDate
import java.time.LocalDateTime
import java.time.LocalTime
import java.time.ZoneId
import java.time.ZoneOffset

private const val NOTE_FILE_MAX_BYTES = 25L * 1024 * 1024
private const val NOTE_FILES_MAX = 10

/** One staged composer file (bytes read at post time, not at pick time). */
private data class StagedFile(val uri: Uri, val name: String, val size: Long, val mime: String)

/**
 * Task detail: inline-editable title/description (blur save), assignee and
 * offset-ISO due pickers, derived done circle (message PATCH), quoted source
 * message, the D28 derived read-only attachments union (per-item signed
 * URLs), the merged activity+discussion timeline, and a pinned note composer
 * (notes are the only door for task files). viewer_level 'none' shows the
 * task identity plus an access notice — nothing conversation-derived.
 */
@Composable
internal fun TaskDetailScreen(
    graph: AppGraph,
    mutations: TaskMutations,
    companyId: String,
    me: Me,
    taskId: String,
    onBack: () -> Unit,
    onOpenConversation: ((conversationId: String, messageId: String) -> Unit)?,
    modifier: Modifier = Modifier,
) {
    BackHandler(onBack = onBack)

    var state by remember(taskId) { mutableStateOf<LoadState<TaskDetail>>(LoadState.Loading) }
    var members by remember(companyId) { mutableStateOf<List<Member>>(emptyList()) }
    var refreshKey by remember(taskId) { mutableStateOf(0) }
    var actionError by remember(taskId) { mutableStateOf<String?>(null) }

    LaunchedEffect(taskId, refreshKey) {
        state = try {
            LoadState.Ready(mutations.detail(companyId, taskId))
        } catch (cause: Exception) {
            val code = (cause as? ApiException)?.code
            when {
                // A teammate deleted it (task.changed → refetch → 404):
                // say so instead of showing a stale row forever.
                code == ApiErrorCode.NOT_FOUND ->
                    LoadState.Failed("This task doesn't exist or was removed.", code)

                state is LoadState.Ready -> state // keep data on a quiet refresh failure
                else -> LoadState.Failed(cause.userMessage(), code)
            }
        }
    }
    LaunchedEffect(companyId) {
        runCatching { mutations.members(companyId) }.onSuccess { members = it.data }
    }
    // Realtime: metadata changes ride task.changed; done flips ride
    // message.status. Payloads are ID-only — match and refetch via the API.
    LaunchedEffect(taskId) {
        graph.realtime.events.collect { event ->
            val detail = (state as? LoadState.Ready)?.value
            when (event.event) {
                "task.changed" -> {
                    val conversation =
                        (event.payload["conversation_id"] as? JsonPrimitive)?.content
                    if (detail == null || conversation == null ||
                        conversation == detail.conversation_id
                    ) {
                        refreshKey++
                    }
                }

                "message.status" -> {
                    val message = (event.payload["message_id"] as? JsonPrimitive)?.content
                    if (detail == null || message == detail.message_id) refreshKey++
                }
            }
        }
    }

    when (val current = state) {
        is LoadState.Loading -> Column(modifier.fillMaxSize()) {
            DetailTopBar(onBack = onBack, menu = {})
            CenteredLoading()
        }

        is LoadState.Failed -> Column(modifier.fillMaxSize()) {
            DetailTopBar(onBack = onBack, menu = {})
            if (current.code == ApiErrorCode.NOT_FOUND) {
                // Deleted (or never visible) — retrying would just 404 again.
                Text(
                    current.message,
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.padding(24.dp),
                )
            } else {
                CenteredError(current.message, onRetry = { refreshKey++ })
            }
        }

        is LoadState.Ready -> TaskDetailBody(
            graph = graph,
            mutations = mutations,
            companyId = companyId,
            me = me,
            detail = current.value,
            members = members,
            actionError = actionError,
            onActionError = { actionError = it },
            onChanged = { refreshKey++ },
            onPatched = { state = LoadState.Ready(it) },
            onDeleted = onBack,
            onBack = onBack,
            onOpenConversation = onOpenConversation,
            modifier = modifier,
        )
    }
}

@Composable
private fun DetailTopBar(
    onBack: () -> Unit,
    menu: @Composable () -> Unit,
) {
    Row(
        Modifier
            .fillMaxWidth()
            .padding(horizontal = 4.dp, vertical = 4.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        IconButton(onClick = onBack) {
            Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Back to tasks")
        }
        Text(
            "Task",
            style = MaterialTheme.typography.titleMedium,
            modifier = Modifier.weight(1f),
        )
        menu()
    }
}

@Composable
private fun TaskDetailBody(
    graph: AppGraph,
    mutations: TaskMutations,
    companyId: String,
    me: Me,
    detail: TaskDetail,
    members: List<Member>,
    actionError: String?,
    onActionError: (String?) -> Unit,
    onChanged: () -> Unit,
    onPatched: (TaskDetail) -> Unit,
    onDeleted: () -> Unit,
    onBack: () -> Unit,
    onOpenConversation: ((String, String) -> Unit)?,
    modifier: Modifier = Modifier,
) {
    val scope = rememberCoroutineScope()
    val context = LocalContext.current
    val noAccess = detail.viewer_level == "none"

    val role = me.memberships.firstOrNull { it.company_id == companyId }?.role
    val canDelete = MemberRole.atLeast(role, MemberRole.ADMIN) ||
        detail.created_by_user_id == me.user_id
    val hasNotes = detail.activity.any { it.kind == "note" }
    val hasContent = hasNotes || detail.attachments.isNotEmpty()

    fun memberName(userId: String?): String? =
        members.firstOrNull { it.user_id == userId }?.display_name?.ifBlank { null }

    fun patched(newDetail: TaskDetail) = onPatched(newDetail)

    // Metadata edits reuse the fetched detail, swapping just the task columns.
    fun applyTask(task: com.loonext.android.core.model.Task) {
        patched(
            detail.copy(
                title = task.title,
                description = task.description,
                assigned_user_id = task.assigned_user_id,
                due_at = task.due_at,
                updated_at = task.updated_at,
            ),
        )
    }

    var menuOpen by remember { mutableStateOf(false) }
    var confirmDelete by remember { mutableStateOf(false) }
    var pickerOpen by remember { mutableStateOf(false) }
    var datePickerOpen by remember { mutableStateOf(false) }
    var timePickerOpen by remember { mutableStateOf(false) }
    var pickedDate by remember { mutableStateOf<LocalDate?>(null) }
    var deleting by remember { mutableStateOf(false) }

    fun toggleDone() {
        val next = !detail.done
        scope.launch {
            onActionError(null)
            try {
                mutations.setDone(companyId, detail.message_id, next)
                onChanged()
            } catch (cause: Exception) {
                onActionError(cause.userMessage())
            }
        }
    }

    fun deleteTask() {
        deleting = true
        scope.launch {
            onActionError(null)
            try {
                mutations.delete(companyId, detail.id)
                onDeleted()
            } catch (cause: Exception) {
                onActionError(
                    if ((cause as? ApiException)?.code == ApiErrorCode.FORBIDDEN) {
                        "Only the task's creator or an admin can delete it."
                    } else {
                        cause.userMessage()
                    },
                )
            } finally {
                deleting = false
            }
        }
    }

    Column(modifier.fillMaxSize()) {
        DetailTopBar(onBack = onBack) {
            Box {
                IconButton(onClick = { menuOpen = true }) {
                    Icon(Icons.Filled.MoreVert, contentDescription = "Task actions")
                }
                DropdownMenu(expanded = menuOpen, onDismissRequest = { menuOpen = false }) {
                    if (!noAccess) {
                        DropdownMenuItem(
                            text = { Text(if (detail.done) "Mark not done" else "Mark done") },
                            onClick = {
                                menuOpen = false
                                toggleDone()
                            },
                        )
                    }
                    if (canDelete) {
                        DropdownMenuItem(
                            text = {
                                Text(
                                    "Delete task",
                                    color = MaterialTheme.colorScheme.error,
                                )
                            },
                            enabled = !deleting,
                            onClick = {
                                menuOpen = false
                                // #89: confirm only when the task carries
                                // notes or files; a plain task deletes now.
                                if (hasContent) confirmDelete = true else deleteTask()
                            },
                        )
                    }
                }
            }
        }

        if (actionError != null) {
            Text(
                actionError,
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.error,
                modifier = Modifier.padding(horizontal = 16.dp, vertical = 4.dp),
            )
        }

        LazyColumn(
            Modifier
                .weight(1f)
                .fillMaxWidth(),
        ) {
            item(key = "header") {
                Row(
                    Modifier
                        .fillMaxWidth()
                        .padding(horizontal = 8.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    if (!noAccess) {
                        DoneCircle(done = detail.done, onToggle = { toggleDone() })
                    }
                    if (noAccess) {
                        Text(
                            detail.title,
                            style = MaterialTheme.typography.titleLarge,
                            modifier = Modifier
                                .weight(1f)
                                .padding(horizontal = 8.dp, vertical = 12.dp),
                            textDecoration =
                            if (detail.done) TextDecoration.LineThrough else null,
                        )
                    } else {
                        InlineEditField(
                            key = detail.id + detail.updated_at + ":title",
                            initial = detail.title,
                            maxLength = TASK_TITLE_MAX,
                            placeholder = "Task title",
                            singleLine = true,
                            allowEmpty = false,
                            textStyle = MaterialTheme.typography.titleLarge,
                            onSave = { value ->
                                try {
                                    applyTask(mutations.rename(companyId, detail.id, value))
                                    null
                                } catch (cause: Exception) {
                                    cause.userMessage()
                                }
                            },
                            modifier = Modifier.weight(1f),
                        )
                    }
                }
            }

            item(key = "meta") {
                Row(
                    Modifier
                        .fillMaxWidth()
                        .padding(horizontal = 16.dp, vertical = 4.dp),
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    val assigneeLabel = detail.assignee?.display_name?.ifBlank { null }
                        ?: memberName(detail.assigned_user_id)
                        ?: if (detail.assigned_user_id == null) "Unassigned" else "Teammate"
                    AssistChip(
                        onClick = { if (!noAccess) pickerOpen = true },
                        label = {
                            Text(
                                if (detail.assigned_user_id != null &&
                                    detail.assigned_user_id == me.user_id
                                ) {
                                    "You"
                                } else {
                                    assigneeLabel
                                },
                            )
                        },
                        leadingIcon = {
                            Icon(
                                Icons.Filled.Person,
                                contentDescription = null,
                                modifier = Modifier.size(16.dp),
                            )
                        },
                    )
                    val overdue = !detail.done && detail.due_at != null &&
                        parseInstant(detail.due_at)?.isBefore(Instant.now()) == true
                    AssistChip(
                        onClick = { if (!noAccess) datePickerOpen = true },
                        label = {
                            Text(
                                when {
                                    detail.due_at == null -> "No due date"
                                    overdue -> "Overdue · ${formatDue(detail.due_at)}"
                                    else -> "Due ${formatDue(detail.due_at)}"
                                },
                                color = if (overdue) MaterialTheme.colorScheme.tertiary
                                else androidx.compose.ui.graphics.Color.Unspecified,
                            )
                        },
                        leadingIcon = {
                            Icon(
                                Icons.Filled.Event,
                                contentDescription = null,
                                modifier = Modifier.size(16.dp),
                            )
                        },
                    )
                    if (detail.due_at != null && !noAccess) {
                        IconButton(
                            onClick = {
                                scope.launch {
                                    onActionError(null)
                                    try {
                                        applyTask(mutations.setDue(companyId, detail.id, null))
                                    } catch (cause: Exception) {
                                        onActionError(cause.userMessage())
                                    }
                                }
                            },
                            modifier = Modifier.size(28.dp),
                        ) {
                            Icon(
                                Icons.Filled.Close,
                                contentDescription = "Clear due date",
                                modifier = Modifier.size(16.dp),
                            )
                        }
                    }
                }
                val creator = detail.created_by?.display_name?.ifBlank { null }
                    ?: memberName(detail.created_by_user_id)
                Text(
                    listOfNotNull(
                        creator?.let { "Created by $it" },
                        relativeTime(detail.created_at),
                    ).joinToString(" · "),
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.padding(horizontal = 16.dp),
                )
            }

            if (noAccess) {
                item(key = "no-access") {
                    OutlinedCard(
                        Modifier
                            .fillMaxWidth()
                            .padding(16.dp),
                    ) {
                        Text(
                            "This task is linked to a number you don't have access to. " +
                                "You can see the task, but not its messages, files, or " +
                                "discussion. Ask an owner or admin for access.",
                            style = MaterialTheme.typography.bodyMedium,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                            modifier = Modifier.padding(12.dp),
                        )
                    }
                }
            } else {
                item(key = "source") {
                    val source = detail.source_message
                    if (source != null) {
                        Column(Modifier.padding(horizontal = 16.dp, vertical = 8.dp)) {
                            SectionLabel("From this message")
                            OutlinedCard(Modifier.fillMaxWidth()) {
                                Column(Modifier.padding(12.dp)) {
                                    Text(
                                        source.body.ifBlank { "A photo" },
                                        style = MaterialTheme.typography.bodyMedium,
                                    )
                                    if (onOpenConversation != null) {
                                        Text(
                                            "View in conversation",
                                            style = MaterialTheme.typography.labelLarge,
                                            color = MaterialTheme.colorScheme.primary,
                                            modifier = Modifier
                                                .padding(top = 8.dp)
                                                .clickable {
                                                    onOpenConversation(
                                                        detail.conversation_id,
                                                        detail.message_id,
                                                    )
                                                },
                                        )
                                    }
                                }
                            }
                        }
                    }
                }

                item(key = "description") {
                    Column(Modifier.padding(horizontal = 16.dp, vertical = 8.dp)) {
                        SectionLabel("Notes on this task")
                        InlineEditField(
                            key = detail.id + detail.updated_at + ":description",
                            initial = detail.description,
                            maxLength = TASK_DESCRIPTION_MAX,
                            placeholder = "Add details teammates should know",
                            singleLine = false,
                            allowEmpty = true,
                            textStyle = MaterialTheme.typography.bodyMedium,
                            onSave = { value ->
                                try {
                                    applyTask(
                                        mutations.describe(companyId, detail.id, value),
                                    )
                                    null
                                } catch (cause: Exception) {
                                    cause.userMessage()
                                }
                            },
                            modifier = Modifier.fillMaxWidth(),
                        )
                    }
                }

                if (detail.attachments.isNotEmpty()) {
                    item(key = "attachments") {
                        Column(Modifier.padding(horizontal = 16.dp, vertical = 8.dp)) {
                            SectionLabel("Files")
                            LazyRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                items(
                                    detail.attachments.size,
                                    key = { detail.attachments[it].id },
                                ) { index ->
                                    AttachmentCell(
                                        item = detail.attachments[index],
                                        mutations = mutations,
                                        companyId = companyId,
                                        onError = onActionError,
                                    )
                                }
                            }
                        }
                    }
                }

                item(key = "activity-label") {
                    Column(Modifier.padding(horizontal = 16.dp, vertical = 8.dp)) {
                        SectionLabel("Activity")
                        if (detail.activity.isEmpty()) {
                            Text(
                                "No activity yet. Post a note below to start a discussion.",
                                style = MaterialTheme.typography.bodyMedium,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        }
                    }
                }

                items(detail.activity.size, key = { "act:${detail.activity[it].id}" }) { i ->
                    val item = detail.activity[i]
                    if (item.kind == "note") {
                        NoteCard(
                            author = item.author?.display_name?.ifBlank { null }
                                ?: memberName(item.author_user_id) ?: "Teammate",
                            body = item.body.orEmpty(),
                            createdAt = item.created_at,
                        )
                    } else {
                        val sentence = taskEventSentence(
                            item,
                            by = item.actor?.display_name?.ifBlank { null }
                                ?: memberName(item.actor_user_id) ?: "Loonext",
                            memberName = ::memberName,
                        )
                        if (sentence != null) {
                            Text(
                                "$sentence · ${relativeTime(item.created_at)}",
                                style = MaterialTheme.typography.labelSmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                                modifier = Modifier.padding(
                                    horizontal = 20.dp,
                                    vertical = 4.dp,
                                ),
                            )
                        }
                    }
                }

                item(key = "bottom-space") { Spacer(Modifier.height(12.dp)) }
            }
        }

        if (!noAccess) {
            HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
            NoteComposer(
                graph = graph,
                mutations = mutations,
                companyId = companyId,
                conversationId = detail.conversation_id,
                taskId = detail.id,
                onPosted = onChanged,
            )
        }
    }

    if (confirmDelete) {
        AlertDialog(
            onDismissRequest = { confirmDelete = false },
            title = { Text("Delete this task?") },
            text = {
                Text(
                    "It carries " + listOfNotNull(
                        if (hasNotes) "discussion notes" else null,
                        if (detail.attachments.isNotEmpty()) "files" else null,
                    ).joinToString(" and ") +
                        ". The conversation and its messages stay; the done mark " +
                        "on the source message is kept.",
                )
            },
            confirmButton = {
                TextButton(
                    enabled = !deleting,
                    onClick = {
                        confirmDelete = false
                        deleteTask()
                    },
                ) { Text("Delete", color = MaterialTheme.colorScheme.error) }
            },
            dismissButton = {
                TextButton(onClick = { confirmDelete = false }) { Text("Keep task") }
            },
        )
    }

    if (pickerOpen) {
        MemberPickerSheet(
            members = members,
            meUserId = me.user_id,
            selectedUserId = detail.assigned_user_id,
            showUnassigned = true,
            onPick = { userId ->
                pickerOpen = false
                scope.launch {
                    onActionError(null)
                    try {
                        applyTask(mutations.assign(companyId, detail.id, userId))
                    } catch (cause: Exception) {
                        onActionError(cause.userMessage())
                    }
                }
            },
            onDismiss = { pickerOpen = false },
        )
    }

    if (datePickerOpen) {
        val initialMillis = parseInstant(detail.due_at)
            ?.atZone(ZoneId.systemDefault())?.toLocalDate()
            ?.atStartOfDay(ZoneOffset.UTC)?.toInstant()?.toEpochMilli()
        val dateState = rememberDatePickerState(initialSelectedDateMillis = initialMillis)
        DatePickerDialog(
            onDismissRequest = { datePickerOpen = false },
            confirmButton = {
                TextButton(
                    enabled = dateState.selectedDateMillis != null,
                    onClick = {
                        val millis = dateState.selectedDateMillis ?: return@TextButton
                        pickedDate = Instant.ofEpochMilli(millis)
                            .atZone(ZoneOffset.UTC).toLocalDate()
                        datePickerOpen = false
                        timePickerOpen = true
                    },
                ) { Text("Next") }
            },
            dismissButton = {
                TextButton(onClick = { datePickerOpen = false }) { Text("Cancel") }
            },
        ) { DatePicker(state = dateState) }
    }

    if (timePickerOpen) {
        val existing = parseInstant(detail.due_at)?.atZone(ZoneId.systemDefault())
        val timeState = rememberTimePickerState(
            initialHour = existing?.hour ?: 9,
            initialMinute = existing?.minute ?: 0,
        )
        AlertDialog(
            onDismissRequest = { timePickerOpen = false },
            title = { Text("Due time") },
            text = { TimePicker(state = timeState) },
            confirmButton = {
                TextButton(onClick = {
                    val date = pickedDate ?: LocalDate.now()
                    timePickerOpen = false
                    val local = LocalDateTime.of(
                        date,
                        LocalTime.of(timeState.hour, timeState.minute),
                    )
                    // The API requires ISO 8601 WITH the local UTC offset.
                    val iso = encodeDueAt(local, ZoneId.systemDefault())
                    scope.launch {
                        onActionError(null)
                        try {
                            applyTask(mutations.setDue(companyId, detail.id, iso))
                        } catch (cause: Exception) {
                            onActionError(cause.userMessage())
                        }
                    }
                }) { Text("Set due date") }
            },
            dismissButton = {
                TextButton(onClick = { timePickerOpen = false }) { Text("Cancel") }
            },
        )
    }
}

@Composable
private fun SectionLabel(text: String) {
    Text(
        text,
        style = MaterialTheme.typography.labelMedium,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
        modifier = Modifier.padding(bottom = 6.dp),
    )
}

/**
 * Blur-save inline editor: saving happens when focus leaves the field with a
 * changed value; an empty value snaps back when [allowEmpty] is false. The
 * save callback returns an error sentence (null = saved) so failures keep the
 * user's text and show a calm line under the field.
 */
@Composable
private fun InlineEditField(
    key: String,
    initial: String,
    maxLength: Int,
    placeholder: String,
    singleLine: Boolean,
    allowEmpty: Boolean,
    textStyle: androidx.compose.ui.text.TextStyle,
    onSave: suspend (String) -> String?,
    modifier: Modifier = Modifier,
) {
    var value by remember(key) { mutableStateOf(initial) }
    var focused by remember(key) { mutableStateOf(false) }
    var error by remember(key) { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()

    Column(modifier) {
        OutlinedTextField(
            value = value,
            onValueChange = {
                value = it.take(maxLength)
                error = null
            },
            textStyle = textStyle,
            placeholder = { Text(placeholder) },
            singleLine = singleLine,
            keyboardOptions = KeyboardOptions.Default,
            modifier = Modifier
                .fillMaxWidth()
                .onFocusChanged { focusState ->
                    val wasFocused = focused
                    focused = focusState.isFocused
                    if (wasFocused && !focusState.isFocused) {
                        val trimmed = value.trim()
                        if (trimmed == initial.trim()) return@onFocusChanged
                        if (trimmed.isEmpty() && !allowEmpty) {
                            value = initial // empty snaps back
                            return@onFocusChanged
                        }
                        scope.launch { error = onSave(trimmed) }
                    }
                },
        )
        if (error != null) {
            Text(
                error.orEmpty(),
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.error,
                modifier = Modifier.padding(top = 2.dp),
            )
        }
    }
}

/**
 * One derived-union attachment. URLs are short-lived and NEVER cached: images
 * mint on entering the composition (per view), files mint at open time and
 * hand the signed URL to the browser — the honest path without a download
 * pipeline or a FileProvider manifest entry.
 */
@Composable
private fun AttachmentCell(
    item: TaskAttachmentItem,
    mutations: TaskMutations,
    companyId: String,
    onError: (String?) -> Unit,
) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()

    if (item.kind == "image") {
        var url by remember(item.id) { mutableStateOf<String?>(null) }
        var failed by remember(item.id) { mutableStateOf(false) }
        LaunchedEffect(item.id) {
            try {
                url = mutations.attachmentUrl(companyId, item.id).url
            } catch (cause: Exception) {
                failed = true
                onError(cause.userMessage())
            }
        }
        Surface(
            shape = MaterialTheme.shapes.medium,
            color = MaterialTheme.colorScheme.surfaceVariant,
            modifier = Modifier.size(96.dp),
        ) {
            when {
                url != null -> AsyncImage(
                    model = url,
                    contentDescription = item.file_name ?: "Photo",
                    contentScale = androidx.compose.ui.layout.ContentScale.Crop,
                    modifier = Modifier
                        .fillMaxSize()
                        .clickable {
                            scope.launch {
                                try {
                                    val fresh =
                                        mutations.attachmentUrl(companyId, item.id).url
                                    context.startActivity(
                                        Intent(Intent.ACTION_VIEW, Uri.parse(fresh)),
                                    )
                                } catch (cause: Exception) {
                                    onError(cause.userMessage())
                                }
                            }
                        },
                )

                failed -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                    Text(
                        "Couldn't load",
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }

                else -> Box(Modifier.fillMaxSize())
            }
        }
    } else {
        OutlinedCard(
            modifier = Modifier
                .width(180.dp)
                .clickable {
                    scope.launch {
                        try {
                            val fresh = mutations.attachmentUrl(companyId, item.id).url
                            context.startActivity(
                                Intent(Intent.ACTION_VIEW, Uri.parse(fresh)),
                            )
                        } catch (cause: Exception) {
                            onError(cause.userMessage())
                        }
                    }
                },
        ) {
            Row(
                Modifier.padding(10.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Icon(
                    Icons.Outlined.Description,
                    contentDescription = null,
                    tint = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                Spacer(Modifier.width(8.dp))
                Column {
                    Text(
                        item.file_name ?: "File",
                        style = MaterialTheme.typography.bodySmall,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )
                    Text(
                        formatBytes(item.size_bytes),
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }
        }
    }
}

internal fun formatBytes(bytes: Long?): String = when {
    bytes == null -> ""
    bytes >= 1024 * 1024 -> "%.1f MB".format(bytes / 1024.0 / 1024.0)
    bytes >= 1024 -> "${bytes / 1024} KB"
    else -> "$bytes B"
}

/** A task-linked discussion note: amber card with author + time + body. */
@Composable
private fun NoteCard(author: String, body: String, createdAt: String) {
    Surface(
        shape = MaterialTheme.shapes.medium,
        color = MaterialTheme.colorScheme.tertiaryContainer,
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 16.dp, vertical = 4.dp),
    ) {
        Column(Modifier.padding(12.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                InitialsAvatar(author, size = 24.dp)
                Spacer(Modifier.width(8.dp))
                Text(
                    author,
                    style = MaterialTheme.typography.labelLarge,
                    color = MaterialTheme.colorScheme.onTertiaryContainer,
                    modifier = Modifier.weight(1f),
                )
                Text(
                    relativeTime(createdAt),
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onTertiaryContainer,
                )
            }
            if (body.isNotBlank()) {
                Text(
                    body,
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onTertiaryContainer,
                    modifier = Modifier.padding(top = 6.dp),
                )
            }
        }
    }
}

/**
 * The pinned note composer (TASKS-V2 D-D): posts an internal note with
 * task_id, then uploads staged files against the note (owner_type='note' —
 * the only door for task files, D28). Partial upload failure keeps an honest
 * line pointing at the note in the thread.
 */
@Composable
private fun NoteComposer(
    graph: AppGraph,
    mutations: TaskMutations,
    companyId: String,
    conversationId: String,
    taskId: String,
    onPosted: () -> Unit,
) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val multipart = remember { MultipartClient(graph.api, BuildConfig.API_URL) }

    var body by remember(taskId) { mutableStateOf("") }
    var staged by remember(taskId) { mutableStateOf(listOf<StagedFile>()) }
    var posting by remember(taskId) { mutableStateOf(false) }
    var error by remember(taskId) { mutableStateOf<String?>(null) }

    val filePicker = rememberLauncherForActivityResult(
        ActivityResultContracts.OpenMultipleDocuments(),
    ) { uris ->
        if (uris.isEmpty()) return@rememberLauncherForActivityResult
        val room = NOTE_FILES_MAX - staged.size
        val next = uris.take(room).mapNotNull { uri -> describeFile(context, uri) }
        val oversize = next.filter { it.size > NOTE_FILE_MAX_BYTES }
        error = when {
            uris.size > room -> "Up to $NOTE_FILES_MAX files per note."
            oversize.isNotEmpty() -> "Files must be 25 MB or less."
            else -> null
        }
        staged = staged + next.filter { it.size <= NOTE_FILE_MAX_BYTES }
    }

    Column(
        Modifier
            .fillMaxWidth()
            .padding(horizontal = 12.dp, vertical = 8.dp),
    ) {
        if (staged.isNotEmpty()) {
            LazyRow(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                items(staged.size, key = { staged[it].uri.toString() }) { index ->
                    val file = staged[index]
                    AssistChip(
                        onClick = { staged = staged - file },
                        label = {
                            Text(file.name, maxLines = 1, overflow = TextOverflow.Ellipsis)
                        },
                        trailingIcon = {
                            Icon(
                                Icons.Filled.Close,
                                contentDescription = "Remove ${file.name}",
                                modifier = Modifier.size(14.dp),
                            )
                        },
                    )
                }
            }
        }
        if (error != null) {
            Text(
                error.orEmpty(),
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.error,
                modifier = Modifier.padding(vertical = 2.dp),
            )
        }
        Row(verticalAlignment = Alignment.Bottom) {
            IconButton(
                enabled = !posting && staged.size < NOTE_FILES_MAX,
                onClick = { filePicker.launch(arrayOf("*/*")) },
            ) {
                Icon(Icons.Filled.AttachFile, contentDescription = "Attach files")
            }
            OutlinedTextField(
                value = body,
                onValueChange = {
                    body = it.take(NOTE_BODY_MAX)
                    error = null
                },
                placeholder = { Text("Add a note for your team") },
                modifier = Modifier.weight(1f),
                maxLines = 4,
            )
            IconButton(
                enabled = !posting && (body.isNotBlank() || staged.isNotEmpty()),
                onClick = {
                    posting = true
                    error = null
                    scope.launch {
                        try {
                            val note = mutations.postNote(
                                companyId,
                                conversationId,
                                body.trim(),
                                taskId,
                            )
                            var failures = 0
                            for (file in staged) {
                                val bytes = withContext(Dispatchers.IO) {
                                    runCatching {
                                        context.contentResolver.openInputStream(file.uri)
                                            ?.use { it.readBytes() }
                                    }.getOrNull()
                                }
                                if (bytes == null) {
                                    failures++
                                    continue
                                }
                                try {
                                    multipart.uploadNoteFile(
                                        companyId = companyId,
                                        noteId = note.id,
                                        fileName = file.name,
                                        contentType = file.mime,
                                        bytes = bytes,
                                    )
                                } catch (_: Exception) {
                                    failures++
                                }
                            }
                            body = ""
                            staged = emptyList()
                            error = if (failures > 0) {
                                "The note posted, but $failures " +
                                    (if (failures == 1) "file" else "files") +
                                    " didn't upload. Retry from the note in the thread."
                            } else null
                            onPosted()
                        } catch (cause: Exception) {
                            error = cause.userMessage()
                        } finally {
                            posting = false
                        }
                    }
                },
            ) {
                Icon(
                    Icons.AutoMirrored.Filled.Send,
                    contentDescription = "Post note",
                    tint = MaterialTheme.colorScheme.primary,
                )
            }
        }
    }
}

/** Resolve a picked document's display name, size, and MIME type. */
private fun describeFile(context: android.content.Context, uri: Uri): StagedFile? {
    val resolver = context.contentResolver
    val mime = resolver.getType(uri) ?: "application/octet-stream"
    var name = "file"
    var size = -1L
    runCatching {
        resolver.query(uri, null, null, null, null)?.use { cursor ->
            if (cursor.moveToFirst()) {
                val nameIndex = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME)
                val sizeIndex = cursor.getColumnIndex(OpenableColumns.SIZE)
                if (nameIndex >= 0) name = cursor.getString(nameIndex) ?: name
                if (sizeIndex >= 0 && !cursor.isNull(sizeIndex)) {
                    size = cursor.getLong(sizeIndex)
                }
            }
        }
    }
    return StagedFile(uri = uri, name = name, size = size, mime = mime)
}
