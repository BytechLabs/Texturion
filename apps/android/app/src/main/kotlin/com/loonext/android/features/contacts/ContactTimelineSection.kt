package com.loonext.android.features.contacts

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.CheckCircle
import androidx.compose.material.icons.outlined.Call
import androidx.compose.material.icons.outlined.ChatBubbleOutline
import androidx.compose.material.icons.outlined.RadioButtonUnchecked
import androidx.compose.material3.Icon
import androidx.compose.material3.LoadingIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.loonext.android.core.data.CacheKeys
import com.loonext.android.core.i18n.LocalAppLocale
import com.loonext.android.core.i18n.t
import com.loonext.android.AppGraph
import com.loonext.android.ui.common.LoadState
import com.loonext.android.ui.common.PaperCard
import com.loonext.android.ui.common.RowDivider
import com.loonext.android.ui.common.SectionHeader
import com.loonext.android.ui.common.SkeletonListRow
import com.loonext.android.features.thread.memberNames
import com.loonext.android.ui.common.rememberCacheFirst
import com.loonext.android.ui.common.rememberHaptics
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import kotlinx.coroutines.launch

/**
 * #324 — "what have we done for this customer?", answered by scrolling once.
 *
 * D7 threads by recency, so a long relationship is MANY conversations. The
 * prior-conversations list (G6) and the per-contact call history (#205) both
 * already existed and are both still right; what was missing is that they were
 * separate blocks with jobs nowhere, so the question asked before every visit
 * meant opening threads one at a time.
 *
 * This sits ABOVE the Calls section rather than replacing it: this is the
 * overview, and Calls stays as the detail view where a voicemail plays in
 * place.
 *
 * The kinds are told apart by icon and by what the line says, never by being
 * put back into separate lists — merging them is the entire point.
 */
