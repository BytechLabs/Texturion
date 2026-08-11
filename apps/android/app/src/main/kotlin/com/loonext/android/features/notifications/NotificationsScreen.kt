package com.loonext.android.features.notifications

import com.loonext.android.ui.common.InitialsAvatar
import com.loonext.android.ui.common.RefreshBox
import androidx.compose.animation.AnimatedContent
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import com.loonext.android.core.model.AlertPause
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.AlternateEmail
import androidx.compose.material.icons.outlined.AssignmentInd
import androidx.compose.material.icons.outlined.ChatBubbleOutline
import androidx.compose.material.icons.outlined.Checklist
import androidx.compose.material.icons.outlined.Notifications
import androidx.compose.material.icons.outlined.PhoneMissed
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ExperimentalMaterial3ExpressiveApi
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.loonext.android.AppGraph
import com.loonext.android.core.data.CacheKeys
import com.loonext.android.core.i18n.AppStrings
import com.loonext.android.core.i18n.LocalAppLocale
import com.loonext.android.core.i18n.t
import com.loonext.android.core.model.NotificationItem
import com.loonext.android.core.model.NotificationType
import com.loonext.android.core.model.Page
import com.loonext.android.ui.common.AttentionDot
import com.loonext.android.ui.common.CenteredError
import com.loonext.android.ui.common.LoadState
import com.loonext.android.ui.common.ResyncOnResume
import com.loonext.android.ui.common.RowDivider
import com.loonext.android.ui.common.SkeletonList
import com.loonext.android.ui.common.formatPhone
import com.loonext.android.ui.common.relativeTime
import com.loonext.android.ui.common.rememberCacheFirst
import com.loonext.android.ui.common.rememberHaptics
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonPrimitive

/**
 * The derived notifications feed (D24), in the paper-&-olive bell grammar
 * (screen 06): one paper card of rows with kind-tinted 38dp circles, coral
 * unread dots, muted tabular times, cursor pagination. Tap = optimistic
 * watermark advance (that item and everything older flips read; newer stays
 * unread) + deep link into the conversation. 'Read all' advances the
 * watermark to now. The unread count stays live via the company realtime
 * channel plus a 60s poll.
 *
 * #176 cache-first: the accumulated feed (CacheKeys.notifications) and the
 * badge (CacheKeys.unreadNotifications, shared with the For You bell, the
 * shell avatar dot, and the account sheet, #201) render instantly from
 * StoreCache on every return visit and revalidate silently; the only spinner
 * is the true first in-process fetch.
 */
