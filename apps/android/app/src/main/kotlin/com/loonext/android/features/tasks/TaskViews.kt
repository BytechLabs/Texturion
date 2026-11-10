package com.loonext.android.features.tasks

import com.loonext.android.core.model.Task
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull

/**
 * #689 G and #690: saved views for the Tasks screen, on top of the plumbing the
 * inbox already uses (`features/inbox/SavedViews.kt`, surface "tasks").
 *
 * The tasks half of `packages/shared/src/saved-views.ts` decides what a view may
 * hold; [sanitizeTaskFilters] is its hand port, key for key. A view stores the
 * QUERY, never the result, so number access applies per viewer when it opens.
 *
 * What a view cannot hold, and so what is deliberately not saved:
 *  - the Today and This week chips. Their windows are absolute times, and a view
 *    saved on Monday would quietly show Monday's week on Friday. Overdue is a
 *    flag the server computes, so it is kept.
 *  - search text and cursors (the shared header says why).
 */
private val UUID_RE =
    Regex("^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$")
private val ISO_RE = Regex("""^\d{4}-\d{2}-\d{2}(T[\d:.]+(Z|[+-]\d{2}:\d{2}))?$""")
private val SORTS = setOf("created", "due", "priority", "updated")
private val SOURCES = setOf("text", "call", "none")
private val GROUPS = setOf("status", "assignee", "priority")

private fun JsonObject.str(key: String): String? =
    (this[key] as? JsonPrimitive)?.let { if (it.isString) it.contentOrNull else null }

private fun JsonObject.flag(key: String): Boolean =
    (this[key] as? JsonPrimitive)?.let { if (it.isString) null else it.booleanOrNull } == true

/** Keep only the task filters the list understands, with values it accepts. */
fun sanitizeTaskFilters(raw: JsonObject): JsonObject {
    val out = mutableMapOf<String, JsonElement>()
    for ((key, value) in raw) {
        val primitive = value as? JsonPrimitive
        val text = primitive?.let { if (it.isString) it.contentOrNull else null }
        val bool = primitive?.let { if (it.isString) null else it.booleanOrNull }
        val keep: Boolean = when (key) {
            "status" -> text == "open" || text == "done"
            "assigned_user_id", "tag_id", "contact_id", "conversation_id" ->
                text != null && UUID_RE.matches(text)

            "unassigned", "overdue", "has_location", "has_attachments", "has_references" -> bool != null
            "due_before", "due_after" -> text != null && ISO_RE.matches(text)
            "priority" -> text != null && text.isNotEmpty() &&
                text.split(",").all { it in TaskPriority.PICKER }

            "sort" -> text != null && text in SORTS
            "created_by" -> text != null && (text == "me" || UUID_RE.matches(text))
            "source" -> text != null && text in SOURCES
            "group" -> text != null && text in GROUPS
            else -> false
        }
        if (keep) out[key] = value
    }
    return JsonObject(out)
}

/** The Tasks screen's controls as one value: what a view sets, and what saving reads. */
data class TaskViewState(
    val tab: TasksTabKind,
    /** A member id, [ASSIGNEE_ALL] for "anyone", or null for the tab's own pin. */
    val assigneeChip: String?,
    val unassigned: Boolean,
    val dueChip: DueChip?,
    val extra: TaskExtraFilters,
)

/**
 * A view's stored filters as the Tasks screen's controls.
 *
 * The tab is read back from the request the view stands for: `status` picks
 * Open or Done, and with neither the person's own tasks are Mine while a view
 * with no assignee at all is All. "Mine" is stored as the saver's own id, so
 * opening it as that person is exact and as anyone else is their colleague's.
 */
fun taskViewToState(filters: JsonObject, meUserId: String): TaskViewState {
    val clean = sanitizeTaskFilters(filters)
    val status = clean.str("status")
    val assignee = clean.str("assigned_user_id")
    val unassigned = clean.flag("unassigned")
    val mine = assignee != null && assignee.equals(meUserId, ignoreCase = true)
    val tab = when (status) {
        "open" -> TasksTabKind.Open
        "done" -> TasksTabKind.Done
        else -> if (assignee == null && !unassigned) TasksTabKind.All else TasksTabKind.Mine
    }
    val chip = when {
        unassigned -> null
        assignee == null -> if (status != null) ASSIGNEE_ALL else null
        mine -> null
        else -> assignee
    }
    val dueChip = if (clean.flag("overdue")) DueChip.Overdue else null
    val extra = TaskExtraFilters(
        priorities = clean.str("priority")?.split(",")?.toSet().orEmpty(),
        tagId = clean.str("tag_id"),
        sort = TaskSort.entries.firstOrNull { it.wire == clean.str("sort") } ?: TaskSort.Created,
        contactId = clean.str("contact_id"),
        createdBy = clean.str("created_by"),
        source = clean.str("source"),
        hasAttachments = clean.flag("has_attachments"),
        hasReferences = clean.flag("has_references"),
        dueAfter = if (dueChip == null) clean.str("due_after") else null,
        dueBefore = if (dueChip == null) clean.str("due_before") else null,
        group = TaskGroup.entries.firstOrNull { it.wire == clean.str("group") } ?: TaskGroup.Status,
    )
    return TaskViewState(tab, chip, unassigned && chip == null, dueChip, extra)
}

