package com.loonext.android.features.tasks

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.KeyboardArrowLeft
import androidx.compose.material.icons.automirrored.outlined.KeyboardArrowRight
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.loonext.android.core.data.CacheKeys
import com.loonext.android.core.data.StoreCache
import com.loonext.android.core.model.Task
import com.loonext.android.ui.common.CenteredError
import com.loonext.android.ui.common.LoadState
import com.loonext.android.ui.common.RowDivider
import com.loonext.android.ui.common.SectionHeader
import com.loonext.android.ui.common.SkeletonBlock
import com.loonext.android.ui.common.rememberCacheFirst
import com.loonext.android.ui.common.rememberHaptics
import java.time.Clock
import java.time.LocalDate
import java.time.YearMonth
import java.time.ZoneId
import java.time.format.DateTimeFormatter

/**
 * /tasks Calendar view (#184) — the scheduling view in the paper & olive
 * grammar, the Android sibling of the web's calendar
 * (apps/web/src/components/tasks/views/calendar-view.tsx):
 *
 *  - ONE month paper card (r22): month title + chevron nav, Mon..Sun column
 *    heads (the web grid runs Sun..Sat; mobile uses the ISO week), day cells
 *    with up to three task dots colored by done state (lime = done, ink =
 *    open), today ringed, adjacent-month days muted but live.
 *  - Tapping a day selects it and lists that day's tasks below the grid as
 *    standard task rows (the list view's [TaskListRow]); each opens the task
 *    detail, and the done ring writes through the same derived-done path.
 *  - Data is GET /v1/tasks with due_after/due_before spanning the visible
 *    week-aligned grid, pages drained so no dated task past page one drops
 *    off the grid. A due window is an explicit param, so the route's
 *    Open·Mine default is off and BOTH statuses arrive in one due-sorted
 *    query (exactly the web's fetch).
 *  - Filters: the assignee dimension (tab's Mine/All baseline, the assignee
 *    chip, the unassigned chip) and the title search ride the FETCH; the
 *    status tabs (Open/Done) and the due chips are applied CLIENT-SIDE over
 *    the month rows — the month window already owns due_after/due_before, so
 *    a due chip narrows within it (the web instead drops status + overdue on
 *    its calendar; applying them locally keeps every visible pill honest).
 *  - Undated tasks can never match a due window, so the quiet
 *    "N without a due date" line (the map view's unlocated-count grammar) is
 *    counted client-side from the scope's statusless arms, capped.
 *
 * Cache-first (#176): one snapshot per (companyId, month, assignee scope, q),
 * so a revisit paints from cache in the first frame while the month
 * revalidates silently; the skeleton grid can only ever appear on the true
 * first fetch of a month. Status tab and due chip flips reuse the SAME
 * snapshot (they are client-side), so they repaint instantly with no fetch.
 */

/** The cached month aggregate: dated rows in the visible grid + the undated count. */
internal data class TaskCalendarSnapshot(
    val rows: List<Task>,
    val undatedOpen: Int,
    val undatedDone: Int,
    /** True when the undated count hit its page cap (render "N+"). */
    val undatedTruncated: Boolean,
)

/** Monday on/before the 1st — DayOfWeek.value is Mon=1..Sun=7. */
internal fun calendarGridStart(month: YearMonth): LocalDate {
    val first = month.atDay(1)
    return first.minusDays((first.dayOfWeek.value - 1).toLong())
}

/** Sunday on/after the last day of the month. */
internal fun calendarGridEnd(month: YearMonth): LocalDate {
    val last = month.atEndOfMonth()
    return last.plusDays(7L - last.dayOfWeek.value)
}

/**
 * The tab's assignee baseline for the calendar fetch, the same collapse the
 * web's toTaskFilters applies once its calendar strips status: Open/Mine/Done
 * pin `me`, All means every assignee, and the chips override.
 */
internal fun taskCalendarBaseAssignee(
    tab: TasksTabKind,
    assigneeChip: String?,
    unassignedChip: Boolean,
): String? = when {
    assigneeChip != null -> assigneeChip
    unassignedChip -> null
    tab == TasksTabKind.All -> ASSIGNEE_ALL
    else -> ASSIGNEE_ME
}

/**
 * Calendar filterKey for [CacheKeys.tasks]: always "cal|…"-prefixed so month
 * snapshots (their own value type) never collide with list/board entries and
 * never claim the warmer's "default". Status tab and due chip are absent on
 * purpose — they filter client-side, so every tab/chip flip reuses one entry.
 */
