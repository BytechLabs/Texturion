package com.loonext.android.features.thread

import android.Manifest
import android.content.Intent
import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.layout.Arrangement
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
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Call
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.ExpandLess
import androidx.compose.material.icons.filled.ExpandMore
import androidx.compose.material.icons.filled.KeyboardArrowDown
import androidx.compose.material.icons.filled.MoreHoriz
import androidx.compose.material.icons.filled.PushPin
import androidx.compose.material.icons.filled.Sell
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
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
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
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
import com.loonext.android.telephony.SoftphoneManager
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
import com.loonext.android.ui.common.initialsOf
import com.loonext.android.ui.common.userMessage
import com.loonext.android.ui.theme.BrandColor
import java.time.LocalDate
import java.time.ZoneId
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.launch

/**
 * One conversation: header (identity → contact panel, Call button, status,
 * assignee, overflow) → tags row → interleaved timeline (newest-first,
 * reverseLayout) → composer or gate banner. State-based detail screen —
 * callers own the "which conversation is open" state.
 *
 * [onOpenConversation] navigates to ANOTHER conversation (the contact panel's
 * prior-conversations rows); callers that own the open-thread state wire it
 * as `{ openConversationId = it }`. Rows stay un-tappable until wired.
 */
@Composable
fun ThreadScreen(
    graph: AppGraph,
    companyId: String,
    me: Me,
    conversationId: String,
    onBack: () -> Unit,
    modifier: Modifier = Modifier,
    onOpenConversation: ((conversationId: String) -> Unit)? = null,
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

    // "Photos & files" replaces the thread in place (state-based navigation,
    // like the thread itself) — back returns to the conversation.
    var galleryOpen by remember(conversationId) { mutableStateOf(false) }

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

            is LoadState.Ready ->
                if (galleryOpen) {
                    AttachmentsGalleryScreen(
                        repo = repo,
                        companyId = companyId,
                        conversationId = conversationId,
                        contactName = controller.conversation?.let { detail ->
                            detail.contact.name ?: formatPhone(detail.contact.phone_e164)
                        }.orEmpty(),
                        onBack = { galleryOpen = false },
                        onNotice = { scope.launch { snackbar.showSnackbar(it) } },
                    )
                } else {
                    ThreadLoaded(
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
                        onOpenGallery = { galleryOpen = true },
                        onOpenConversation = onOpenConversation,
                    )
                }
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
    onOpenGallery: () -> Unit,
    onOpenConversation: ((conversationId: String) -> Unit)?,
) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val detail = controller.conversation ?: return
    val names = remember(controller.members) { memberNames(controller.members) }
    val contactName = detail.contact.name ?: formatPhone(detail.contact.phone_e164)

    // Call button (#165): authorize + place through the softphone. The mic is
    // preflighted BEFORE authorizing (a denial never reserves the line or
    // bills); gate refusals arrive coded (usage_cap_reached,
    // subscription_inactive, conflict "line on another call") with honest
    // server copy — surfaced verbatim on the snackbar. Stays enabled for
    // opted-out contacts: voice consent ≠ SMS consent.
    val softphone = remember(graph) { SoftphoneManager.get(context, graph.api) }
    var placingCall by remember(controller) { mutableStateOf(false) }
    fun placeCall() {
        if (placingCall) return
        placingCall = true
        // Idempotent registration — the thread may be the first calls surface
        // this process touches.
        softphone.start(companyId, me.display_name)
        scope.launch {
            try {
                softphone.placeCall(
                    displayName = contactName,
                    conversationId = controller.conversationId,
                )
            } catch (cause: Exception) {
                onNotice(cause.userMessage())
            } finally {
                placingCall = false
            }
        }
    }

    val micLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestPermission(),
    ) { granted ->
        if (granted) {
            placeCall()
        } else {
            onNotice(
                "Loonext needs the microphone to place calls. " +
                    "Allow it in Settings › Apps › Loonext › Permissions.",
            )
        }
    }

    var contactPanelOpen by remember(controller) { mutableStateOf(false) }
    var tagSheetOpen by remember(controller) { mutableStateOf(false) }

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

    var showNewPill by remember { mutableStateOf(false) }

    // Your OWN sends always jump to the bottom — you want to see what you
    // just sent regardless of where you'd scrolled.
    LaunchedEffect(controller.pendingSends.size) {
        if (controller.pendingSends.isNotEmpty()) listState.animateScrollToItem(0)
    }

    // Any OTHER new row (teammate message, note, task line): stick to bottom
    // when already there, otherwise surface the "New message" pill instead of
    // silently growing the list below the fold (founder: needs a subtle
    // scroll-to-bottom action when something arrives while scrolled up).
    LaunchedEffect(controller.newestMessageId) {
        if (controller.newestMessageId == null) return@LaunchedEffect
        if (listState.firstVisibleItemIndex <= 1) {
            listState.scrollToItem(0)
        } else {
            showNewPill = true
        }
    }

    // "New message ↓" pill when an inbound lands while scrolled up.
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
            calling = placingCall,
            onCall = {
                if (softphone.hasMicPermission()) {
                    placeCall()
                } else {
                    micLauncher.launch(Manifest.permission.RECORD_AUDIO)
                }
            },
            onOpenContactPanel = { contactPanelOpen = true },
            onOpenGallery = onOpenGallery,
        )

        ThreadTagsRow(
            tags = detail.tags,
            onManage = { tagSheetOpen = true },
            onRemove = { controller.detachTag(it) },
        )

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
                                eventType = item.event.type,
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
        MakeTaskSheet(
            message = message,
            contactName = contactName,
            members = controller.members,
            onCreate = { title, assignedUserId, dueAtIso ->
                controller.makeTask(message, title, assignedUserId, dueAtIso)
                makeTaskFor = null
            },
            onDismiss = { makeTaskFor = null },
        )
    }

    if (contactPanelOpen) {
        ContactPanelSheet(
            controller = controller,
            members = controller.members,
            onOpenConversation = onOpenConversation?.let { open ->
                { conversationId ->
                    contactPanelOpen = false
                    open(conversationId)
                }
            },
            onDismiss = { contactPanelOpen = false },
        )
    }

    if (tagSheetOpen) {
        TagManageSheet(
            repo = repo,
            companyId = companyId,
            attached = detail.tags,
            onAttach = { controller.attachTag(it) },
            onDetach = { controller.detachTag(it) },
            onDismiss = { tagSheetOpen = false },
        )
    }
}

