package com.loonext.android.features.notifications

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.AssignmentInd
import androidx.compose.material.icons.outlined.ChatBubbleOutline
import androidx.compose.material.icons.outlined.Checklist
import androidx.compose.material.icons.outlined.Notifications
import androidx.compose.material.icons.outlined.PhoneMissed
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
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
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.loonext.android.AppGraph
import com.loonext.android.core.model.NotificationItem
import com.loonext.android.core.model.NotificationType
import com.loonext.android.ui.common.AttentionDot
import com.loonext.android.ui.common.CenteredError
import com.loonext.android.ui.common.CenteredLoading
import com.loonext.android.ui.common.LoadState
import com.loonext.android.ui.common.RowDivider
import com.loonext.android.ui.common.formatPhone
import com.loonext.android.ui.common.initialsOf
import com.loonext.android.ui.common.relativeTime
import com.loonext.android.ui.common.userMessage
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

/**
 * The derived notifications feed (D24), in the paper-&-olive bell grammar
 * (screen 06): one paper card of rows with kind-tinted 38dp circles, coral
 * unread dots, muted tabular times, cursor pagination. Tap = optimistic
 * watermark advance (that item and everything older flips read; newer stays
 * unread) + deep link into the conversation. 'Read all' advances the
 * watermark to now. The unread count stays live via the company realtime
 * channel plus a 60s poll.
 */
