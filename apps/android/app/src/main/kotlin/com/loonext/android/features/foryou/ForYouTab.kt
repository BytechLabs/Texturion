package com.loonext.android.features.foryou

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.PhoneCallback
import androidx.compose.material.icons.filled.PhoneForwarded
import androidx.compose.material.icons.filled.PhoneMissed
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.loonext.android.AppGraph
import com.loonext.android.core.model.Call
import com.loonext.android.core.model.CallOutcome
import com.loonext.android.core.model.ForYou
import com.loonext.android.core.model.Me
import com.loonext.android.features.calls.CallsRepository
import com.loonext.android.features.calls.callOutcomeLabel
import com.loonext.android.features.calls.callerDisplayName
import com.loonext.android.features.calls.isActionableMiss
import com.loonext.android.features.thread.ThreadScreen
import com.loonext.android.ui.common.CenteredError
import com.loonext.android.ui.common.CenteredLoading
import com.loonext.android.ui.common.InitialsAvatar
import com.loonext.android.ui.common.LoadState
import com.loonext.android.ui.common.formatPhone
import com.loonext.android.ui.common.relativeTime
import com.loonext.android.ui.common.userMessage

/**
 * /for-you — the default landing: Triage (owner/admin), Waiting on you,
 * My tasks, Unread, and Recent calls (D43: the mobile entry point into the
 * Calls surface). Realtime events refetch the queue; every row deep-links
 * into [ThreadScreen] in place (task rows open their conversation — task
 * detail itself is the Tasks tab's surface, #154).
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
            onOpenConversation = { openConversationId = it },
            onOpenCalls = onOpenCalls,
            modifier = modifier,
        )
    }
}

@Composable
private fun ForYouList(
    forYou: ForYou,
    recentCalls: LoadState<List<Call>>,
    onOpenConversation: (String) -> Unit,
    onOpenCalls: (() -> Unit)?,
    modifier: Modifier = Modifier,
) {
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
                        onClick = { onOpenConversation(row.conversation_id) },
                    )
                }
                items(triage.tasks, key = { "tt:${it.task_id}" }) { row ->
                    TaskRow(
                        title = row.title,
                        overdue = row.overdue,
                        dueAt = row.due_at,
                        onClick = { onOpenConversation(row.conversation_id) },
                    )
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
                    onClick = { onOpenConversation(row.conversation_id) },
                )
            }
        }

        if (forYou.my_tasks.isNotEmpty()) {
            item { SectionHeader("Your tasks") }
            items(forYou.my_tasks, key = { "t:${it.task_id}" }) { row ->
                TaskRow(
                    title = row.title,
                    overdue = row.overdue,
                    dueAt = row.due_at,
                    onClick = { onOpenConversation(row.conversation_id) },
                )
            }
        }

        if (forYou.unread.isNotEmpty()) {
            item { SectionHeader("Unread") }
            items(forYou.unread, key = { "u:${it.conversation_id}" }) { row ->
                PersonRow(
                    name = row.contact?.name ?: formatPhone(row.contact?.phone_e164),
                    meta = relativeTime(row.last_message_at),
                    unread = true,
                    onClick = { onOpenConversation(row.conversation_id) },
                )
            }
        }

        // Recent calls (#165/D43) — the mobile doorway into the Calls
        // surface. Hidden entirely while there are no calls; an honest error
        // line when the log couldn't load.
        when (recentCalls) {
            is LoadState.Loading -> Unit
            is LoadState.Failed -> {
                item(key = "calls-header") {
                    RecentCallsHeader(onOpenCalls)
                }
                item(key = "calls-error") {
                    Text(
                        "Couldn't load recent calls.",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        modifier = Modifier.padding(horizontal = 20.dp, vertical = 8.dp),
                    )
                }
            }

            is LoadState.Ready -> if (recentCalls.value.isNotEmpty()) {
                item(key = "calls-header") {
                    RecentCallsHeader(onOpenCalls)
                }
                items(recentCalls.value, key = { "c:${it.id}" }) { call ->
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

@Composable
private fun RecentCallsHeader(onOpenCalls: (() -> Unit)?) {
    Row(
        Modifier
            .fillMaxWidth()
            .padding(start = 20.dp, end = 8.dp, top = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(
            "Recent calls",
            style = MaterialTheme.typography.titleSmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.weight(1f),
        )
        if (onOpenCalls != null) {
            TextButton(onClick = onOpenCalls) { Text("View all") }
        }
    }
}

@Composable
private fun RecentCallRow(call: Call, onClick: (() -> Unit)?) {
    val name = callerDisplayName(call)
    val glyph = when {
        call.direction == "outbound" -> Icons.Filled.PhoneForwarded
        call.outcome == CallOutcome.MISSED -> Icons.Filled.PhoneMissed
        else -> Icons.Filled.PhoneCallback
    }
    Row(
        Modifier
            .fillMaxWidth()
            .let { base -> if (onClick != null) base.clickable(onClick = onClick) else base }
            .padding(horizontal = 20.dp, vertical = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        InitialsAvatar(name)
        Spacer(Modifier.width(12.dp))
        Column(Modifier.weight(1f)) {
            Text(name, style = MaterialTheme.typography.bodyLarge)
            Row(verticalAlignment = Alignment.CenterVertically) {
                Icon(
                    glyph,
                    contentDescription = null,
                    // Amber only for the actionable inbound miss (calm system).
                    tint = if (isActionableMiss(call)) {
                        MaterialTheme.colorScheme.tertiary
                    } else {
                        MaterialTheme.colorScheme.onSurfaceVariant
                    },
                    modifier = Modifier.size(14.dp),
                )
                Spacer(Modifier.width(6.dp))
                Text(
                    callOutcomeLabel(call),
                    style = MaterialTheme.typography.labelMedium,
                    color = if (isActionableMiss(call)) {
                        MaterialTheme.colorScheme.tertiary
                    } else {
                        MaterialTheme.colorScheme.onSurfaceVariant
                    },
                )
            }
        }
        Text(
            relativeTime(call.started_at),
            style = MaterialTheme.typography.labelSmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
    }
    HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
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
private fun PersonRow(name: String?, meta: String, unread: Boolean, onClick: () -> Unit) {
    Row(
        Modifier
            .fillMaxWidth()
            .clickable(onClick = onClick)
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
private fun TaskRow(title: String, overdue: Boolean, dueAt: String?, onClick: () -> Unit) {
    Row(
        Modifier
            .fillMaxWidth()
            .clickable(onClick = onClick)
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