internal fun taskCalendarFilterKey(
    month: YearMonth,
    baseAssignee: String?,
    unassigned: Boolean,
    q: String?,
): String = listOf(
    "cal",
    month.toString(),
    baseAssignee ?: "-",
    if (unassigned) "unassigned" else "-",
    "q=${q.orEmpty()}",
).joinToString("|")

/** Does [task] pass the status dimension of [tab]? (Client-side on the grid.) */
internal fun matchesCalendarTab(task: Task, tab: TasksTabKind): Boolean = when (tab) {
    TasksTabKind.Open -> !task.done
    TasksTabKind.Done -> task.done
    else -> true
}

/**
 * Does [task] pass the due chip? Client-side sibling of [dueChipFilters] so a
 * chip narrows the month grid without re-fetching (the month window already
 * owns the query's due params).
 */
internal fun matchesDueChip(
    task: Task,
    chip: DueChip?,
    clock: Clock = Clock.systemDefaultZone(),
): Boolean {
    if (chip == null) return true
    if (chip == DueChip.Overdue) return isOverdue(task, clock)
    val due = parseInstant(task.due_at) ?: return false
    val start = LocalDate.now(clock).atStartOfDay(clock.zone)
    val end = if (chip == DueChip.Today) start.plusDays(1) else start.plusDays(7)
    return !due.isBefore(start.toInstant()) && due.isBefore(end.toInstant())
}

/**
 * Drain the month window (dated rows) and count the scope's undated tasks.
 * Fresh loaders per fetch — a cursor never crosses filter sets/orderings.
 * The route has no undated filter, so the count walks the statusless arms
 * client-side with a hard page cap; [TaskCalendarSnapshot.undatedTruncated]
 * keeps the line honest when the cap is hit.
 */
internal suspend fun fetchTaskCalendarSnapshot(
    mutations: TaskMutations,
    companyId: String,
    monthArm: TaskListFilters,
    undatedArms: List<TaskListFilters>,
): TaskCalendarSnapshot {
    val monthLoader = TaskListLoader(mutations, companyId, listOf(monthArm), limit = 100)
    val rows = mutableListOf<Task>()
    var pages = 0
    do {
        rows += monthLoader.nextPage()
        pages++
    } while (monthLoader.hasMore && pages < 12)

    val undatedLoader = TaskListLoader(mutations, companyId, undatedArms, limit = 100)
    var undatedOpen = 0
    var undatedDone = 0
    pages = 0
    do {
        undatedLoader.nextPage().forEach { task ->
            if (task.due_at == null) {
                if (task.done) undatedDone++ else undatedOpen++
            }
        }
        pages++
    } while (undatedLoader.hasMore && pages < 10)

    return TaskCalendarSnapshot(
        rows = rows,
        undatedOpen = undatedOpen,
        undatedDone = undatedDone,
        undatedTruncated = undatedLoader.hasMore,
    )
}