@Composable
fun NotificationsScreen(
    graph: AppGraph,
    companyId: String,
    modifier: Modifier = Modifier,
    onOpenConversation: (String) -> Unit,
) {
    val repo = remember(graph) { NotificationsFeedRepository(graph.api) }
    val scope = rememberCoroutineScope()
    val snackbar = remember { SnackbarHostState() }

    var state by remember(companyId) { mutableStateOf<LoadState<Unit>>(LoadState.Loading) }
    var items by remember(companyId) { mutableStateOf<List<NotificationItem>>(emptyList()) }
    var nextCursor by remember(companyId) { mutableStateOf<String?>(null) }
    var loadingMore by remember(companyId) { mutableStateOf(false) }
    var unreadCount by remember(companyId) { mutableStateOf(0) }
    var refreshKey by remember(companyId) { mutableStateOf(0) }

    // The furthest watermark this session has advanced to (forward-only, the
    // server RPC's semantics). Re-applied to every fetched page so a refetch
    // racing an in-flight mark-read POST can't resurrect stale unread dots.
    var localWatermark by remember(companyId) { mutableStateOf<String?>(null) }
    // Server unread counts are ignored while a mark POST is in flight (they'd
    // briefly resurrect the pre-mark badge); reconciled on settle.
    var pendingMarks by remember(companyId) { mutableStateOf(0) }
    fun withLocalReads(fetched: List<NotificationItem>): List<NotificationItem> =
        localWatermark?.let { applyWatermark(fetched, it) } ?: fetched

    // First page + badge. Realtime events bump refreshKey and trim back to
    // page 1 (web reconnect parity); a quiet refresh failure keeps shown data.
    LaunchedEffect(companyId, refreshKey) {
        try {
            val page = repo.feed(companyId)
            items = withLocalReads(page.data)
            nextCursor = page.next_cursor
            state = LoadState.Ready(Unit)
        } catch (cause: Exception) {
            if (state !is LoadState.Ready) state = LoadState.Failed(cause.userMessage())
        }
        runCatching { repo.unreadCount(companyId) }
            .onSuccess { if (pendingMarks == 0) unreadCount = it.count }
    }

    // The feed is derived from messages/conversations/tasks/calls — any of
    // those moving can add an item or change the badge.
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
    // 60s badge poll — the backstop when realtime is quiet or degraded.
    LaunchedEffect(companyId) {
        while (true) {
            delay(60_000)
            runCatching { repo.unreadCount(companyId) }
                .onSuccess { if (pendingMarks == 0) unreadCount = it.count }
        }
    }

    fun markItemRead(item: NotificationItem) {
        if (!item.unread) return
        val previousItems = items
        val previousCount = unreadCount
        val previousWatermark = localWatermark
        localWatermark = advanceWatermark(localWatermark, item.created_at)
        items = applyWatermark(items, item.created_at)
        // Everything newer than a loaded item is also loaded (contiguous DESC
        // feed), so counting loaded unread rows is exact after the advance.
        unreadCount = items.count { it.unread }
        pendingMarks++
        scope.launch {
            try {
                val result = repo.markRead(companyId, item.created_at)
                // The server may be further ahead (another device read more).
                localWatermark = advanceWatermark(localWatermark, result.last_seen_at)
                items = applyWatermark(items, result.last_seen_at)
                unreadCount = items.count { it.unread }
            } catch (_: Exception) {
                items = previousItems
                unreadCount = previousCount
                localWatermark = previousWatermark
                snackbar.showSnackbar("Couldn't mark that read.")
            } finally {
                pendingMarks--
            }
        }
    }

    fun markAllRead() {
        if (unreadCount == 0 && items.none { it.unread }) return
        val previousItems = items
        val previousCount = unreadCount
        val previousWatermark = localWatermark
        items = items.map { if (it.unread) it.copy(unread = false) else it }
        unreadCount = 0
        pendingMarks++
        scope.launch {
            try {
                val result = repo.markAllRead(companyId)
                localWatermark = advanceWatermark(localWatermark, result.last_seen_at)
            } catch (_: Exception) {
                items = previousItems
                unreadCount = previousCount
                localWatermark = previousWatermark
                snackbar.showSnackbar("Couldn't mark all read.")
            } finally {
                pendingMarks--
            }
        }
    }

    fun loadOlder() {
        val cursor = nextCursor ?: return
        if (loadingMore) return
        loadingMore = true
        scope.launch {
            try {
                val page = repo.feed(companyId, cursor = cursor)
                items = (items + withLocalReads(page.data))
                    .distinctBy { "${it.type}:${it.id}" }
                nextCursor = page.next_cursor
            } catch (_: Exception) {
                snackbar.showSnackbar("Couldn't load older notifications.")
            } finally {
                loadingMore = false
            }
        }
    }

    Box(modifier.fillMaxSize()) {
        when (val current = state) {
            is LoadState.Loading -> CenteredLoading()

            is LoadState.Failed -> CenteredError(
                current.message,
                onRetry = {
                    state = LoadState.Loading
                    refreshKey++
                },
            )

            is LoadState.Ready -> Column(
                Modifier
                    .fillMaxSize()
                    .padding(horizontal = 18.dp),
            ) {
                // The overlay scaffold already shows the back arrow + title;
                // this row carries only the olive 'Read all' action.
                Row(
                    Modifier.fillMaxWidth(),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Spacer(Modifier.weight(1f))
                    TextButton(
                        onClick = ::markAllRead,
                        enabled = unreadCount > 0 || items.any { it.unread },
                        colors = ButtonDefaults.textButtonColors(
                            contentColor = MaterialTheme.colorScheme.secondary,
                        ),
                    ) {
                        Text(
                            "Read all",
                            style = MaterialTheme.typography.labelMedium.copy(
                                fontSize = 11.5.sp,
                                fontWeight = FontWeight.Bold,
                            ),
                        )
                    }
                }

                if (items.isEmpty()) {
                    Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                        Text(
                            "You're all caught up.",
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
                                Column {
                                    if (index > 0) RowDivider()
                                    NotificationRow(
                                        row = row,
                                        onTap = {
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
                                            .fillMaxWidth()
                                            .padding(vertical = 6.dp),
                                        contentAlignment = Alignment.Center,
                                    ) {
                                        TextButton(
                                            onClick = ::loadOlder,
                                            enabled = !loadingMore,
                                            colors = ButtonDefaults.textButtonColors(
                                                contentColor = MaterialTheme.colorScheme.secondary,
                                            ),
                                        ) {
                                            Text(
                                                if (loadingMore) "Loading older…" else "Show older",
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
                        horizontalArrangement = androidx.compose.foundation.layout.Arrangement.Center,
                    ) {
                        Surface(
                            shape = CircleShape,
                            color = MaterialTheme.colorScheme.surfaceContainer,
                        ) {
                            Text(
                                "Push and email mirror these · Settings › Notifications",
                                style = MaterialTheme.typography.labelSmall.copy(fontSize = 11.sp),
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                                modifier = Modifier.padding(horizontal = 14.dp, vertical = 7.dp),
                            )
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
    Row(
        Modifier
            .fillMaxWidth()
            .clickable(enabled = enabled, onClick = onTap)
            .alpha(if (row.unread) 1f else 0.6f)
            .padding(horizontal = 15.dp, vertical = 13.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        KindBadge(row)
        Spacer(Modifier.width(11.dp))
        Text(
            summaryFor(row),
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

        else -> colors.surfaceContainer to colors.onSurfaceVariant
    }
    val contactName = row.contact?.name
    Box {
        Box(
            Modifier
                .size(38.dp)
                .background(tint, CircleShape),
            contentAlignment = Alignment.Center,
        ) {
            if (row.type == NotificationType.INBOUND_MESSAGE && contactName != null) {
                Text(
                    initialsOf(contactName),
                    style = MaterialTheme.typography.labelMedium.copy(
                        fontSize = 12.sp,
                        fontWeight = FontWeight.SemiBold,
                    ),
                    color = content,
                )
            } else {
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
private fun summaryFor(row: NotificationItem): String {
    val who = row.contact?.let { it.name ?: formatPhone(it.phone_e164) }
    return when (row.type) {
        NotificationType.INBOUND_MESSAGE ->
            who?.let { "New message from $it" } ?: "New message"

        NotificationType.ASSIGNED ->
            who?.let { "$it assigned to you" } ?: "Conversation assigned to you"

        NotificationType.TASK_ASSIGNED ->
            who?.let { "Task assigned · $it" } ?: "Task assigned to you"

        NotificationType.MISSED_CALL ->
            who?.let { "Missed call from $it" } ?: "Missed call"

        // A type added server-side after this build shipped — show something
        // honest instead of crashing or hiding it.
        else -> who?.let { "Update · $it" } ?: "Update"
    }
}

private fun iconFor(type: String): ImageVector = when (type) {
    NotificationType.INBOUND_MESSAGE -> Icons.Outlined.ChatBubbleOutline
    NotificationType.ASSIGNED -> Icons.Outlined.AssignmentInd
    NotificationType.TASK_ASSIGNED -> Icons.Outlined.Checklist
    NotificationType.MISSED_CALL -> Icons.Outlined.PhoneMissed
    else -> Icons.Outlined.Notifications
}
