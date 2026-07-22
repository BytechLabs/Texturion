package com.loonext.android.features.foryou

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ArrowBack
import androidx.compose.material.icons.automirrored.outlined.ArrowForward
import androidx.compose.material.icons.outlined.Notifications
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.minimumInteractiveComponentSize
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
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
import com.loonext.android.features.notifications.NotificationsScreen
import com.loonext.android.features.thread.ThreadScreen
import com.loonext.android.ui.common.AttentionDot
import com.loonext.android.ui.common.CenteredError
import com.loonext.android.ui.common.CenteredLoading
import com.loonext.android.ui.common.DsChip
import com.loonext.android.ui.common.LoadState
import com.loonext.android.ui.common.PaperCard
import com.loonext.android.ui.common.RowDivider
import com.loonext.android.ui.common.ScreenTitle
import com.loonext.android.ui.common.SectionHeader
import com.loonext.android.ui.common.formatPhone
import com.loonext.android.ui.common.initialsOf
import com.loonext.android.ui.common.relativeTime
import com.loonext.android.ui.common.userMessage
import com.loonext.android.ui.theme.BrandColor

/**
 * /for-you — the default landing: Triage (owner/admin), Waiting on you,
 * My tasks, Unread, and Recent calls (D43: the mobile entry point into the
 * Calls surface). Realtime events refetch the queue; every row deep-links
 * into [ThreadScreen] in place (task rows open their conversation — task
 * detail itself is the Tasks tab's surface, #154).
 *
 * Paper & Olive pass (screens 19/29 + the screen-18 activation grammar):
 * identity avatar top-left, a 44dp paper-circle bell (coral dot when unread —
 * opens the notifications feed in place), Bricolage "For you" heading with a
 * one-line summary, then each queue section as a radius-22 paper card of rows.
 *
 * [onOpenCalls] is the shell's navigation to the full Calls surface — the
 * "View all" affordance hides until the integrator wires it.
 * [onViewedConversationChanged] reports which thread this tab has open (null
 * when back on the queue) so the shell's inbound toast can suppress itself.
 */
@Composable
fun ForYouTab(
    graph: AppGraph,
    companyId: String,
    me: Me,
    modifier: Modifier = Modifier,
    onOpenCalls: (() -> Unit)? = null,
    onViewedConversationChanged: ((conversationId: String?) -> Unit)? = null,
) {
    var openConversationId by rememberSaveable(companyId) { mutableStateOf<String?>(null) }
    var showNotifications by rememberSaveable(companyId) { mutableStateOf(false) }
    LaunchedEffect(openConversationId) {
        onViewedConversationChanged?.invoke(openConversationId)
    }

    val openId = openConversationId
    if (openId != null) {
        ThreadScreen(
            graph = graph,
            companyId = companyId,
            me = me,
            conversationId = openId,
            onBack = { openConversationId = null },
            modifier = modifier,
            onOpenConversation = { openConversationId = it },
        )
        return
    }

    if (showNotifications) {
        NotificationsHost(
            graph = graph,
            companyId = companyId,
            onBack = { showNotifications = false },
            onOpenConversation = { openConversationId = it },
            modifier = modifier,
        )
        return
    }

    var state by remember(companyId) { mutableStateOf<LoadState<ForYou>>(LoadState.Loading) }
    var refreshKey by remember { mutableStateOf(0) }

    LaunchedEffect(companyId, refreshKey) {
        if (refreshKey == 0) state = LoadState.Loading
        state = try {
            LoadState.Ready(graph.forYouRepo.forYou(companyId))
        } catch (cause: Exception) {
            LoadState.Failed(cause.userMessage())
        }
    }

    // Recent calls (#165): the 3 newest sessions, refetched on the same
    // realtime ticks as the queue (call.updated is in the filter below).
    val callsRepo = remember(graph) { CallsRepository(graph.api) }
    var recentCalls by remember(companyId) {
        mutableStateOf<LoadState<List<Call>>>(LoadState.Loading)
    }
    LaunchedEffect(companyId, refreshKey) {
        recentCalls = try {
            LoadState.Ready(callsRepo.calls(companyId, limit = 3).data)
        } catch (cause: Exception) {
            // Keep stale rows over an error flash on a refetch hiccup.
            (recentCalls as? LoadState.Ready)?.let { it }
                ?: LoadState.Failed(cause.userMessage())
        }
    }
    // Coral dot on the bell — refreshed on the same ticks (the feed derives
    // from message/task/call activity). A miss keeps the last known count.
    var unreadNotifications by remember(companyId) { mutableStateOf(0) }
    LaunchedEffect(companyId, refreshKey) {
        unreadNotifications = runCatching {
            graph.notificationsRepo.unreadCount(companyId).count
        }.getOrDefault(unreadNotifications)
    }
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

    when (val current = state) {
        is LoadState.Loading -> CenteredLoading(modifier)
        is LoadState.Failed -> CenteredError(current.message, onRetry = { refreshKey++ }, modifier)
        is LoadState.Ready -> ForYouList(
            forYou = current.value,
            recentCalls = recentCalls,
            unreadNotifications = unreadNotifications,
            me = me,
            onOpenConversation = { openConversationId = it },
            onOpenCalls = onOpenCalls,
            onOpenNotifications = { showNotifications = true },
            modifier = modifier,
        )
    }
}

