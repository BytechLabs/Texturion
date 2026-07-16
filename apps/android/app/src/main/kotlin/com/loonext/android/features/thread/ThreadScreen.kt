package com.loonext.android.features.thread

import android.content.Intent
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.ExpandLess
import androidx.compose.material.icons.filled.ExpandMore
import androidx.compose.material.icons.filled.KeyboardArrowDown
import androidx.compose.material.icons.filled.MoreVert
import androidx.compose.material.icons.filled.Person
import androidx.compose.material.icons.filled.PushPin
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LoadingIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.SnackbarDuration
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.SnackbarResult
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
import androidx.compose.runtime.snapshotFlow
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.core.net.toUri
import com.loonext.android.AppGraph
import com.loonext.android.BuildConfig
import com.loonext.android.core.model.Attachment
import com.loonext.android.core.model.ConversationStatus
import com.loonext.android.core.model.Me
import com.loonext.android.core.model.Member
import com.loonext.android.core.model.Message
import com.loonext.android.core.model.MessageDirection
import com.loonext.android.core.net.ApiErrorCode
import com.loonext.android.features.compose.ComposerDrafts
import com.loonext.android.features.compose.NoteFileUploader
import com.loonext.android.features.compose.ThreadComposer
import com.loonext.android.features.compose.Nanp
import com.loonext.android.features.compose.rememberComposerState
import com.loonext.android.features.compose.selectComposerBanner
import com.loonext.android.features.compose.usSendApproved
import com.loonext.android.ui.common.CenteredError
import com.loonext.android.ui.common.CenteredLoading
import com.loonext.android.ui.common.InitialsAvatar
import com.loonext.android.ui.common.LoadState
import com.loonext.android.ui.common.formatPhone
import com.loonext.android.ui.common.userMessage
import java.time.LocalDate
import java.time.ZoneId
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.launch

/**
 * One conversation: header (status/assignee/overflow) → interleaved timeline
 * (newest-first, reverseLayout) → composer or gate banner. State-based detail
 * screen — callers own the "which conversation is open" state.
 */
