package com.loonext.android.features.tasks

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.selection.toggleable
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.loonext.android.core.i18n.t
import com.loonext.android.core.model.ContactSummary
import com.loonext.android.core.model.Member
import com.loonext.android.core.model.Tag
import com.loonext.android.features.inbox.SAVED_VIEW_NAME_MAX
import com.loonext.android.features.inbox.SavedView
import com.loonext.android.ui.common.AppSheet
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.delay

private const val CONTACT_SEARCH_DEBOUNCE_MS = 200L

/** The names the Filters sheet shows for ids it only holds. */
data class FilterNames(val contact: String? = null, val tag: String? = null)

/**
 * The ONE Filters control (#689 G): everything that narrows the task list, in a
 * bottom sheet, each change applied at once. The rail keeps the status tabs, a
 * Filters pill with a count, the sort and the views switcher.
 *
 * Applying: Zen of Clarity (secondary filters leave the rail for one sheet) and
 * Chunking (rows are grouped as who, when, what, where from).
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
internal fun TaskFiltersSheet(
    state: TaskViewState,
    names: FilterNames,
    members: List<Member>,
    meUserId: String,
    companyId: String,
    repo: ReferenceRepository,
    loadTags: suspend () -> List<Tag>,
    /** Rows that only the list and the board honour (priority, label, customer, source and the rest). */
    showAdvanced: Boolean,
    /** The map takes no due filter. */
    showDue: Boolean,
    showGroup: Boolean,
    onChange: (TaskViewState, FilterNames) -> Unit,
    onClearAll: () -> Unit,
    onDismiss: () -> Unit,
) {
    var assigneeOpen by remember { mutableStateOf(false) }
    var priorityOpen by remember { mutableStateOf(false) }
    var labelOpen by remember { mutableStateOf(false) }
    var contactOpen by remember { mutableStateOf(false) }
    var createdByOpen by remember { mutableStateOf(false) }
    val extra = state.extra
    val youLabel = t("contactsTasks.you")
    val anyoneLabel = t("taskViews.anyone")
    val teammateLabel = t("contactsTasks.teammate")

    fun nameOf(id: String?): String = when (id) {
        null -> anyoneLabel
        ASSIGNEE_ALL -> anyoneLabel
        "me", meUserId -> youLabel
        else -> members.firstOrNull { it.user_id == id }?.display_name?.ifBlank { null }
            ?: teammateLabel
    }

    fun change(next: TaskViewState, newNames: FilterNames = names) = onChange(next, newNames)

    AppSheet(onDismissRequest = onDismiss) {
        Column(
            Modifier
                .fillMaxWidth()
                .verticalScroll(rememberScrollState())
                .padding(bottom = 24.dp),
        ) {
            Row(
                Modifier.fillMaxWidth().padding(start = 18.dp, end = 8.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(
                    t("taskViews.filtersTitle"),
                    style = MaterialTheme.typography.titleMedium,
                    modifier = Modifier.weight(1f),
                )
                TextButton(onClick = onClearAll) { Text(t("taskViews.clearAll")) }
                TextButton(onClick = onDismiss) { Text(t("taskViews.done")) }
            }

            val assigneeValue = when {
                state.unassigned -> t("contactsTasks.unassigned")
                state.assigneeChip != null -> nameOf(state.assigneeChip)
                state.tab == TasksTabKind.All -> anyoneLabel
                else -> youLabel
            }
            FilterRow(t("contactsTasks.assignee"), assigneeValue) { assigneeOpen = true }
            SwitchRow(t("contactsTasks.unassigned"), state.unassigned) { on ->
                change(state.copy(unassigned = on, assigneeChip = if (on) null else state.assigneeChip))
            }

            if (showDue) {
                ChipsRow(t("taskViews.due")) {
                    FilterPill(
                        text = t("taskViews.dueAny"),
                        selected = state.dueChip == null && extra.dueAfter == null && extra.dueBefore == null,
                        onClick = {
                            change(state.copy(dueChip = null, extra = extra.copy(dueAfter = null, dueBefore = null)))
                        },
                    )
                    DueChip.entries.forEach { chip ->
                        FilterPill(
                            text = t(chip.labelKey),
                            selected = state.dueChip == chip,
                            onClick = {
                                change(
                                    state.copy(
                                        dueChip = if (state.dueChip == chip) null else chip,
                                        extra = extra.copy(dueAfter = null, dueBefore = null),
                                    ),
                                )
                            },
                        )
                    }
                    if (extra.dueAfter != null || extra.dueBefore != null) {
                        FilterPill(
                            text = t("taskViews.dueCustom"),
                            selected = true,
                            onClick = { change(state.copy(extra = extra.copy(dueAfter = null, dueBefore = null))) },
                        )
                    }
                }
            }

            if (showAdvanced) {
                FilterRow(
                    t("contactsTasks.priority"),
                    when (extra.priorities.size) {
                        0 -> t("taskViews.any")
                        1 -> t(TaskPriority.labelKey(extra.priorities.first()))
                        else -> t("contactsTasks.priorityMany", "count" to "${extra.priorities.size}")
                    },
                ) { priorityOpen = true }
                FilterRow(t("contactsTasks.label"), names.tag ?: t("taskViews.any")) { labelOpen = true }
                FilterRow(t("taskViews.customer"), names.contact ?: t("taskViews.any")) { contactOpen = true }
                FilterRow(
                    t("taskViews.createdBy"),
                    if (extra.createdBy == null) anyoneLabel else nameOf(extra.createdBy),
                ) { createdByOpen = true }
                ChipsRow(t("taskViews.source")) {
                    listOf(
                        null to "taskViews.any",
                        "text" to "taskViews.sourceText",
                        "call" to "taskViews.sourceCall",
                        "none" to "taskViews.sourceNone",
                    ).forEach { (wire, key) ->
                        FilterPill(
                            text = t(key),
                            selected = extra.source == wire,
                            onClick = { change(state.copy(extra = extra.copy(source = wire))) },
                        )
                    }
                }
                SwitchRow(t("taskViews.hasFiles"), extra.hasAttachments) { on ->
                    change(state.copy(extra = extra.copy(hasAttachments = on)))
                }
                SwitchRow(t("taskViews.hasLinks"), extra.hasReferences) { on ->
                    change(state.copy(extra = extra.copy(hasReferences = on)))
                }
            }

            if (showGroup) {
                ChipsRow(t("taskViews.groupBy")) {
                    TaskGroup.entries.forEach { group ->
                        FilterPill(
                            text = t(group.labelKey),
                            selected = extra.group == group,
                            onClick = { change(state.copy(extra = extra.copy(group = group))) },
                        )
                    }
                }
            }
        }
    }

    if (assigneeOpen) {
        val people = members.filter { it.deactivated_at == null && it.user_id != meUserId }
        val current = state.assigneeChip ?: if (state.tab == TasksTabKind.All) ASSIGNEE_ALL else meUserId
        OptionSheet(
            title = t("contactsTasks.assignee"),
            options = listOf(
                SheetOption(ASSIGNEE_ALL, anyoneLabel),
                SheetOption(meUserId, youLabel),
            ) + people.map { SheetOption(it.user_id, it.display_name.ifBlank { t("contactsTasks.teammate") }) },
            selected = setOf(current),
            onPick = { id ->
                assigneeOpen = false
                // The tab's own pin is the default, so picking it clears the chip.
                val pinned = if (state.tab == TasksTabKind.All) ASSIGNEE_ALL else meUserId
                change(state.copy(assigneeChip = id.takeUnless { it == pinned }, unassigned = false))
            },
            onDismiss = { assigneeOpen = false },
        )
    }
    if (priorityOpen) {
        OptionSheet(
            title = t("contactsTasks.priority"),
            options = TaskPriority.PICKER.map { SheetOption(it, t(TaskPriority.labelKey(it))) },
            selected = extra.priorities,
            onPick = { p ->
                val next = if (p in extra.priorities) extra.priorities - p else extra.priorities + p
                change(state.copy(extra = extra.copy(priorities = next)))
            },
            onDismiss = { priorityOpen = false },
        )
    }
    if (labelOpen) {
        TagChoiceSheet(
            title = t("contactsTasks.labels"),
            loadTags = loadTags,
            selectedId = extra.tagId,
            onPick = { tag ->
                labelOpen = false
                if (extra.tagId == tag.id) {
                    change(state.copy(extra = extra.copy(tagId = null)), names.copy(tag = null))
                } else {
                    change(state.copy(extra = extra.copy(tagId = tag.id)), names.copy(tag = tag.name))
                }
            },
            onDismiss = { labelOpen = false },
        )
    }
    if (contactOpen) {
        ContactPickerSheet(
            repo = repo,
            companyId = companyId,
            onPick = { contact ->
                contactOpen = false
                if (contact == null) {
                    change(state.copy(extra = extra.copy(contactId = null)), names.copy(contact = null))
                } else {
                    change(
                        state.copy(extra = extra.copy(contactId = contact.id)),
                        names.copy(contact = contact.name?.ifBlank { null } ?: contact.phone_e164),
                    )
                }
            },
            onDismiss = { contactOpen = false },
        )
    }
    if (createdByOpen) {
        val people = members.filter { it.deactivated_at == null && it.user_id != meUserId }
        OptionSheet(
            title = t("taskViews.createdBy"),
            options = listOf(
                SheetOption("anyone", anyoneLabel),
                SheetOption("me", youLabel),
            ) + people.map { SheetOption(it.user_id, it.display_name.ifBlank { t("contactsTasks.teammate") }) },
            selected = setOf(extra.createdBy ?: "anyone"),
            onPick = { id ->
                createdByOpen = false
                change(state.copy(extra = extra.copy(createdBy = id.takeUnless { it == "anyone" })))
            },
            onDismiss = { createdByOpen = false },
        )
    }
}

@Composable
private fun FilterRow(label: String, value: String, onClick: () -> Unit) {
    Row(
        Modifier
            .fillMaxWidth()
            .heightIn(min = 52.dp)
            .clickable(role = Role.Button, onClick = onClick)
            .padding(horizontal = 18.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Text(label, style = MaterialTheme.typography.bodyMedium, modifier = Modifier.weight(1f))
        Text(
            value,
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )
    }
}

@Composable
private fun SwitchRow(label: String, checked: Boolean, onChange: (Boolean) -> Unit) {
    Row(
        Modifier
            .fillMaxWidth()
            .heightIn(min = 52.dp)
            .toggleable(value = checked, role = Role.Switch, onValueChange = onChange)
            .padding(horizontal = 18.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(label, style = MaterialTheme.typography.bodyMedium, modifier = Modifier.weight(1f))
        Switch(checked = checked, onCheckedChange = null)
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun ChipsRow(label: String, content: @Composable () -> Unit) {
    Column(Modifier.fillMaxWidth().padding(horizontal = 18.dp, vertical = 8.dp)) {
        Text(
            label,
            style = MaterialTheme.typography.labelMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.padding(bottom = 6.dp),
        )
        FlowRow(
            horizontalArrangement = Arrangement.spacedBy(6.dp),
            verticalArrangement = Arrangement.spacedBy(6.dp),
        ) { content() }
    }
}

/** Pick one customer by name or number; a null pick clears the filter. */
@Composable
internal fun ContactPickerSheet(
    repo: ReferenceRepository,
    companyId: String,
    onPick: (ContactSummary?) -> Unit,
    onDismiss: () -> Unit,
) {
    var query by remember { mutableStateOf("") }
    var results by remember { mutableStateOf<List<ContactSummary>>(emptyList()) }
    LaunchedEffect(query) {
        if (query.isBlank()) {
            results = emptyList()
            return@LaunchedEffect
        }
        delay(CONTACT_SEARCH_DEBOUNCE_MS)
        try {
            results = repo.search(companyId, query, 10).contacts
        } catch (cancelled: CancellationException) {
            throw cancelled
        } catch (_: Exception) {
            results = emptyList()
        }
    }
    AppSheet(onDismissRequest = onDismiss) {
        Column(Modifier.fillMaxWidth().padding(horizontal = 18.dp)) {
            Text(t("taskViews.pickCustomer"), style = MaterialTheme.typography.titleMedium)
            OutlinedTextField(
                value = query,
                onValueChange = { query = it.take(80) },
                label = { Text(t("taskViews.searchCustomers")) },
                singleLine = true,
                modifier = Modifier.fillMaxWidth().padding(vertical = 10.dp),
            )
            Column(Modifier.heightIn(max = 320.dp).verticalScroll(rememberScrollState())) {
                TextButton(onClick = { onPick(null) }, modifier = Modifier.heightIn(min = 48.dp)) {
                    Text(t("taskViews.any"))
                }
                results.forEach { contact ->
                    Text(
                        contact.name?.ifBlank { null } ?: contact.phone_e164,
                        style = MaterialTheme.typography.bodyMedium,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                        modifier = Modifier
                            .fillMaxWidth()
                            .heightIn(min = 48.dp)
                            .clickable(role = Role.Button) { onPick(contact) }
                            .padding(vertical = 14.dp),
                    )
                }
            }
            Spacer(Modifier.height(16.dp))
        }
    }
}

/**
 * The compact views switcher (#689 G): one pill that names the view on screen,
 * and a menu holding the saved views, saving the current arrangement, and what
 * can be done to the one that is open.
 */
@Composable
internal fun TaskViewsControl(
    views: List<SavedView>,
    activeId: String?,
    defaultId: String?,
    canShare: Boolean,
    onApply: (SavedView) -> Unit,
    onSave: (name: String, shared: Boolean, done: (String?) -> Unit) -> Unit,
    onRename: (id: String, name: String) -> Unit,
    onDelete: (id: String) -> Unit,
    onDefault: (id: String?) -> Unit,
    suggestedName: String,
) {
    var menuOpen by remember { mutableStateOf(false) }
    var saveOpen by remember { mutableStateOf(false) }
    var renameOpen by remember { mutableStateOf(false) }
    var deleteOpen by remember { mutableStateOf(false) }
    val active = views.firstOrNull { it.id == activeId }

    Column {
        FilterPill(
            text = active?.name ?: t("taskViews.views"),
            selected = active != null,
            onClick = { menuOpen = true },
        )
        DropdownMenu(expanded = menuOpen, onDismissRequest = { menuOpen = false }) {
            if (views.isEmpty()) {
                DropdownMenuItem(text = { Text(t("taskViews.viewsNone")) }, enabled = false, onClick = {})
            }
            views.forEach { view ->
                DropdownMenuItem(
                    text = { Text(view.name, maxLines = 1, overflow = TextOverflow.Ellipsis) },
                    onClick = {
                        menuOpen = false
                        onApply(view)
                    },
                )
            }
            DropdownMenuItem(
                text = { Text(t("taskViews.viewsSave")) },
                onClick = {
                    menuOpen = false
                    saveOpen = true
                },
            )
            if (active != null) {
                val manage = !active.shared || canShare
                DropdownMenuItem(
                    text = {
                        Text(
                            if (active.id == defaultId) {
                                t("inbox.viewStopOpeningHere")
                            } else {
                                t("inbox.viewOpenHereByDefault")
                            },
                        )
                    },
                    onClick = {
                        menuOpen = false
                        onDefault(if (active.id == defaultId) null else active.id)
                    },
                )
                if (manage) {
                    DropdownMenuItem(
                        text = { Text(t("inbox.viewRename")) },
                        onClick = {
                            menuOpen = false
                            renameOpen = true
                        },
                    )
                    DropdownMenuItem(
                        text = { Text(t("taskViews.viewDelete")) },
                        onClick = {
                            menuOpen = false
                            if (active.shared) deleteOpen = true else onDelete(active.id)
                        },
                    )
                }
            }
        }
    }

    if (saveOpen) {
        var name by remember { mutableStateOf(suggestedName) }
        var shared by remember { mutableStateOf(false) }
        var error by remember { mutableStateOf<String?>(null) }
        var saving by remember { mutableStateOf(false) }
        AlertDialog(
            onDismissRequest = { saveOpen = false },
            title = { Text(t("taskViews.viewsSave")) },
            text = {
                Column {
                    Text(t("inbox.viewSaveDescription"), style = MaterialTheme.typography.bodyMedium)
                    OutlinedTextField(
                        value = name,
                        onValueChange = { if (it.length <= SAVED_VIEW_NAME_MAX) name = it },
                        label = { Text(t("inbox.viewNameLabel")) },
                        singleLine = true,
                        modifier = Modifier.fillMaxWidth().padding(top = 12.dp),
                    )
                    if (canShare) {
                        SwitchRow(t("inbox.viewShareToggle"), shared) { shared = it }
                        Text(t("inbox.viewShareNote"), style = MaterialTheme.typography.bodySmall)
                    }
                    error?.let {
                        Text(
                            it,
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.error,
                            modifier = Modifier.padding(top = 8.dp),
                        )
                    }
                }
            },
            confirmButton = {
                TextButton(
                    enabled = name.isNotBlank() && !saving,
                    onClick = {
                        saving = true
                        onSave(name, shared) { failure ->
                            saving = false
                            if (failure == null) saveOpen = false else error = failure
                        }
                    },
                ) { Text(if (saving) t("inbox.viewSaving") else t("common.save")) }
            },
            dismissButton = { TextButton(onClick = { saveOpen = false }) { Text(t("common.cancel")) } },
        )
    }
    if (renameOpen && active != null) {
        var draft by remember { mutableStateOf(active.name) }
        AlertDialog(
            onDismissRequest = { renameOpen = false },
            title = { Text(t("inbox.viewRenameTitle")) },
            text = {
                OutlinedTextField(
                    value = draft,
                    onValueChange = { if (it.length <= SAVED_VIEW_NAME_MAX) draft = it },
                    label = { Text(t("inbox.viewNameLabel")) },
                    singleLine = true,
                )
            },
            confirmButton = {
                TextButton(enabled = draft.isNotBlank(), onClick = {
                    renameOpen = false
                    onRename(active.id, draft)
                }) { Text(t("common.save")) }
            },
            dismissButton = { TextButton(onClick = { renameOpen = false }) { Text(t("common.cancel")) } },
        )
    }
    if (deleteOpen && active != null) {
        AlertDialog(
            onDismissRequest = { deleteOpen = false },
            title = { Text(t("inbox.viewDeleteTitle")) },
            text = { Text(t("taskViews.viewDeleteBody", "name" to active.name)) },
            confirmButton = {
                TextButton(onClick = {
                    deleteOpen = false
                    onDelete(active.id)
                }) { Text(t("inbox.viewDeleteConfirm")) }
            },
            dismissButton = { TextButton(onClick = { deleteOpen = false }) { Text(t("inbox.viewDeleteKeep")) } },
        )
    }
}
