package com.loonext.android.features.foryou

import androidx.compose.animation.AnimatedContent
import androidx.compose.foundation.LocalIndication
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ArrowForward
import androidx.compose.material.icons.outlined.Notifications
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.minimumInteractiveComponentSize
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import com.loonext.android.core.data.CacheKeys
import com.loonext.android.ui.common.rememberCacheFirst
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.luminance
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.TextUnit
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.em
import androidx.compose.ui.unit.sp
import com.loonext.android.AppGraph
import com.loonext.android.core.model.Call
import com.loonext.android.core.model.ForYou
import com.loonext.android.core.model.Me
import com.loonext.android.features.calls.CallsRepository
import com.loonext.android.features.calls.callOutcomeLabel
import com.loonext.android.features.calls.callerDisplayName
import com.loonext.android.features.calls.isActionableMiss
import com.loonext.android.features.thread.ThreadScreen
import com.loonext.android.ui.common.AttentionDot
import com.loonext.android.ui.common.CenteredError
import com.loonext.android.ui.common.DsChip
import com.loonext.android.ui.common.LoadState
import com.loonext.android.ui.common.PaperCard
import com.loonext.android.ui.common.ResyncOnResume
import com.loonext.android.ui.common.RowDivider
import com.loonext.android.ui.common.ScreenTitle
import com.loonext.android.ui.common.SectionHeader
import com.loonext.android.ui.common.SkeletonBlock
import com.loonext.android.ui.common.SkeletonList
import com.loonext.android.ui.common.formatPhone
import com.loonext.android.ui.common.initialsOf
import com.loonext.android.ui.common.pressScale
import com.loonext.android.ui.common.relativeTime
import com.loonext.android.ui.common.rememberHaptics
import com.loonext.android.ui.common.userMessage
import com.loonext.android.ui.theme.BrandColor
import kotlinx.coroutines.delay

