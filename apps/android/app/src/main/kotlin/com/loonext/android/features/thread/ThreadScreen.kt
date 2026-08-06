package com.loonext.android.features.thread

import android.Manifest
import android.content.Intent
import android.net.ConnectivityManager
import android.net.Network
import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.Spring
import androidx.compose.animation.core.spring
import androidx.compose.animation.core.tween
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
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
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
import androidx.compose.material.icons.outlined.Block
import androidx.compose.material.icons.outlined.ChatBubbleOutline
import androidx.compose.material.icons.outlined.CheckBox
import androidx.compose.material.icons.outlined.CheckBoxOutlineBlank
import androidx.compose.material.icons.outlined.Info
import androidx.compose.material.icons.outlined.Lock
import androidx.compose.material.icons.outlined.PersonAdd
import androidx.compose.material.icons.outlined.PhotoLibrary
import androidx.compose.material.icons.outlined.PushPin
import androidx.compose.material.icons.outlined.Report
import androidx.compose.material.icons.outlined.Schedule
import androidx.compose.material.icons.outlined.Undo
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
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.runtime.snapshotFlow
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.toggleableState
import androidx.compose.ui.state.ToggleableState
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.core.net.toUri
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.loonext.android.AppGraph
import com.loonext.android.BuildConfig
import com.loonext.android.core.model.Attachment
import com.loonext.android.core.model.AttachmentSummary
import com.loonext.android.core.diag.RecentErrors
import com.loonext.android.core.model.Capability
import com.loonext.android.core.model.ConversationStatus
import com.loonext.android.core.model.Me
import com.loonext.android.core.model.Member
import com.loonext.android.core.model.MemberRole
import com.loonext.android.core.compose.OnMyWay
import com.loonext.android.core.model.Message
import com.loonext.android.core.model.MessageDirection
import com.loonext.android.core.model.shouldOfferThreadSummaryFor
import com.loonext.android.core.model.isCarrierEnforcedOptOut
import com.loonext.android.core.net.ApiErrorCode
import com.loonext.android.features.attachments.openOriginal
import com.loonext.android.features.compose.bannerKind
import com.loonext.android.features.contacts.contactRepeatBadge
import com.loonext.android.features.settings.openExternal
import com.loonext.android.features.settings.supportMailto
import com.loonext.android.features.settings.supportSituation
import com.loonext.android.features.settings.supportSubjectFor
import com.loonext.android.core.realtime.PRESENCE_HEARTBEAT_MS
import com.loonext.android.core.realtime.RealtimeState
import com.loonext.android.core.realtime.TYPING_THROTTLE_MS
import com.loonext.android.core.realtime.TYPING_TTL_MS
import com.loonext.android.core.realtime.presenceEntries
import com.loonext.android.core.realtime.presenceLabel
import com.loonext.android.core.realtime.viewersOf
import com.loonext.android.core.snooze.isSnoozed
import com.loonext.android.core.snooze.snoozeReturnLabel
import com.loonext.android.features.compose.ComposerDrafts
import com.loonext.android.features.compose.DraftSuggestionsCache
import com.loonext.android.features.compose.Nanp
import com.loonext.android.features.compose.NoteFileUploader
import com.loonext.android.features.compose.ThreadComposer
import com.loonext.android.features.compose.WrapUpTranscriber
import com.loonext.android.features.compose.rememberComposerState
import com.loonext.android.features.compose.selectComposerBanner
import com.loonext.android.features.compose.usSendApproved
import com.loonext.android.features.compose.usSuspended
import com.loonext.android.features.compose.usTextingOff
import com.loonext.android.telephony.SoftphoneManager
import com.loonext.android.ui.common.AppSheet
import com.loonext.android.ui.common.CenteredError
import com.loonext.android.ui.common.InitialsAvatar
import com.loonext.android.ui.common.LoadState
import com.loonext.android.ui.common.ResyncOnResume
import com.loonext.android.ui.common.SkeletonBlock
import com.loonext.android.ui.common.formatPhone
import com.loonext.android.ui.common.initialsOf
import com.loonext.android.ui.common.pressScale
import com.loonext.android.ui.common.rememberHaptics
import com.loonext.android.ui.common.userMessage
import com.loonext.android.ui.theme.BrandColor
import java.time.LocalDate
import java.time.ZoneId
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.launch
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

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
    /** #217: open a message/checklist task's detail (MainActivity Overlay.Task). */
    onOpenTask: ((taskId: String) -> Unit)? = null,
    /** Search-result jump: scroll to this message and flash it briefly. */
    highlightMessageId: String? = null,
    /** Open the AI settings, offered under the drafts (MainActivity Overlay.Settings). */
    onOpenAiSettings: (() -> Unit)? = null,
    /** #465: open the full contact screen from the conversation panel. */
    onOpenContact: ((contactId: String) -> Unit)? = null,
) {
    val context = LocalContext.current
    // #289: this phone's own answer about its own data plan. Device-scoped,
    // not workspace-scoped — the same person on a laptop has a different one.
    val wifiOnlyOriginals by graph.prefs.wifiOnlyOriginals
        .collectAsStateWithLifecycle(initialValue = false)
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
    ResyncOnResume(controller) {
        controller.refreshAfterReconnect()
        // #234: coming back to the app is the most common moment the bars
        // came back too — the walk out of the basement to the truck.
        controller.flushOutbox()
    }

    // #234: and the case a foreground return does NOT cover — the phone
    // regaining signal while the thread is open in the person's hand.
    //
    // Registered HERE rather than in the controller because the controller has
    // no teardown: a default network callback per thread opened would leak one
    // per screen for the life of the process. DisposableEffect is the hook that
    // guarantees the unregister.
    val appContext = LocalContext.current.applicationContext
    DisposableEffect(controller) {
        val connectivity = appContext.getSystemService(ConnectivityManager::class.java)
        val callback = object : ConnectivityManager.NetworkCallback() {
            override fun onAvailable(network: Network) {
                controller.flushOutbox()
            }
        }
        runCatching { connectivity?.registerDefaultNetworkCallback(callback) }
        onDispose { runCatching { connectivity?.unregisterNetworkCallback(callback) } }
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
                        onOpenAiSettings = onOpenAiSettings,
                        onOpenContact = onOpenContact,
                        onBack = onBack,
                        onOpenFile = { attachment ->
                            scope.launch {
                                try {
                                    // #240: handing the file to another app
                                    // means handing over the FILE, not a
                                    // picture of it.
                                    //
                                    // #289: which is exactly why it waits for
                                    // Wi-Fi when somebody has asked it to. The
                                    // thread above already rendered from a
                                    // 200 KB preview; this is the 25 MB one.
                                    openOriginal(
                                        context = context,
                                        wifiOnlyOriginals = wifiOnlyOriginals,
                                        snackbar = snackbar,
                                        mint = {
                                            repo.attachmentUrl(
                                                companyId,
                                                attachment.id,
                                                "original",
                                            ).url
                                        },
                                    )
                                } catch (cause: Exception) {
                                    snackbar.showSnackbar(cause.userMessage())
                                }
                            }
                        },
                        // #189 non-image MMS chips: mint a signed URL, open.
                        onOpenAttachment = { attachment ->
                            scope.launch {
                                try {
                                    // #240: handing the file to another app
                                    // means handing over the FILE, not a
                                    // picture of it.
                                    //
                                    // #289: which is exactly why it waits for
                                    // Wi-Fi when somebody has asked it to. The
                                    // thread above already rendered from a
                                    // 200 KB preview; this is the 25 MB one.
                                    openOriginal(
                                        context = context,
                                        wifiOnlyOriginals = wifiOnlyOriginals,
                                        snackbar = snackbar,
                                        mint = {
                                            repo.attachmentUrl(
                                                companyId,
                                                attachment.id,
                                                "original",
                                            ).url
                                        },
                                    )
                                } catch (cause: Exception) {
                                    snackbar.showSnackbar(cause.userMessage())
                                }
                            }
                        },
                        onNotice = { scope.launch { snackbar.showSnackbar(it) } },
                        onOpenGallery = { galleryOpen = true },
                        onOpenConversation = onOpenConversation,
                        onOpenTask = onOpenTask,
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
    onOpenTask: ((taskId: String) -> Unit)?,
    onOpenAiSettings: (() -> Unit)?,
    onOpenContact: ((contactId: String) -> Unit)?,
    highlightMessageId: String? = null,
) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val haptics = rememberHaptics()
    val detail = controller.conversation ?: return
    val names = remember(controller.members) { memberNames(controller.members) }
    val contactName = detail.contact.name ?: formatPhone(detail.contact.phone_e164)

    // #507: the wrap-up a crew member speaks into their own phone after a call
    // has ended. Multipart, so it goes through its own small client for the
    // same reason NoteFileUploader above does — ApiClient speaks JSON bodies.
    val wrapUpTranscriber = remember(graph) {
        WrapUpTranscriber(graph.api, BuildConfig.API_URL)
    }

    // #234: deleting a queued message throws away words the person wrote and
    // that nothing else holds — the draft is long gone by then. Confirming is
    // the one place in this screen where a step is worth the friction.
    // *Applying: Ethical Friction — a deliberate pause before the irreversible.*
    var confirmDiscardQueued by remember(controller) { mutableStateOf<PendingSend?>(null) }

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

    // #217 go-to-message: the highlight target (a task's source message, or a
    // search hit) may sit deeper than the loaded window. Page back until it
    // lands — keyed on the target ALONE so timeline growth never cancels the
    // walk mid-page. The flash+jump effect below fires once it's present.
    LaunchedEffect(highlightMessageId) {
        val target = highlightMessageId ?: return@LaunchedEffect
        if (controller.messages.none { it.id == target }) {
            controller.ensureMessageLoaded(target)
        }
    }

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

    // #520: is there a job on this thread due TODAY? Asked here rather than in
    // the composer, which stays presentational — and "today" is the DEVICE's
    // day, because the person tapping is standing somewhere and means their
    // today, not the workspace's.
    //
    // A failed read leaves it false, so the affordance simply does not appear.
    // Offering it and having the send find no job would be worse than not
    // offering it at all.
    var hasJobToday by remember(controller.conversationId) { mutableStateOf(false) }
    LaunchedEffect(controller.conversationId) {
        val startOfDay = java.time.LocalDate.now()
            .atStartOfDay(java.time.ZoneId.systemDefault())
        runCatching {
            graph.tasksRepo.tasks(
                companyId = companyId,
                status = "open",
                conversationId = controller.conversationId,
                dueAfter = startOfDay.toInstant().toString(),
                dueBefore = startOfDay.plusDays(1).toInstant().toString(),
                limit = 1,
            )
        }.onSuccess { hasJobToday = it.data.isNotEmpty() }
    }

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

        // #250: the classifier's only visible effect. It suppressed a push
        // and nothing else, so without this the thread simply went quiet for
        // a reason nobody could see. Above the snooze banner: "is this even
        // a customer" outranks "when does this come back".
        if (detail.spam_suspected_at != null) {
            SpamSuspectedBanner(
                reasons = detail.spam_signals.map { it.why },
                // Clearing it PATCHes the thread, which read_only cannot do.
                // Same resolution as viewerReadOnly further down; computed
                // here because that val is declared below this point.
                canAct = me.memberships.firstOrNull { it.company_id == companyId }?.role !=
                    MemberRole.READ_ONLY,
                onNotSpam = {
                    haptics.tap()
                    controller.clearSpamSuspicion()
                },
            )
        }

        // #293: a deferred thread says so IN PLACE, with a one-tap way back.
        // The alternative is opening a thread you snoozed, seeing nothing, and
        // finding it gone from the inbox again an hour later — a state the app
        // knew about and did not mention.
        detail.snoozed_until?.takeIf { isSnoozed(it) }?.let { until ->
            SnoozedBanner(
                label = snoozeReturnLabel(until),
                onBringBack = {
                    haptics.tap()
                    controller.unsnooze()
                },
            )
        }

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

        // #247 — the catch-up, last in the strip stack and directly above the
        // messages it is about. Below spam/snooze/pinned deliberately: each of
        // those is a fact about the thread's standing, and this is a reading
        // aid. A summary must never sit above the question "is this even a
        // customer".
        ThreadSummaryCard(
            state = catchUpState(
                // The same rule the server enforces before it reserves
                // anything, so the control is absent rather than offering
                // something that answers "there was nothing to summarise".
                offered = shouldOfferThreadSummaryFor(controller.messages, System.currentTimeMillis()),
                reading = controller.summarizing,
                summary = controller.summary,
            ),
            onAsk = {
                haptics.tap()
                controller.askForSummary()
            },
            // The citation, made real. Reuses the pinned banner's jump exactly:
            // page back until the message is loaded, then flash it in place. A
            // line that could not be reached would make the attribution a
            // disclaimer, which is the one thing this card must not become.
            onOpenMessage = { messageId ->
                scope.launch {
                    if (controller.ensureMessageLoaded(messageId)) {
                        jumpToMessageId = messageId
                    }
                }
            },
        )

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
                                    // #101 shared-inbox attribution: in a shared
                                    // inbox the first question about an
                                    // outbound text is who already answered
                                    // this customer, so sends carry the
                                    // teammate's name the way the web does.
                                    authorName = when (message.direction) {
                                        MessageDirection.NOTE ->
                                            message.sent_by_user_id?.let { names[it] }
                                                ?: "Internal note"

                                        MessageDirection.OUTBOUND ->
                                            message.sent_by_user_id?.let { names[it] }

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
                                    onOpenTask = onOpenTask,
                                )
                            }

                            is TimelineItem.PendingItem -> PendingBubble(
                                pending = item.pending,
                                onSendNow = {
                                    haptics.confirm()
                                    controller.retryQueued(item.pending.localId)
                                },
                                onDelete = { confirmDiscardQueued = item.pending },
                            )

                            is TimelineItem.EventItem -> {
                                // #465: an event that names a task or a message
                                // goes there. Resolved from the payload, so a
                                // line whose target was deleted (or whose
                                // message is not in this thread) stays inert
                                // rather than offering a tap that dead-ends.
                                val target = eventTargetOf(item.event)
                                val jumpable = target is EventTarget.JumpToMessage &&
                                    timeline.any { it.key == "m:${target.messageId}" }
                                val openable = target is EventTarget.OpenTask &&
                                    onOpenTask != null
                                EventLine(
                                    text = eventLine(item.event, names, contactName),
                                    timeIso = item.event.created_at,
                                    eventType = item.event.type,
                                    transcript = voicemailTranscriptOf(item.event),
                                    clickLabel = when {
                                        openable -> "Open the task"
                                        jumpable -> "Go to that message"
                                        else -> null
                                    },
                                    onClick = when {
                                        openable -> {
                                            {
                                                onOpenTask!!(
                                                    (target as EventTarget.OpenTask).taskId,
                                                )
                                            }
                                        }

                                        jumpable -> {
                                            {
                                                val id =
                                                    (target as EventTarget.JumpToMessage)
                                                        .messageId
                                                jumpToMessageId = id
                                                flashMessageId = id
                                            }
                                        }

                                        else -> null
                                    },
                                )
                            }

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

        // #302 — who else is on this thread.
        //
        // The socket already holds this number's presence topic (it rides the
        // same lifecycle as the number topic), so opening a thread only has to
        // announce this viewer and keep announcing inside the TTL. A screen that
        // stops running stops speaking, and the viewer disappears for everybody
        // else on their next evaluation — no server, no cleanup job.
        val presenceByTopic by graph.realtime.presence.collectAsStateWithLifecycle()
        var presenceNow by remember(controller.conversationId) { mutableLongStateOf(System.currentTimeMillis()) }
        var typingUntil by remember(controller.conversationId) { mutableLongStateOf(0L) }
        val numberId = detail.phone_number_id

        LaunchedEffect(controller.conversationId, numberId, me.user_id) {
            fun announce(typing: Boolean) {
                graph.realtime.trackPresence(
                    numberId,
                    buildJsonObject {
                        put("user_id", me.user_id)
                        put("display_name", me.display_name)
                        put("conversation_id", controller.conversationId)
                        put("typing", typing)
                        put("at", System.currentTimeMillis())
                    },
                )
            }
            // The topic is joined for as long as this thread is open, and left
            // in the `finally` below — presence is per-thread, not per-number.
            graph.realtime.joinPresence(numberId)
            announce(false)
            try {
                while (true) {
                    delay(PRESENCE_HEARTBEAT_MS)
                    announce(System.currentTimeMillis() < typingUntil)
                    // Re-evaluate staleness even when no frame arrives: a viewer
                    // who simply stops speaking must leave the screen, and on a
                    // quiet thread nothing else would trigger that.
                    presenceNow = System.currentTimeMillis()
                }
            } finally {
                // Leaving the thread stops the announcement immediately rather
                // than letting the TTL expire — "promptly" is the acceptance
                // criterion, and 45 seconds of a ghost is not prompt.
                graph.realtime.untrackPresence(numberId)
                graph.realtime.leavePresence(numberId)
            }
        }

        // A second, faster tick purely for staleness. Cheap, and it fetches
        // nothing.
        LaunchedEffect(controller.conversationId) {
            while (true) {
                delay(5_000)
                presenceNow = System.currentTimeMillis()
            }
        }

        // COLLECTED, not read. `state.value` inside composition samples the
        // flow once and never recomposes on a change, so a socket that dropped
        // would leave the last viewers pinned to the thread forever — the exact
        // stale-presence failure the `healthy` gate exists to prevent.
        val realtimeState by graph.realtime.state.collectAsState()

        val viewers = viewersOf(
            entries = presenceEntries(
                presenceByTopic["realtime:company:$companyId:number:$numberId:presence"]
                    ?: emptyMap(),
            ),
            conversationId = controller.conversationId,
            selfUserId = me.user_id,
            now = presenceNow,
            // Presence we are no longer being told about is presence we must not
            // show. The realtime state IS the health signal.
            healthy = realtimeState is RealtimeState.Joined,
        )
        presenceLabel(viewers)?.let { line ->
            Row(
                Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 16.dp, vertical = 4.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Box(
                    Modifier
                        .size(6.dp)
                        .clip(CircleShape)
                        .background(
                            if (viewers.any { it.typing }) MaterialTheme.colorScheme.secondary
                            else MaterialTheme.colorScheme.onSurfaceVariant,
                        ),
                )
                Spacer(Modifier.width(6.dp))
                Text(
                    line,
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }

        // Composer (or gate banner + notes-only).
        val drafts = remember { ComposerDrafts(context.applicationContext) }
        val composer = rememberComposerState(controller.conversationId, drafts)
        // #315: a view-only observer may read this thread and change nothing in
        // it. Resolved from the membership, the same way the settings index
        // does it.
        val viewerReadOnly =
            me.memberships.firstOrNull { it.company_id == companyId }?.role ==
                MemberRole.READ_ONLY
        val banner = selectComposerBanner(
            contactOptedOut = controller.contact?.opted_out == true,
            contactOptOutSource = controller.contact?.opt_out_source,
            subscriptionStatus = controller.company?.subscription_status
                ?: com.loonext.android.core.model.SubscriptionStatus.ACTIVE,
            destinationCountry = Nanp.destinationCountry(detail.contact.phone_e164),
            usApproved = controller.company?.let { usSendApproved(it) } ?: true,
            usTextingOff = controller.company?.let { usTextingOff(it) } ?: false,
            usage = controller.usage,
            // #396: a shared inbox means the person replying is often not the
            // person who read the request.
            optOutHint = detail.opt_out_hint_at != null,
            // #423: the carrier took an approved registration away.
            usSuspended = controller.company?.let { usSuspended(it) } ?: false,
            // #363: the reader's own level on THIS number — the one banner
            // about them rather than about the conversation.
            viewerLevel = detail.viewer_level,
            viewerReadOnly = viewerReadOnly,
        )

        // #233: what this thread is about to say. Above the composer and below
        // the transcript, because a scheduled message is not a message — it has
        // no delivery status and may never become one, and putting it in the
        // history would mean a reader has to check a badge before believing
        // anything above the fold actually went. Rendered here rather than
        // inside the banner branch's `else` so a HELD text still says why:
        // a banner means something is wrong with sending, which is exactly when
        // a queued text is stuck and most needs saying out loud.
        // #244: above the scheduled strip, because this is the only thing on
        // the screen with a clock running on it — somebody is waiting for a
        // callback, and if nobody claims it the alert widens to the whole crew.
        AlertBanner(
            alert = detail.open_alert,
            viewerId = me.user_id,
            onClaim = { controller.acknowledgeAlert(it) },
            modifier = Modifier.padding(bottom = 6.dp),
        )

        ScheduledStrip(
            rows = controller.scheduled,
            onCancel = { controller.cancelScheduled(it) },
            modifier = Modifier.padding(bottom = 4.dp),
        )

        ThreadComposer(
            state = composer,
            noteOnly = detail.viewer_level == "note",
            readOnly = viewerReadOnly,
            hasJobToday = hasJobToday,
            onSendOnMyWay = { minutes ->
                // The ORDINARY send path: the opt-out gate, quiet hours and
                // number access all apply. Being fast is not a reason for an
                // exemption, and the server's refusal is what gets shown.
                controller.sendText(
                    OnMyWay.text(minutes),
                    emptyList(),
                    null,
                    false,
                ) {
                    // The restore hook every other send uses. There is no draft
                    // to put back here — the words were never in the box — so
                    // it deliberately does nothing, which is stated rather
                    // than left as an empty lambda somebody wonders about.
                }
            },
            onTyping = {
                // #302: throttled, because the keystroke rate is not the
                // broadcast rate. The window is extended on every keystroke; the
                // heartbeat above carries it while it lasts.
                val now = System.currentTimeMillis()
                val wasQuiet = now >= typingUntil - TYPING_TTL_MS + TYPING_THROTTLE_MS
                typingUntil = now + TYPING_TTL_MS
                if (wasQuiet) {
                    graph.realtime.trackPresence(
                        numberId,
                        buildJsonObject {
                            put("user_id", me.user_id)
                            put("display_name", me.display_name)
                            put("conversation_id", controller.conversationId)
                            put("typing", true)
                            put("at", now)
                        },
                    )
                }
            },
            banner = banner,
            contactName = detail.contact.name,
            businessName = controller.company?.name,
            // #274: everything this side can answer honestly. The visit day and
            // time are the server's to resolve — a cached answer would be
            // confidently wrong the moment a teammate reschedules the task.
            contactAddress = detail.contact.address,
            senderName = me.display_name,
            // The number THIS conversation sends from, not whichever is first:
            // that is the one the customer replies to.
            ourNumberE164 = controller.company?.numbers
                ?.firstOrNull { it.id == detail.phone_number_id }
                ?.number_e164,
            // Reuse drafts already paid for until a message moves the thread.
            destinationClock = detail.destination_clock,
            draftCacheKey = DraftSuggestionsCache.keyOf(
                controller.conversationId,
                detail.last_message_at,
            ),
            // #274: most-used first. Somebody opening the picker is about to
            // send, and the reply they send twenty times a day should not be
            // wherever its name happens to fall.
            loadTemplates = { repo.templates(companyId, byUse = true).data },
            onOpenAiSettings = onOpenAiSettings,
            // #106: calling is outreach like texting, so a notes-only member
            // gets no control the API would refuse.
            onCallInstead = if (detail.viewer_level == "text") ({ placeCall() }) else null,
            // #253: the honest banner told them exactly what is wrong; without
            // this it is still a dead end. Reads the recent-failure ring at TAP
            // time, not at render — the useful errors are the ones that happened
            // while the person was staring at the banner.
            onReportBanner = { banner ->
                val kind = bannerKind(banner)
                openExternal(
                    context,
                    supportMailto(
                        companyId = companyId,
                        companyName = controller.company?.name,
                        plan = controller.company?.plan,
                        appVersion = BuildConfig.VERSION_NAME,
                        subject = supportSubjectFor(kind),
                        situation = supportSituation(kind),
                        recentErrors = RecentErrors.recentLines(),
                    ),
                )
            },
            onSendText = { body, photos, templateId, templateEdited ->
                controller.sendText(body, photos, templateId, templateEdited) {
                    composer.restore(body, photos, emptyList())
                }
            },
            onSaveNote = { body, files, mentionUserIds ->
                val picked = composer.picked
                controller.saveNote(body, files, mentionUserIds) {
                    // Put the picks back with the words: a restored draft that
                    // still reads "@Sam" must still be able to tell Sam.
                    composer.restore(body, emptyList(), files, picked)
                }
            },
            loadMentionableMembers = { controller.mentionableMembers() },
            // #408: the newest outbound in this thread, so the send boundary
            // can ask before landing on top of a colleague's answer. A note is
            // not a collision — it reaches no customer — so only outbound
            // counts here.
            lastOutbound = controller.messages
                .firstOrNull { it.direction == MessageDirection.OUTBOUND },
            memberName = { id ->
                controller.members.firstOrNull { it.user_id == id }
                    ?.display_name?.ifBlank { null }
            },
            meUserId = me.user_id,
            onNotice = onNotice,
            suggestReplies = { draft ->
                graph.aiRepo.suggestReplies(companyId, detail.id, draft)
            },
            // #507: the words come back for the member to read and edit; the
            // note itself is still written by the Save button below, through
            // the one note route that owns mentions, permissions and search.
            transcribeWrapUp = { audio, seconds ->
                wrapUpTranscriber.transcribe(companyId, detail.id, audio, seconds)
            },
            // #431: fire-and-forget on its own coroutine. A slow or failed
            // outcome report must never delay or fail the send it describes.
            reportAiOutcome = { feature, outcome ->
                scope.launch { graph.aiRepo.reportAiOutcome(companyId, feature, outcome) }
            },
            // #233: queue it instead of sending it. Withheld from a notes-only
            // or view-only member for the same reason the send path is — the
            // API would refuse it, and an affordance that only ever fails is
            // worse than no affordance.
            onScheduleSend = if (detail.viewer_level == "text" && !viewerReadOnly) {
                { body, sendAtIso, confirmed ->
                    controller.scheduleSend(body, sendAtIso, confirmed)
                }
            } else {
                null
            },
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
            meUserId = me.user_id,
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
            onOpenContact = onOpenContact?.let { open ->
                { contactId ->
                    contactPanelOpen = false
                    open(contactId)
                }
            },
            onOpenTask = onOpenTask?.let { open ->
                { taskId ->
                    contactPanelOpen = false
                    open(taskId)
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
            // #298: a workspace that keeps a set list hides Create here rather
            // than failing it. Defaults to allowed while the company is still
            // loading — the server is the gate, and an affordance that flickers
            // off is worse than one that occasionally has to say no.
            mayCreate = controller.company?.tags_locked != true ||
                MemberRole.has(
                    me.memberships.firstOrNull { it.company_id == companyId }?.role,
                    Capability.SETTINGS_MANAGE,
                ),
            onAttach = { controller.attachTag(it) },
            onDetach = { controller.detachTag(it) },
            onDismiss = { tagSheetOpen = false },
        )
    }

    confirmDiscardQueued?.let { pending ->
        AlertDialog(
            onDismissRequest = { confirmDiscardQueued = null },
            title = { Text("Delete this message?") },
            text = {
                // Quoting it back is the point: a queued row shows a couple of
                // lines, and the person is about to lose whichever ones they
                // cannot see.
                Text(
                    "It hasn't been sent, and deleting it here is the only copy gone. " +
                        "\n\n“${pending.body}”",
                )
            },
            confirmButton = {
                TextButton(onClick = {
                    haptics.reject()
                    controller.discardQueued(pending.localId)
                    confirmDiscardQueued = null
                }) { Text("Delete") }
            },
            dismissButton = {
                TextButton(onClick = { confirmDiscardQueued = null }) { Text("Keep it") }
            },
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
                    // #505 — the repeat-customer signal, on the surface the
                    // person replying is actually looking at. It lived only in
                    // the contact panel, which opens on a tap nobody takes
                    // mid-reply.
                    //
                    // On this line rather than beside the name, which is where
                    // web puts it. The phone header's identity column is about
                    // 142dp on a 360dp device, and an unweighted chip in a Row
                    // is measured BEFORE the weighted name — so a long count at
                    // a large system font scale could squeeze the contact's
                    // name to nothing. This line already ellipsizes, already
                    // joins secondary facts with " · ", and cannot push
                    // anything off screen.
                    //
                    // FIRST in the string, so it is the last thing truncation
                    // takes: a tech in a truck is exactly who this is for, and
                    // the narrow screen is exactly where it would be lost.
                    //
                    // The count comes from the contact DETAIL read (the same
                    // `controller.contact` the opted-out marker below uses) —
                    // the conversation embed carries no relationship summary,
                    // and reading a defaulted 0 off it would badge nobody.
                    val repeatBadge =
                        contactRepeatBadge(controller.contact?.conversation_count)
                    val subtitle = buildString {
                        // Absent entirely below two conversations: a first-time
                        // caller's header is what it always was.
                        if (repeatBadge != null) {
                            append(repeatBadge)
                            append(" · ")
                        }
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
 * #250 — "this looks like a robotext", said out loud rather than acted on.
 *
 * Every genuine new customer is an unknown sender with no prior outbound,
 * because that is what a new lead IS. So the classifier never hides a
 * thread; it suppresses one push and shows this. The reasons are the
 * server's own sentences, rendered verbatim — a verdict somebody cannot
 * check is one they learn to dismiss.
 */
@Composable
private fun SpamSuspectedBanner(
    reasons: List<String>,
    canAct: Boolean,
    onNotSpam: () -> Unit,
) {
    Column(
        Modifier
            .fillMaxWidth()
            .padding(horizontal = 18.dp, vertical = 5.dp)
            .clip(RoundedCornerShape(14.dp))
            .background(MaterialTheme.colorScheme.surfaceContainerHigh)
            .padding(horizontal = 14.dp, vertical = 10.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Icon(
                Icons.Outlined.Info,
                contentDescription = null,
                tint = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.size(14.dp),
            )
            Spacer(Modifier.width(8.dp))
            Text(
                "This looks like spam",
                style = MaterialTheme.typography.labelMedium.copy(
                    fontWeight = FontWeight.SemiBold,
                ),
                color = MaterialTheme.colorScheme.onSurface,
                modifier = Modifier.weight(1f),
            )
            if (canAct) {
                Text(
                    "Not spam",
                    style = MaterialTheme.typography.labelMedium.copy(
                        fontWeight = FontWeight.SemiBold,
                    ),
                    color = MaterialTheme.colorScheme.primary,
                    modifier = Modifier.clickable(onClick = onNotSpam),
                )
            }
        }
        Text(
            "We didn't send a notification for it. Nothing is hidden, and you " +
                "can reply as normal.",
            style = MaterialTheme.typography.labelSmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.padding(top = 4.dp),
        )
        reasons.forEach { why ->
            Text(
                why,
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.padding(top = 2.dp),
            )
        }
    }
}

/**
 * #293 — "Back Thursday, 8:00 AM · Bring back". One line, the same shape as the
 * pinned banner so a second in-thread status strip does not invent a second
 * visual language, and the whole strip is the tap target: at this point there
 * is exactly one thing a person wants from it.
 */
@Composable
private fun SnoozedBanner(label: String, onBringBack: () -> Unit) {
    Row(
        Modifier
            .fillMaxWidth()
            .padding(horizontal = 18.dp, vertical = 5.dp)
            .clip(RoundedCornerShape(14.dp))
            .background(MaterialTheme.colorScheme.surfaceContainerHigh)
            .clickable(onClick = onBringBack)
            .padding(horizontal = 14.dp, vertical = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(
            Icons.Outlined.Schedule,
            contentDescription = null,
            tint = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.size(14.dp),
        )
        Spacer(Modifier.width(8.dp))
        Text(
            label,
            style = MaterialTheme.typography.labelMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.weight(1f),
        )
        Text(
            "Bring back",
            style = MaterialTheme.typography.labelMedium.copy(
                fontWeight = FontWeight.SemiBold,
            ),
            color = MaterialTheme.colorScheme.primary,
        )
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
                        icon = Icons.Outlined.PersonAdd,
                        label = assignee?.let { "Assigned to " + it } ?: "Assign to…",
                        onClick = onAssign,
                    )
                    HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
                    // #465: pinned and spam are STATES, drawn and named as such.
                    SheetToggleRow(
                        icon = Icons.Outlined.PushPin,
                        label = "Pinned",
                        checked = detail.pinned_at != null,
                        onToggle = {
                            haptics.tap()
                            controller.toggleConversationPin()
                            onDismiss()
                        },
                    )
                    HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
                    SheetActionRow(
                        icon = Icons.Outlined.PhotoLibrary,
                        label = "Photos & files",
                        onClick = onOpenGallery,
                    )
                    HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
                    SheetToggleRow(
                        icon = Icons.Outlined.Report,
                        label = "Spam",
                        checked = detail.is_spam,
                        onToggle = {
                            haptics.tap()
                            controller.setSpam(!detail.is_spam)
                            onDismiss()
                        },
                    )
                    HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
                    if (controller.contact?.opted_out == true) {
                        // #407: a STOP the customer sent is a CARRIER block,
                        // and only they can lift it. Offering to undo it here
                        // promised something the next send would immediately
                        // contradict — and taught the owner that consent is
                        // theirs to reinstate. So the row becomes the answer
                        // they actually need: the route back, which is one the
                        // customer takes.
                        if (isCarrierEnforcedOptOut(controller.contact?.opt_out_source)) {
                            SheetNote(
                                "This customer texted STOP. Only they can undo it, by " +
                                    "texting START to your number.",
                            )
                        } else {
                            SheetActionRow(
                                icon = Icons.Outlined.Undo,
                                label = "Remove opt-out",
                                onClick = onRevokeOptOut,
                            )
                        }
                    } else {
                        SheetActionRow(
                            icon = Icons.Outlined.Block,
                            label = "Opt out of texts",
                            onClick = onOptOut,
                        )
                    }
                }
            }

            // #293: deferral gets its own card rather than a row in the
            // actions list above, because it is a CHOICE (which "later") not a
            // toggle, and folding four presets into that list would bury the
            // actions that are one tap each.
            SnoozeSection(detail = detail, controller = controller, onDismiss = onDismiss)

            // Timeline visibility.
            Surface(
                shape = MaterialTheme.shapes.large,
                color = MaterialTheme.colorScheme.surface,
            ) {
                Column {
                    SheetToggleRow(
                        icon = Icons.Outlined.ChatBubbleOutline,
                        label = "Show messages",
                        checked = controller.filter.messages,
                        onToggle = {
                            haptics.tap()
                            controller.filter = controller.filter.toggledMessages()
                        },
                    )
                    HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
                    SheetToggleRow(
                        icon = Icons.Outlined.Lock,
                        label = "Show notes",
                        checked = controller.filter.notes,
                        onToggle = {
                            haptics.tap()
                            controller.filter = controller.filter.toggledNotes()
                        },
                    )
                    HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
                    SheetToggleRow(
                        icon = Icons.Outlined.Info,
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

/**
 * A row that says something rather than doing something (#407).
 *
 * Deliberately NOT a disabled SheetActionRow: a greyed-out row still reads as
 * an action somebody could earn, and the whole point here is that this one is
 * not ours to take at all. Same metrics as its tappable sibling so the sheet
 * keeps its rhythm; muted, smaller and wrapping so it never reads as pressable.
 */
@Composable
private fun SheetNote(text: String) {
    Text(
        text,
        style = MaterialTheme.typography.labelSmall,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 15.dp, vertical = 13.dp),
    )
}

@Composable
private fun SheetActionRow(icon: ImageVector, label: String, onClick: () -> Unit) {
    Row(
        Modifier
            .fillMaxWidth()
            .clickable(onClick = onClick)
            .padding(horizontal = 15.dp, vertical = 13.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        // #465: these rows were text-only, so assign, pin and spam all read as
        // one undifferentiated list. The icon is the fastest way to find the
        // row you came for, and the message sheet has always had one.
        Icon(
            icon,
            contentDescription = null,
            tint = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.size(18.dp),
        )
        Spacer(Modifier.width(13.dp))
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
private fun SheetToggleRow(
    icon: ImageVector,
    label: String,
    checked: Boolean,
    onToggle: () -> Unit,
) {
    Row(
        Modifier
            .fillMaxWidth()
            .semantics { toggleableState = ToggleableState(checked) }
            .clickable(onClick = onToggle)
            .padding(horizontal = 15.dp, vertical = 13.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(
            icon,
            contentDescription = null,
            tint = if (checked) {
                MaterialTheme.colorScheme.primary
            } else {
                MaterialTheme.colorScheme.onSurfaceVariant
            },
            modifier = Modifier.size(18.dp),
        )
        Spacer(Modifier.width(13.dp))
        Text(
            label,
            style = MaterialTheme.typography.bodyMedium.copy(
                fontSize = 13.5.sp,
                fontWeight = FontWeight.Medium,
            ),
            modifier = Modifier.weight(1f),
        )
        // #465: the box is drawn in BOTH states. A mark that appears only when
        // on leaves an unchecked row identical to the action rows above it,
        // which is the whole complaint.
        Icon(
            if (checked) Icons.Outlined.CheckBox else Icons.Outlined.CheckBoxOutlineBlank,
            contentDescription = null,
            tint = if (checked) {
                MaterialTheme.colorScheme.primary
            } else {
                MaterialTheme.colorScheme.outline
            },
            modifier = Modifier.size(17.dp),
        )
    }
}