@OptIn(ExperimentalMaterial3Api::class, ExperimentalMaterial3ExpressiveApi::class)
@Composable
fun NotificationsScreen(
    graph: AppGraph,
    companyId: String,
    /** #358: whose read state this screen cares about. The read.* events ride
     *  the company topic, so a colleague's reading must be ignored. */
    meUserId: String,
    modifier: Modifier = Modifier,
    onOpenConversation: (String) -> Unit,
) {
    val repo = remember(graph) { NotificationsFeedRepository(graph.api) }
    val scope = rememberCoroutineScope()
    val snackbar = remember { SnackbarHostState() }
    val haptics = rememberHaptics()
    // #228: read once IN composition, so the snackbars below — which run on
    // appScope, outside any composition — can still speak the reader's language.
    val locale = LocalAppLocale.current

    var loadingMore by remember(companyId) { mutableStateOf(false) }
    var refreshKey by remember(companyId) { mutableStateOf(0) }
    var refreshing by remember(companyId) { mutableStateOf(false) }

    // #201: the mark bookkeeping (in-flight POSTs, per-item reads, watermark)
    // lives on the graph, not in composition. Tapping a row navigates away
    // and unmounts this screen while its POST survives on appScope; guards
    // that died with the composition let the fresh instance's first refetch
    // repaint pre-mark server state.
    val readState = remember(companyId) { graph.notificationsReadState.forCompany(companyId) }
    // A failed POST can settle after navigation disposes this screen; the
    // rollback writes are safe (StoreCache flows, not composition state) but
    // the snackbar is not, so late failures skip it instead of suspending on
    // a host nothing renders.
    var mounted by remember { mutableStateOf(true) }
    DisposableEffect(Unit) { onDispose { mounted = false } }

    // #176 cache-first: the ACCUMULATED feed (first page + any loaded older
    // pages) is the cached value, so a return visit paints everything it had
    // instantly; mutations and pagination write through this flow.
    val feedFlow = remember(companyId) {
        graph.storeCache.flowOf<Page<NotificationItem>>(CacheKeys.notifications(companyId))
    }
    // The badge shares its key with the For You bell, the shell avatar dot,
    // and the account sheet (#201), so writing the count here is what keeps
    // every dot honest. #358 added a read.* broadcast, so a mark on ANOTHER
    // device now reaches this screen too — the local watermark still wins
    // while this device's own mark is in flight.
    val unreadFlow = remember(companyId) {
        graph.storeCache.flowOf<Int>(CacheKeys.unreadNotifications(companyId))
    }
    val unreadCount = unreadFlow.collectAsState().value ?: 0
    // #343: whether the workspace's daily notification allowance is spent. It
    // rides the badge poll below, so it costs nothing extra.
    var alertPause by remember(companyId) { mutableStateOf<AlertPause?>(null) }
    val feed = feedFlow.collectAsState().value
    val items = feed?.data.orEmpty()
    val nextCursor = feed?.next_cursor

    // First page. Realtime events bump refreshKey and trim back to page 1
    // (web reconnect parity); a background miss keeps shown data
    // (rememberCacheFirst semantics), and Loading can only ever be the true
    // first in-process fetch.
    val state = rememberCacheFirst(
        cache = graph.storeCache,
        key = CacheKeys.notifications(companyId),
        refreshKey = refreshKey,
    ) {
        repo.feed(companyId).let { page ->
            page.copy(data = readState.withLocalReads(page.data))
        }
    }

    // Badge refresh on first show and every realtime tick (same cadence the
    // old feed effect carried); ignored while a mark POST is in flight.
    LaunchedEffect(companyId, refreshKey) {
        runCatching { repo.unreadCount(companyId) }
            .onSuccess {
                readState.offerServerCount(unreadFlow, it.count)
                alertPause = it.alert_pause
            }
    }

    // The feed is derived from messages/conversations/tasks/calls — any of
    // those moving can add an item or change the badge.
    LaunchedEffect(companyId) {
        graph.realtime.events.collect { event ->
            // #358: `read.` is this person's own read state moving, probably
            // on another device. Filtered to them: the event rides the company
            // topic, so without the check every member would refetch whenever
            // anybody opened a thread.
            val mine = event.event.startsWith("read.") &&
                event.payload["user_id"]?.jsonPrimitive?.contentOrNull == meUserId
            if (mine ||
                event.event.startsWith("message.") ||
                event.event.startsWith("conversation.") ||
                event.event.startsWith("task.") ||
                event.event.startsWith("call.")
            ) {
                refreshKey++
            }
        }
    }
    LaunchedEffect(companyId) {
        graph.realtime.reconnected.collect { refreshKey++ }
    }
    // #215: heal a queue-moving frame missed while backgrounded/blurred by
    // revalidating on return to the foreground.
    ResyncOnResume(companyId) { refreshKey++ }
    // Badge poll — ONLY a drift-correction backstop for anything realtime does
    // not broadcast. Realtime is the live path, so this ran every 60s forever on
    // every foregrounded app purely to re-confirm a number that was almost always
    // already correct. Five minutes keeps the backstop honest at a fifth of the
    // requests (Workers bill per request); a genuinely missed count also self-
    // heals on the next broadcast or away-resync.
    LaunchedEffect(companyId) {
        while (true) {
            delay(5 * 60_000L)
            runCatching { repo.unreadCount(companyId) }
                .onSuccess { readState.offerServerCount(unreadFlow, it.count) }
        }
    }

    fun markItemRead(item: NotificationItem) {
        if (!item.unread) return
        val previousCount = unreadCount
        // #188: truly per-item now — flip ONLY the tapped row, never advance
        // the watermark (that marked everything older read too).
        readState.localReadIds += item.id
        feedFlow.value?.let { f ->
            feedFlow.value = f.copy(
                data = f.data.map {
                    if (it.id == item.id) it.copy(unread = false) else it
                },
            )
        }
        unreadFlow.value = (previousCount - 1).coerceAtLeast(0)
        readState.beginMark()
        // appScope, not the composable scope: the tap navigates away
        // immediately, and a composition-scoped launch would cancel the POST
        // mid-flight — the other half of the "tapping never marks it read" bug.
        graph.appScope.launch {
            try {
                repo.markReadItem(companyId, item.id, item.created_at)
            } catch (_: Exception) {
                readState.localReadIds -= item.id
                feedFlow.value?.let { f ->
                    feedFlow.value = f.copy(
                        data = f.data.map {
                            if (it.id == item.id) it.copy(unread = true) else it
                        },
                    )
                }
                unreadFlow.value = previousCount
                if (mounted) {
                    snackbar.showSnackbar(
                        AppStrings.translate(locale, "contactsTasks.notifMarkOneFailed"),
                    )
                }
            } finally {
                // When the LAST in-flight mark settles, run one guarded
                // reconcile: mark endpoints emit no realtime event, so no
                // later tick would correct any drift.
                if (readState.settleMark()) {
                    runCatching { repo.unreadCount(companyId) }
                        .onSuccess { readState.offerServerCount(unreadFlow, it.count) }
                }
            }
        }
    }

    fun markAllRead() {
        val previousFeed = feedFlow.value
        if (unreadCount == 0 && previousFeed?.data.orEmpty().none { it.unread }) return
        haptics.confirm()
        val previousCount = unreadCount
        val previousWatermark = readState.localWatermark
        if (previousFeed != null) {
            feedFlow.value = previousFeed.copy(
                data = previousFeed.data.map { if (it.unread) it.copy(unread = false) else it },
            )
        }
        unreadFlow.value = 0
        readState.beginMark()
        // appScope for the same reason markItemRead uses it: backing out of
        // the overlay cancels a composition-scoped launch mid-POST, and the
        // catch rollback would resurrect every dot while the server watermark
        // never advanced.
        graph.appScope.launch {
            try {
                val result = repo.markAllRead(companyId)
                readState.localWatermark =
                    advanceWatermark(readState.localWatermark, result.last_seen_at)
                // Silent revalidate so the cached feed reconciles with the
                // server; withLocalReads keeps the advance applied meanwhile.
                refreshKey++
            } catch (_: Exception) {
                if (previousFeed != null) feedFlow.value = previousFeed
                unreadFlow.value = previousCount
                readState.localWatermark = previousWatermark
                if (mounted) {
                    snackbar.showSnackbar(
                        AppStrings.translate(locale, "contactsTasks.notifMarkAllFailed"),
                    )
                }
            } finally {
                if (readState.settleMark()) {
                    runCatching { repo.unreadCount(companyId) }
                        .onSuccess { readState.offerServerCount(unreadFlow, it.count) }
                }
            }
        }
    }

    // Pull-to-refresh: the same page-1 revalidate a realtime tick performs
    // (trim back to page 1, badge refetch), awaited here only so the
    // indicator settles honestly. Data on screen never blanks.
    fun manualRefresh() {
        if (refreshing) return
        refreshing = true
        scope.launch {
            try {
                val page = repo.feed(companyId)
                feedFlow.value = page.copy(data = readState.withLocalReads(page.data))
                runCatching { repo.unreadCount(companyId) }
                    .onSuccess { readState.offerServerCount(unreadFlow, it.count) }
            } catch (_: Exception) {
                snackbar.showSnackbar(
                    AppStrings.translate(locale, "contactsTasks.notifRefreshFailed"),
                )
            } finally {
                refreshing = false
            }
        }
    }

    fun loadOlder() {
        val startFeed = feedFlow.value ?: return
        val cursor = startFeed.next_cursor ?: return
        if (loadingMore) return
        loadingMore = true
        scope.launch {
            try {
                val page = repo.feed(companyId, cursor = cursor)
                // Append to whatever is cached NOW (a quiet revalidate may
                // have landed) so the accumulated list is what a return
                // visit repaints.
                val base = feedFlow.value ?: startFeed
                feedFlow.value = base.copy(
                    data = (base.data + readState.withLocalReads(page.data))
                        .distinctBy { "${it.type}:${it.id}" },
                    next_cursor = page.next_cursor,
                )
            } catch (_: Exception) {
                snackbar.showSnackbar(
                    AppStrings.translate(locale, "contactsTasks.notifLoadOlderFailed"),
                )
            } finally {
                loadingMore = false
            }
        }
    }

    Box(modifier.fillMaxSize()) {
        when (val current = state) {
            is LoadState.Loading ->
                // First-fetch stand-in in the real bell grammar: one paper
                // card of avatar rows below where the actions row sits.
                Column(
                    Modifier
                        .fillMaxSize()
                        .padding(horizontal = 18.dp),
                ) {
                    Spacer(Modifier.height(48.dp))
                    Surface(
                        shape = MaterialTheme.shapes.large,
                        color = MaterialTheme.colorScheme.surface,
                        modifier = Modifier.fillMaxWidth(),
                    ) {
                        SkeletonList(rows = 8, avatar = true)
                    }
                }

            is LoadState.Failed -> CenteredError(
                current.message,
                onRetry = { refreshKey++ },
            )

            is LoadState.Ready -> RefreshBox(
                isRefreshing = refreshing,
                onRefresh = ::manualRefresh,
                modifier = Modifier.fillMaxSize(),
            ) {
                Column(
                    Modifier
                        .fillMaxSize()
                        .padding(horizontal = 18.dp),
                ) {
                    // The overlay scaffold already shows the back arrow +
                    // title; this row carries the live unread count and the
                    // olive 'Read all' action.
                    Row(
                        Modifier.fillMaxWidth(),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        AnimatedContent(
                            targetState = unreadCount,
                            label = "unreadCount",
                            modifier = Modifier.padding(start = 6.dp),
                        ) { count ->
                            Text(
                                if (count > 0) {
                                    t("contactsTasks.notifUnreadCount", "count" to "$count")
                                } else {
                                    ""
                                },
                                style = MaterialTheme.typography.labelMedium.copy(
                                    fontSize = 11.5.sp,
                                    fontWeight = FontWeight.SemiBold,
                                ),
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        }
                        Spacer(Modifier.weight(1f))
                        TextButton(
                            onClick = ::markAllRead,
                            enabled = unreadCount > 0 || items.any { it.unread },
                            colors = ButtonDefaults.textButtonColors(
                                contentColor = MaterialTheme.colorScheme.secondary,
                            ),
                        ) {
                            Text(
                                t("contactsTasks.notifReadAll"),
                                style = MaterialTheme.typography.labelMedium.copy(
                                    fontSize = 11.5.sp,
                                    fontWeight = FontWeight.Bold,
                                ),
                            )
                        }
                    }

                    // #343: before the list AND before the caught-up state —
                    // "all caught up" is the exact wrong thing to read when
                    // alerts have been switched off underneath you.
                    NotificationPauseNotice(alertPause)

                    if (items.isEmpty()) {
                        Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                            Text(
                                t("contactsTasks.notifCaughtUp"),
                                style = MaterialTheme.typography.bodyLarge,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        }
                    } else {
                        Surface(
                            shape = MaterialTheme.shapes.large,
                            color = MaterialTheme.colorScheme.surface,
                            modifier = Modifier
                                .fillMaxWidth()
                                .weight(1f, fill = false),
                        ) {
                            LazyColumn(contentPadding = PaddingValues(bottom = 4.dp)) {
                                itemsIndexed(
                                    items,
                                    key = { _, row -> "${row.type}:${row.id}" },
                                ) { index, row ->
                                    Column(Modifier.animateItem()) {
                                        if (index > 0) RowDivider()
                                        NotificationRow(
                                            row = row,
                                            onTap = {
                                                haptics.tap()
                                                markItemRead(row)
                                                row.conversation_id?.let(onOpenConversation)
                                            },
                                        )
                                    }
                                }
                                if (nextCursor != null) {
                                    item(key = "show-older") {
                                        Box(
                                            Modifier
                                                .animateItem()
                                                .fillMaxWidth()
                                                .padding(vertical = 6.dp),
                                            contentAlignment = Alignment.Center,
                                        ) {
                                            TextButton(
                                                onClick = ::loadOlder,
                                                enabled = !loadingMore,
                                                colors = ButtonDefaults.textButtonColors(
                                                    contentColor =
                                                    MaterialTheme.colorScheme.secondary,
                                                ),
                                            ) {
                                                Text(
                                                    if (loadingMore) {
                                                        t("contactsTasks.notifLoadingOlder")
                                                    } else {
                                                        t("contactsTasks.notifShowOlder")
                                                    },
                                                )
                                            }
                                        }
                                    }
                                }
                            }
                        }
                        Row(
                            Modifier
                                .fillMaxWidth()
                                .padding(vertical = 13.dp),
                            horizontalArrangement =
                            androidx.compose.foundation.layout.Arrangement.Center,
                        ) {
                            Surface(
                                shape = CircleShape,
                                color = MaterialTheme.colorScheme.surfaceContainer,
                            ) {
                                Text(
                                    t("contactsTasks.notifMirrorHint"),
                                    style = MaterialTheme.typography.labelSmall.copy(
                                        fontSize = 11.sp,
                                    ),
                                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                                    modifier = Modifier.padding(
                                        horizontal = 14.dp,
                                        vertical = 7.dp,
                                    ),
                                )
                            }
                        }
                    }
                }
            }
        }

        SnackbarHost(snackbar, Modifier.align(Alignment.BottomCenter))
    }
}

@Composable
private fun NotificationRow(row: NotificationItem, onTap: () -> Unit) {
    // Every derived type today links to its conversation; a future type
    // without one renders disabled instead of dead-tapping.
    val enabled = row.conversation_id != null
    // Read outside the semantics lambda, which is not composition.
    val unreadLabel = t("contactsTasks.notifStateUnread")
    val readLabel = t("contactsTasks.notifStateRead")
    val summary = summaryFor(row, LocalAppLocale.current)
    Row(
        Modifier
            .fillMaxWidth()
            .clickable(enabled = enabled, onClick = onTap)
            .alpha(if (row.unread) 1f else 0.6f)
            // Unread was carried ONLY by alpha + font weight, so TalkBack read a
            // read and an unread row identically. (iOS already exposes this via
            // .accessibilityValue on its NotificationRow.)
            .semantics { stateDescription = if (row.unread) unreadLabel else readLabel }
            .padding(horizontal = 15.dp, vertical = 13.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        KindBadge(row)
        Spacer(Modifier.width(11.dp))
        Text(
            summary,
            style = MaterialTheme.typography.titleSmall.copy(
                fontSize = 13.sp,
                fontWeight = if (row.unread) FontWeight.Bold else FontWeight.SemiBold,
            ),
            maxLines = 2,
            overflow = TextOverflow.Ellipsis,
            modifier = Modifier.weight(1f),
        )
        Spacer(Modifier.width(8.dp))
        Text(
            relativeTime(row.created_at),
            style = MaterialTheme.typography.labelSmall.copy(fontSize = 11.sp),
            color = MaterialTheme.colorScheme.outline,
        )
    }
}

/** 38dp kind-tinted circle: contact initials for texts, stroke icon otherwise. */
@Composable
private fun KindBadge(row: NotificationItem) {
    val colors = MaterialTheme.colorScheme
    val (tint, content) = when (row.type) {
        NotificationType.INBOUND_MESSAGE -> colors.secondaryContainer to colors.onSecondaryContainer
        NotificationType.MISSED_CALL -> colors.errorContainer to colors.onErrorContainer
        NotificationType.ASSIGNED, NotificationType.TASK_ASSIGNED ->
            colors.secondaryContainer to colors.secondary

        // A mention is aimed at THIS reader, so it carries the primary tint
        // rather than the quieter assignment one.
        NotificationType.MENTION -> colors.primaryContainer to colors.onPrimaryContainer

        else -> colors.surfaceContainer to colors.onSurfaceVariant
    }
    val contactName = row.contact?.name
    Box {
        // The initials branch and the icon branch are separate badges rather than one
        // box with two children: an icon is fixed `dp` and correct as it is, while
        // initials are `sp` and need the #569 bound that InitialsAvatar carries.
        if (row.type == NotificationType.INBOUND_MESSAGE && contactName != null) {
            InitialsAvatar(
                contactName,
                38.dp,
                glyph = 12.sp,
                container = tint,
                content = content,
            )
        } else {
            Box(
                Modifier
                    .size(38.dp)
                    .background(tint, CircleShape),
                contentAlignment = Alignment.Center,
            ) {
                Icon(
                    iconFor(row.type),
                    contentDescription = null,
                    tint = content,
                    modifier = Modifier.size(15.dp),
                )
            }
        }
        if (row.unread) {
            Box(
                Modifier
                    .align(Alignment.TopStart)
                    .offset(x = (-3).dp, y = (-3).dp)
                    .size(12.dp)
                    .background(MaterialTheme.colorScheme.surface, CircleShape),
                contentAlignment = Alignment.Center,
            ) {
                AttentionDot(size = 8.dp)
            }
        }
    }
}

/** One-line summaries, mirroring the web bell popover copy exactly. */
private fun summaryFor(row: NotificationItem, locale: String?): String {
    val who = row.contact?.let { it.name ?: formatPhone(it.phone_e164) }
    fun say(key: String, named: String) =
        who?.let { AppStrings.translate(locale, named, mapOf("who" to it)) }
            ?: AppStrings.translate(locale, key)
    return when (row.type) {
        NotificationType.INBOUND_MESSAGE ->
            say("contactsTasks.notifNewMessage", "contactsTasks.notifNewMessageFrom")

        NotificationType.ASSIGNED ->
            say("contactsTasks.notifAssigned", "contactsTasks.notifAssignedFrom")

        NotificationType.TASK_ASSIGNED ->
            say("contactsTasks.notifTaskAssigned", "contactsTasks.notifTaskAssignedFrom")

        NotificationType.MISSED_CALL ->
            say("contactsTasks.notifMissedCall", "contactsTasks.notifMissedCallFrom")

        NotificationType.MENTION ->
            say("contactsTasks.notifMention", "contactsTasks.notifMentionFrom")

        // A type added server-side after this build shipped — show something
        // honest instead of crashing or hiding it.
        else -> say("contactsTasks.notifUpdate", "contactsTasks.notifUpdateFrom")
    }
}

private fun iconFor(type: String): ImageVector = when (type) {
    NotificationType.INBOUND_MESSAGE -> Icons.Outlined.ChatBubbleOutline
    NotificationType.ASSIGNED -> Icons.Outlined.AssignmentInd
    NotificationType.TASK_ASSIGNED -> Icons.Outlined.Checklist
    NotificationType.MISSED_CALL -> Icons.Outlined.PhoneMissed
    NotificationType.MENTION -> Icons.Outlined.AlternateEmail
    else -> Icons.Outlined.Notifications
}

/**
 * #343 — "your notifications are paused", said to the crew rather than only to
 * the owner.
 *
 * At the workspace's daily ceiling, alerts stop reaching every member while an
 * email goes to the owner alone. A tech's phone simply goes quiet, and the
 * reasonable inference from that side is that the business had a slow
 * afternoon. Same failure shape as a spam thread absorbing messages (#342) and
 * a queue count that stopped at the page size (#306).
 *
 * Renders nothing on almost every day. A notice, not an alarm — it never
 * carries a badge of its own, because a workspace at its ceiling is already
 * getting fewer notifications and does not need another one about it.
 */
@Composable
private fun NotificationPauseNotice(pause: AlertPause?) {
    if (pause == null || !pause.anyPaused) return

    val what = when {
        pause.email_paused && pause.push_paused -> t("contactsTasks.notifPausedBoth")
        pause.email_paused -> t("contactsTasks.notifPausedEmail")
        else -> t("contactsTasks.notifPausedPush")
    }
    // When only one channel is spent, saying which is the difference between
    // "we are broken" and "you are still covered".
    val still = if (pause.email_paused && !pause.push_paused) {
        t("contactsTasks.notifPausedStillPush")
    } else {
        ""
    }
    val resumes = pause.resets_at?.let {
        t("contactsTasks.notifPausedResumes", "when" to relativeTime(it))
    } ?: ""

    Surface(
        shape = MaterialTheme.shapes.large,
        color = MaterialTheme.colorScheme.errorContainer,
        modifier = Modifier
            .fillMaxWidth()
            .padding(bottom = 8.dp),
    ) {
        Text(
            t(
                "contactsTasks.notifPausedBody",
                "what" to what,
                "still" to still,
                "resumes" to resumes,
            ),
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onErrorContainer,
            modifier = Modifier.padding(horizontal = 14.dp, vertical = 10.dp),
        )
    }
}
