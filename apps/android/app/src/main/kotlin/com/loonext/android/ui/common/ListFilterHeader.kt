package com.loonext.android.ui.common

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.background
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.layout.Column
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Check
import androidx.compose.material.icons.outlined.Close
import androidx.compose.material.icons.outlined.Star
import androidx.compose.material.icons.outlined.Tune
import androidx.compose.material.icons.outlined.Bookmarks
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.loonext.android.core.i18n.t

/**
 * #711: the header every filterable list shares. One row under the search box:
 * the list's own status tabs on the left, then the Filter button and the Views
 * menu. The applied filters show as removable chips only while any is on.
 *
 * Applying: Zen of Clarity (secondary actions live in two controls and a menu),
 * Chunking (one control per concept) and the Safety principle (the inbox, Tasks
 * and Contacts lists all read the same).
 */

/** One saved view in the Views menu. */
data class ViewsMenuEntry(
    val id: String,
    val name: String,
    /** The queue badge, or null where the surface has none. */
    val count: Int? = null,
    val shared: Boolean = false,
    val isDefault: Boolean = false,
)

/** What the Views menu needs from a list. A list with no saved views passes null. */
class ListViews(
    val entries: List<ViewsMenuEntry>,
    /** The saved view the filters on screen equal, if any. */
    val activeId: String?,
    /** True only when something is filtered and no saved view matches it. */
    val canSaveCurrent: Boolean,
    /** Sharing a view is workspace configuration, so it rides the capability the server gates it on. */
    val canShare: Boolean,
    val onApply: (id: String) -> Unit,
    val onSaveCurrent: () -> Unit,
    val onDefault: (id: String?) -> Unit,
    val onRename: (id: String, name: String) -> Unit,
    val onShare: (id: String, shared: Boolean) -> Unit,
    val onDelete: (id: String) -> Unit,
)

/**
 * The one row: [tabs] (a list's status pills, scrollable), then Filter, then
 * Views. [views] is null for a list that has no saved views.
 */
@Composable
fun ListFilterRow(
    filterCount: Int,
    onFilter: () -> Unit,
    modifier: Modifier = Modifier,
    views: ListViews? = null,
    tabs: @Composable RowScope.() -> Unit = {},
) {
    Row(
        modifier.fillMaxWidth(),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        // Weighted, so the two controls are measured first and keep their size.
        Row(
            Modifier
                .weight(1f)
                .horizontalScroll(rememberScrollState()),
            horizontalArrangement = Arrangement.spacedBy(7.dp),
            verticalAlignment = Alignment.CenterVertically,
            content = tabs,
        )
        Spacer(Modifier.width(6.dp))
        ListFilterButton(count = filterCount, onClick = onFilter)
        if (views != null) {
            Spacer(Modifier.width(2.dp))
            ListViewsMenu(views)
        }
    }
}

/** The Filter button: an icon that says how many filters are on. */
@Composable
fun ListFilterButton(count: Int, onClick: () -> Unit) {
    val haptics = rememberHaptics()
    val name = if (count > 0) {
        t("inbox.filterActionCount", "count" to count.toString())
    } else {
        t("inbox.filterAction")
    }
    Box {
        Surface(
            onClick = {
                haptics.tap()
                onClick()
            },
            shape = CircleShape,
            color = MaterialTheme.colorScheme.surface,
            contentColor = MaterialTheme.colorScheme.onSurface,
            modifier = Modifier
                .touchTarget()
                .asButton()
                .semantics { contentDescription = name },
        ) {
            Icon(
                Icons.Outlined.Tune,
                contentDescription = null,
                modifier = Modifier.padding(horizontal = 12.dp, vertical = 10.dp).size(18.dp),
            )
        }
        if (count > 0) {
            CountPill(
                count,
                tone = CountPillTone.Primary,
                size = CountPillSize.Small,
                modifier = Modifier.align(Alignment.TopEnd).offset(x = (-2).dp, y = 4.dp),
            )
        }
    }
}

/**
 * The Views menu: the saved views, "Save these filters as a view…" only when
 * the filters on screen match no saved view, and "Manage views".
 */