@Composable
internal fun ContactTimelineSection(
    graph: AppGraph,
    mutations: ContactMutations,
    companyId: String,
    contactId: String,
    onOpenConversation: ((conversationId: String) -> Unit)?,
    modifier: Modifier = Modifier,
) {
    var refreshKey by remember(contactId) { mutableIntStateOf(0) }
    var loadingMore by remember(contactId) { mutableStateOf(false) }
    val scope = rememberCoroutineScope()
    val haptics = rememberHaptics()
    // #228: the day headings are built inside a LazyListScope, which is not a
    // composition, so the reader's language is read here and carried in.
    val locale = LocalAppLocale.current

    // #176 cache-first, like the Calls section: a reopened contact paints its
    // history instantly while the first page revalidates, and the merge keeps
    // any deeper pages the user already loaded.
    val cacheKey = CacheKeys.contactTimeline(companyId, contactId)
    val state = rememberCacheFirst(
        cache = graph.storeCache,
        key = cacheKey,
        refreshKey = refreshKey,
    ) {
        mergeTimelineFirstPage(
            graph.storeCache.flowOf<ContactTimelineLog>(cacheKey).value,
            mutations.timeline(companyId, contactId),
        )
    }

    // The history changes when a text lands, a call ends, or a job moves — so
    // it revalidates on the same broadcasts those surfaces already listen to
    // rather than inventing a fourth event.
    LaunchedEffect(contactId) {
        graph.realtime.events.collect { event ->
            when (event.event) {
                // `task.changed` is the wire name the tasks trigger emits
                // (20260702060000). An earlier draft said `task.updated`,
                // which nothing broadcasts, so job rows never revalidated.
                "call.updated", "message.created", "conversation.updated", "task.changed" ->
                    refreshKey++
            }
        }
    }
    LaunchedEffect(contactId) {
        graph.realtime.reconnected.collect { refreshKey++ }
    }

    // #517: the roster, so an answered call can say who took it. Best-effort
    // and out of band — the history must still render if this fails, because
    // the name is a decoration on a line that already reads correctly.
    var memberNames by remember(companyId) { mutableStateOf(emptyMap<String, String>()) }
    LaunchedEffect(companyId) {
        runCatching { mutations.members(companyId) }
            .getOrNull()
            ?.let { page -> memberNames = memberNames(page.data) }
    }

    ContactSection(t("contactsTasks.historySection"), modifier) {
        when (val current = state) {
            is LoadState.Loading -> PaperCard(Modifier.fillMaxWidth()) {
                SkeletonListRow(avatar = false)
                RowDivider()
                SkeletonListRow(avatar = false)
            }

            is LoadState.Failed -> Column(Modifier.padding(start = 6.dp)) {
                Text(
                    current.message,
                    style = MaterialTheme.typography.bodySmall.copy(fontSize = 12.sp),
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                TextButton(
                    onClick = {
                        haptics.tap()
                        refreshKey++
                    },
                    contentPadding = PaddingValues(0.dp),
                ) { Text(t("common.retry")) }
            }

            is LoadState.Ready -> {
                val entries = current.value.entries
                if (entries.isEmpty()) {
                    Text(
                        t("contactsTasks.timelineEmpty"),
                        style = MaterialTheme.typography.bodySmall.copy(fontSize = 12.5.sp),
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        modifier = Modifier.padding(start = 6.dp),
                    )
                } else {
                    val groups = remember(entries) { groupTimelineByDay(entries) }
                    groups.forEachIndexed { groupIndex, (day, rows) ->
                        SectionHeader(
                            timelineDayLabel(day, locale = locale),
                            Modifier.padding(top = if (groupIndex == 0) 0.dp else 10.dp),
                            count = rows.size,
                        )
                        PaperCard(Modifier.fillMaxWidth()) {
                            rows.forEachIndexed { index, entry ->
                                key("${entry.kind}:${entry.id}") {
                                    TimelineRow(
                                        entry = entry,
                                        memberNames = memberNames,
                                        onOpen = entry.conversation_id
                                            ?.takeIf { onOpenConversation != null }
                                            ?.let { id -> { onOpenConversation?.invoke(id) } },
                                    )
                                    if (index < rows.lastIndex) RowDivider()
                                }
                            }
                        }
                    }
                    if (current.value.nextCursor != null) {
                        Box(
                            Modifier
                                .fillMaxWidth()
                                .padding(top = 4.dp),
                            contentAlignment = Alignment.Center,
                        ) {
                            if (loadingMore) {
                                LoadingIndicator(Modifier.size(28.dp))
                            } else {
                                TextButton(onClick = {
                                    val cursor = current.value.nextCursor
                                        ?: return@TextButton
                                    haptics.tap()
                                    loadingMore = true
                                    scope.launch {
                                        try {
                                            val page = mutations.timeline(
                                                companyId, contactId, cursor = cursor,
                                            )
                                            // Append onto whatever the cache holds
                                            // NOW: a silent revalidate may have
                                            // landed since the tap.
                                            val base = graph.storeCache
                                                .flowOf<ContactTimelineLog>(cacheKey).value
                                                ?: current.value
                                            graph.storeCache.put(
                                                cacheKey,
                                                appendTimelinePage(base, page),
                                            )
                                        } catch (_: Exception) {
                                            // Keep what is loaded; the button stays,
                                            // so the retry is one tap.
                                        } finally {
                                            loadingMore = false
                                        }
                                    }
                                }) { Text(t("contactsTasks.showEarlier")) }
                            }
                        }
                    }
                }
            }
        }
    }
}

private val TIME_LABEL: DateTimeFormatter = DateTimeFormatter.ofPattern("h:mm a")

@Composable
private fun TimelineRow(
    entry: TimelineEntry,
    memberNames: Map<String, String>,
    onOpen: (() -> Unit)?,
) {
    val haptics = rememberHaptics()
    val locale = LocalAppLocale.current
    Row(
        Modifier
            .fillMaxWidth()
            .then(
                // A call that never threaded has nowhere to go, and a dead tap
                // target is worse than a plain row.
                if (onOpen != null) {
                    Modifier.clickable {
                        haptics.tap()
                        onOpen()
                    }
                } else {
                    Modifier
                },
            )
            .padding(horizontal = 12.dp, vertical = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Icon(
            imageVector = when {
                entry.kind == "call" -> Icons.Outlined.Call
                entry.kind == "task" && entry.done == true -> Icons.Outlined.CheckCircle
                entry.kind == "task" -> Icons.Outlined.RadioButtonUnchecked
                else -> Icons.Outlined.ChatBubbleOutline
            },
            contentDescription = null,
            modifier = Modifier.size(20.dp),
            tint = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        Column(Modifier.weight(1f)) {
            Text(
                timelineTitle(entry, memberNames, locale),
                style = MaterialTheme.typography.bodyMedium,
                maxLines = 1,
            )
            Text(
                timelineDetail(entry, locale),
                style = MaterialTheme.typography.bodySmall.copy(fontSize = 12.sp),
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                maxLines = 1,
            )
        }
        Text(
            TIME_LABEL.format(
                Instant.parse(entry.occurred_at).atZone(ZoneId.systemDefault()),
            ),
            style = MaterialTheme.typography.labelSmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
    }
}
