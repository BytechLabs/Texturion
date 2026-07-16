package com.loonext.android.features.foryou

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.loonext.android.AppGraph
import com.loonext.android.core.model.ForYou
import com.loonext.android.core.model.Me
import com.loonext.android.ui.common.CenteredError
import com.loonext.android.ui.common.CenteredLoading
import com.loonext.android.ui.common.InitialsAvatar
import com.loonext.android.ui.common.LoadState
import com.loonext.android.ui.common.formatPhone
import com.loonext.android.ui.common.relativeTime
import com.loonext.android.ui.common.userMessage

/**
 * /for-you — the default landing: Triage (owner/admin), Waiting on you,
 * My tasks, Unread. Realtime events refetch the queue.
 */
@Composable
fun ForYouTab(graph: AppGraph, companyId: String, me: Me, modifier: Modifier = Modifier) {
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

    when (val current = state) {
        is LoadState.Loading -> CenteredLoading(modifier)
        is LoadState.Failed -> CenteredError(current.message, onRetry = { refreshKey++ }, modifier)
        is LoadState.Ready -> ForYouList(current.value, modifier)
    }
}

@Composable
private fun ForYouList(forYou: ForYou, modifier: Modifier = Modifier) {
    val total = forYou.waiting_on_you.size + forYou.my_tasks.size + forYou.unread.size +
        (forYou.triage?.let { it.conversations.size + it.tasks.size } ?: 0)

    LazyColumn(modifier = modifier.fillMaxWidth()) {
        item {
            Column(Modifier.padding(horizontal = 20.dp, vertical = 16.dp)) {
                Text("For you", style = MaterialTheme.typography.headlineSmall)
                Text(
                    if (total == 0) "You're all caught up."
                    else "$total ${if (total == 1) "thing needs" else "things need"} you",
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }

        forYou.triage?.let { triage ->
            if (triage.conversations.isNotEmpty() || triage.tasks.isNotEmpty()) {
                item { SectionHeader("Needs an owner") }
                items(triage.conversations, key = { "tc:${it.conversation_id}" }) { row ->
                    PersonRow(
                        name = row.contact?.name ?: formatPhone(row.contact?.phone_e164),
                        meta = relativeTime(row.last_message_at),
                        unread = row.unread,
                    )
                }
                items(triage.tasks, key = { "tt:${it.task_id}" }) { row ->
                    TaskRow(title = row.title, overdue = row.overdue, dueAt = row.due_at)
                }
            }
        }

        if (forYou.waiting_on_you.isNotEmpty()) {
            item { SectionHeader("Waiting on you") }
            items(forYou.waiting_on_you, key = { "w:${it.conversation_id}" }) { row ->
                PersonRow(
                    name = row.contact?.name ?: formatPhone(row.contact?.phone_e164),
                    meta = relativeTime(row.last_message_at),
                    unread = row.unread,
                )
            }
        }

        if (forYou.my_tasks.isNotEmpty()) {
            item { SectionHeader("Your tasks") }
            items(forYou.my_tasks, key = { "t:${it.task_id}" }) { row ->
                TaskRow(title = row.title, overdue = row.overdue, dueAt = row.due_at)
            }
        }

        if (forYou.unread.isNotEmpty()) {
            item { SectionHeader("Unread") }
            items(forYou.unread, key = { "u:${it.conversation_id}" }) { row ->
                PersonRow(
                    name = row.contact?.name ?: formatPhone(row.contact?.phone_e164),
                    meta = relativeTime(row.last_message_at),
                    unread = true,
                )
            }
        }
    }
}

@Composable
private fun SectionHeader(title: String) {
    Text(
        title,
        style = MaterialTheme.typography.titleSmall,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
        modifier = Modifier.padding(start = 20.dp, top = 20.dp, bottom = 6.dp),
    )
}

@Composable
private fun PersonRow(name: String?, meta: String, unread: Boolean) {
    Row(
        Modifier
            .fillMaxWidth()
            .padding(horizontal = 20.dp, vertical = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        InitialsAvatar(name)
        Spacer(Modifier.width(12.dp))
        Column(Modifier.weight(1f)) {
            Text(
                name ?: "Unknown",
                style = if (unread) MaterialTheme.typography.titleSmall
                else MaterialTheme.typography.bodyLarge,
            )
        }
        Text(
            meta,
            style = MaterialTheme.typography.labelSmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
    }
    HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
}

@Composable
private fun TaskRow(title: String, overdue: Boolean, dueAt: String?) {
    Row(
        Modifier
            .fillMaxWidth()
            .padding(horizontal = 20.dp, vertical = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Column(Modifier.weight(1f)) {
            Text(title, style = MaterialTheme.typography.bodyLarge)
            Text(
                when {
                    overdue -> "Overdue task"
                    dueAt != null -> "Due ${relativeTime(dueAt)}"
                    else -> "Open task"
                },
                style = MaterialTheme.typography.labelSmall,
                // Overdue = amber, never red (calm system).
                color = if (overdue) MaterialTheme.colorScheme.tertiary
                else MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
    HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
}