@Composable
fun ListViewsMenu(views: ListViews) {
    val haptics = rememberHaptics()
    var open by remember { mutableStateOf(false) }
    var managing by remember { mutableStateOf(false) }
    val active = views.entries.firstOrNull { it.id == views.activeId }
    val name = t("inbox.viewsMenuAria", "current" to (active?.name ?: t("inbox.viewsMenu")))
    Box {
        Surface(
            onClick = {
                haptics.tap()
                open = true
            },
            shape = CircleShape,
            color = if (active != null) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.surface,
            contentColor = if (active != null) {
                MaterialTheme.colorScheme.onPrimary
            } else {
                MaterialTheme.colorScheme.onSurface
            },
            modifier = Modifier
                .touchTarget()
                .asButton()
                .semantics { contentDescription = name },
        ) {
            Box(Modifier.padding(horizontal = 12.dp, vertical = 10.dp)) {
                Icon(Icons.Outlined.Bookmarks, contentDescription = null, modifier = Modifier.size(18.dp))
            }
        }
        DropdownMenu(expanded = open, onDismissRequest = { open = false }) {
            if (views.entries.isEmpty() && !views.canSaveCurrent) {
                DropdownMenuItem(
                    text = { Text(t("taskViews.viewsNone")) },
                    enabled = false,
                    onClick = {},
                )
            }
            views.entries.forEach { entry ->
                DropdownMenuItem(
                    text = {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Text(
                                entry.name,
                                maxLines = 1,
                                overflow = TextOverflow.Ellipsis,
                                modifier = Modifier.weight(1f, fill = false),
                            )
                            if (entry.count != null && entry.count > 0) {
                                Spacer(Modifier.width(8.dp))
                                CountPill(entry.count)
                            }
                        }
                    },
                    leadingIcon = if (entry.isDefault) {
                        { Icon(Icons.Outlined.Star, contentDescription = null, modifier = Modifier.size(16.dp)) }
                    } else {
                        null
                    },
                    trailingIcon = if (entry.id == views.activeId) {
                        { Icon(Icons.Outlined.Check, contentDescription = null, modifier = Modifier.size(16.dp)) }
                    } else {
                        null
                    },
                    onClick = {
                        open = false
                        views.onApply(entry.id)
                    },
                )
            }
            if (views.canSaveCurrent || views.entries.isNotEmpty()) HorizontalDivider()
            if (views.canSaveCurrent) {
                DropdownMenuItem(
                    text = { Text(t("inbox.viewsSaveCurrent")) },
                    onClick = {
                        open = false
                        views.onSaveCurrent()
                    },
                )
            }
            if (views.entries.isNotEmpty()) {
                DropdownMenuItem(
                    text = { Text(t("inbox.viewsManage")) },
                    onClick = {
                        open = false
                        managing = true
                    },
                )
            }
        }
    }
    if (managing) {
        ManageViewsSheet(views = views, onDismiss = { managing = false })
    }
}

/**
 * Manage views: set the default, rename, share with the crew and delete. A view
 * the crew shares is not the person's to change unless they can manage the
 * workspace, and deleting one asks first because the rest of the crew opens it.
 */
