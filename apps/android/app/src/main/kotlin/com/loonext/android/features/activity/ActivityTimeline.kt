package com.loonext.android.features.activity

import androidx.compose.foundation.clickable
import com.loonext.android.ui.common.EmptyStateSize
import com.loonext.android.ui.common.EmptyState
import com.loonext.android.ui.common.PaperCard
import com.loonext.android.ui.common.SkeletonList
import com.loonext.android.ui.common.LoadErrorVariant
import com.loonext.android.ui.common.LoadError
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.AlternateEmail
import androidx.compose.material.icons.outlined.Block
import androidx.compose.material.icons.outlined.CheckCircle
import androidx.compose.material.icons.outlined.ChatBubbleOutline
import androidx.compose.material.icons.outlined.Call
import androidx.compose.material.icons.outlined.Delete
import androidx.compose.material.icons.outlined.Edit
import androidx.compose.material.icons.outlined.Link
import androidx.compose.material.icons.outlined.MergeType
import androidx.compose.material.icons.outlined.Person
import androidx.compose.material.icons.outlined.Schedule
import androidx.compose.material.icons.outlined.Sell
import androidx.compose.material.icons.outlined.Voicemail
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
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.loonext.android.AppGraph
import com.loonext.android.core.i18n.LocalAppLocale
import com.loonext.android.core.i18n.t
import com.loonext.android.core.model.Member
import com.loonext.android.core.model.Page
import com.loonext.android.core.net.ApiClient
import com.loonext.android.core.time.TimestampFormat
import com.loonext.android.features.thread.memberNames
import com.loonext.android.ui.common.ChoiceChip
import com.loonext.android.ui.common.RowDivider
import com.loonext.android.ui.common.SectionHeader
import com.loonext.android.ui.common.Timestamp
import com.loonext.android.ui.common.rememberHaptics
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch

/** #714: reads the one activity timeline, a page at a time, filtered by the server. */
class ActivityRepository(private val api: ApiClient) {
    suspend fun page(
        companyId: String,
        recordType: ActivityRecordType,
        recordId: String,
        category: ActivityCategory?,
        cursor: String? = null,
    ): Page<ActivityItem> = api.get(
        recordType.path(recordId),
        query = mapOf(
            "category" to category?.wire,
            "cursor" to cursor,
        ),
        companyId = companyId,
    )

    suspend fun members(companyId: String): Page<Member> = api.get(
        "/v1/members",
        query = mapOf("limit" to "100"),
        companyId = companyId,
    )
}

private sealed interface ActivityState {
    data object Loading : ActivityState
    data object Failed : ActivityState
    data class Ready(val items: List<ActivityItem>, val nextCursor: String?) : ActivityState
}