@Composable
fun ThreadScreen(
    graph: AppGraph,
    companyId: String,
    me: Me,
    conversationId: String,
    onBack: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val repo = remember(graph) { MessagingRepository(graph.api) }
    val uploader = remember(graph) { NoteFileUploader(graph.api, BuildConfig.API_URL) }
    val controller = remember(companyId, conversationId) {
        ThreadController(
            repo = repo,
            meRepo = graph.meRepo,
            uploader = uploader,
            appContext = context.applicationContext,
            companyId = companyId,
            conversationId = conversationId,
            meUserId = me.user_id,
            scope = graph.appScope,
        )
    }

    BackHandler(onBack = onBack)
    LaunchedEffect(controller) { controller.start() }
    LaunchedEffect(controller) {
        graph.realtime.events.collect { controller.onRealtime(it) }
    }
    LaunchedEffect(controller) {
        graph.realtime.reconnected.collect { controller.refreshAfterReconnect() }
    }
    // Mark read on open and again whenever the newest message id changes.
    LaunchedEffect(controller, controller.newestMessageId) { controller.markRead() }

    val snackbar = remember { SnackbarHostState() }
    LaunchedEffect(controller.notice) {
        val notice = controller.notice ?: return@LaunchedEffect
        val result = snackbar.showSnackbar(
            message = notice.text,
            actionLabel = notice.actionLabel,
            duration = if (notice.actionLabel != null) SnackbarDuration.Long
            else SnackbarDuration.Short,
        )
        if (result == SnackbarResult.ActionPerformed) notice.action?.invoke()
    }

    Box(modifier.fillMaxSize()) {
        when (val load = controller.load) {
            is LoadState.Loading -> CenteredLoading()
            is LoadState.Failed -> {
                if (load.code == ApiErrorCode.NOT_FOUND) {
                    Column(
                        Modifier
                            .fillMaxSize()
                            .padding(32.dp),
                        horizontalAlignment = Alignment.CenterHorizontally,
                        verticalArrangement = androidx.compose.foundation.layout.Arrangement.Center,
                    ) {
                        Text(
                            "This conversation doesn't exist or was removed.",
                            style = MaterialTheme.typography.bodyMedium,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                        TextButton(onClick = onBack) { Text("Back to inbox") }
                    }
                } else {
                    CenteredError(load.message, onRetry = { controller.retryInitialLoad() })
                }
            }

            is LoadState.Ready -> ThreadLoaded(
                graph = graph,
                controller = controller,
                repo = repo,
                companyId = companyId,
                me = me,
                onBack = onBack,
                onOpenFile = { attachment ->
                    scope.launch {
                        try {
                            val url = repo.attachmentUrl(companyId, attachment.id).url
                            context.startActivity(Intent(Intent.ACTION_VIEW, url.toUri()))
                        } catch (cause: Exception) {
                            snackbar.showSnackbar(cause.userMessage())
                        }
                    }
                },
                onNotice = { scope.launch { snackbar.showSnackbar(it) } },
            )
        }
        SnackbarHost(
            snackbar,
            modifier = Modifier
                .align(Alignment.BottomCenter)
                .imePadding(),
        )
    }
}

@Composable
private fun ThreadLoaded(
    graph: AppGraph,
    controller: ThreadController,
    repo: MessagingRepository,
    companyId: String,
    me: Me,
    onBack: () -> Unit,
    onOpenFile: (Attachment) -> Unit,
    onNotice: (String) -> Unit,
) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val detail = controller.conversation ?: return
    val names = remember(controller.members) { memberNames(controller.members) }
    val contactName = detail.contact.name ?: formatPhone(detail.contact.phone_e164)

    val listState = rememberLazyListState()
    val zone = remember { ZoneId.systemDefault() }
    val timeline = remember(
        controller.messages,
        controller.events,
        controller.pendingSends,
        controller.filter,
        controller.allMessagesLoaded,
    ) {
        buildTimeline(
            messages = controller.messages,
            events = controller.events,
            pending = controller.pendingSends,
            filter = controller.filter,
            allMessagesLoaded = controller.allMessagesLoaded,
            zone = zone,
            today = LocalDate.now(zone),
        )
    }

    // Scroll-back pagination: reverseLayout means the LAST index is the oldest.
    LaunchedEffect(listState, controller) {
        snapshotFlow {
            val info = listState.layoutInfo
            (info.visibleItemsInfo.lastOrNull()?.index ?: 0) to info.totalItemsCount
        }
            .distinctUntilChanged()
            .collect { (lastVisible, total) ->
                if (total > 0 && lastVisible >= total - 5) controller.loadOlderMessages()
            }
    }

    // Stick to bottom when a new row lands while the user is already there.
    LaunchedEffect(controller.newestMessageId, controller.pendingSends.size) {
        if (listState.firstVisibleItemIndex <= 1) listState.scrollToItem(0)
    }

    // "New message ↓" pill when an inbound lands while scrolled up.
    var showNewPill by remember { mutableStateOf(false) }
    LaunchedEffect(controller.newInboundTick) {
        if (controller.newInboundTick == 0) return@LaunchedEffect
        if (listState.firstVisibleItemIndex > 2) showNewPill = true
        else listState.animateScrollToItem(0)
    }
    LaunchedEffect(listState) {
        snapshotFlow { listState.firstVisibleItemIndex }.collect {
            if (it <= 1) showNewPill = false
        }
    }

    // Pinned-banner jump target: scroll once the message is in the timeline.
    var jumpToMessageId by remember { mutableStateOf<String?>(null) }
    LaunchedEffect(jumpToMessageId, timeline.size) {
        val target = jumpToMessageId ?: return@LaunchedEffect
        val index = timeline.indexOfFirst { it.key == "m:$target" }
        if (index >= 0) {
            listState.animateScrollToItem(index)
            jumpToMessageId = null
        }
    }

    var actionsFor by remember { mutableStateOf<Message?>(null) }
    var makeTaskFor by remember { mutableStateOf<Message?>(null) }

    Column(Modifier.fillMaxSize()) {
        ThreadHeader(
            controller = controller,
            contactName = contactName,
            phoneLabel = formatPhone(detail.contact.phone_e164),
            members = controller.members,
            meUserId = me.user_id,
            onBack = onBack,
        )
        HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)

        if (controller.pinnedMessages.isNotEmpty()) {
            PinnedBanner(
                pinned = controller.pinnedMessages,
                onJump = { messageId ->
                    scope.launch {
                        if (controller.ensureMessageLoaded(messageId)) {
                            jumpToMessageId = messageId
                        }
                    }
                },
            )
            HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
        }

        Box(Modifier.weight(1f)) {
            if (timeline.isEmpty()) {
                Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                    Text(
                        "No messages yet.",
                        style = MaterialTheme.typography.bodyLarge,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            } else {
                LazyColumn(
                    state = listState,
                    reverseLayout = true,
                    modifier = Modifier.fillMaxSize(),
                ) {
                    items(timeline, key = { it.key }) { item ->
                        when (item) {
                            is TimelineItem.MessageItem -> {
                                val message = item.message
                                MessageBubble(
                                    message = message,
                                    authorName = when (message.direction) {
                                        MessageDirection.NOTE ->
                                            message.sent_by_user_id?.let { names[it] }
                                                ?: "Internal note"

                                        else -> null
                                    },
                                    doneByName = message.done_by_user_id?.let { names[it] },
                                    noteFilesState =
                                        if (message.direction == MessageDirection.NOTE) {
                                            controller.noteFiles[message.id]
                                        } else {
                                            null
                                        },
                                    onLoadNoteFiles = { controller.loadNoteFiles(message.id) },
                                    onLongPress = { actionsFor = message },
                                    onRetry = { controller.retrySend(message.id) },
                                    mintAttachmentUrl = { id ->
                                        repo.attachmentUrl(companyId, id).url
                                    },
                                    onOpenFile = onOpenFile,
                                )
                            }

                            is TimelineItem.PendingItem -> PendingBubble(item.pending)

                            is TimelineItem.EventItem -> EventLine(
                                text = eventLine(item.event, names, contactName),
                                timeIso = item.event.created_at,
                            )

                            is TimelineItem.DayDivider -> DayDividerLine(item.label)
                        }
                    }
                    if (controller.loadingOlder) {
                        item(key = "loading-older") {
                            Box(
                                Modifier
                                    .fillMaxWidth()
                                    .padding(12.dp),
                                contentAlignment = Alignment.Center,
                            ) { LoadingIndicator() }
                        }
                    }
                }
            }

            if (showNewPill) {
                Surface(
                    color = MaterialTheme.colorScheme.primary,
                    shape = RoundedCornerShape(50),
                    modifier = Modifier
                        .align(Alignment.BottomCenter)
                        .padding(bottom = 12.dp)
                        .clickable {
                            showNewPill = false
                            scope.launch { listState.animateScrollToItem(0) }
                        },
                ) {
                    Row(
                        Modifier.padding(horizontal = 14.dp, vertical = 8.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Text(
                            "New message",
                            style = MaterialTheme.typography.labelMedium,
                            color = MaterialTheme.colorScheme.onPrimary,
                        )
                        Icon(
                            Icons.Filled.KeyboardArrowDown,
                            contentDescription = null,
                            tint = MaterialTheme.colorScheme.onPrimary,
                            modifier = Modifier.size(16.dp),
                        )
                    }
                }
            }
        }

        // Composer (or gate banner + notes-only).
        val drafts = remember { ComposerDrafts(context.applicationContext) }
        val composer = rememberComposerState(controller.conversationId, drafts)
        val banner = selectComposerBanner(
            contactOptedOut = controller.contact?.opted_out == true,
            subscriptionStatus = controller.company?.subscription_status
                ?: com.loonext.android.core.model.SubscriptionStatus.ACTIVE,
            destinationCountry = Nanp.destinationCountry(detail.contact.phone_e164),
            usApproved = controller.company?.let { usSendApproved(it) } ?: true,
            usage = controller.usage,
        )
        ThreadComposer(
            state = composer,
            noteOnly = detail.viewer_level == "note",
            banner = banner,
            contactName = detail.contact.name,
            businessName = controller.company?.name,
            loadTemplates = { repo.templates(companyId).data },
            onSendText = { body, photos ->
                controller.sendText(body, photos) {
                    composer.restore(body, photos, emptyList())
                }
            },
            onSaveNote = { body, files ->
                controller.saveNote(body, files) {
                    composer.restore(body, emptyList(), files)
                }
            },
            onNotice = onNotice,
            modifier = Modifier.imePadding(),
        )
    }

    actionsFor?.let { message ->
        MessageActionsSheet(
            message = message,
            onToggleDone = { controller.toggleDone(message) },
            onTogglePin = { controller.togglePin(message) },
            onRetry = { controller.retrySend(message.id) },
            onMakeTask = {
                actionsFor = null
                makeTaskFor = message
            },
            onCopied = { onNotice("Copied.") },
            onDismiss = { actionsFor = null },
        )
    }
    makeTaskFor?.let { message ->
        MakeTaskDialog(
            message = message,
            onCreate = { title ->
                controller.makeTask(message, title)
                makeTaskFor = null
            },
            onDismiss = { makeTaskFor = null },
        )
    }
}

// ---------------------------------------------------------------------------
// Header
// ---------------------------------------------------------------------------

@Composable
private fun ThreadHeader(
    controller: ThreadController,
    contactName: String,
    phoneLabel: String,
    members: List<Member>,
    meUserId: String,
    onBack: () -> Unit,
) {
    val detail = controller.conversation ?: return
    var statusMenuOpen by remember { mutableStateOf(false) }
    var overflowOpen by remember { mutableStateOf(false) }
    var assigneeSheetOpen by remember { mutableStateOf(false) }
    var confirmOptOut by remember { mutableStateOf(false) }
    var confirmRevoke by remember { mutableStateOf(false) }

    Row(
        Modifier
            .fillMaxWidth()
            .padding(horizontal = 4.dp, vertical = 6.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        IconButton(onClick = onBack) {
            Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Back")
        }
        InitialsAvatar(contactName, size = 34.dp)
        Spacer(Modifier.width(10.dp))
        Column(Modifier.weight(1f)) {
            Text(
                contactName,
                style = MaterialTheme.typography.titleSmall,
                fontWeight = FontWeight.SemiBold,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            Text(
                if (controller.contact?.opted_out == true) "$phoneLabel · Opted out"
                else phoneLabel,
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
        }

        // Status pill + menu (the single status control).
        Box {
            Text(
                statusLabel(detail.status),
                style = MaterialTheme.typography.labelMedium,
                color = MaterialTheme.colorScheme.onPrimaryContainer,
                modifier = Modifier
                    .background(
                        MaterialTheme.colorScheme.primaryContainer,
                        RoundedCornerShape(50),
                    )
                    .clickable { statusMenuOpen = true }
                    .padding(horizontal = 10.dp, vertical = 5.dp),
            )
            DropdownMenu(
                expanded = statusMenuOpen,
                onDismissRequest = { statusMenuOpen = false },
            ) {
                listOf(
                    ConversationStatus.NEW,
                    ConversationStatus.OPEN,
                    ConversationStatus.WAITING,
                    ConversationStatus.CLOSED,
                ).forEach { status ->
                    DropdownMenuItem(
                        text = { Text(statusLabel(status)) },
                        trailingIcon = {
                            if (detail.status == status) {
                                Icon(Icons.Filled.Check, contentDescription = "Current")
                            }
                        },
                        onClick = {
                            statusMenuOpen = false
                            if (status != detail.status) controller.setStatus(status)
                        },
                    )
                }
            }
        }

        // Assignee control.
        IconButton(onClick = { assigneeSheetOpen = true }) {
            val assignee = members.firstOrNull { it.user_id == detail.assigned_user_id }
            if (assignee != null) {
                InitialsAvatar(assignee.display_name.ifBlank { null }, size = 28.dp)
            } else {
                Icon(
                    Icons.Filled.Person,
                    contentDescription = "Assign",
                    tint = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }

        // Overflow.
        Box {
            IconButton(onClick = { overflowOpen = true }) {
                Icon(Icons.Filled.MoreVert, contentDescription = "More")
            }
            DropdownMenu(
                expanded = overflowOpen,
                onDismissRequest = { overflowOpen = false },
            ) {
                DropdownMenuItem(
                    text = {
                        Text(
                            if (detail.pinned_at == null) "Pin conversation"
                            else "Unpin conversation",
                        )
                    },
                    onClick = {
                        overflowOpen = false
                        controller.toggleConversationPin()
                    },
                )
                DropdownMenuItem(
                    text = { Text(if (detail.is_spam) "Not spam" else "Mark as spam") },
                    onClick = {
                        overflowOpen = false
                        controller.setSpam(!detail.is_spam)
                    },
                )
                if (controller.contact?.opted_out == true) {
                    DropdownMenuItem(
                        text = { Text("Remove opt-out") },
                        onClick = {
                            overflowOpen = false
                            confirmRevoke = true
                        },
                    )
                } else {
                    DropdownMenuItem(
                        text = { Text("Opt out of texts") },
                        onClick = {
                            overflowOpen = false
                            confirmOptOut = true
                        },
                    )
                }
                HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
                DropdownMenuItem(
                    text = { Text("Show messages") },
                    trailingIcon = {
                        if (controller.filter.messages) {
                            Icon(Icons.Filled.Check, contentDescription = "On")
                        }
                    },
                    onClick = { controller.filter = controller.filter.toggledMessages() },
                )
                DropdownMenuItem(
                    text = { Text("Show notes") },
                    trailingIcon = {
                        if (controller.filter.notes) {
                            Icon(Icons.Filled.Check, contentDescription = "On")
                        }
                    },
                    onClick = { controller.filter = controller.filter.toggledNotes() },
                )
                DropdownMenuItem(
                    text = { Text("Show events") },
                    trailingIcon = {
                        if (controller.filter.events) {
                            Icon(Icons.Filled.Check, contentDescription = "On")
                        }
                    },
                    onClick = { controller.filter = controller.filter.toggledEvents() },
                )
            }
        }
    }

    if (assigneeSheetOpen) {
        AssigneePickerSheet(
            members = members,
            meUserId = meUserId,
            selectedUserId = detail.assigned_user_id,
            onPick = { userId ->
                assigneeSheetOpen = false
                if (userId != detail.assigned_user_id) controller.setAssignee(userId)
            },
            onDismiss = { assigneeSheetOpen = false },
        )
    }

    if (confirmOptOut) {
        AlertDialog(
            onDismissRequest = { confirmOptOut = false },
            title = { Text("Opt this customer out?") },
            text = {
                Text(
                    "They won't receive texts from you until the opt-out is removed. " +
                        "This is recorded in the conversation timeline.",
                )
            },
            confirmButton = {
                TextButton(onClick = {
                    confirmOptOut = false
                    controller.optOutContact()
                }) { Text("Opt out") }
            },
            dismissButton = {
                TextButton(onClick = { confirmOptOut = false }) { Text("Cancel") }
            },
        )
    }
    if (confirmRevoke) {
        AlertDialog(
            onDismissRequest = { confirmRevoke = false },
            title = { Text("Remove the opt-out?") },
            text = {
                Text(
                    "You'll be able to text this customer again. Only do this if they " +
                        "asked to hear from you.",
                )
            },
            confirmButton = {
                TextButton(onClick = {
                    confirmRevoke = false
                    controller.revokeOptOut()
                }) { Text("Remove opt-out") }
            },
            dismissButton = {
                TextButton(onClick = { confirmRevoke = false }) { Text("Cancel") }
            },
        )
    }
}

/** Active-member picker with an Unassigned entry. */
@Composable
private fun AssigneePickerSheet(
    members: List<Member>,
    meUserId: String,
    selectedUserId: String?,
    onPick: (String?) -> Unit,
    onDismiss: () -> Unit,
) {
    ModalBottomSheet(onDismissRequest = onDismiss) {
        Column(Modifier.fillMaxWidth()) {
            Text(
                "Assign to",
                style = MaterialTheme.typography.titleMedium,
                modifier = Modifier.padding(horizontal = 20.dp, vertical = 8.dp),
            )
            Row(
                Modifier
                    .fillMaxWidth()
                    .clickable { onPick(null) }
                    .padding(horizontal = 20.dp, vertical = 12.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(
                    "Unassigned",
                    style = MaterialTheme.typography.bodyLarge,
                    modifier = Modifier.weight(1f),
                )
                if (selectedUserId == null) {
                    Icon(
                        Icons.Filled.Check,
                        contentDescription = "Selected",
                        tint = MaterialTheme.colorScheme.primary,
                    )
                }
            }
            HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
            members.filter { it.deactivated_at == null }.forEach { member ->
                Row(
                    Modifier
                        .fillMaxWidth()
                        .clickable { onPick(member.user_id) }
                        .padding(horizontal = 20.dp, vertical = 12.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    InitialsAvatar(member.display_name.ifBlank { null }, size = 30.dp)
                    Spacer(Modifier.width(12.dp))
                    Text(
                        member.display_name.ifBlank { "Teammate" } +
                            if (member.user_id == meUserId) " (you)" else "",
                        style = MaterialTheme.typography.bodyLarge,
                        modifier = Modifier.weight(1f),
                    )
                    if (selectedUserId == member.user_id) {
                        Icon(
                            Icons.Filled.Check,
                            contentDescription = "Selected",
                            tint = MaterialTheme.colorScheme.primary,
                        )
                    }
                }
            }
            Spacer(Modifier.size(24.dp))
        }
    }
}

/** Collapsed "Pinned · N" disclosure; expanded rows jump to the message. */
@Composable
private fun PinnedBanner(
    pinned: List<Message>,
    onJump: (String) -> Unit,
) {
    var expanded by remember { mutableStateOf(false) }
    Column(
        Modifier
            .fillMaxWidth()
            .background(MaterialTheme.colorScheme.surfaceContainerLow),
    ) {
        Row(
            Modifier
                .fillMaxWidth()
                .clickable { expanded = !expanded }
                .padding(horizontal = 16.dp, vertical = 8.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Icon(
                Icons.Filled.PushPin,
                contentDescription = null,
                tint = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.size(14.dp),
            )
            Spacer(Modifier.width(8.dp))
            Text(
                "Pinned · ${pinned.size}",
                style = MaterialTheme.typography.labelMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.weight(1f),
            )
            Icon(
                if (expanded) Icons.Filled.ExpandLess else Icons.Filled.ExpandMore,
                contentDescription = if (expanded) "Collapse" else "Expand",
                tint = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        if (expanded) {
            pinned.forEach { message ->
                Row(
                    Modifier
                        .fillMaxWidth()
                        .clickable { onJump(message.id) }
                        .padding(horizontal = 16.dp, vertical = 8.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Text(
                        message.body.ifBlank { "Photo" },
                        style = MaterialTheme.typography.bodySmall,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                        modifier = Modifier.weight(1f),
                    )
                    Spacer(Modifier.width(8.dp))
                    Text(
                        bubbleTime(message.created_at),
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }
        }
    }
}