@Composable
private fun ManageViewsSheet(views: ListViews, onDismiss: () -> Unit) {
    var renaming by remember { mutableStateOf<ViewsMenuEntry?>(null) }
    var deleting by remember { mutableStateOf<ViewsMenuEntry?>(null) }
    AppSheet(onDismissRequest = onDismiss) {
        Column(
            Modifier
                .fillMaxWidth()
                .verticalScroll(rememberScrollState())
                .padding(start = 20.dp, end = 20.dp, bottom = 22.dp),
        ) {
            Text(
                t("inbox.viewsManage"),
                style = MaterialTheme.typography.headlineMedium.copy(fontSize = 21.sp),
                color = MaterialTheme.colorScheme.onBackground,
            )
            views.entries.forEach { entry ->
                val canManage = !entry.shared || views.canShare
                Column(Modifier.padding(top = 14.dp)) {
                    Text(
                        entry.name,
                        style = MaterialTheme.typography.titleSmall,
                        color = MaterialTheme.colorScheme.onSurface,
                    )
                    Row(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                        TextButton(onClick = {
                            views.onDefault(if (entry.isDefault) null else entry.id)
                        }) {
                            Text(
                                if (entry.isDefault) {
                                    t("inbox.viewStopOpeningHere")
                                } else {
                                    t("inbox.viewOpenHereByDefault")
                                },
                                style = MaterialTheme.typography.labelLarge,
                            )
                        }
                        if (canManage) {
                            TextButton(onClick = { renaming = entry }) {
                                Text(t("inbox.viewRename"), style = MaterialTheme.typography.labelLarge)
                            }
                        }
                    }
                    if (canManage) {
                        Row(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                            if (views.canShare) {
                                TextButton(onClick = { views.onShare(entry.id, !entry.shared) }) {
                                    Text(
                                        if (entry.shared) {
                                            t("inbox.viewMakeMine")
                                        } else {
                                            t("inbox.viewShareWithCrew")
                                        },
                                        style = MaterialTheme.typography.labelLarge,
                                    )
                                }
                            }
                            TextButton(onClick = {
                                if (entry.shared) {
                                    deleting = entry
                                } else {
                                    views.onDelete(entry.id)
                                }
                            }) {
                                Text(
                                    t("common.delete"),
                                    style = MaterialTheme.typography.labelLarge,
                                    color = MaterialTheme.colorScheme.error,
                                )
                            }
                        }
                    }
                    HorizontalDivider(Modifier.padding(top = 6.dp))
                }
            }
        }
    }
    renaming?.let { entry ->
        var draft by remember(entry.id) { mutableStateOf(entry.name) }
        AlertDialog(
            onDismissRequest = { renaming = null },
            title = { Text(t("inbox.viewRenameTitle")) },
            text = {
                OutlinedTextField(
                    value = draft,
                    onValueChange = { if (it.length <= 60) draft = it },
                    label = { Text(t("inbox.viewNameLabel")) },
                    singleLine = true,
                )
            },
            confirmButton = {
                TextButton(enabled = draft.isNotBlank(), onClick = {
                    views.onRename(entry.id, draft)
                    renaming = null
                }) { Text(t("common.save")) }
            },
            dismissButton = { TextButton(onClick = { renaming = null }) { Text(t("common.cancel")) } },
        )
    }
    deleting?.let { entry ->
        ConfirmDialog(
            title = t("inbox.viewDeleteTitle"),
            body = t("inbox.viewDeleteBody", "name" to entry.name),
            confirmLabel = t("inbox.viewDeleteConfirm"),
            onConfirm = {
                views.onDelete(entry.id)
                deleting = null
            },
            onDismiss = {
                deleting = null
            },
            dismissLabel = t("inbox.viewDeleteKeep"),
        )
    }
}

/** One applied filter, removable. */
data class ActiveFilterChip(val label: String, val onRemove: () -> Unit)

/**
 * The applied filters as one scrolling line of removable chips with "Clear all".
 * Nothing renders while no filter is applied.
 */
@Composable
fun ActiveFilterChips(
    chips: List<ActiveFilterChip>,
    onClearAll: () -> Unit,
    modifier: Modifier = Modifier,
) {
    if (chips.isEmpty()) return
    val haptics = rememberHaptics()
    Row(
        modifier
            .fillMaxWidth()
            .horizontalScroll(rememberScrollState()),
        horizontalArrangement = Arrangement.spacedBy(6.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        chips.forEach { chip ->
            val removeName = t("inbox.removeFilterAria", "label" to chip.label)
            Surface(
                onClick = {
                    haptics.tap()
                    chip.onRemove()
                },
                shape = CircleShape,
                color = MaterialTheme.colorScheme.surface,
                contentColor = MaterialTheme.colorScheme.onSurface,
                border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant),
                modifier = Modifier
                    .touchTarget()
                    .asButton()
                    .semantics { contentDescription = removeName },
            ) {
                Row(
                    Modifier.padding(start = 12.dp, end = 8.dp, top = 8.dp, bottom = 8.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(6.dp),
                ) {
                    Text(
                        chip.label,
                        style = MaterialTheme.typography.labelLarge.copy(fontSize = 12.sp),
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )
                    Icon(Icons.Outlined.Close, contentDescription = null, modifier = Modifier.size(14.dp))
                }
            }
        }
        TextButton(onClick = {
            haptics.tap()
            onClearAll()
        }) {
            Text(t("inbox.clearAll"), style = MaterialTheme.typography.labelLarge)
        }
    }
}