/** The Tasks screen's controls as a view would store them. */
fun taskStateToView(state: TaskViewState, meUserId: String): JsonObject {
    val extra = state.extra
    val assignee: String? = when {
        state.unassigned -> null
        state.assigneeChip == ASSIGNEE_ALL -> null
        state.assigneeChip != null -> state.assigneeChip
        state.tab == TasksTabKind.All -> null
        else -> meUserId
    }
    val raw = buildJsonObject {
        when (state.tab) {
            TasksTabKind.Open -> put("status", JsonPrimitive("open"))
            TasksTabKind.Done -> put("status", JsonPrimitive("done"))
            else -> Unit
        }
        assignee?.let { put("assigned_user_id", JsonPrimitive(it)) }
        if (state.unassigned) put("unassigned", JsonPrimitive(true))
        if (state.dueChip == DueChip.Overdue) put("overdue", JsonPrimitive(true))
        if (state.dueChip == null) {
            extra.dueAfter?.let { put("due_after", JsonPrimitive(it)) }
            extra.dueBefore?.let { put("due_before", JsonPrimitive(it)) }
        }
        if (extra.priorities.isNotEmpty()) {
            put("priority", JsonPrimitive(TaskPriority.PICKER.filter { it in extra.priorities }.joinToString(",")))
        }
        extra.tagId?.let { put("tag_id", JsonPrimitive(it)) }
        extra.sort.wire?.let { put("sort", JsonPrimitive(it)) }
        extra.contactId?.let { put("contact_id", JsonPrimitive(it)) }
        extra.createdBy?.let { put("created_by", JsonPrimitive(it)) }
        extra.source?.let { put("source", JsonPrimitive(it)) }
        if (extra.hasAttachments) put("has_attachments", JsonPrimitive(true))
        if (extra.hasReferences) put("has_references", JsonPrimitive(true))
        if (extra.group != TaskGroup.Status) put("group", JsonPrimitive(extra.group.wire))
    }
    return sanitizeTaskFilters(raw)
}

/** Is this view the arrangement currently on screen? */
fun taskViewMatches(filters: JsonObject, state: TaskViewState, meUserId: String): Boolean =
    sanitizeTaskFilters(filters) == taskStateToView(state, meUserId) &&
        // A view for an empty arrangement is never "the one open".
        sanitizeTaskFilters(filters).isNotEmpty()

/** One section of a grouped list or one column of a grouped board. */
data class TaskBucket(
    val id: String,
    /** A catalogue key when the heading is a word we own; null when [name] is a person. */
    val labelKey: String?,
    val name: String?,
    val tasks: List<Task>,
)

/**
 * Split tasks by the chosen key, keeping their order inside each bucket.
 *
 * Priority runs most pressing first; assignee runs by first name with
 * "nobody" last; status is left to the caller (To do, then Done).
 */
fun bucketTasks(tasks: List<Task>, group: TaskGroup, nameOf: (Task) -> String?): List<TaskBucket> =
    when (group) {
        TaskGroup.Status -> listOf(
            TaskBucket("todo", "contactsTasks.columnToDo", null, tasks.filter { !it.done }),
            TaskBucket("done", "contactsTasks.columnDone", null, tasks.filter { it.done }),
        )

        TaskGroup.Priority -> TaskPriority.PICKER.map { p ->
            TaskBucket(p, TaskPriority.labelKey(p), null, tasks.filter { TaskPriority.normalize(it.priority) == p })
        }

        TaskGroup.Assignee -> {
            val firstId = { task: Task -> task.assigneeIdList.firstOrNull() }
            val people = tasks.mapNotNull(firstId).distinct()
            val named = people.map { id ->
                val mine = tasks.filter { firstId(it) == id }
                val name = nameOf(mine.first())
                TaskBucket(id, if (name == null) "contactsTasks.teammate" else null, name, mine)
            }.sortedBy { it.name.orEmpty().lowercase() }
            named + TaskBucket("nobody", "taskViews.noAssignee", null, tasks.filter { firstId(it) == null })
        }
    }.filter { it.tasks.isNotEmpty() }

/** The saved-views surface this screen reads and writes. */
const val TASKS_SURFACE = "tasks"

/**
 * A name for the view about to be saved, from what is filtered. Never empty for
 * a filtered list, so saving is one tap: the person already said what the view
 * is by building it.
 */
fun suggestTaskViewName(
    state: TaskViewState,
    tagName: String?,
    contactName: String?,
    say: (key: String) -> String,
): String {
    val parts = mutableListOf<String>()
    parts += say(state.tab.labelKey)
    if (state.dueChip != null) parts += say(state.dueChip.labelKey)
    if (state.unassigned) parts += say("contactsTasks.unassigned")
    tagName?.let { parts += it }
    contactName?.let { parts += it }
    state.extra.priorities.takeIf { it.size == 1 }?.let { parts += say(TaskPriority.labelKey(it.first())) }
    // A middot, not a dash: rendered copy carries no em or en dashes.
    return parts.joinToString(" · ")
}