/**
 * The header tags row (#165): attached chips (each with an inline remove) +
 * the Tags affordance opening [TagManageSheet]. Renders nothing but the
 * affordance while untagged — the row must never look like content.
 */
@Composable
private fun ThreadTagsRow(
    tags: List<com.loonext.android.core.model.Tag>,
    onManage: () -> Unit,
    onRemove: (com.loonext.android.core.model.Tag) -> Unit,
) {
    Row(
        Modifier
            .fillMaxWidth()
            .horizontalScroll(rememberScrollState())
            .padding(horizontal = 16.dp, vertical = 5.dp),
        horizontalArrangement = Arrangement.spacedBy(6.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        tags.forEach { tag ->
            Row(
                Modifier
                    .background(MaterialTheme.colorScheme.surface, RoundedCornerShape(50))
                    .padding(start = 10.dp, top = 4.dp, bottom = 4.dp, end = 4.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(
                    tag.name,
                    style = MaterialTheme.typography.labelMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                Icon(
                    Icons.Filled.Close,
                    contentDescription = "Remove tag ${tag.name}",
                    tint = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier
                        .padding(start = 2.dp)
                        .size(16.dp)
                        .clickable { onRemove(tag) },
                )
            }
        }
        Row(
            Modifier
                .clickable(onClick = onManage)
                .padding(horizontal = 6.dp, vertical = 3.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Icon(
                Icons.Filled.Sell,
                contentDescription = null,
                tint = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.size(14.dp),
            )
            Spacer(Modifier.width(4.dp))
            Text(
                if (tags.isEmpty()) "Add tag" else "Tags",
                style = MaterialTheme.typography.labelMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
}

// ---------------------------------------------------------------------------
// Header
// ---------------------------------------------------------------------------

/** 38dp identity circle on the avatar tint (spec header grammar). */
@Composable
private fun HeaderAvatar(name: String?) {
    Box(
        Modifier
            .size(38.dp)
            .background(MaterialTheme.colorScheme.secondaryContainer, CircleShape),
        contentAlignment = Alignment.Center,
    ) {
        Text(
            initialsOf(name),
            style = MaterialTheme.typography.labelMedium.copy(
                fontSize = 12.5.sp,
                fontWeight = FontWeight.SemiBold,
            ),
            color = MaterialTheme.colorScheme.onSecondaryContainer,
        )
    }
}

@Composable
private fun ThreadHeader(
    controller: ThreadController,
    contactName: String,
    phoneLabel: String,
    members: List<Member>,
    meUserId: String,
    onBack: () -> Unit,
    calling: Boolean,
    onCall: () -> Unit,
    onOpenContactPanel: () -> Unit,
    onOpenGallery: () -> Unit,
) {
    val detail = controller.conversation ?: return
    var statusMenuOpen by remember { mutableStateOf(false) }
    var overflowOpen by remember { mutableStateOf(false) }
    var assigneeSheetOpen by remember { mutableStateOf(false) }
    var confirmOptOut by remember { mutableStateOf(false) }
    var confirmRevoke by remember { mutableStateOf(false) }

    // Paper pill header (spec 21/30): back · avatar · name + status line ·
    // ink call circle · overflow dots.
    Surface(
        shape = CircleShape,
        color = MaterialTheme.colorScheme.surface,
        modifier = Modifier
            .fillMaxWidth()
            .padding(start = 14.dp, end = 14.dp, top = 6.dp),
    ) {
        Row(
            Modifier.padding(horizontal = 6.dp, vertical = 8.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Box(
                Modifier
                    .size(36.dp)
                    .clip(CircleShape)
                    .clickable(onClick = onBack),
                contentAlignment = Alignment.Center,
            ) {
                Icon(
                    Icons.AutoMirrored.Filled.ArrowBack,
                    contentDescription = "Back",
                    modifier = Modifier.size(18.dp),
                )
            }
            Spacer(Modifier.width(6.dp))

            // The identity block opens the contact panel sheet (#165); the
            // status line beneath the name anchors the status menu.
            Box(Modifier.clickable(onClick = onOpenContactPanel)) {
                HeaderAvatar(contactName)
            }
            Spacer(Modifier.width(10.dp))
            Column(Modifier.weight(1f)) {
                Text(
                    contactName,
                    style = MaterialTheme.typography.titleSmall.copy(
                        fontSize = 14.5.sp,
                        fontWeight = FontWeight.SemiBold,
                    ),
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.clickable(onClick = onOpenContactPanel),
                )
                Box {
                    val assigneeName = members
                        .firstOrNull { it.user_id == detail.assigned_user_id }
                        ?.display_name?.ifBlank { null }
                    val subtitle = buildString {
                        append(statusLabel(detail.status))
                        append(" · ")
                        append(assigneeName ?: phoneLabel)
                        if (controller.contact?.opted_out == true) append(" · Opted out")
                    }
                    Row(
                        Modifier.clickable { statusMenuOpen = true },
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Box(
                            Modifier
                                .size(6.dp)
                                .background(
                                    if (isSystemInDarkTheme()) BrandColor.Lime
                                    else BrandColor.LimeBright,
                                    CircleShape,
                                ),
                        )
                        Spacer(Modifier.width(5.dp))
                        Text(
                            subtitle,
                            style = MaterialTheme.typography.labelSmall.copy(fontSize = 11.sp),
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis,
                        )
                    }
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
            }
            Spacer(Modifier.width(8.dp))

            // Call (#165) — the 44dp ink circle. Enabled even for opted-out
            // contacts (voice ≠ SMS consent); mic preflight and gate errors
            // live in the caller.
            Box(
                Modifier
                    .size(44.dp)
                    .clip(CircleShape)
                    .background(MaterialTheme.colorScheme.primary)
                    .clickable(enabled = !calling, onClick = onCall),
                contentAlignment = Alignment.Center,
            ) {
                if (calling) {
                    LoadingIndicator(
                        modifier = Modifier.size(20.dp),
                        color = MaterialTheme.colorScheme.onPrimary,
                    )
                } else {
                    Icon(
                        Icons.Filled.Call,
                        contentDescription = "Call $contactName",
                        tint = MaterialTheme.colorScheme.onPrimary,
                        modifier = Modifier.size(18.dp),
                    )
                }
            }

            // Overflow (assignee moved here — the status line names them).
            Box {
                Box(
                    Modifier
                        .size(36.dp)
                        .clip(CircleShape)
                        .clickable { overflowOpen = true },
                    contentAlignment = Alignment.Center,
                ) {
                    Icon(
                        Icons.Filled.MoreHoriz,
                        contentDescription = "More",
                        tint = MaterialTheme.colorScheme.onSurfaceVariant,
                        modifier = Modifier.size(18.dp),
                    )
                }
                DropdownMenu(
                    expanded = overflowOpen,
                    onDismissRequest = { overflowOpen = false },
                ) {
                    DropdownMenuItem(
                        text = {
                            val assignee =
                                members.firstOrNull { it.user_id == detail.assigned_user_id }
                            Text(
                                assignee?.let {
                                    "Assigned to ${it.display_name.ifBlank { "a teammate" }}"
                                } ?: "Assign to…",
                            )
                        },
                        onClick = {
                            overflowOpen = false
                            assigneeSheetOpen = true
                        },
                    )
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
                        text = { Text("Photos & files") },
                        onClick = {
                            overflowOpen = false
                            onOpenGallery()
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

/**
 * Collapsed "Pinned · N" disclosure; expanded rows jump to the message.
 * Rendered as the cream pinned-well from the token table (paper-raised in
 * dark, where cream has no counterpart).
 */
@Composable
private fun PinnedBanner(
    pinned: List<Message>,
    onJump: (String) -> Unit,
) {
    var expanded by remember { mutableStateOf(false) }
    Column(
        Modifier
            .fillMaxWidth()
            .padding(horizontal = 18.dp, vertical = 5.dp)
            .clip(RoundedCornerShape(14.dp))
            .background(
                if (isSystemInDarkTheme()) MaterialTheme.colorScheme.surfaceContainerHigh
                else BrandColor.Cream,
            ),
    ) {
        Row(
            Modifier
                .fillMaxWidth()
                .clickable { expanded = !expanded }
                .padding(horizontal = 14.dp, vertical = 8.dp),
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
