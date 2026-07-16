package com.loonext.android.features.tasks

import java.time.Clock
import java.time.LocalDate
import java.time.ZonedDateTime
import java.time.format.DateTimeFormatter

/**
 * The /v1/tasks filter model, ported from apps/web/src/lib/api/task-params.ts
 * and task-view-url.ts so the two clients never drift on the route's frozen
 * semantics:
 *
 *  - NO params at all silently means status=open + assignee=me ("what needs
 *    me now"); ANY explicit filter param disables BOTH defaults.
 *  - "all" is UI sugar: the assignee pin is dropped, and when no other
 *    explicit param would survive, a `status=open` sentinel is injected so the
 *    route's Open·Mine default is not re-applied.
 *  - Cursors come in TWO incompatible orderings — due-sorted (when overdue /
 *    due_before / due_after is present) vs created-sorted — and a cursor
 *    minted for one ordering is a 422 on the other. [orderingKey] is the
 *    client-side guard: a pager may only reuse a cursor while the key (and
 *    the rest of the params) is unchanged.
 */

/** Marker the server resolves to the caller (the route accepts the literal). */
const val ASSIGNEE_ME = "me"

/** UI sugar for "every assignee" — normalized away by [taskQueryParams]. */
const val ASSIGNEE_ALL = "all"

object TaskStatus {
    const val OPEN = "open"
    const val DONE = "done"
}

/** The segmented tabs, mirroring the web /tasks page. */
enum class TasksTabKind(val label: String) {
    Open("Open"), Mine("Mine"), All("All"), Done("Done")
}

/** The due filter chip (single-select, mirrors DUE_LABELS on the web). */
enum class DueChip(val label: String) {
    Overdue("Overdue"), Today("Due today"), Week("Due this week")
}

/** One GET /v1/tasks query, pre-serialization. All fields optional. */
data class TaskListFilters(
    val status: String? = null,
    /** [ASSIGNEE_ME], a concrete user id, or [ASSIGNEE_ALL] (the sugar). */
    val assignedUserId: String? = null,
    val unassigned: Boolean = false,
    val conversationId: String? = null,
    val dueBefore: String? = null,
    val dueAfter: String? = null,
    val overdue: Boolean = false,
    val q: String? = null,
)

/**
 * Serialize filters to the GET /v1/tasks query params — the Kotlin port of
 * the web's `taskSearchParams` (apps/web/src/lib/api/task-params.ts). Nulls
 * are dropped by ApiClient; booleans are sent only when true.
 */
fun taskQueryParams(
    filters: TaskListFilters,
    cursor: String? = null,
    limit: Int = 25,
): Map<String, String?> {
    val explicitAll = filters.assignedUserId == ASSIGNEE_ALL

    // "All" needs (1) no assignee pin and (2) at least one explicit param so
    // the frozen route's Open·Mine default is not re-applied. `status=open` is
    // the only opt-out that keeps the query semantically clean, injected only
    // when no other explicit filter is already the opt-out.
    val needsAllSentinel = explicitAll &&
        filters.status == null &&
        !filters.overdue &&
        filters.conversationId == null &&
        filters.dueBefore == null &&
        filters.dueAfter == null &&
        filters.q == null &&
        !filters.unassigned
    val status = filters.status ?: if (needsAllSentinel) TaskStatus.OPEN else null

    return mapOf(
        "status" to status,
        "assigned_user_id" to if (explicitAll) null else filters.assignedUserId,
        "unassigned" to if (filters.unassigned) "true" else null,
        "conversation_id" to filters.conversationId,
        "due_before" to filters.dueBefore,
        "due_after" to filters.dueAfter,
        "overdue" to if (filters.overdue) "true" else null,
        "q" to filters.q,
        "cursor" to cursor,
        "limit" to limit.toString(),
    )
}

/**
 * Which cursor ordering a filter set produces. A cursor may ONLY be passed
 * back with params whose ordering key (and content) match the page that
 * minted it — the route 422s on a cursor from the other ordering.
 */
fun orderingKey(filters: TaskListFilters): String =
    if (filters.overdue || filters.dueBefore != null || filters.dueAfter != null) "due"
    else "created"

/**
 * The due chip → ISO window mapping (web's dueRange). Today = [start of
 * today, +1 day); This week = [start of today, +7 days); Overdue = the
 * dedicated flag (past-due AND not done, server-side).
 */
fun dueChipFilters(chip: DueChip, clock: Clock = Clock.systemDefaultZone()): TaskListFilters {
    if (chip == DueChip.Overdue) return TaskListFilters(overdue = true)
    val start = LocalDate.now(clock).atStartOfDay(clock.zone)
    val end = if (chip == DueChip.Today) start.plusDays(1) else start.plusDays(7)
    val fmt = DateTimeFormatter.ISO_OFFSET_DATE_TIME
    fun ZonedDateTime.iso(): String = toOffsetDateTime().format(fmt)
    return TaskListFilters(dueAfter = start.iso(), dueBefore = end.iso())
}

/**
 * The whole tab + chips + search state of the tasks screen, resolved to the
 * one-or-two status-scoped queries ("arms") the list/board runs.
 *
 * Tab → baseline (web's toTaskFilters): Open = open+me, Mine = me (both
 * statuses), Done = done+me, All = every assignee. A specific-member assignee
 * chip overrides the tab's `me` pin; the unassigned chip is its own dimension
 * (the two are mutually exclusive in the UI). Chips for due/q refine every arm.
 *
 * There is NO all-statuses mode on the route, so statusless tabs (Mine / All)
 * become TWO arms — status=open then status=done — paginated sequentially
 * (open rows always list before done rows).
 */
fun taskListArms(
    tab: TasksTabKind,
    assigneeUserId: String?,
    unassigned: Boolean,
    due: DueChip?,
    q: String?,
    clock: Clock = Clock.systemDefaultZone(),
): List<TaskListFilters> {
    val dueFilters = due?.let { dueChipFilters(it, clock) } ?: TaskListFilters()
    val query = q?.trim()?.ifEmpty { null }

    val baseAssignee = when {
        assigneeUserId != null -> assigneeUserId
        unassigned -> null
        tab == TasksTabKind.All -> ASSIGNEE_ALL
        else -> ASSIGNEE_ME
    }

    fun arm(status: String): TaskListFilters = TaskListFilters(
        status = status,
        assignedUserId = baseAssignee,
        unassigned = unassigned && assigneeUserId == null,
        dueBefore = dueFilters.dueBefore,
        dueAfter = dueFilters.dueAfter,
        overdue = dueFilters.overdue,
        q = query,
    )

    return when (tab) {
        TasksTabKind.Open -> listOf(arm(TaskStatus.OPEN))
        TasksTabKind.Done -> listOf(arm(TaskStatus.DONE))
        // Statusless tabs: union open + done, open first.
        TasksTabKind.Mine, TasksTabKind.All ->
            listOf(arm(TaskStatus.OPEN), arm(TaskStatus.DONE))
    }
}