@Composable
internal fun TaskCalendarView(
    cache: StoreCache,
    mutations: TaskMutations,
    companyId: String,
    tab: TasksTabKind,
    assigneeChip: String?,
    unassignedChip: Boolean,
    dueChip: DueChip?,
    q: String?,
    refreshKey: Int,
    memberName: (String?) -> String?,
    onOpenTask: (String) -> Unit,
    onToggleDone: (Task, Boolean) -> Unit,
    modifier: Modifier = Modifier,
) {
    val zone = remember { ZoneId.systemDefault() }
    val haptics = rememberHaptics()

    // Month + selected day survive detail round-trips exactly like the view
    // choice (founder mandate): both persist by STRING through rememberSaveable
    // and re-parse defensively.
    var monthKey by rememberSaveable(companyId) { mutableStateOf(YearMonth.now().toString()) }
    val month = remember(monthKey) {
        runCatching { YearMonth.parse(monthKey) }.getOrDefault(YearMonth.now())
    }
    var selectedKey by rememberSaveable(companyId) {
        mutableStateOf<String?>(LocalDate.now().toString())
    }
    val selectedDay = remember(selectedKey) {
        selectedKey?.let { runCatching { LocalDate.parse(it) }.getOrNull() }
    }
    var localRefresh by remember(companyId) { mutableIntStateOf(0) }

    val gridStart = remember(month) { calendarGridStart(month) }
    val gridEnd = remember(month) { calendarGridEnd(month) }
    val weeks = remember(month) {
        generateSequence(calendarGridStart(month)) { it.plusDays(1) }
            .takeWhile { !it.isAfter(calendarGridEnd(month)) }
            .toList()
            .chunked(7)
    }

    fun stepMonth(delta: Long) {
        haptics.tap()
        val next = month.plusMonths(delta)
        monthKey = next.toString()
        // A selection that scrolled out of the visible grid quietly clears —
        // its day list would otherwise show data the grid no longer explains.
        val sel = selectedDay
        if (sel != null &&
            (sel.isBefore(calendarGridStart(next)) || sel.isAfter(calendarGridEnd(next)))
        ) {
            selectedKey = null
        }
    }

    val query = q?.trim()?.ifEmpty { null }
    val baseAssignee = taskCalendarBaseAssignee(tab, assigneeChip, unassignedChip)
    val unassigned = unassignedChip && assigneeChip == null
    val cacheKey = CacheKeys.tasks(
        companyId,
        taskCalendarFilterKey(month, baseAssignee, unassigned, query),
    )
    val state = rememberCacheFirst(
        cache = cache,
        key = cacheKey,
        refreshKey = refreshKey + localRefresh,
    ) {
        fetchTaskCalendarSnapshot(
            mutations = mutations,
            companyId = companyId,
            monthArm = TaskListFilters(
                assignedUserId = baseAssignee,
                unassigned = unassigned,
                dueAfter = isoAtStartOfDay(gridStart, zone),
                // Exclusive end, one past the last grid day (the web's
                // addDays(gridEnd, 1)).
                dueBefore = isoAtStartOfDay(gridEnd.plusDays(1), zone),
                q = query,
            ),
            undatedArms = taskListArms(
                tab = if (tab == TasksTabKind.All) TasksTabKind.All else TasksTabKind.Mine,
                assigneeUserId = assigneeChip,
                unassigned = unassignedChip,
                due = null,
                q = query,
            ),
        )
    }

    when (val current = state) {
        is LoadState.Loading -> TaskCalendarSkeleton(modifier)
        is LoadState.Failed -> CenteredError(
            current.message,
            onRetry = { localRefresh++ },
            modifier = modifier,
        )

        is LoadState.Ready -> {
            val snapshot = current.value
            // The client-side dimensions: status tab + due chip narrow the one
            // cached month payload, so flipping them repaints with no fetch.
            val visibleRows = remember(snapshot, tab, dueChip) {
                snapshot.rows.filter { task ->
                    matchesCalendarTab(task, tab) && matchesDueChip(task, dueChip)
                }
            }
            val byDay = remember(visibleRows) {
                visibleRows.groupBy { task ->
                    parseInstant(task.due_at)?.atZone(zone)?.toLocalDate()
                }
            }
            val undatedCount = when (tab) {
                TasksTabKind.Open -> snapshot.undatedOpen
                TasksTabKind.Done -> snapshot.undatedDone
                else -> snapshot.undatedOpen + snapshot.undatedDone
            }
            val today = LocalDate.now()
            val dayTasks = selectedDay?.let { byDay[it] }.orEmpty()
            val selectionVisible = selectedDay != null &&
                !selectedDay.isBefore(gridStart) && !selectedDay.isAfter(gridEnd)

            LazyColumn(
                modifier.fillMaxSize(),
                contentPadding = PaddingValues(bottom = 24.dp),
            ) {
                item(key = "cal-grid") {
                    Column(
                        Modifier
                            .padding(start = 18.dp, end = 18.dp, top = 4.dp)
                            .fillMaxWidth()
                            .clip(RoundedCornerShape(22.dp))
                            .background(MaterialTheme.colorScheme.surface),
                    ) {
                        MonthNavRow(
                            month = month,
                            isCurrentMonth = month == YearMonth.now(),
                            onPrevious = { stepMonth(-1) },
                            onNext = { stepMonth(1) },
                            onToday = {
                                haptics.tap()
                                monthKey = YearMonth.now().toString()
                                selectedKey = LocalDate.now().toString()
                            },
                        )
                        WeekdayHeads()
                        RowDivider(Modifier.padding(horizontal = 12.dp))
                        weeks.forEach { week ->
                            Row(Modifier.padding(horizontal = 8.dp)) {
                                week.forEach { day ->
                                    DayCell(
                                        day = day,
                                        inMonth = YearMonth.from(day) == month,
                                        today = day == today,
                                        selected = day == selectedDay,
                                        tasks = byDay[day].orEmpty(),
                                        onClick = {
                                            haptics.tick()
                                            selectedKey =
                                                if (day == selectedDay) null
                                                else day.toString()
                                        },
                                        modifier = Modifier.weight(1f),
                                    )
                                }
                            }
                        }
                        Spacer(Modifier.height(6.dp))
                    }
                }

                if (visibleRows.isEmpty()) {
                    // Teach the calendar rather than leave it reading as
                    // broken (the web's empty-range card).
                    item(key = "cal-teach") {
                        Column(
                            Modifier
                                .padding(start = 18.dp, end = 18.dp, top = 10.dp)
                                .fillMaxWidth()
                                .clip(RoundedCornerShape(22.dp))
                                .background(MaterialTheme.colorScheme.surface)
                                .padding(horizontal = 16.dp, vertical = 14.dp),
                        ) {
                            Text(
                                "Nothing is scheduled in this range. A task appears " +
                                    "here once it has a due date. Set one from the " +
                                    "task's detail screen.",
                                fontSize = 12.5.sp,
                                lineHeight = 18.sp,
                                textAlign = TextAlign.Center,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                                modifier = Modifier.fillMaxWidth(),
                            )
                        }
                    }
                }

                if (visibleRows.isNotEmpty() || undatedCount > 0) {
                    // The quiet counts line — the map view's "N without a
                    // location" grammar, for due dates.
                    item(key = "cal-counts") {
                        val undatedText =
                            if (snapshot.undatedTruncated) "$undatedCount+" else "$undatedCount"
                        Text(
                            when {
                                visibleRows.isNotEmpty() && undatedCount > 0 ->
                                    "${visibleRows.size} scheduled · $undatedText without a due date"
                                visibleRows.isNotEmpty() -> "${visibleRows.size} scheduled"
                                else -> "$undatedText without a due date"
                            },
                            fontSize = 11.5.sp,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                            modifier = Modifier.padding(start = 24.dp, end = 24.dp, top = 10.dp),
                        )
                    }
                }

                if (selectionVisible && selectedDay != null) {
                    item(key = "day-hdr") {
                        SectionHeader(
                            dayHeadingLabel(selectedDay),
                            Modifier.padding(start = 18.dp, top = 14.dp),
                            count = dayTasks.size,
                        )
                    }
                    if (dayTasks.isEmpty()) {
                        item(key = "day-empty") {
                            Text(
                                "Nothing due this day.",
                                fontSize = 12.sp,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                                modifier = Modifier.padding(horizontal = 24.dp),
                            )
                        }
                    } else {
                        // The selected day's tasks as standard rows fused into
                        // one paper card — the list view's row, the same
                        // derived-done write path behind the ring. (Swipe
                        // shortcuts stay a List-view affordance, like Board.)
                        itemsIndexed(
                            dayTasks,
                            key = { _, task -> "day-${task.id}" },
                        ) { index, task ->
                            Column(
                                Modifier
                                    .animateItem()
                                    .padding(horizontal = 18.dp)
                                    .clip(cardGroupShape(index, dayTasks.size))
                                    .background(MaterialTheme.colorScheme.surface),
                            ) {
                                TaskListRow(
                                    task = task,
                                    assigneeName = memberName(task.assigned_user_id),
                                    onClick = { onOpenTask(task.id) },
                                    onToggleDone = { done -> onToggleDone(task, done) },
                                )
                                if (index < dayTasks.lastIndex) RowDivider()
                            }
                        }
                    }
                }
            }
        }
    }
}