/** The notifications feed hosted in place (paper-circle back + display title). */
@Composable
private fun NotificationsHost(
    graph: AppGraph,
    companyId: String,
    onBack: () -> Unit,
    onOpenConversation: (String) -> Unit,
    modifier: Modifier = Modifier,
) {
    BackHandler(onBack = onBack)
    Column(modifier.fillMaxSize()) {
        Row(
            Modifier
                .fillMaxWidth()
                .padding(start = 18.dp, end = 18.dp, top = 8.dp, bottom = 10.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            CircleIconButton(
                icon = Icons.AutoMirrored.Outlined.ArrowBack,
                contentDescription = "Back",
                onClick = onBack,
            )
            Spacer(Modifier.width(12.dp))
            ScreenTitle("Notifications")
        }
        NotificationsScreen(
            graph = graph,
            companyId = companyId,
            modifier = Modifier.fillMaxWidth().weight(1f),
            onOpenConversation = onOpenConversation,
        )
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
            item(key = "caught-up") { CaughtUpWell() }
        }

        forYou.triage
            ?.takeIf { it.conversations.isNotEmpty() || it.tasks.isNotEmpty() }
            ?.let { triage ->
                item(key = "triage") {
                    QueueSection("Triage", count = triage.conversations.size + triage.tasks.size) {
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
                QueueSection("Waiting on you", count = forYou.waiting_on_you.size) {
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
                QueueSection("My tasks", count = forYou.my_tasks.size) {
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
                QueueSection("Unread", count = forYou.unread.size) {
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
                Column(Modifier.padding(top = 14.dp)) {
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
                    Column(Modifier.padding(top = 14.dp)) {
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
    content: @Composable ColumnScope.() -> Unit,
) {
    Column(Modifier.padding(top = 14.dp)) {
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
    Row(
        Modifier
            .fillMaxWidth()
            .clickable(onClick = onClick)
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
    Row(
        Modifier
            .fillMaxWidth()
            .clickable(onClick = onClick)
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
    Row(
        Modifier
            .fillMaxWidth()
            .let { base -> if (onClick != null) base.clickable(onClick = onClick) else base }
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
private fun CaughtUpWell() {
    Surface(
        shape = RoundedCornerShape(26.dp),
        color = MaterialTheme.colorScheme.surfaceContainerHigh,
        modifier = Modifier.fillMaxWidth().padding(top = 15.dp),
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

/** 44dp paper circle icon button; optional coral dot (unread notifications). */
@Composable
private fun CircleIconButton(
    icon: ImageVector,
    contentDescription: String,
    onClick: () -> Unit,
    showDot: Boolean = false,
) {
    Surface(
        onClick = onClick,
        shape = CircleShape,
        color = MaterialTheme.colorScheme.surface,
        contentColor = MaterialTheme.colorScheme.onSurface,
        shadowElevation = 1.dp,
        modifier = Modifier.size(44.dp),
    ) {
        Box(contentAlignment = Alignment.Center) {
            Icon(icon, contentDescription = contentDescription, modifier = Modifier.size(17.dp))
            if (showDot) {
                AttentionDot(
                    Modifier.align(Alignment.TopEnd).padding(top = 9.dp, end = 9.dp),
                    size = 8.dp,
                )
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
