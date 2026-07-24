package com.loonext.android.features.thread

import android.Manifest
import android.content.Intent
import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.Spring
import androidx.compose.animation.core.spring
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.scaleIn
import androidx.compose.animation.scaleOut
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.LocalIndication
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.tween
import androidx.compose.ui.graphics.Color
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
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
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.core.net.toUri
import com.loonext.android.AppGraph
import com.loonext.android.BuildConfig
import com.loonext.android.core.model.Attachment
import com.loonext.android.core.model.AttachmentSummary
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
import com.loonext.android.ui.common.AppSheet
import com.loonext.android.ui.common.CenteredError
import com.loonext.android.ui.common.InitialsAvatar
import com.loonext.android.ui.common.LoadState
import com.loonext.android.ui.common.SkeletonBlock
import com.loonext.android.ui.common.formatPhone
import com.loonext.android.ui.common.initialsOf
import com.loonext.android.ui.common.ResyncOnResume
import com.loonext.android.ui.common.pressScale
import com.loonext.android.ui.common.rememberHaptics
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
    /** Search-result jump: scroll to this message and flash it briefly. */
    highlightMessageId: String? = null,
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
            cache = graph.storeCache,
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
    // #215: a frame missed while this thread was backgrounded/blurred is lost
    // until a re-JOIN — self-heal on return to the foreground via the same
    // refetch the reconnect path uses.
    ResyncOnResume(controller) { controller.refreshAfterReconnect() }
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
            // First-fetch shimmer in the thread's own bubble grammar
            // (cache-first #176 makes this a once-per-conversation sight).
            is LoadState.Loading -> ThreadSkeleton()
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
                        cache = graph.storeCache,
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
                        highlightMessageId = highlightMessageId,
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
                        // #189 non-image MMS chips: mint a signed URL, open.
                        onOpenAttachment = { attachment ->
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
        // Keyboard: the #187/#199 route host pads the ime; a local imePadding
        // here was a consumed no-op and is gone (ImeContractLintTest).
        SnackbarHost(
            snackbar,
            modifier = Modifier.align(Alignment.BottomCenter),
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
    onOpenAttachment: (AttachmentSummary) -> Unit,
    onNotice: (String) -> Unit,
    onOpenGallery: () -> Unit,
    onOpenConversation: ((conversationId: String) -> Unit)?,
    highlightMessageId: String? = null,
) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val haptics = rememberHaptics()
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

    // The row to FLASH (search-result indication). Set when the highlight
    // target lands in the timeline; cleared after the flash animation.
    var flashMessageId by remember { mutableStateOf<String?>(null) }
    LaunchedEffect(highlightMessageId, timeline.size) {
        val target = highlightMessageId ?: return@LaunchedEffect
        if (flashMessageId == target) return@LaunchedEffect
        if (timeline.any { it.key == "m:$target" }) {
            jumpToMessageId = target
            flashMessageId = target
        }
    }
    LaunchedEffect(flashMessageId) {
        if (flashMessageId != null) {
            kotlinx.coroutines.delay(2_200)
            flashMessageId = null
        }
    }
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
            onRemove = {
                haptics.tap()
                controller.detachTag(it)
            },
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
                        val flashed = item is TimelineItem.MessageItem &&
                            flashMessageId == item.message.id
                        val flashColor by animateColorAsState(
                            if (flashed) {
                                MaterialTheme.colorScheme.tertiaryContainer.copy(alpha = 0.45f)
                            } else {
                                Color.Transparent
                            },
                            animationSpec = tween(durationMillis = 600),
                            label = "search-flash",
                        )
                        // animateItem: NEWLY ARRIVING rows fade + settle in
                        // (medium-low springs); the initial cached paint lays
                        // out without animation, so data is never delayed.
                        Box(
                            Modifier
                                .animateItem()
                                .background(flashColor, MaterialTheme.shapes.medium),
                        ) {
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
                                    // combinedClickable already performs the
                                    // long-press haptic — no manual heavy()
                                    // here or it would double-fire.
                                    onLongPress = { actionsFor = message },
                                    onRetry = { controller.retrySend(message.id) },
                                    mintAttachmentUrl = { id ->
                                        repo.attachmentUrl(companyId, id).url
                                    },
                                    onOpenFile = onOpenFile,
                                    onOpenAttachment = onOpenAttachment,
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

            // "New message ↓" springs in instead of popping. Fully qualified:
            // the outer ColumnScope's extension shadows the top-level overload
            // inside this BoxScope and the DslMarker forbids calling it.
            androidx.compose.animation.AnimatedVisibility(
                visible = showNewPill,
                enter = scaleIn(
                    animationSpec = spring(stiffness = Spring.StiffnessMediumLow),
                    initialScale = 0.8f,
                ) + fadeIn(),
                exit = scaleOut(targetScale = 0.9f) + fadeOut(),
                modifier = Modifier
                    .align(Alignment.BottomCenter)
                    .padding(bottom = 12.dp),
            ) {
                val pillInteraction = remember { MutableInteractionSource() }
                Surface(
                    color = MaterialTheme.colorScheme.primary,
                    shape = RoundedCornerShape(50),
                    modifier = Modifier
                        .pressScale(pillInteraction)
                        .clickable(
                            interactionSource = pillInteraction,
                            indication = LocalIndication.current,
                        ) {
                            haptics.tap()
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
            aiRepo = graph.aiRepo,
            companyId = companyId,
            conversationId = controller.conversationId,
            onCreate = { title, assignedUserId, dueAtIso, address ->
                controller.makeTask(message, title, assignedUserId, dueAtIso, address)
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
    val haptics = rememberHaptics()
    var menuOpen by remember { mutableStateOf(false) }
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
            val backInteraction = remember { MutableInteractionSource() }
            Box(
                Modifier
                    .size(36.dp)
                    .pressScale(backInteraction)
                    .clip(CircleShape)
                    .clickable(
                        interactionSource = backInteraction,
                        indication = LocalIndication.current,
                        onClick = onBack,
                    ),
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
            Box(Modifier.clickable { menuOpen = true }) {
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
                    modifier = Modifier.clickable { menuOpen = true },
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
                        Modifier.clickable { menuOpen = true },
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
                }
            }
            Spacer(Modifier.width(8.dp))

            // Call (#165) — the 44dp ink circle. Enabled even for opted-out
            // contacts (voice ≠ SMS consent); mic preflight and gate errors
            // live in the caller.
            val callInteraction = remember { MutableInteractionSource() }
            Box(
                Modifier
                    .size(44.dp)
                    .pressScale(callInteraction)
                    .clip(CircleShape)
                    .background(MaterialTheme.colorScheme.primary)
                    .clickable(
                        interactionSource = callInteraction,
                        indication = LocalIndication.current,
                        enabled = !calling,
                        onClick = onCall,
                    ),
                contentAlignment = Alignment.Center,
            ) {
                // Icon ⇄ in-flight loader morph instead of a hard swap.
                AnimatedContent(
                    targetState = calling,
                    transitionSpec = {
                        (scaleIn(initialScale = 0.6f) + fadeIn()) togetherWith
                            (scaleOut(targetScale = 0.6f) + fadeOut())
                    },
                    label = "call-state",
                ) { inFlight ->
                    if (inFlight) {
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
            }

            // Overflow (assignee moved here — the status line names them).
            Box {
                val moreInteraction = remember { MutableInteractionSource() }
                Box(
                    Modifier
                        .size(36.dp)
                        .pressScale(moreInteraction)
                        .clip(CircleShape)
                        .clickable(
                            interactionSource = moreInteraction,
                            indication = LocalIndication.current,
                        ) { menuOpen = true },
                    contentAlignment = Alignment.Center,
                ) {
                    Icon(
                        Icons.Filled.MoreHoriz,
                        contentDescription = "More",
                        tint = MaterialTheme.colorScheme.onSurfaceVariant,
                        modifier = Modifier.size(18.dp),
                    )
                }
            }
        }
    }

    if (menuOpen) {
        ConversationSheet(
            controller = controller,
            detail = detail,
            members = members,
            onOpenContactPanel = {
                menuOpen = false
                onOpenContactPanel()
            },
            onAssign = {
                menuOpen = false
                assigneeSheetOpen = true
            },
            onOpenGallery = {
                menuOpen = false
                onOpenGallery()
            },
            onOptOut = {
                menuOpen = false
                confirmOptOut = true
            },
            onRevokeOptOut = {
                menuOpen = false
                confirmRevoke = true
            },
            onDismiss = { menuOpen = false },
        )
    }

    if (assigneeSheetOpen) {
        AssigneePickerSheet(
            members = members,
            meUserId = meUserId,
            selectedUserId = detail.assigned_user_id,
            onPick = { userId ->
                assigneeSheetOpen = false
                if (userId != detail.assigned_user_id) {
                    haptics.confirm()
                    controller.setAssignee(userId)
                }
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
                    haptics.reject()
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
                    haptics.confirm()
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
    AppSheet(onDismissRequest = onDismiss) {
        // #180 contract: sheet roots scroll so rows are reachable at ANY
        // viewport height (inert on tall screens).
        Column(Modifier.fillMaxWidth().verticalScroll(rememberScrollState())) {
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
            // The count swaps with a quiet fade when pins change.
            Box(Modifier.weight(1f)) {
                AnimatedContent(
                    targetState = pinned.size,
                    transitionSpec = {
                        fadeIn(tween(durationMillis = 180)) togetherWith
                            fadeOut(tween(durationMillis = 120))
                    },
                    label = "pinned-count",
                ) { count ->
                    Text(
                        "Pinned · $count",
                        style = MaterialTheme.typography.labelMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }
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


/**
 * The conversation menu + info sheet (founder: "a proper card like the
 * filters, at the bottom, with nice controls" — replaces BOTH header
 * dropdowns). Identity on top (tap-through to the full contact panel), the
 * status as segmented pills, then assign/pin/gallery/spam/opt-out rows, and
 * the timeline visibility toggles.
 */
@Composable
private fun ConversationSheet(
    controller: ThreadController,
    detail: com.loonext.android.core.model.ConversationDetail,
    members: List<Member>,
    onOpenContactPanel: () -> Unit,
    onAssign: () -> Unit,
    onOpenGallery: () -> Unit,
    onOptOut: () -> Unit,
    onRevokeOptOut: () -> Unit,
    onDismiss: () -> Unit,
) {
    val contactName = controller.contact?.name
        ?: controller.contact?.phone_e164?.let(::formatPhone)
        ?: "Contact"
    val haptics = rememberHaptics()
    AppSheet(
        onDismissRequest = onDismiss,
        containerColor = MaterialTheme.colorScheme.background,
    ) {
        Column(
            Modifier
                .fillMaxWidth()
                .verticalScroll(rememberScrollState())
                .padding(start = 18.dp, end = 18.dp, bottom = 24.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            // Identity → full contact panel.
            Surface(
                onClick = onOpenContactPanel,
                shape = MaterialTheme.shapes.large,
                color = MaterialTheme.colorScheme.surface,
            ) {
                Row(
                    Modifier.padding(horizontal = 15.dp, vertical = 12.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    InitialsAvatar(contactName, size = 40.dp)
                    Spacer(Modifier.width(11.dp))
                    Column(Modifier.weight(1f)) {
                        Text(
                            contactName,
                            style = MaterialTheme.typography.titleSmall.copy(fontSize = 14.sp),
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis,
                        )
                        Text(
                            controller.contact?.phone_e164?.let(::formatPhone) ?: "",
                            style = MaterialTheme.typography.labelSmall.copy(fontSize = 11.5.sp),
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                    Text(
                        "View contact",
                        style = MaterialTheme.typography.labelSmall.copy(
                            fontSize = 11.5.sp,
                            fontWeight = FontWeight.SemiBold,
                        ),
                        color = MaterialTheme.colorScheme.secondary,
                    )
                }
            }

            // Status pills.
            Column {
                Text(
                    "STATUS",
                    style = MaterialTheme.typography.labelSmall.copy(
                        fontSize = 10.5.sp,
                        fontWeight = FontWeight.Bold,
                        letterSpacing = androidx.compose.ui.unit.TextUnit(
                            0.12f,
                            androidx.compose.ui.unit.TextUnitType.Em,
                        ),
                    ),
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.padding(start = 6.dp, bottom = 7.dp),
                )
                Row(horizontalArrangement = Arrangement.spacedBy(7.dp)) {
                    listOf(
                        ConversationStatus.NEW,
                        ConversationStatus.OPEN,
                        ConversationStatus.WAITING,
                        ConversationStatus.CLOSED,
                    ).forEach { status ->
                        val selected = detail.status == status
                        Surface(
                            onClick = {
                                if (!selected) {
                                    haptics.tap()
                                    controller.setStatus(status)
                                }
                                onDismiss()
                            },
                            shape = CircleShape,
                            color = if (selected) {
                                MaterialTheme.colorScheme.primary
                            } else {
                                MaterialTheme.colorScheme.surface
                            },
                            contentColor = if (selected) {
                                MaterialTheme.colorScheme.onPrimary
                            } else {
                                MaterialTheme.colorScheme.onSurfaceVariant
                            },
                        ) {
                            Text(
                                statusLabel(status),
                                style = MaterialTheme.typography.labelSmall.copy(
                                    fontSize = 11.5.sp,
                                    fontWeight = FontWeight.SemiBold,
                                ),
                                modifier = Modifier.padding(
                                    horizontal = 13.dp,
                                    vertical = 8.dp,
                                ),
                            )
                        }
                    }
                }
            }

            // Actions.
            Surface(
                shape = MaterialTheme.shapes.large,
                color = MaterialTheme.colorScheme.surface,
            ) {
                Column {
                    val assignee = members
                        .firstOrNull { it.user_id == detail.assigned_user_id }
                        ?.display_name?.ifBlank { null }
                    SheetActionRow(
                        label = assignee?.let { "Assigned to " + it } ?: "Assign to…",
                        onClick = onAssign,
                    )
                    HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
                    SheetActionRow(
                        label = if (detail.pinned_at == null) "Pin conversation"
                        else "Unpin conversation",
                        onClick = {
                            haptics.tap()
                            controller.toggleConversationPin()
                            onDismiss()
                        },
                    )
                    HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
                    SheetActionRow(label = "Photos & files", onClick = onOpenGallery)
                    HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
                    SheetActionRow(
                        label = if (detail.is_spam) "Not spam" else "Mark as spam",
                        onClick = {
                            haptics.tap()
                            controller.setSpam(!detail.is_spam)
                            onDismiss()
                        },
                    )
                    HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
                    if (controller.contact?.opted_out == true) {
                        SheetActionRow(label = "Remove opt-out", onClick = onRevokeOptOut)
                    } else {
                        SheetActionRow(label = "Opt out of texts", onClick = onOptOut)
                    }
                }
            }

            // Timeline visibility.
            Surface(
                shape = MaterialTheme.shapes.large,
                color = MaterialTheme.colorScheme.surface,
            ) {
                Column {
                    SheetToggleRow(
                        label = "Show messages",
                        checked = controller.filter.messages,
                        onToggle = {
                            haptics.tap()
                            controller.filter = controller.filter.toggledMessages()
                        },
                    )
                    HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
                    SheetToggleRow(
                        label = "Show notes",
                        checked = controller.filter.notes,
                        onToggle = {
                            haptics.tap()
                            controller.filter = controller.filter.toggledNotes()
                        },
                    )
                    HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
                    SheetToggleRow(
                        label = "Show events",
                        checked = controller.filter.events,
                        onToggle = {
                            haptics.tap()
                            controller.filter = controller.filter.toggledEvents()
                        },
                    )
                }
            }
        }
    }
}

@Composable
private fun SheetActionRow(label: String, onClick: () -> Unit) {
    Row(
        Modifier
            .fillMaxWidth()
            .clickable(onClick = onClick)
            .padding(horizontal = 15.dp, vertical = 13.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(
            label,
            style = MaterialTheme.typography.bodyMedium.copy(
                fontSize = 13.5.sp,
                fontWeight = FontWeight.Medium,
            ),
            modifier = Modifier.weight(1f),
        )
    }
}

/**
 * First-fetch stand-in in the thread's own grammar: alternating bubble
 * shapes shimmering where messages will land. Failed states render
 * elsewhere; with cache-first paints this appears once per conversation.
 */
@Composable
private fun ThreadSkeleton(modifier: Modifier = Modifier) {
    Column(
        modifier
            .fillMaxSize()
            .padding(horizontal = 18.dp, vertical = 14.dp),
        verticalArrangement = Arrangement.Bottom,
    ) {
        ThreadSkeletonBubble(inbound = true, width = 214.dp)
        ThreadSkeletonBubble(inbound = false, width = 168.dp)
        ThreadSkeletonBubble(inbound = false, width = 236.dp)
        ThreadSkeletonBubble(inbound = true, width = 148.dp)
        ThreadSkeletonBubble(inbound = true, width = 246.dp)
        ThreadSkeletonBubble(inbound = false, width = 190.dp)
    }
}

/** One shimmering bubble in the tail-corner grammar of the real timeline. */
@Composable
private fun ThreadSkeletonBubble(inbound: Boolean, width: Dp) {
    Column(
        Modifier
            .fillMaxWidth()
            .padding(vertical = 5.dp),
        horizontalAlignment = if (inbound) Alignment.Start else Alignment.End,
    ) {
        SkeletonBlock(
            width = width,
            height = 44.dp,
            shape = if (inbound) RoundedCornerShape(20.dp, 20.dp, 20.dp, 6.dp)
            else RoundedCornerShape(20.dp, 20.dp, 6.dp, 20.dp),
        )
    }
}

@Composable
private fun SheetToggleRow(label: String, checked: Boolean, onToggle: () -> Unit) {
    Row(
        Modifier
            .fillMaxWidth()
            .clickable(onClick = onToggle)
            .padding(horizontal = 15.dp, vertical = 13.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(
            label,
            style = MaterialTheme.typography.bodyMedium.copy(
                fontSize = 13.5.sp,
                fontWeight = FontWeight.Medium,
            ),
            modifier = Modifier.weight(1f),
        )
        if (checked) {
            Icon(
                Icons.Filled.Check,
                contentDescription = "On",
                tint = MaterialTheme.colorScheme.secondary,
                modifier = Modifier.size(16.dp),
            )
        }
    }
}