/**
 * /for-you — the default landing: Triage (owner/admin), Waiting on you,
 * My tasks, Unread, and Recent calls (D43: the mobile entry point into the
 * Calls surface). Realtime events refetch the queue; every row deep-links
 * into [ThreadScreen] in place (task rows open their conversation — task
 * detail itself is the Tasks tab's surface, #154).
 *
 * Paper & Olive pass (screens 19/29 + the screen-18 activation grammar):
 * identity avatar top-left, a 44dp paper-circle bell (coral dot when unread —
 * opens the notifications route above the shell), Bricolage "For you" heading with a
 * one-line summary, then each queue section as a radius-22 paper card of rows.
 *
 * [onOpenCalls] is the shell's navigation to the full Calls surface — the
 * "View all" affordance hides until the integrator wires it.
 * [onViewedConversationChanged] reports which thread this tab has open (null
 * when back on the queue) so the shell's inbound toast can suppress itself.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ForYouTab(
    graph: AppGraph,
    companyId: String,
    me: Me,
    modifier: Modifier = Modifier,
    onOpenCalls: (() -> Unit)? = null,
    onOpenThread: ((conversationId: String) -> Unit)? = null,
    onOpenNotifications: (() -> Unit)? = null,
) {
    // Threads and notifications are ROUTES above the shell now (founder
    // mandate: nothing pushed shows the pill nav) — this tab is only ever the
    // For You list itself.
    // #176 cache-first: renders instantly from StoreCache on every visit after
    // the first in-process fetch; refreshKey bumps are always silent revalidation.
    var refreshKey by remember { mutableStateOf(0) }
    val state = rememberCacheFirst(
        cache = graph.storeCache,
        key = CacheKeys.forYou(companyId),
        refreshKey = refreshKey,
    ) { graph.forYouRepo.forYou(companyId) }

    // Recent calls (#165): the 3 newest sessions, refetched on the same
    // realtime ticks as the queue (call.updated is in the filter below).
    val callsRepo = remember(graph) { CallsRepository(graph.api) }
    val recentCalls = rememberCacheFirst(
        cache = graph.storeCache,
        key = CacheKeys.recentCalls(companyId),
        refreshKey = refreshKey,
    ) { callsRepo.calls(companyId, limit = 3).data }
    // Coral dot on the bell — refreshed on the same ticks (the feed derives
    // from message/task/call activity). A miss keeps the last known count.
    // #201: the refetch goes through the shared mark guards, so a tick that
    // lands during an in-flight mark POST can't write the pre-mark server
    // count back into the key every badge surface reads.
    val unreadState = rememberCacheFirst(
        cache = graph.storeCache,
        key = CacheKeys.unreadNotifications(companyId),
        refreshKey = refreshKey,
    ) {
        val readState = graph.notificationsReadState.forCompany(companyId)
        val fetched = graph.notificationsRepo.unreadCount(companyId).count
        // Cache read AFTER the fetch: a mark can start mid-request, and its
        // optimistic write is the value that must win.
        readState.reconcileFetched(
            cached = graph.storeCache
                .flowOf<Int>(CacheKeys.unreadNotifications(companyId)).value,
            fetched = fetched,
        )
    }
    val unreadNotifications = (unreadState as? LoadState.Ready)?.value ?: 0
    // Any conversation/task/call movement can change the queue — refetch quietly.
    LaunchedEffect(companyId) {
        graph.realtime.events.collect { event ->
            if (event.event.startsWith("message.") ||
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
    // #215: heal a frame missed while backgrounded/blurred by revalidating on
    // return to the foreground.
    ResyncOnResume(companyId) { refreshKey++ }

    // Pull-to-refresh rides the same silent refreshKey revalidation the
    // realtime ticks use (cache-first: rows never blank underneath); the
    // crest spins just long enough to acknowledge the gesture.
    var pullRefreshing by remember { mutableStateOf(false) }
    LaunchedEffect(pullRefreshing) {
        if (pullRefreshing) {
            delay(650)
            pullRefreshing = false
        }
    }
    val haptics = rememberHaptics()

    when (val current = state) {
        // First fetch only (#176 keeps every revisit cached): shimmer in the
        // queue-card grammar, not a spinner.
        is LoadState.Loading -> ForYouSkeleton(modifier)
        is LoadState.Failed -> CenteredError(current.message, onRetry = { refreshKey++ }, modifier)
        is LoadState.Ready -> PullToRefreshBox(
            isRefreshing = pullRefreshing,
            onRefresh = {
                haptics.tick()
                pullRefreshing = true
                refreshKey++
            },
            modifier = modifier,
        ) {
            ForYouList(
                forYou = current.value,
                recentCalls = recentCalls,
                unreadNotifications = unreadNotifications,
                me = me,
                onOpenConversation = { onOpenThread?.invoke(it) },
                onOpenCalls = onOpenCalls,
                onOpenNotifications = { onOpenNotifications?.invoke() },
                modifier = Modifier.fillMaxSize(),
            )
        }
    }
}

@Composable
private fun ForYouList(
    forYou: ForYou,
    recentCalls: LoadState<List<Call>>,
    unreadNotifications: Int,
    me: Me,
    onOpenConversation: (String) -> Unit,
    onOpenCalls: (() -> Unit)?,
    onOpenNotifications: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val triageCount = forYou.triage?.let { it.conversations.size + it.tasks.size } ?: 0
    val total = forYou.waiting_on_you.size + forYou.my_tasks.size + forYou.unread.size +
        triageCount

    LazyColumn(
        modifier = modifier.fillMaxWidth(),
        contentPadding = PaddingValues(start = 18.dp, end = 18.dp, top = 8.dp, bottom = 24.dp),
    ) {
        item(key = "header") {
            Row(
                Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                AvatarCircle(me.display_name.ifBlank { null }, size = 40.dp, fontSize = 13.sp)
                CircleIconButton(
                    icon = Icons.Outlined.Notifications,
                    contentDescription = "Notifications",
                    onClick = onOpenNotifications,
                    showDot = unreadNotifications > 0,
                )
            }
        }

        item(key = "title") {
            Column(Modifier.padding(top = 15.dp)) {
                ScreenTitle("For you")
                Text(
                    when {
                        total == 0 -> "You're all caught up"
                        total == 1 -> "1 thing needs you · otherwise you're caught up"
                        else -> "$total things need you · otherwise you're caught up"
                    },
                    modifier = Modifier.padding(top = 5.dp),
                    style = MaterialTheme.typography.bodyMedium.copy(fontSize = 13.sp),
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }

        // The activation/empty variant (screen-18 grammar): a centered inset
        // well instead of the queue cards.
        if (total == 0) {
            item(key = "caught-up") { CaughtUpWell(Modifier.animateItem()) }
        }

        forYou.triage
            ?.takeIf { it.conversations.isNotEmpty() || it.tasks.isNotEmpty() }
            ?.let { triage ->
                item(key = "triage") {
                    QueueSection(
                        "Triage",
                        count = triage.conversations.size + triage.tasks.size,
                        // Sections glide as queues above them empty or fill.
                        modifier = Modifier.animateItem(),
                    ) {
                        triage.conversations.forEachIndexed { index, row ->
                            if (index > 0) RowDivider()
                            PersonRow(
                                name = row.contact?.name ?: formatPhone(row.contact?.phone_e164),
                                why = relativeTime(row.last_message_at),
                                unread = row.unread,
                                chipLabel = if (row.unread) "New lead" else null,
                                onClick = { onOpenConversation(row.conversation_id) },
                            )
                        }
                        triage.tasks.forEachIndexed { index, row ->
                            if (index > 0 || triage.conversations.isNotEmpty()) RowDivider()
                            TaskQueueRow(
                                title = row.title,
                                overdue = row.overdue,
                                dueAt = row.due_at,
                                onClick = { onOpenConversation(row.conversation_id) },
                            )
                        }
                    }
                }
            }

        if (forYou.waiting_on_you.isNotEmpty()) {
            item(key = "waiting") {
                QueueSection(
                    "Waiting on you",
                    count = forYou.waiting_on_you.size,
                    modifier = Modifier.animateItem(),
                ) {
                    forYou.waiting_on_you.forEachIndexed { index, row ->
                        if (index > 0) RowDivider()
                        PersonRow(
                            name = row.contact?.name ?: formatPhone(row.contact?.phone_e164),
                            why = relativeTime(row.last_message_at),
                            unread = row.unread,
                            onClick = { onOpenConversation(row.conversation_id) },
                        )
                    }
                }
            }
        }

        if (forYou.my_tasks.isNotEmpty()) {
            item(key = "tasks") {
                QueueSection(
                    "My tasks",
                    count = forYou.my_tasks.size,
                    modifier = Modifier.animateItem(),
                ) {
                    forYou.my_tasks.forEachIndexed { index, row ->
                        if (index > 0) RowDivider()
                        TaskQueueRow(
                            title = row.title,
                            overdue = row.overdue,
                            dueAt = row.due_at,
                            onClick = { onOpenConversation(row.conversation_id) },
                        )
                    }
                }
            }
        }

        if (forYou.unread.isNotEmpty()) {
            item(key = "unread") {
                QueueSection(
                    "Unread",
                    count = forYou.unread.size,
                    modifier = Modifier.animateItem(),
                ) {
                    forYou.unread.forEachIndexed { index, row ->
                        if (index > 0) RowDivider()
                        PersonRow(
                            name = row.contact?.name ?: formatPhone(row.contact?.phone_e164),
                            why = relativeTime(row.last_message_at),
                            unread = true,
                            onClick = { onOpenConversation(row.conversation_id) },
                        )
                    }
                }
            }
        }

        // Recent calls (#165/D43) — the mobile doorway into the Calls
        // surface. Hidden entirely while there are no calls; an honest error
        // line when the log couldn't load.
        when (recentCalls) {
            is LoadState.Loading -> Unit
            is LoadState.Failed -> item(key = "calls-error") {
                Column(Modifier.animateItem().padding(top = 14.dp)) {
                    RecentCallsHeader(onOpenCalls)
                    Text(
                        "Couldn't load recent calls.",
                        style = MaterialTheme.typography.bodySmall.copy(fontSize = 11.5.sp),
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        modifier = Modifier.padding(start = 6.dp, top = 2.dp),
                    )
                }
            }

            is LoadState.Ready -> if (recentCalls.value.isNotEmpty()) {
                item(key = "calls") {
                    Column(Modifier.animateItem().padding(top = 14.dp)) {
                        RecentCallsHeader(onOpenCalls)
                        PaperCard(Modifier.fillMaxWidth()) {
                            recentCalls.value.forEachIndexed { index, call ->
                                if (index > 0) RowDivider()
                                RecentCallRow(
                                    call = call,
                                    onClick = call.conversation_id?.let { id ->
                                        { onOpenConversation(id) }
                                    },
                                )
                            }
                        }
                    }
                }
            }
        }
    }
}

/** Tracked micro-header + a radius-22 paper card of rows. */
@Composable
private fun QueueSection(
    label: String,
    count: Int? = null,
    modifier: Modifier = Modifier,
    content: @Composable ColumnScope.() -> Unit,
) {
    Column(modifier.padding(top = 14.dp)) {
        SectionHeader(label, count = count)
        PaperCard(Modifier.fillMaxWidth()) { content() }
    }
}

