package com.loonext.android.features.tasks

import android.content.Intent
import android.net.Uri
import android.provider.OpenableColumns
import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.animation.AnimatedContent
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.IntrinsicSize
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ArrowBack
import androidx.compose.material.icons.outlined.ArrowUpward
import androidx.compose.material.icons.outlined.AttachFile
import androidx.compose.material.icons.outlined.AutoAwesome
import androidx.compose.material.icons.outlined.Close
import androidx.compose.material.icons.outlined.Description
import androidx.compose.material.icons.outlined.ExpandMore
import androidx.compose.material.icons.outlined.Lock
import androidx.compose.material.icons.outlined.MoreHoriz
import androidx.compose.material.icons.outlined.Place
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.AssistChip
import androidx.compose.material3.DatePicker
import androidx.compose.material3.DatePickerDialog
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.IconButtonDefaults
import androidx.compose.material3.LocalTextStyle
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Surface
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TimePicker
import androidx.compose.material3.rememberDatePickerState
import androidx.compose.material3.rememberTimePickerState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.em
import androidx.compose.ui.unit.sp
import coil3.compose.AsyncImage
import com.loonext.android.AppGraph
import com.loonext.android.BuildConfig
import com.loonext.android.core.data.CacheKeys
import com.loonext.android.core.i18n.AppStrings
import com.loonext.android.core.i18n.LocalAppLocale
import com.loonext.android.core.i18n.t
import com.loonext.android.core.model.AddressProvenance
import com.loonext.android.core.model.Me
import com.loonext.android.core.model.Member
import com.loonext.android.core.model.MemberRole
import com.loonext.android.core.model.TaskAddressInput
import com.loonext.android.core.model.TaskAttachmentItem
import com.loonext.android.core.model.TaskDetail
import com.loonext.android.core.model.addressProvenanceLabel
import com.loonext.android.core.net.ApiErrorCode
import com.loonext.android.core.net.ApiException
import com.loonext.android.features.contacts.MultipartClient
import com.loonext.android.features.contacts.uploadNoteFile
import com.loonext.android.ui.common.AiOrb
import com.loonext.android.ui.common.AiOrbState
import com.loonext.android.ui.common.CenteredError
import com.loonext.android.ui.common.CountryField
import com.loonext.android.ui.common.DsChip
import com.loonext.android.ui.common.LoadState
import com.loonext.android.ui.common.PaperCard
import com.loonext.android.ui.common.ResyncOnResume
import com.loonext.android.ui.common.RowDivider
import com.loonext.android.ui.common.SectionHeader
import com.loonext.android.ui.common.SkeletonBlock
import com.loonext.android.ui.common.pressScale
import com.loonext.android.ui.common.relativeTime
import com.loonext.android.ui.common.rememberHaptics
import com.loonext.android.ui.common.userMessage
import com.loonext.android.ui.theme.BrandColor
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
import java.time.format.DateTimeFormatter
import com.loonext.android.core.jobs.groupJobPhotos

private const val NOTE_FILE_MAX_BYTES = 25L * 1024 * 1024
private const val NOTE_FILES_MAX = 10

/** One staged composer file (bytes read at post time, not at pick time). */
private data class StagedFile(val uri: Uri, val name: String, val size: Long, val mime: String)