/** Month title flanked by chevrons, plus a quiet Today jump when off-month. */
@Composable
private fun MonthNavRow(
    month: YearMonth,
    isCurrentMonth: Boolean,
    onPrevious: () -> Unit,
    onNext: () -> Unit,
    onToday: () -> Unit,
) {
    Row(
        Modifier
            .fillMaxWidth()
            .padding(start = 6.dp, end = 6.dp, top = 6.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        IconButton(onClick = onPrevious) {
            Icon(
                Icons.AutoMirrored.Outlined.KeyboardArrowLeft,
                contentDescription = "Previous month",
                tint = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.size(20.dp),
            )
        }
        Text(
            month.format(MONTH_TITLE),
            modifier = Modifier.weight(1f),
            textAlign = TextAlign.Center,
            fontSize = 14.5.sp,
            fontWeight = FontWeight.SemiBold,
            color = MaterialTheme.colorScheme.onSurface,
            maxLines = 1,
        )
        if (!isCurrentMonth) {
            TextButton(onClick = onToday) {
                Text("Today", fontSize = 12.sp, fontWeight = FontWeight.SemiBold)
            }
        }
        IconButton(onClick = onNext) {
            Icon(
                Icons.AutoMirrored.Outlined.KeyboardArrowRight,
                contentDescription = "Next month",
                tint = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.size(20.dp),
            )
        }
    }
}

@Composable
private fun WeekdayHeads() {
    Row(Modifier.padding(horizontal = 10.dp, vertical = 4.dp)) {
        WEEKDAY_HEADS.forEach { head ->
            Text(
                head.uppercase(),
                modifier = Modifier.weight(1f),
                textAlign = TextAlign.Center,
                fontSize = 9.5.sp,
                fontWeight = FontWeight.Bold,
                color = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.7f),
                maxLines = 1,
            )
        }
    }
}