/**
 * #714: the ONE timeline every record uses (a customer, a job, a thread, a
 * call). The server writes the rows, so this only reads them: a filter row
 * (All, Messages, Calls, Changes, applied by the server so paging stays right),
 * day groups, per row the sentence, who did it and when, and "Show earlier".
 * A port of `apps/web/src/components/activity/activity-timeline.tsx`.
 *
 * The caller supplies the heading, so a sheet and a screen can each frame it.
 * It is a plain column rather than a lazy list, so it sits inside whichever
 * scrolling container the surface already has.
 *
 * *Applying: Chunking (one list, four filters) and Zen of Clarity (an icon and
 * one sentence per row; the time and the actor underneath).*
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun ActivityTimeline(
    graph: AppGraph,
    companyId: String,
    recordType: ActivityRecordType,
    recordId: String,
    modifier: Modifier = Modifier,
    onOpenConversation: ((conversationId: String, messageId: String?) -> Unit)? = null,
    onOpenTask: ((taskId: String) -> Unit)? = null,
    onOpenContact: ((contactId: String) -> Unit)? = null,
    /** Bumped by a surface that changed the record and wants the timeline to catch up. */
    reloadKey: Int = 0,
) {
    val repo = remember(graph) { ActivityRepository(graph.api) }
    val locale = LocalAppLocale.current
    val haptics = rememberHaptics()
    val scope = rememberCoroutineScope()

    var category by remember(recordType, recordId) { mutableStateOf<ActivityCategory?>(null) }
    var refreshKey by remember(recordType, recordId) { mutableIntStateOf(0) }
    var state by remember(recordType, recordId) { mutableStateOf<ActivityState>(ActivityState.Loading) }
    var loadingMore by remember(recordType, recordId) { mutableStateOf(false) }
    var names by remember(companyId) { mutableStateOf(emptyMap<String, String>()) }

    LaunchedEffect(companyId) {
        runCatching { repo.members(companyId) }
            .getOrNull()
            ?.let { names = memberNames(it.data) }
    }

    // The filter is the server's, so a new one starts from the newest page. The
    // old rows stay on screen while it loads, on a refresh, and go on a filter change.
    LaunchedEffect(recordType, recordId, category, refreshKey, reloadKey) {
        try {
            val page = repo.page(companyId, recordType, recordId, category)
            state = ActivityState.Ready(page.data, page.next_cursor)
        } catch (cancelled: CancellationException) {
            throw cancelled
        } catch (_: Exception) {
            if (state !is ActivityState.Ready) state = ActivityState.Failed
        }
    }

    // A text lands, a call moves, a job changes: the same broadcasts the record's own screen hears.
    LaunchedEffect(recordType, recordId) {
        graph.realtime.events.collect { event ->
            when (event.event) {
                "call.updated", "message.created", "conversation.updated", "task.changed" -> refreshKey++
            }
        }
    }
    LaunchedEffect(recordType, recordId) {
        graph.realtime.reconnected.collect { refreshKey++ }
    }

    val nameOf: (String?) -> String? = { id -> id?.let { names[it] } }
    val filterLabel = t("activity.filterAria")

    Column(modifier, verticalArrangement = Arrangement.spacedBy(8.dp)) {
        FlowRow(
            horizontalArrangement = Arrangement.spacedBy(8.dp),
            modifier = Modifier
                .padding(horizontal = 6.dp)
                .semantics { contentDescription = filterLabel },
        ) {
            ACTIVITY_FILTERS.forEach { (value, labelKey) ->
                ChoiceChip(
                    label = t(labelKey),
                    chosen = category == value,
                    onClick = {
                        if (category != value) {
                            haptics.tap()
                            state = ActivityState.Loading
                            category = value
                        }
                    },
                )
            }
        }

        when (val current = state) {
            is ActivityState.Loading -> PaperCard(Modifier.fillMaxWidth()) {
                SkeletonList(rows = 2, avatar = false)
            }

            is ActivityState.Failed -> LoadError(
                message = t("activity.loadFailed") + ". " + t("activity.loadFailedDetail"),
                onRetry = {
                    haptics.tap()
                    state = ActivityState.Loading
                    refreshKey++
                },
                variant = LoadErrorVariant.Inline,
            )

            is ActivityState.Ready -> {
                if (current.items.isEmpty()) {
                    EmptyState(
                        title = t(if (category == null) "activity.empty" else "activity.emptyFiltered"),
                        description = if (category == null) t("activity.emptyDetail") else null,
                        size = EmptyStateSize.Panel,
                    )
                } else {
                    val groups = remember(current.items) {
                        groupActivityByDay(current.items, ActivityItem::occurred_at)
                    }
                    groups.forEachIndexed { groupIndex, (day, rows) ->
                        SectionHeader(
                            activityDayLabel(day, locale),
                            Modifier.padding(top = if (groupIndex == 0) 0.dp else 6.dp),
                        )
                        PaperCard(Modifier.fillMaxWidth()) {
                            rows.forEachIndexed { index, item ->
                                key(item.id) {
                                    val line = activityLine(item, recordType, recordId, nameOf, locale)
                                    val go: (() -> Unit)? = when (val open = line.open) {
                                        is ActivityOpen.Thread -> onOpenConversation?.let { go -> { go(open.conversationId, open.messageId) } }
                                        is ActivityOpen.Task -> onOpenTask?.let { go -> { go(open.taskId) } }
                                        is ActivityOpen.Contact -> onOpenContact?.let { go -> { go(open.contactId) } }
                                        null -> null
                                    }
                                    ActivityRow(
                                        line = line,
                                        who = activityActor(item, nameOf, locale),
                                        at = item.occurred_at,
                                        onOpen = go,
                                    )
                                    if (index < rows.lastIndex) RowDivider()
                                }
                            }
                        }
                    }
                    current.nextCursor?.let { cursor ->
                        Box(Modifier.fillMaxWidth(), contentAlignment = Alignment.Center) {
                            if (loadingMore) {
                                LoadingIndicator(Modifier.size(28.dp))
                            } else {
                                TextButton(
                                    onClick = {
                                        haptics.tap()
                                        loadingMore = true
                                        scope.launch {
                                            try {
                                                val page = repo.page(
                                                    companyId, recordType, recordId, category, cursor,
                                                )
                                                state = current.copy(
                                                    items = current.items + page.data
                                                        .filterNot { next -> current.items.any { it.id == next.id } },
                                                    nextCursor = page.next_cursor,
                                                )
                                            } catch (cancelled: CancellationException) {
                                                throw cancelled
                                            } catch (_: Exception) {
                                                // Keep what is loaded; the button stays, so the retry is one tap.
                                            } finally {
                                                loadingMore = false
                                            }
                                        }
                                    },
                                    modifier = Modifier.heightIn(min = 48.dp),
                                ) { Text(t("activity.showEarlier")) }
                            }
                        }
                    }
                }
            }
        }
    }
}

private fun iconFor(icon: ActivityIcon): ImageVector = when (icon) {
    ActivityIcon.TEXT -> Icons.Outlined.ChatBubbleOutline
    ActivityIcon.CALL -> Icons.Outlined.Call
    ActivityIcon.VOICEMAIL -> Icons.Outlined.Voicemail
    ActivityIcon.EDIT -> Icons.Outlined.Edit
    ActivityIcon.TAG -> Icons.Outlined.Sell
    ActivityIcon.PERSON -> Icons.Outlined.Person
    ActivityIcon.LINK -> Icons.Outlined.Link
    ActivityIcon.STOP -> Icons.Outlined.Block
    ActivityIcon.CHECK -> Icons.Outlined.CheckCircle
    ActivityIcon.MERGE -> Icons.Outlined.MergeType
    ActivityIcon.TRASH -> Icons.Outlined.Delete
    ActivityIcon.MENTION -> Icons.Outlined.AlternateEmail
    ActivityIcon.CLOCK -> Icons.Outlined.Schedule
}

@Composable
private fun ActivityRow(
    line: ActivityLine,
    who: String,
    at: String,
    onOpen: (() -> Unit)?,
) {
    val haptics = rememberHaptics()
    Row(
        Modifier
            .fillMaxWidth()
            .then(
                // A row with nothing to open stays a plain row: a dead tap target is worse.
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
            imageVector = iconFor(line.icon),
            contentDescription = null,
            modifier = Modifier.size(20.dp),
            tint = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        Column(Modifier.weight(1f)) {
            Text(line.text, style = MaterialTheme.typography.bodyMedium)
            Row {
                Text(
                    "$who · ",
                    style = MaterialTheme.typography.bodySmall.copy(fontSize = 12.sp),
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                Timestamp(
                    at,
                    style = TimestampFormat.Style.LONG,
                    fontSize = 12.sp,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }
    }
}