/**
 * Task detail (spec 23): paper-circle top bar, big done ring + 21sp title
 * (inline blur-save edit), status chip + created line, the Assignee/Due paper
 * rows, the lime-barred source-message quote, the D28 derived read-only
 * attachments union (per-item signed URLs), the merged activity+discussion
 * timeline (dashed internal-note cards), and the pinned pill note composer
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

    // #176 cache-first: a revisit paints the cached detail instantly while it
    // revalidates silently. Hand-rolled against StoreCache (instead of
    // rememberCacheFirst) because a refetch 404 must EVICT and replace even
    // cached data — a teammate deleting the task must not leave a stale row
    // on screen forever.
    // #228: read in composition; the fetch effect below is not composition.
    val locale = LocalAppLocale.current
    val cacheKey = CacheKeys.task(companyId, taskId)
    val detailFlow = remember(cacheKey) { graph.storeCache.flowOf<TaskDetail>(cacheKey) }
    val cachedDetail by detailFlow.collectAsState()
    var failure by remember(taskId) { mutableStateOf<LoadState.Failed?>(null) }
    var members by remember(companyId) { mutableStateOf<List<Member>>(emptyList()) }
    var refreshKey by remember(taskId) { mutableStateOf(0) }
    var actionError by remember(taskId) { mutableStateOf<String?>(null) }

    LaunchedEffect(taskId, refreshKey) {
        try {
            detailFlow.value = mutations.detail(companyId, taskId)
            failure = null
        } catch (cause: Exception) {
            val code = (cause as? ApiException)?.code
            failure = when {
                // A teammate deleted it (task.changed → refetch → 404):
                // evict and say so instead of showing a stale row forever.
                code == ApiErrorCode.NOT_FOUND -> {
                    detailFlow.value = null
                    LoadState.Failed(
                        AppStrings.translate(locale, "contactsTasks.taskGone"),
                        code,
                    )
                }

                // Keep shown data on a quiet refresh failure.
                detailFlow.value != null -> null
                else -> LoadState.Failed(cause.userMessage(locale), code)
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
            val detail = detailFlow.value
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
    // #215: this screen carried no reconnect subscriber at all — an in-
    // foreground socket re-JOIN (which may have skipped frames while the
    // channel was down) must also refetch the detail.
    LaunchedEffect(taskId) {
        graph.realtime.reconnected.collect { refreshKey++ }
    }
    // ...and a frame missed while backgrounded/blurred heals on return to the
    // foreground.
    ResyncOnResume(taskId) { refreshKey++ }

    // The cached value always wins the render; the ONLY failure that may
    // outrank shown data is the explicit not-found eviction above.
    val state: LoadState<TaskDetail> = cachedDetail?.let { LoadState.Ready(it) }
        ?: failure
        ?: LoadState.Loading

    when (val current = state) {
        is LoadState.Loading -> Column(modifier.fillMaxSize()) {
            DetailTopBar(onBack = onBack, menu = { Spacer(Modifier.size(44.dp)) })
            TaskDetailSkeleton()
        }

        is LoadState.Failed -> Column(modifier.fillMaxSize()) {
            DetailTopBar(onBack = onBack, menu = { Spacer(Modifier.size(44.dp)) })
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
            onPatched = { graph.storeCache.put(cacheKey, it) },
            onDeleted = onBack,
            onBack = onBack,
            onOpenConversation = onOpenConversation,
            modifier = modifier,
        )
    }
}

/** Paper-circle back button · centered "Task" label · the actions circle. */
@Composable
private fun DetailTopBar(
    onBack: () -> Unit,
    menu: @Composable () -> Unit,
) {
    Row(
        Modifier
            .fillMaxWidth()
            .padding(start = 18.dp, end = 18.dp, top = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        PaperCircleButton(
            icon = Icons.AutoMirrored.Outlined.ArrowBack,
            contentDescription = t("contactsTasks.backToTasks"),
            onClick = onBack,
        )
        Text(
            t("contactsTasks.taskHeading"),
            fontSize = 13.sp,
            fontWeight = FontWeight.SemiBold,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            textAlign = TextAlign.Center,
            modifier = Modifier.weight(1f),
        )
        menu()
    }
}

/**
 * First-fetch stand-in in the detail grammar (spec 23): done ring + title
 * stub, created line, the Assignee/Due paper card, then a details block.
 * With cache-first (#176) a revisit paints real data in the first frame, so
 * this can only ever show on the true first fetch of a task.
 */
@Composable
private fun TaskDetailSkeleton() {
    Column(
        Modifier
            .fillMaxWidth()
            .padding(horizontal = 18.dp),
    ) {
        Row(
            Modifier.padding(top = 14.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            SkeletonBlock(30.dp, 30.dp, shape = CircleShape)
            Spacer(Modifier.width(12.dp))
            SkeletonBlock(198.dp, 17.dp)
        }
        Spacer(Modifier.height(13.dp))
        SkeletonBlock(148.dp, 11.dp)
        Spacer(Modifier.height(16.dp))
        Column(
            Modifier
                .fillMaxWidth()
                .clip(MaterialTheme.shapes.large)
                .background(MaterialTheme.colorScheme.surface)
                .padding(horizontal = 15.dp, vertical = 14.dp),
        ) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                SkeletonBlock(44.dp, 10.dp)
                Spacer(Modifier.width(20.dp))
                SkeletonBlock(88.dp, 12.dp)
            }
            Spacer(Modifier.height(19.dp))
            Row(verticalAlignment = Alignment.CenterVertically) {
                SkeletonBlock(44.dp, 10.dp)
                Spacer(Modifier.width(20.dp))
                SkeletonBlock(116.dp, 12.dp)
            }
        }
        Spacer(Modifier.height(16.dp))
        SkeletonBlock(60.dp, 10.dp)
        Spacer(Modifier.height(8.dp))
        SkeletonBlock(236.dp, 12.dp)
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
    val haptics = rememberHaptics()
    val locale = LocalAppLocale.current
    val teammateLabel = t("contactsTasks.teammate")
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
                // #214: reflect the saved (or cleared) structured address.
                addr_street = task.addr_street,
                addr_unit = task.addr_unit,
                addr_city = task.addr_city,
                addr_state = task.addr_state,
                addr_postal_code = task.addr_postal_code,
                addr_country = task.addr_country,
                addr_provenance = task.addr_provenance,
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
        // Marking done commits; unmarking is a light touch. One haptic serves
        // both the header ring and the menu item — they share this path.
        if (next) haptics.confirm() else haptics.tap()
        scope.launch {
            onActionError(null)
            try {
                mutations.setDone(companyId, detail.message_id, next)
                onChanged()
            } catch (cause: Exception) {
                onActionError(cause.userMessage(locale))
            }
        }
    }

    fun deleteTask() {
        // Destructive commit — fires once whether it came straight from the
        // menu or through the confirm dialog (both funnel here).
        haptics.reject()
        deleting = true
        scope.launch {
            onActionError(null)
            try {
                mutations.delete(companyId, detail.id)
                onDeleted()
            } catch (cause: Exception) {
                onActionError(
                    if ((cause as? ApiException)?.code == ApiErrorCode.FORBIDDEN) {
                        AppStrings.translate(locale, "contactsTasks.deleteForbidden")
                    } else {
                        cause.userMessage(locale)
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
                PaperCircleButton(
                    icon = Icons.Outlined.MoreHoriz,
                    contentDescription = t("contactsTasks.taskActions"),
                    onClick = {
                        haptics.tap()
                        menuOpen = true
                    },
                )
                DropdownMenu(expanded = menuOpen, onDismissRequest = { menuOpen = false }) {
                    if (!noAccess) {
                        DropdownMenuItem(
                            text = {
                                Text(
                                    t(
                                        if (detail.done) {
                                            "contactsTasks.markNotDone"
                                        } else {
                                            "contactsTasks.markDone"
                                        },
                                    ),
                                )
                            },
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
                                    t("contactsTasks.deleteTask"),
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
                modifier = Modifier.padding(horizontal = 18.dp, vertical = 4.dp),
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
                        .padding(start = 14.dp, end = 18.dp, top = 8.dp),
                    verticalAlignment = Alignment.Top,
                ) {
                    if (!noAccess) {
                        DoneCircle(
                            done = detail.done,
                            onToggle = { toggleDone() },
                            ring = 30.dp,
                            checkSize = 16.dp,
                            ringWidth = 2.dp,
                            touch = 44.dp,
                            modifier = Modifier.padding(top = 2.dp),
                        )
                    }
                    if (noAccess) {
                        Text(
                            detail.title,
                            fontSize = 21.sp,
                            fontWeight = FontWeight.SemiBold,
                            lineHeight = 26.sp,
                            letterSpacing = (-0.01).em,
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
                            placeholder = t("contactsTasks.taskTitlePlaceholder"),
                            singleLine = true,
                            allowEmpty = false,
                            textStyle = MaterialTheme.typography.titleLarge.copy(
                                fontSize = 21.sp,
                                fontWeight = FontWeight.SemiBold,
                                lineHeight = 26.sp,
                                letterSpacing = (-0.01).em,
                            ),
                            onSave = { value ->
                                try {
                                    applyTask(mutations.rename(companyId, detail.id, value))
                                    null
                                } catch (cause: Exception) {
                                    cause.userMessage(locale)
                                }
                            },
                            modifier = Modifier.weight(1f),
                        )
                    }
                }
            }

            item(key = "status-line") {
                val creator = detail.created_by?.display_name?.ifBlank { null }
                    ?: memberName(detail.created_by_user_id)
                Row(
                    Modifier.padding(start = 18.dp, end = 18.dp, top = 4.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(7.dp),
                ) {
                    // AnimatedContent so the done flip morphs the chip instead
                    // of hard-swapping it.
                    AnimatedContent(
                        targetState = detail.done,
                        label = "statusChip",
                    ) { done ->
                        DsChip(
                            t(
                                if (done) {
                                    "contactsTasks.columnDone"
                                } else {
                                    "contactsTasks.columnToDo"
                                },
                            ),
                        )
                    }
                    Text(
                        listOfNotNull(
                            t(
                                "contactsTasks.createdWhen",
                                "when" to relativeTime(detail.created_at),
                            ),
                            creator?.let { t("contactsTasks.createdBy", "who" to it) },
                        ).joinToString(" "),
                        fontSize = 11.5.sp,
                        color = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.8f),
                    )
                }
            }

            item(key = "meta") {
                val overdue = !detail.done && detail.due_at != null &&
                    parseInstant(detail.due_at)?.isBefore(Instant.now()) == true
                PaperCard(
                    Modifier
                        .fillMaxWidth()
                        .padding(start = 18.dp, end = 18.dp, top = 14.dp),
                ) {
                    // Assignee row.
                    MetaRow(
                        label = t("contactsTasks.assignee"),
                        onClick = if (noAccess) null else {
                            {
                                haptics.tap()
                                pickerOpen = true
                            }
                        },
                    ) {
                        val assigneeLabel = detail.assignee?.display_name?.ifBlank { null }
                            ?: memberName(detail.assigned_user_id)
                            ?: if (detail.assigned_user_id == null) {
                                t("contactsTasks.unassigned")
                            } else {
                                teammateLabel
                            }
                        if (detail.assigned_user_id != null) {
                            TaskAvatar(assigneeLabel, size = 24.dp)
                            Spacer(Modifier.width(7.dp))
                        }
                        Text(
                            if (detail.assigned_user_id != null &&
                                detail.assigned_user_id == me.user_id
                            ) {
                                t("contactsTasks.you")
                            } else {
                                assigneeLabel
                            },
                            fontSize = 13.sp,
                            fontWeight = FontWeight.SemiBold,
                            color = if (detail.assigned_user_id == null) {
                                MaterialTheme.colorScheme.onSurfaceVariant
                            } else {
                                MaterialTheme.colorScheme.onSurface
                            },
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis,
                        )
                    }
                    RowDivider()
                    // Due row.
                    MetaRow(
                        label = t("contactsTasks.due"),
                        onClick = if (noAccess) null else {
                            {
                                haptics.tap()
                                datePickerOpen = true
                            }
                        },
                        trailing = if (detail.due_at != null && !noAccess) {
                            {
                                IconButton(
                                    onClick = {
                                        haptics.tap()
                                        scope.launch {
                                            onActionError(null)
                                            try {
                                                applyTask(
                                                    mutations.setDue(
                                                        companyId,
                                                        detail.id,
                                                        null,
                                                    ),
                                                )
                                            } catch (cause: Exception) {
                                                onActionError(cause.userMessage(locale))
                                            }
                                        }
                                    },
                                    modifier = Modifier.size(28.dp),
                                ) {
                                    Icon(
                                        Icons.Outlined.Close,
                                        contentDescription = t("contactsTasks.clearDueDate"),
                                        modifier = Modifier.size(16.dp),
                                    )
                                }
                            }
                        } else null,
                    ) {
                        Text(
                            when {
                                detail.due_at == null -> t("contactsTasks.noDueDate")
                                overdue -> t(
                                    "contactsTasks.overdueDot",
                                    "due" to dueRowLabel(detail.due_at, locale),
                                )

                                else -> dueRowLabel(detail.due_at, locale)
                            },
                            fontSize = 13.sp,
                            fontWeight = FontWeight.SemiBold,
                            // Overdue = olive emphasis, never a red scare.
                            color = when {
                                detail.due_at == null ->
                                    MaterialTheme.colorScheme.onSurfaceVariant

                                overdue -> MaterialTheme.colorScheme.secondary
                                else -> MaterialTheme.colorScheme.onSurface
                            },
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis,
                        )
                    }

                    // #237: directly under the due date, because it only means
                    // anything as a qualifier on it — a job with no date sends
                    // nothing whatever this says, and the switch would read as
                    // broken sitting anywhere else. Hidden without a date, for
                    // the same reason.
                    if (detail.due_at != null) {
                        RowDivider()
                        MetaRow(
                            label = t("contactsTasks.remind"),
                            // The switch IS the control; tapping the row would
                            // be a second, invisible way to toggle it.
                            onClick = null,
                            trailing = {
                                Switch(
                                    checked = !detail.reminders_off,
                                    enabled = !noAccess,
                                    onCheckedChange = { on ->
                                        haptics.tap()
                                        scope.launch {
                                            onActionError(null)
                                            try {
                                                applyTask(
                                                    mutations.setReminders(
                                                        companyId,
                                                        detail.id,
                                                        !on,
                                                    ),
                                                )
                                            } catch (cause: Exception) {
                                                onActionError(cause.userMessage(locale))
                                            }
                                        }
                                    },
                                )
                            },
                        ) {
                            Text(
                                when {
                                    detail.confirmed_at != null ->
                                        confirmedLine(detail.confirmed_by, locale)
                                    detail.reminders_off ->
                                        t("contactsTasks.remindOff")
                                    else -> t("contactsTasks.remindWorkspace")
                                },
                                fontSize = 13.sp,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                                maxLines = 2,
                                overflow = TextOverflow.Ellipsis,
                            )
                        }
                    }
                }
            }

            // #214 structured job address — task identity (a task column, not
            // conversation-derived), so it shows even at 'none'. Editable inline;
            // enriched values carry a provenance badge that clears on any edit.
            item(key = "address") {
                TaskAddressSection(
                    detail = detail,
                    enabled = !noAccess,
                    onSave = { address ->
                        try {
                            applyTask(mutations.setAddress(companyId, detail.id, address))
                            null
                        } catch (cause: Exception) {
                            cause.userMessage(locale)
                        }
                    },
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(start = 18.dp, end = 18.dp, top = 14.dp),
                )
            }

            if (noAccess) {
                item(key = "no-access") {
                    PaperCard(
                        Modifier
                            .fillMaxWidth()
                            .padding(18.dp),
                    ) {
                        Text(
                            t("contactsTasks.taskNoAccess"),
                            style = MaterialTheme.typography.bodyMedium,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                            modifier = Modifier.padding(15.dp),
                        )
                    }
                }
            } else {
                item(key = "source") {
                    val source = detail.source_message
                    if (source != null) {
                        SourceMessageCard(
                            body = source.body.ifBlank { t("contactsTasks.aPhoto") },
                            createdAt = source.created_at,
                            onOpenConversation = onOpenConversation?.let { open ->
                                { open(detail.conversation_id, detail.message_id) }
                            },
                            modifier = Modifier
                                .fillMaxWidth()
                                .padding(start = 18.dp, end = 18.dp, top = 14.dp),
                        )
                    }
                }

                item(key = "description") {
                    Column(Modifier.padding(horizontal = 18.dp).padding(top = 14.dp)) {
                        SectionHeader(t("contactsTasks.description"))
                        InlineEditField(
                            key = detail.id + detail.updated_at + ":description",
                            initial = detail.description,
                            maxLength = TASK_DESCRIPTION_MAX,
                            placeholder = t("contactsTasks.descriptionPlaceholder"),
                            singleLine = false,
                            allowEmpty = true,
                            textStyle = MaterialTheme.typography.bodyMedium.copy(
                                fontSize = 13.sp,
                                lineHeight = 19.sp,
                            ),
                            onSave = { value ->
                                try {
                                    applyTask(
                                        mutations.describe(companyId, detail.id, value),
                                    )
                                    null
                                } catch (cause: Exception) {
                                    cause.userMessage(locale)
                                }
                            },
                            modifier = Modifier.fillMaxWidth(),
                        )
                    }
                }

                if (detail.attachments.isNotEmpty()) {
                    // #294 — grouped into the visits they arrived on, oldest first.
                    // One flat row made a job with four site visits look identical
                    // to a job with one, and said nothing about which pictures were
                    // the finished work. Every file already knows the note it came
                    // in on, and that note has a time, an author and a label.
                    item(key = "attachments") {
                        Column(Modifier.padding(horizontal = 18.dp).padding(top = 14.dp)) {
                            SectionHeader(
                                t("contactsTasks.files"),
                                count = detail.attachments.size,
                            )
                            groupJobPhotos(detail.attachments).forEach { group ->
                                PhotoGroupHeader(
                                    phase = group.workPhase,
                                    at = group.at,
                                    addedByUserId = group.addedByUserId,
                                    fromCustomer = group.noteId == null,
                                    // The resolver this screen already uses for
                                    // the assignee and the activity timeline.
                                    nameOf = ::memberName,
                                )
                                LazyRow(
                                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                                    modifier = Modifier.padding(bottom = 10.dp),
                                ) {
                                    items(
                                        group.items.size,
                                        key = { group.items[it].id },
                                    ) { index ->
                                        AttachmentCell(
                                            item = group.items[index],
                                            mutations = mutations,
                                            companyId = companyId,
                                            onError = onActionError,
                                        )
                                    }
                                }
                            }
                            // #294: only when there are photos to send. An offer
                            // to share an empty set is an offer to look unready.
                            ShareJobPhotos(
                                taskId = detail.id,
                                photoCount = detail.attachments.count { it.kind == "image" },
                                mutations = mutations,
                                companyId = companyId,
                                onError = onActionError,
                            )
                        }
                    }
                }

                item(key = "activity-label") {
                    Column(Modifier.padding(horizontal = 18.dp).padding(top = 16.dp)) {
                        SectionHeader(t("contactsTasks.activity"))
                        if (detail.activity.isEmpty()) {
                            Text(
                                t("contactsTasks.activityEmpty"),
                                fontSize = 12.5.sp,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        }
                    }
                }

                // animateItem: freshly posted notes and realtime activity
                // glide into the timeline; cached repaints rebuild the whole
                // composition and never animate.
                items(detail.activity.size, key = { "act:${detail.activity[it].id}" }) { i ->
                    val item = detail.activity[i]
                    if (item.kind == "note") {
                        NoteCard(
                            author = item.author?.display_name?.ifBlank { null }
                                ?: memberName(item.author_user_id) ?: teammateLabel,
                            body = item.body.orEmpty(),
                            createdAt = item.created_at,
                            modifier = Modifier.animateItem(),
                        )
                    } else {
                        val sentence = taskEventSentence(
                            item,
                            by = item.actor?.display_name?.ifBlank { null }
                                ?: memberName(item.actor_user_id) ?: "Loonext",
                            memberName = ::memberName,
                            locale = locale,
                        )
                        if (sentence != null) {
                            Row(
                                Modifier
                                    .animateItem()
                                    .padding(horizontal = 24.dp, vertical = 4.dp),
                                verticalAlignment = Alignment.CenterVertically,
                                horizontalArrangement = Arrangement.spacedBy(9.dp),
                            ) {
                                Box(
                                    Modifier
                                        .size(6.dp)
                                        .background(
                                            MaterialTheme.colorScheme.outline,
                                            CircleShape,
                                        ),
                                )
                                Text(
                                    t(
                                        "contactsTasks.activityLine",
                                        "sentence" to sentence,
                                        "when" to relativeTime(item.created_at),
                                    ),
                                    fontSize = 12.sp,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                                )
                            }
                        }
                    }
                }

                item(key = "bottom-space") { Spacer(Modifier.height(12.dp)) }
            }
        }

        if (!noAccess) {
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
            title = { Text(t("contactsTasks.deleteTaskTitle")) },
            text = {
                Text(
                    t(
                        "contactsTasks.deleteTaskBody",
                        "what" to listOfNotNull(
                            if (hasNotes) t("contactsTasks.discussionNotes") else null,
                            if (detail.attachments.isNotEmpty()) {
                                t("contactsTasks.filesLower")
                            } else {
                                null
                            },
                        ).joinToString(t("contactsTasks.andJoiner")),
                    ),
                )
            },
            confirmButton = {
                TextButton(
                    enabled = !deleting,
                    onClick = {
                        confirmDelete = false
                        deleteTask()
                    },
                ) { Text(t("common.delete"), color = MaterialTheme.colorScheme.error) }
            },
            dismissButton = {
                TextButton(onClick = { confirmDelete = false }) {
                    Text(t("contactsTasks.keepTask"))
                }
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
                // Assignment is a commit, not a filter tweak.
                haptics.confirm()
                pickerOpen = false
                scope.launch {
                    onActionError(null)
                    try {
                        applyTask(mutations.assign(companyId, detail.id, userId))
                    } catch (cause: Exception) {
                        onActionError(cause.userMessage(locale))
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
                ) { Text(t("contactsTasks.next")) }
            },
            dismissButton = {
                TextButton(onClick = { datePickerOpen = false }) { Text(t("common.cancel")) }
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
            title = { Text(t("contactsTasks.dueTime")) },
            text = { TimePicker(state = timeState) },
            confirmButton = {
                TextButton(onClick = {
                    haptics.confirm()
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
                            onActionError(cause.userMessage(locale))
                        }
                    }
                }) { Text(t("contactsTasks.setDueDate")) }
            },
            dismissButton = {
                TextButton(onClick = { timePickerOpen = false }) { Text(t("common.cancel")) }
            },
        )
    }
}

/** "Tomorrow · 9:00 AM" — the due row value (spec 23). */
private fun dueRowLabel(dueAt: String, locale: String?): String {
    val day = formatDue(dueAt, locale = locale)
    val time = parseInstant(dueAt)
        ?.atZone(ZoneId.systemDefault())
        ?.format(DateTimeFormatter.ofPattern("h:mm a"))
    return if (day.isEmpty() || time == null) day else "$day · $time"
}

/**
 * One paper-card meta row (spec 23): 64dp micro label, content, an optional
 * trailing affordance, and a chevron when the row is tappable.
 */
@Composable
private fun MetaRow(
    label: String,
    onClick: (() -> Unit)?,
    trailing: (@Composable () -> Unit)? = null,
    content: @Composable RowScope.() -> Unit,
) {
    Row(
        Modifier
            .fillMaxWidth()
            .then(if (onClick != null) Modifier.clickable(onClick = onClick) else Modifier)
            .padding(horizontal = 15.dp, vertical = 11.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(
            label,
            fontSize = 11.sp,
            fontWeight = FontWeight.SemiBold,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.width(64.dp),
        )
        content()
        Spacer(Modifier.weight(1f))
        trailing?.invoke()
        if (onClick != null) {
            Icon(
                Icons.Outlined.ExpandMore,
                contentDescription = null,
                tint = MaterialTheme.colorScheme.outline,
                modifier = Modifier.size(14.dp),
            )
        }
    }
}

// ---------------------------------------------------------------------------
// #214 — the task's structured job address, editable inline. Enriched values
// (an address suggested by AI at create time) carry a provenance badge; any
// edit marks the address user-authored ("manual"). A Save affordance appears
// only when the group differs from the saved row; saving no-ops server-side
// when unchanged. Mirrors the web TaskAddressSection.
// ---------------------------------------------------------------------------

private data class AddrFields(
    val street: String = "",
    val unit: String = "",
    val city: String = "",
    val state: String = "",
    val postalCode: String = "",
    val country: String = "",
) {
    fun allBlank(): Boolean =
        street.isBlank() && unit.isBlank() && city.isBlank() &&
            state.isBlank() && postalCode.isBlank() && country.isBlank()

    /** Same content as [other] once each field is trimmed? */
    fun trimmedEquals(other: AddrFields): Boolean =
        street.trim() == other.street.trim() && unit.trim() == other.unit.trim() &&
            city.trim() == other.city.trim() && state.trim() == other.state.trim() &&
            postalCode.trim() == other.postalCode.trim() &&
            country.trim() == other.country.trim()
}

private fun addrFieldsOf(detail: TaskDetail) = AddrFields(
    street = detail.addr_street.orEmpty(),
    unit = detail.addr_unit.orEmpty(),
    city = detail.addr_city.orEmpty(),
    state = detail.addr_state.orEmpty(),
    postalCode = detail.addr_postal_code.orEmpty(),
    country = detail.addr_country.orEmpty(),
)

@Composable
private fun TaskAddressSection(
    detail: TaskDetail,
    enabled: Boolean,
    onSave: suspend (TaskAddressInput?) -> String?,
    modifier: Modifier = Modifier,
) {
    val scope = rememberCoroutineScope()
    // Re-key the whole group on the server row's address signature so a settled
    // save (or a teammate's edit) re-syncs the fields, provenance, and dirty.
    val saved = addrFieldsOf(detail)
    val signature = listOf(
        detail.addr_street, detail.addr_unit, detail.addr_city, detail.addr_state,
        detail.addr_postal_code, detail.addr_country, detail.addr_provenance,
    ).joinToString("|") { it.orEmpty() }

    var fields by remember(signature) { mutableStateOf(saved) }
    var provenance by remember(signature) { mutableStateOf(detail.addr_provenance) }
    var open by remember(signature) { mutableStateOf(!saved.allBlank()) }
    var error by remember(signature) { mutableStateOf<String?>(null) }
    var saving by remember(signature) { mutableStateOf(false) }

    // Editing any field marks the whole address user-authored ("manual").
    fun edit(update: (AddrFields) -> AddrFields) {
        fields = update(fields)
        provenance = AddressProvenance.MANUAL
        error = null
    }

    val dirty = !fields.trimmedEquals(saved)
    val provLabel = addressProvenanceLabel(provenance, LocalAppLocale.current)

    Column(modifier, verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Row(
            Modifier
                .fillMaxWidth()
                .clip(RoundedCornerShape(10.dp))
                .clickable { open = !open }
                .padding(vertical = 4.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Icon(
                Icons.Outlined.Place,
                contentDescription = null,
                tint = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.size(16.dp),
            )
            Text(
                t("contactsTasks.address"),
                fontSize = 13.sp,
                fontWeight = FontWeight.SemiBold,
                color = MaterialTheme.colorScheme.onSurface,
            )
            if (provLabel != null) AddressProvenanceBadge(provLabel)
            Spacer(Modifier.weight(1f))
            // #220: one-click clear of a suggested (or typed) address — shown
            // whenever any field has content. Unlike the make-task sheet, this
            // wipes the fields + provenance into local state and marks the
            // section dirty (empty ≠ the saved row), so the Save affordance
            // appears and persisting writes the cleared (null) address. Opens
            // the group so that Save row is reachable even if it was collapsed.
            // Its own clickable consumes the tap, so it never toggles.
            if (enabled && !fields.allBlank()) {
                Text(
                    t("contactsTasks.clear"),
                    fontSize = 12.sp,
                    fontWeight = FontWeight.SemiBold,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier
                        .clip(RoundedCornerShape(8.dp))
                        .clickable(enabled = !saving) {
                            // Commit the clear in ONE tap (like the Due "X" +
                            // iOS/web) — staging it behind a second "Save" tap
                            // reads as "cleared" while the server still holds the
                            // address, and is silently lost on navigate-away.
                            fields = AddrFields()
                            provenance = null
                            error = null
                            scope.launch {
                                saving = true
                                error = onSave(null)
                                saving = false
                            }
                        }
                        .padding(horizontal = 8.dp, vertical = 4.dp),
                )
            }
            Icon(
                Icons.Outlined.ExpandMore,
                contentDescription = if (open) {
                    t("contactsTasks.hideAddress")
                } else {
                    t("contactsTasks.showAddress")
                },
                tint = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier
                    .size(18.dp)
                    .rotate(if (open) 180f else 0f),
            )
        }

        if (open) {
            AddressInput(
                value = fields.street,
                placeholder = t("contactsTasks.addrStreet"),
                enabled = enabled,
                onValue = { v -> edit { it.copy(street = v) } },
                modifier = Modifier.fillMaxWidth(),
            )
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                AddressInput(
                    value = fields.unit,
                    placeholder = t("contactsTasks.addrUnit"),
                    enabled = enabled,
                    onValue = { v -> edit { it.copy(unit = v) } },
                    modifier = Modifier.weight(1f),
                )
                AddressInput(
                    value = fields.city,
                    placeholder = t("contactsTasks.addrCity"),
                    enabled = enabled,
                    onValue = { v -> edit { it.copy(city = v) } },
                    modifier = Modifier.weight(1f),
                )
            }
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                AddressInput(
                    value = fields.state,
                    placeholder = t("contactsTasks.addrState"),
                    enabled = enabled,
                    onValue = { v -> edit { it.copy(state = v) } },
                    modifier = Modifier.weight(1f),
                )
                AddressInput(
                    value = fields.postalCode,
                    placeholder = t("contactsTasks.addrPostalCode"),
                    enabled = enabled,
                    onValue = { v -> edit { it.copy(postalCode = v) } },
                    modifier = Modifier.weight(1f),
                )
            }
            CountryField(
                value = fields.country,
                onValueChange = { v -> edit { it.copy(country = v) } },
                enabled = enabled,
                modifier = Modifier.fillMaxWidth(),
            )

            if (enabled && dirty) {
                Row(
                    Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(16.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Spacer(Modifier.weight(1f))
                    Text(
                        t("contactsTasks.reset"),
                        fontSize = 13.sp,
                        fontWeight = FontWeight.SemiBold,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        modifier = Modifier
                            .clip(RoundedCornerShape(8.dp))
                            .clickable(enabled = !saving) {
                                fields = saved
                                provenance = detail.addr_provenance
                                error = null
                            }
                            .padding(horizontal = 10.dp, vertical = 6.dp),
                    )
                    Text(
                        if (saving) t("common.saving") else t("contactsTasks.saveAddress"),
                        fontSize = 13.sp,
                        fontWeight = FontWeight.Bold,
                        color = MaterialTheme.colorScheme.secondary,
                        modifier = Modifier
                            .clip(RoundedCornerShape(8.dp))
                            .clickable(enabled = !saving) {
                                val address = if (fields.allBlank()) {
                                    null
                                } else {
                                    TaskAddressInput(
                                        street = fields.street.trim().ifEmpty { null },
                                        unit = fields.unit.trim().ifEmpty { null },
                                        city = fields.city.trim().ifEmpty { null },
                                        state = fields.state.trim().ifEmpty { null },
                                        postal_code = fields.postalCode.trim().ifEmpty { null },
                                        country = fields.country.trim().ifEmpty { null },
                                        provenance = provenance ?: AddressProvenance.MANUAL,
                                    )
                                }
                                scope.launch {
                                    saving = true
                                    error = onSave(address)
                                    saving = false
                                }
                            }
                            .padding(horizontal = 10.dp, vertical = 6.dp),
                    )
                }
            }
            if (error != null) {
                Text(
                    error!!,
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.error,
                )
            }
        }
    }
}

/** #214 the provenance pill: sparkle + "From the message" / etc. */
@Composable
private fun AddressProvenanceBadge(label: String) {
    Row(
        Modifier
            .clip(CircleShape)
            .background(MaterialTheme.colorScheme.surfaceContainerHigh)
            .padding(horizontal = 8.dp, vertical = 3.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(3.dp),
    ) {
        AiOrb(state = AiOrbState.Idle, size = 11.dp)
        Text(
            label,
            style = MaterialTheme.typography.labelSmall.copy(fontSize = 10.5.sp),
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
    }
}

/** One address input, styled to match the detail screen's inline-edit grammar. */
@Composable
private fun AddressInput(
    value: String,
    placeholder: String,
    enabled: Boolean,
    onValue: (String) -> Unit,
    modifier: Modifier = Modifier,
) {
    OutlinedTextField(
        value = value,
        onValueChange = { onValue(it.take(200)) },
        enabled = enabled,
        singleLine = true,
        placeholder = {
            Text(
                placeholder,
                fontSize = 13.sp,
                color = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.6f),
            )
        },
        textStyle = LocalTextStyle.current.copy(fontSize = 13.sp),
        shape = MaterialTheme.shapes.medium,
        colors = OutlinedTextFieldDefaults.colors(
            focusedContainerColor = MaterialTheme.colorScheme.surface,
            unfocusedContainerColor = MaterialTheme.colorScheme.surface,
            focusedBorderColor = MaterialTheme.colorScheme.outline,
            unfocusedBorderColor = MaterialTheme.colorScheme.surfaceContainerHigh,
        ),
        modifier = modifier,
    )
}

/** The lime-barred source-message quote card (spec 22/23 grammar). */
@Composable
private fun SourceMessageCard(
    body: String,
    createdAt: String,
    onOpenConversation: (() -> Unit)?,
    modifier: Modifier = Modifier,
) {
    Surface(
        shape = MaterialTheme.shapes.large,
        color = MaterialTheme.colorScheme.surface,
        modifier = modifier,
    ) {
        Row(
            Modifier
                .padding(horizontal = 15.dp, vertical = 12.dp)
                .height(IntrinsicSize.Min),
            horizontalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            Box(
                Modifier
                    .width(3.dp)
                    .fillMaxHeight()
                    .background(BrandColor.LimeBright, CircleShape),
            )
            Column(Modifier.weight(1f)) {
                Text(
                    "“$body”",
                    fontSize = 12.5.sp,
                    lineHeight = 18.sp,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                Row(
                    Modifier
                        .fillMaxWidth()
                        .padding(top = 6.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Text(
                        t(
                            "contactsTasks.sourceMessageWhen",
                            "when" to relativeTime(createdAt),
                        ),
                        fontSize = 10.5.sp,
                        fontWeight = FontWeight.SemiBold,
                        color = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.75f),
                        modifier = Modifier.weight(1f),
                    )
                    if (onOpenConversation != null) {
                        Text(
                            t("contactsTasks.openConversationArrow"),
                            fontSize = 11.sp,
                            fontWeight = FontWeight.Bold,
                            color = MaterialTheme.colorScheme.secondary,
                            modifier = Modifier.clickable(onClick = onOpenConversation),
                        )
                    }
                }
            }
        }
    }
}

/**
 * Blur-save inline editor: saving happens when focus leaves the field with a
 * changed value; an empty value snaps back when [allowEmpty] is false. The
 * save callback returns an error sentence (null = saved) so failures keep the
 * user's text and show a calm line under the field. Styled flat — plain text
 * until focused, when a hairline outline appears.
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
            placeholder = {
                Text(
                    placeholder,
                    style = textStyle,
                    color = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.6f),
                )
            },
            singleLine = singleLine,
            shape = MaterialTheme.shapes.medium,
            colors = OutlinedTextFieldDefaults.colors(
                focusedContainerColor = Color.Transparent,
                unfocusedContainerColor = Color.Transparent,
                focusedBorderColor = MaterialTheme.colorScheme.outline,
                unfocusedBorderColor = Color.Transparent,
            ),
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
    // #228: read in composition — the fetches below are coroutines, and the
    // failures they report land on this screen in front of the reader.
    val locale = LocalAppLocale.current

    if (item.kind == "image") {
        var url by remember(item.id) { mutableStateOf<String?>(null) }
        var failed by remember(item.id) { mutableStateOf(false) }
        LaunchedEffect(item.id) {
            try {
                url = mutations.attachmentUrl(companyId, item.id).url
            } catch (cause: Exception) {
                failed = true
                onError(cause.userMessage(locale))
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
                    contentDescription = item.file_name ?: t("contactsTasks.photo"),
                    contentScale = androidx.compose.ui.layout.ContentScale.Crop,
                    modifier = Modifier
                        .fillMaxSize()
                        .clickable {
                            scope.launch {
                                try {
                                    // #240: tapping through opens the file in
                                    // another app — that hands over the FILE,
                                    // not the 96dp picture of it above.
                                    val fresh = mutations
                                        .attachmentUrl(companyId, item.id, "original")
                                        .url
                                    context.startActivity(
                                        Intent(Intent.ACTION_VIEW, Uri.parse(fresh)),
                                    )
                                } catch (cause: Exception) {
                                    onError(cause.userMessage(locale))
                                }
                            }
                        },
                )

                failed -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                    Text(
                        t("contactsTasks.couldntLoad"),
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }

                else -> Box(Modifier.fillMaxSize())
            }
        }
    } else {
        // A tappable paper card: pressScale shares the click's interaction
        // source so the card gives under the finger.
        val pressInteraction = remember(item.id) { MutableInteractionSource() }
        Surface(
            onClick = {
                scope.launch {
                    try {
                        // #240: a file card is a download. Nothing here has a
                        // preview today — these are PDFs and documents — but
                        // saying it keeps that true if the rule ever widens.
                        val fresh = mutations
                            .attachmentUrl(companyId, item.id, "original")
                            .url
                        context.startActivity(
                            Intent(Intent.ACTION_VIEW, Uri.parse(fresh)),
                        )
                    } catch (cause: Exception) {
                        onError(cause.userMessage(locale))
                    }
                }
            },
            shape = MaterialTheme.shapes.medium,
            color = MaterialTheme.colorScheme.surface,
            interactionSource = pressInteraction,
            modifier = Modifier
                .width(180.dp)
                .pressScale(pressInteraction),
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
                        item.file_name ?: t("contactsTasks.file"),
                        fontSize = 12.5.sp,
                        fontWeight = FontWeight.SemiBold,
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

/**
 * A task-linked internal note (spec 23): dashed inset card, lock mark,
 * tracked-uppercase author + micro-timestamp, quiet body.
 */
@Composable
private fun NoteCard(
    author: String,
    body: String,
    createdAt: String,
    modifier: Modifier = Modifier,
) {
    val borderColor = MaterialTheme.colorScheme.outline.copy(alpha = 0.75f)
    Column(
        modifier
            .fillMaxWidth()
            .padding(horizontal = 18.dp, vertical = 4.dp)
            .clip(RoundedCornerShape(16.dp))
            .background(MaterialTheme.colorScheme.surfaceContainer)
            .drawBehind {
                drawRoundRect(
                    color = borderColor,
                    style = Stroke(
                        width = 1.5.dp.toPx(),
                        pathEffect = PathEffect.dashPathEffect(floatArrayOf(8f, 7f)),
                    ),
                    cornerRadius = CornerRadius(16.dp.toPx()),
                )
            }
            .padding(horizontal = 13.dp, vertical = 10.dp),
    ) {
        Row(
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(6.dp),
        ) {
            TaskAvatar(author, size = 18.dp, fontSize = 7.5.sp)
            Icon(
                Icons.Outlined.Lock,
                contentDescription = t("contactsTasks.internalNote"),
                tint = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.size(11.dp),
            )
            Text(
                "${author.uppercase()} · ${relativeTime(createdAt).uppercase()}",
                fontSize = 10.sp,
                fontWeight = FontWeight.Bold,
                letterSpacing = 0.08.em,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
        }
        if (body.isNotBlank()) {
            Text(
                body,
                fontSize = 12.5.sp,
                lineHeight = 18.sp,
                color = MaterialTheme.colorScheme.onSurface,
                modifier = Modifier.padding(top = 3.dp),
            )
        }
    }
}

/**
 * The pinned note composer (TASKS-V2 D-D), restyled as the spec-23 pill:
 * attach affordance, quiet placeholder, 38dp ink send circle. Posts an
 * internal note with task_id, then uploads staged files against the note
 * (owner_type='note' — the only door for task files, D28). Partial upload
 * failure keeps an honest line pointing at the note in the thread.
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
    val haptics = rememberHaptics()
    val multipart = remember { MultipartClient(graph.api, BuildConfig.API_URL) }
    // #228: the picker callback and the upload coroutine below are not
    // composition, so their sentences are resolved from a locale read here.
    val locale = LocalAppLocale.current

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
            uris.size > room -> AppStrings.translate(
                locale,
                "contactsTasks.noteFilesCap",
                mapOf("count" to "$NOTE_FILES_MAX"),
            )

            oversize.isNotEmpty() -> AppStrings.translate(
                locale,
                "contactsTasks.noteFileTooBig",
            )
            else -> null
        }
        staged = staged + next.filter { it.size <= NOTE_FILE_MAX_BYTES }
    }

    Column(
        Modifier
            .fillMaxWidth()
            .padding(start = 14.dp, end = 14.dp, top = 6.dp, bottom = 10.dp),
    ) {
        if (staged.isNotEmpty()) {
            LazyRow(
                horizontalArrangement = Arrangement.spacedBy(6.dp),
                modifier = Modifier.padding(bottom = 4.dp),
            ) {
                items(staged.size, key = { staged[it].uri.toString() }) { index ->
                    val file = staged[index]
                    AssistChip(
                        onClick = {
                            haptics.tap()
                            staged = staged - file
                        },
                        label = {
                            Text(file.name, maxLines = 1, overflow = TextOverflow.Ellipsis)
                        },
                        trailingIcon = {
                            Icon(
                                Icons.Outlined.Close,
                                contentDescription = t(
                                    "contactsTasks.removeNamed",
                                    "name" to file.name,
                                ),
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
        Surface(
            shape = RoundedCornerShape(26.dp),
            color = MaterialTheme.colorScheme.surface,
            shadowElevation = 2.dp,
            modifier = Modifier.fillMaxWidth(),
        ) {
            Row(
                Modifier.padding(start = 4.dp, end = 7.dp, top = 7.dp, bottom = 7.dp),
                verticalAlignment = Alignment.Bottom,
            ) {
                IconButton(
                    enabled = !posting && staged.size < NOTE_FILES_MAX,
                    onClick = {
                        haptics.tap()
                        filePicker.launch(arrayOf("*/*"))
                    },
                ) {
                    Icon(
                        Icons.Outlined.AttachFile,
                        contentDescription = t("contactsTasks.attachFiles"),
                        tint = MaterialTheme.colorScheme.onSurfaceVariant,
                        modifier = Modifier.size(18.dp),
                    )
                }
                BasicTextField(
                    value = body,
                    onValueChange = {
                        body = it.take(NOTE_BODY_MAX)
                        error = null
                    },
                    textStyle = LocalTextStyle.current.copy(
                        fontSize = 13.sp,
                        lineHeight = 18.sp,
                        color = MaterialTheme.colorScheme.onSurface,
                    ),
                    cursorBrush = SolidColor(MaterialTheme.colorScheme.primary),
                    maxLines = 4,
                    decorationBox = { inner ->
                        Box {
                            if (body.isEmpty()) {
                                Text(
                                    t("contactsTasks.noteComposerPlaceholder"),
                                    fontSize = 13.sp,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant
                                        .copy(alpha = 0.7f),
                                )
                            }
                            inner()
                        }
                    },
                    modifier = Modifier
                        .weight(1f)
                        .padding(horizontal = 4.dp, vertical = 10.dp),
                )
                val sendInteraction = remember { MutableInteractionSource() }
                IconButton(
                    enabled = !posting && (body.isNotBlank() || staged.isNotEmpty()),
                    onClick = {
                        // Posting a note is a commit.
                        haptics.confirm()
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
                                    AppStrings.translate(
                                        locale,
                                        if (failures == 1) {
                                            "contactsTasks.noteUploadFailedOne"
                                        } else {
                                            "contactsTasks.noteUploadFailedMany"
                                        },
                                        mapOf("count" to "$failures"),
                                    )
                                } else null
                                onPosted()
                            } catch (cause: Exception) {
                                error = cause.userMessage(locale)
                            } finally {
                                posting = false
                            }
                        }
                    },
                    colors = IconButtonDefaults.filledIconButtonColors(
                        containerColor = MaterialTheme.colorScheme.primary,
                        contentColor = MaterialTheme.colorScheme.onPrimary,
                    ),
                    interactionSource = sendInteraction,
                    modifier = Modifier
                        .size(38.dp)
                        .pressScale(sendInteraction),
                ) {
                    Icon(
                        Icons.Outlined.ArrowUpward,
                        contentDescription = t("contactsTasks.postNote"),
                        modifier = Modifier.size(16.dp),
                    )
                }
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

/**
 * #237 — who confirmed, said plainly.
 *
 * The two are NOT the same fact. A customer confirming is a promise from the
 * person who has to be there; a crew member marking it is a note to ourselves.
 * A dispatcher deciding whether to send a van reads them differently, so the
 * line does too. Same wording as the web panel and the iOS screen.
 */
internal fun confirmedLine(by: String?, locale: String? = null): String =
    AppStrings.translate(
        locale,
        if (by == "customer") {
            "contactsTasks.confirmedByCustomer"
        } else {
            "contactsTasks.confirmedByCrew"
        },
    )
