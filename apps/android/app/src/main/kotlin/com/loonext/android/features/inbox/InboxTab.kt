package com.loonext.android.features.inbox

import androidx.compose.foundation.background
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
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.SegmentedButton
import androidx.compose.material3.SegmentedButtonDefaults
import androidx.compose.material3.SingleChoiceSegmentedButtonRow
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.loonext.android.AppGraph
import com.loonext.android.core.model.ConversationListItem
import com.loonext.android.core.model.Me
import com.loonext.android.ui.common.CenteredError
import com.loonext.android.ui.common.CenteredLoading
import com.loonext.android.ui.common.InitialsAvatar
import com.loonext.android.ui.common.LoadState
import com.loonext.android.ui.common.formatPhone
import com.loonext.android.ui.common.relativeTime
import com.loonext.android.ui.common.userMessage

private enum class InboxFilter(val label: String) {
    Open("Open"), Mine("Mine"), All("All"), Closed("Closed")
}

/**
 * Inbox list: segmented Open|Mine|All|Closed + cursor pagination + realtime
 * re-sort (thread view lands with the full messaging pass, #153).
 */
@Composable
fun InboxTab(graph: AppGraph, companyId: String, me: Me, modifier: Modifier = Modifier) {
    var filter by rememberSaveable { mutableStateOf(InboxFilter.Open) }
    var state by remember(companyId) {
        mutableStateOf<LoadState<List<ConversationListItem>>>(LoadState.Loading)
    }
    var nextCursor by remember { mutableStateOf<String?>(null) }
    var refreshKey by remember { mutableStateOf(0) }

    LaunchedEffect(companyId, filter, refreshKey) {
        if (state !is LoadState.Ready) state = LoadState.Loading
        state = try {
            val page = when (filter) {
                InboxFilter.Open -> graph.inboxRepo.conversations(companyId, status = "open")
                InboxFilter.Mine ->
                    graph.inboxRepo.conversations(companyId, assignedUserId = me.user_id)

                InboxFilter.All -> graph.inboxRepo.conversations(companyId)
                InboxFilter.Closed -> graph.inboxRepo.conversations(companyId, status = "closed")
            }
            nextCursor = page.next_cursor
            LoadState.Ready(page.data)
        } catch (cause: Exception) {
            LoadState.Failed(cause.userMessage())
        }
    }
    LaunchedEffect(companyId) {
        graph.realtime.events.collect { event ->
            if (event.event == "message.created" || event.event == "conversation.updated") {
                refreshKey++
            }
        }
    }

    Column(modifier.fillMaxSize()) {
        SingleChoiceSegmentedButtonRow(
            Modifier
                .fillMaxWidth()
                .padding(horizontal = 16.dp, vertical = 10.dp),
        ) {
            InboxFilter.entries.forEachIndexed { index, item ->
                SegmentedButton(
                    selected = filter == item,
                    onClick = { filter = item },
                    shape = SegmentedButtonDefaults.itemShape(
                        index = index,
                        count = InboxFilter.entries.size,
                    ),
                ) { Text(item.label) }
            }
        }
        when (val current = state) {
            is LoadState.Loading -> CenteredLoading()
            is LoadState.Failed -> CenteredError(current.message, onRetry = { refreshKey++ })
            is LoadState.Ready -> {
                if (current.value.isEmpty()) {
                    Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                        Text(
                            "Nothing waiting on you.",
                            style = MaterialTheme.typography.bodyLarge,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                } else {
                    ConversationList(
                        rows = current.value,
                        hasMore = nextCursor != null,
                        onLoadMore = {
                            // Cursor pagination arrives with the full inbox pass (#153);
                            // the first 25 rows render live today.
                        },
                    )
                }
            }
        }
    }
}

@Composable
private fun ConversationList(
    rows: List<ConversationListItem>,
    hasMore: Boolean,
    onLoadMore: () -> Unit,
) {
    LazyColumn(Modifier.fillMaxSize()) {
        items(rows, key = { it.id }) { row -> ConversationRow(row) }
    }
}

@Composable
private fun ConversationRow(row: ConversationListItem) {
    val name = row.contact.name ?: formatPhone(row.contact.phone_e164)
    Row(
        Modifier
            .fillMaxWidth()
            .padding(horizontal = 16.dp, vertical = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        InitialsAvatar(name)
        Spacer(Modifier.width(12.dp))
        Column(Modifier.weight(1f)) {
            Text(
                name,
                style = MaterialTheme.typography.bodyLarge,
                fontWeight = if (row.unread) FontWeight.SemiBold else FontWeight.Normal,
            )
            val snippet = row.last_message?.let { last ->
                if (last.body.isBlank() && last.has_attachments) "Photo" else last.body
            }.orEmpty()
            Text(
                snippet,
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                maxLines = 2,
                overflow = TextOverflow.Ellipsis,
            )
        }
        Spacer(Modifier.width(8.dp))
        Column(horizontalAlignment = Alignment.End) {
            Text(
                relativeTime(row.last_message_at),
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            if (row.unread) {
                Spacer(Modifier.size(6.dp))
                Box(
                    Modifier
                        .size(8.dp)
                        .background(MaterialTheme.colorScheme.primary, CircleShape),
                )
            }
        }
    }
    HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
}