/** "RECENT CALLS" micro-header with the olive "View all" affordance. */
@Composable
private fun RecentCallsHeader(onOpenCalls: (() -> Unit)?) {
    Row(
        Modifier.fillMaxWidth().padding(start = 6.dp, end = 6.dp, bottom = 7.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(
            "RECENT CALLS",
            style = MaterialTheme.typography.labelSmall.copy(
                fontSize = 10.5.sp,
                fontWeight = FontWeight.Bold,
                letterSpacing = 0.12.em,
            ),
            color = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.85f),
            modifier = Modifier.weight(1f),
        )
        if (onOpenCalls != null) {
            Text(
                "View all",
                style = MaterialTheme.typography.labelSmall.copy(
                    fontSize = 10.5.sp,
                    fontWeight = FontWeight.Bold,
                ),
                color = MaterialTheme.colorScheme.secondary,
                modifier = Modifier
                    .minimumInteractiveComponentSize()
                    .clickable(onClick = onOpenCalls)
                    .padding(4.dp),
            )
        }
    }
}

/**
 * Queue row: 38dp tinted avatar, 13.5sp SemiBold name (+ lime chip or coral
 * unread dot), 11.5sp muted why-line, muted 15dp arrow.
 */
@Composable
private fun PersonRow(
    name: String?,
    why: String,
    unread: Boolean,
    chipLabel: String? = null,
    onClick: () -> Unit,
) {
    val pressSource = remember { MutableInteractionSource() }
    Row(
        Modifier
            .fillMaxWidth()
            .clickable(
                interactionSource = pressSource,
                indication = LocalIndication.current,
                onClick = onClick,
            )
            .pressScale(pressSource, pressed = 0.98f)
            .padding(horizontal = 16.dp, vertical = 11.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(11.dp),
    ) {
        AvatarCircle(name, size = 38.dp, fontSize = 12.sp)
        Column(Modifier.weight(1f)) {
            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(7.dp),
            ) {
                Text(
                    name?.takeIf { it.isNotBlank() } ?: "Unknown",
                    style = MaterialTheme.typography.bodyMedium.copy(
                        fontSize = 13.5.sp,
                        fontWeight = FontWeight.SemiBold,
                    ),
                    color = MaterialTheme.colorScheme.onSurface,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.weight(1f, fill = false),
                )
                if (chipLabel != null) {
                    DsChip(chipLabel)
                } else if (unread) {
                    AttentionDot(size = 7.dp)
                }
            }
            Text(
                why,
                style = MaterialTheme.typography.bodySmall.copy(fontSize = 11.5.sp),
                color = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.8f),
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                modifier = Modifier.padding(top = 2.dp),
            )
        }
        RowArrow()
    }
}