/**
 * One day cell: the number (today ringed in ink, the selected day filled on
 * the avatar tint, adjacent-month days muted) over up to three task dots —
 * lime for done, ink for open.
 */
@Composable
private fun DayCell(
    day: LocalDate,
    inMonth: Boolean,
    today: Boolean,
    selected: Boolean,
    tasks: List<Task>,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val taskWord = if (tasks.size == 1) "task" else "tasks"
    val label = "${day.format(CELL_A11Y_DATE)}, ${tasks.size} $taskWord"
    Column(
        modifier
            .clip(RoundedCornerShape(12.dp))
            .clickable(onClick = onClick)
            .semantics { contentDescription = label }
            .padding(top = 5.dp, bottom = 4.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Box(
            Modifier
                .size(27.dp)
                .then(
                    if (selected) {
                        Modifier.background(
                            MaterialTheme.colorScheme.secondaryContainer,
                            CircleShape,
                        )
                    } else {
                        Modifier
                    },
                )
                .then(
                    if (today) {
                        Modifier.border(
                            1.5.dp,
                            MaterialTheme.colorScheme.primary,
                            CircleShape,
                        )
                    } else {
                        Modifier
                    },
                ),
            contentAlignment = Alignment.Center,
        ) {
            Text(
                day.dayOfMonth.toString(),
                fontSize = 12.5.sp,
                fontWeight = if (today || selected) FontWeight.SemiBold else FontWeight.Normal,
                color = when {
                    selected -> MaterialTheme.colorScheme.onSecondaryContainer
                    !inMonth -> MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.45f)
                    else -> MaterialTheme.colorScheme.onSurface
                },
                maxLines = 1,
            )
        }
        Spacer(Modifier.height(4.dp))
        Row(
            Modifier.height(5.dp),
            horizontalArrangement = Arrangement.spacedBy(3.dp),
        ) {
            tasks.take(3).forEach { task ->
                Box(
                    Modifier
                        .size(5.dp)
                        .background(
                            if (task.done) MaterialTheme.colorScheme.tertiary
                            else MaterialTheme.colorScheme.primary,
                            CircleShape,
                        ),
                )
            }
        }
    }
}

/**
 * First-fetch stand-in in the grid grammar: a month-title stub over six weeks
 * of shimmering day circles inside one paper card. With cache-first (#176)
 * this can only ever appear once per month key per process.
 */
@Composable
private fun TaskCalendarSkeleton(modifier: Modifier = Modifier) {
    Column(
        modifier
            .fillMaxSize()
            .padding(horizontal = 18.dp),
    ) {
        Column(
            Modifier
                .padding(top = 4.dp)
                .fillMaxWidth()
                .clip(RoundedCornerShape(22.dp))
                .background(MaterialTheme.colorScheme.surface)
                .padding(vertical = 14.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            SkeletonBlock(112.dp, 12.dp)
            Spacer(Modifier.height(14.dp))
            repeat(6) {
                Row(
                    Modifier
                        .fillMaxWidth()
                        .padding(horizontal = 14.dp, vertical = 5.dp),
                    horizontalArrangement = Arrangement.SpaceBetween,
                ) {
                    repeat(7) {
                        SkeletonBlock(26.dp, 26.dp, shape = CircleShape)
                    }
                }
            }
        }
    }
}

/** "Today" / "Tomorrow" / "Tue Jul 28" (+year off-year) for the day header. */
private fun dayHeadingLabel(
    date: LocalDate,
    clock: Clock = Clock.systemDefaultZone(),
): String {
    val today = LocalDate.now(clock)
    return when (date) {
        today -> "Today"
        today.plusDays(1) -> "Tomorrow"
        else -> date.format(
            DateTimeFormatter.ofPattern(
                if (date.year == today.year) "EEE MMM d" else "EEE MMM d yyyy",
            ),
        )
    }
}

/** Local midnight as the offset-bearing ISO the route expects. */
private fun isoAtStartOfDay(date: LocalDate, zone: ZoneId): String =
    date.atStartOfDay(zone).toOffsetDateTime().format(DateTimeFormatter.ISO_OFFSET_DATE_TIME)

private val MONTH_TITLE = DateTimeFormatter.ofPattern("MMMM yyyy")
private val CELL_A11Y_DATE = DateTimeFormatter.ofPattern("MMMM d")
private val WEEKDAY_HEADS = listOf("Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun")