/** Task row: 22dp outline ring, 13.5sp SemiBold title, due/overdue why-line. */
@Composable
private fun TaskQueueRow(title: String, overdue: Boolean, dueAt: String?, onClick: () -> Unit) {
    val pressSource = remember { MutableInteractionSource() }
    Row(
        Modifier
            .fillMaxWidth()
            .clickable(
                interactionSource = pressSource,
                indication = LocalIndication.current,
                onClick = onClick,
            )
            .pressScale(pressSource, pressed = 0.98f)
            .padding(horizontal = 16.dp, vertical = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Box(
            Modifier
                .size(22.dp)
                .border(1.8.dp, MaterialTheme.colorScheme.outline, CircleShape),
        )
        Column(Modifier.weight(1f)) {
            Text(
                title,
                style = MaterialTheme.typography.bodyMedium.copy(
                    fontSize = 13.5.sp,
                    fontWeight = FontWeight.SemiBold,
                ),
                color = MaterialTheme.colorScheme.onSurface,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            Text(
                when {
                    overdue -> "Overdue task"
                    dueAt != null -> "Due ${relativeTime(dueAt)}"
                    else -> "Open task"
                },
                style = MaterialTheme.typography.bodySmall.copy(
                    fontSize = 11.5.sp,
                    fontWeight = if (overdue) FontWeight.SemiBold else FontWeight.Normal,
                ),
                // Overdue = the coral attention mark, never an error red
                // (calm system).
                color = if (overdue) {
                    coralColor()
                } else {
                    MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.8f)
                },
                modifier = Modifier.padding(top = 2.dp),
            )
        }
        RowArrow()
    }
}

/** Call row: 34dp avatar, outcome why-line (coral only for an actionable miss). */
@Composable
private fun RecentCallRow(call: Call, onClick: (() -> Unit)?) {
    val name = callerDisplayName(call)
    val actionable = isActionableMiss(call)
    val pressSource = remember { MutableInteractionSource() }
    Row(
        Modifier
            .fillMaxWidth()
            .let { base ->
                if (onClick != null) {
                    base
                        .clickable(
                            interactionSource = pressSource,
                            indication = LocalIndication.current,
                            onClick = onClick,
                        )
                        .pressScale(pressSource, pressed = 0.98f)
                } else {
                    base
                }
            }
            .padding(horizontal = 16.dp, vertical = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(11.dp),
    ) {
        AvatarCircle(name, size = 34.dp, fontSize = 11.sp)
        Column(Modifier.weight(1f)) {
            Text(
                name,
                style = MaterialTheme.typography.bodyMedium.copy(
                    fontSize = 13.sp,
                    fontWeight = FontWeight.SemiBold,
                ),
                color = MaterialTheme.colorScheme.onSurface,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            Text(
                callOutcomeLabel(call),
                style = MaterialTheme.typography.bodySmall.copy(
                    fontSize = 11.5.sp,
                    fontWeight = if (actionable) FontWeight.SemiBold else FontWeight.Normal,
                ),
                color = if (actionable) {
                    coralColor()
                } else {
                    MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.8f)
                },
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                modifier = Modifier.padding(top = 1.dp),
            )
        }
        Text(
            relativeTime(call.started_at),
            style = MaterialTheme.typography.labelSmall.copy(fontSize = 11.sp),
            color = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.75f),
        )
    }
}

/** Screen-18 activation grammar, adapted: a centered radius-26 inset well. */
@Composable
private fun CaughtUpWell(modifier: Modifier = Modifier) {
    Surface(
        shape = RoundedCornerShape(26.dp),
        color = MaterialTheme.colorScheme.surfaceContainerHigh,
        modifier = modifier.fillMaxWidth().padding(top = 15.dp),
    ) {
        Column(
            Modifier.padding(horizontal = 22.dp, vertical = 26.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Text(
                "ALL CAUGHT UP",
                style = MaterialTheme.typography.labelSmall.copy(
                    fontSize = 10.5.sp,
                    fontWeight = FontWeight.Bold,
                    letterSpacing = 0.12.em,
                ),
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            Text(
                "Nothing needs you right now. New messages, tasks, and missed calls land here first.",
                style = MaterialTheme.typography.bodyMedium.copy(
                    fontSize = 13.sp,
                    lineHeight = 20.sp,
                ),
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                textAlign = TextAlign.Center,
                modifier = Modifier.padding(top = 12.dp),
            )
        }
    }
}

/**
 * First-fetch stand-in in the real For You grammar: identity/bell circles,
 * display title block, then two shimmering queue cards of avatar rows.
 * Failed and cached states never see this (#176).
 */
@Composable
private fun ForYouSkeleton(modifier: Modifier = Modifier) {
    Column(
        modifier
            .fillMaxSize()
            .padding(start = 18.dp, end = 18.dp, top = 8.dp),
    ) {
        Row(
            Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
        ) {
            SkeletonBlock(40.dp, 40.dp, shape = CircleShape)
            SkeletonBlock(44.dp, 44.dp, shape = CircleShape)
        }
        Spacer(Modifier.height(15.dp))
        SkeletonBlock(168.dp, 30.dp)
        Spacer(Modifier.height(9.dp))
        SkeletonBlock(236.dp, 12.dp)
        Spacer(Modifier.height(21.dp))
        PaperCard(Modifier.fillMaxWidth()) { SkeletonList(rows = 3) }
        Spacer(Modifier.height(14.dp))
        PaperCard(Modifier.fillMaxWidth()) { SkeletonList(rows = 2) }
    }
}

/** 44dp paper circle icon button; optional coral dot (unread notifications). */
@Composable
private fun CircleIconButton(
    icon: ImageVector,
    contentDescription: String,
    onClick: () -> Unit,
    showDot: Boolean = false,
) {
    val haptics = rememberHaptics()
    val pressSource = remember { MutableInteractionSource() }
    Surface(
        onClick = {
            haptics.tap()
            onClick()
        },
        shape = CircleShape,
        color = MaterialTheme.colorScheme.surface,
        contentColor = MaterialTheme.colorScheme.onSurface,
        shadowElevation = 1.dp,
        interactionSource = pressSource,
        modifier = Modifier.size(44.dp).pressScale(pressSource),
    ) {
        Box(contentAlignment = Alignment.Center) {
            Icon(icon, contentDescription = contentDescription, modifier = Modifier.size(17.dp))
            // Animated so the coral dot pops in and out instead of blinking.
            AnimatedContent(
                targetState = showDot,
                modifier = Modifier.align(Alignment.TopEnd).padding(top = 9.dp, end = 9.dp),
                label = "attentionDot",
            ) { dot ->
                if (dot) AttentionDot(size = 8.dp)
            }
        }
    }
}

/** Tinted identity circle (secondaryContainer + SemiBold initials). */
@Composable
private fun AvatarCircle(name: String?, size: Dp, fontSize: TextUnit) {
    Box(
        Modifier
            .size(size)
            .background(MaterialTheme.colorScheme.secondaryContainer, CircleShape),
        contentAlignment = Alignment.Center,
    ) {
        Text(
            initialsOf(name),
            style = MaterialTheme.typography.labelMedium.copy(
                fontSize = fontSize,
                fontWeight = FontWeight.SemiBold,
            ),
            color = MaterialTheme.colorScheme.onSecondaryContainer,
        )
    }
}

/** The muted 15dp trailing arrow on tappable queue rows. */
@Composable
private fun RowArrow() {
    Icon(
        Icons.AutoMirrored.Outlined.ArrowForward,
        contentDescription = null,
        tint = MaterialTheme.colorScheme.outline,
        modifier = Modifier.size(15.dp),
    )
}

/** Theme darkness derived from the applied scheme (user override safe). */
@Composable
private fun isDarkTheme(): Boolean = MaterialTheme.colorScheme.background.luminance() < 0.5f

/** Coral attention mark for the active theme — attention, never error. */
@Composable
private fun coralColor(): Color =
    if (isDarkTheme()) BrandColor.DarkCoral else BrandColor.Coral
