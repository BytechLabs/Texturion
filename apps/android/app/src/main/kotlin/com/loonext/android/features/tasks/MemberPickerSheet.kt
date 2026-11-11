package com.loonext.android.features.tasks

import androidx.compose.foundation.clickable
import com.loonext.android.ui.common.SearchField
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Check
import androidx.compose.material3.Button
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.loonext.android.core.i18n.t
import com.loonext.android.core.model.Member
import com.loonext.android.ui.common.AppSheet

/**
 * cmdk-style member picker: a bottom sheet with a search field over the
 * active members (GET /v1/members), a "(you)" marker, and an optional
 * Unassigned entry. Callers own the fetch — the sheet is pure UI.
 */
@Composable
fun MemberPickerSheet(
    members: List<Member>,
    meUserId: String,
    selectedUserId: String?,
    showUnassigned: Boolean,
    onPick: (userId: String?) -> Unit,
    onDismiss: () -> Unit,
) {
    var query by remember { mutableStateOf("") }
    val active = members.filter { it.deactivated_at == null }
    val matches = if (query.isBlank()) active
    else active.filter { it.display_name.contains(query.trim(), ignoreCase = true) }

    AppSheet(onDismissRequest = onDismiss) {
        Column(Modifier.fillMaxWidth()) {
            SearchField(
                value = query,
                onValueChange = { query = it },
                placeholder = t("contactsTasks.searchTeammates"),
                modifier = Modifier.padding(horizontal = 18.dp, vertical = 8.dp),
            )
            LazyColumn(Modifier.fillMaxWidth()) {
                if (showUnassigned && query.isBlank()) {
                    item(key = "unassigned") {
                        PickerRow(
                            name = t("contactsTasks.unassigned"),
                            avatarName = null,
                            selected = selectedUserId == null,
                            onClick = { onPick(null) },
                        )
                    }
                }
                items(matches, key = { it.user_id }) { member ->
                    PickerRow(
                        name = member.display_name.ifBlank { t("contactsTasks.teammate") } +
                            if (member.user_id == meUserId) t("contactsTasks.youSuffix") else "",
                        avatarName = member.display_name.ifBlank { null },
                        selected = selectedUserId == member.user_id,
                        onClick = { onPick(member.user_id) },
                    )
                }
                if (matches.isEmpty()) {
                    item(key = "empty") {
                        Text(
                            t("contactsTasks.noTeammatesMatch"),
                            style = MaterialTheme.typography.bodyMedium,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                            modifier = Modifier.padding(16.dp),
                        )
                    }
                }
                item(key = "bottom-space") { Spacer(Modifier.height(24.dp)) }
            }
        }
    }
}

@Composable
private fun PickerRow(
    name: String,
    avatarName: String?,
    selected: Boolean,
    onClick: () -> Unit,
    role: Role? = null,
) {
    Row(
        Modifier
            .fillMaxWidth()
            .heightIn(min = 48.dp)
            .clickable(role = role, onClick = onClick)
            .padding(horizontal = 16.dp, vertical = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        if (avatarName != null) {
            TaskAvatar(avatarName, size = 32.dp, fontSize = 11.sp)
        } else {
            Box(Modifier.width(32.dp))
        }
        Spacer(Modifier.width(12.dp))
        Text(
            name,
            style = MaterialTheme.typography.bodyLarge,
            modifier = Modifier.weight(1f),
        )
        if (selected) {
            Icon(
                Icons.Outlined.Check,
                contentDescription = t("contactsTasks.selected"),
                tint = MaterialTheme.colorScheme.secondary,
            )
        }
    }
    HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
}

/**
 * #689 C: the multi-select twin of [MemberPickerSheet]. Tapping a person ticks
 * or unticks them; nothing is written until Apply. [selected] is the starting
 * crew in order (first assignee first). Past [max] a tap is refused and the
 * limit said out loud; [allowEmpty] lets Apply mean "nobody" (the detail
 * screen), where the bulk bar needs at least one person.
 */
@Composable
fun MultiMemberPickerSheet(
    members: List<Member>,
    meUserId: String,
    selected: List<String>,
    allowEmpty: Boolean,
    onApply: (userIds: List<String>) -> Unit,
    onDismiss: () -> Unit,
    max: Int = MAX_TASK_ASSIGNEES,
) {
    var query by remember { mutableStateOf("") }
    var picked by remember { mutableStateOf(selected) }
    var capHit by remember { mutableStateOf(false) }
    val active = members.filter { it.deactivated_at == null }
    val matches = if (query.isBlank()) active
    else active.filter { it.display_name.contains(query.trim(), ignoreCase = true) }

    AppSheet(onDismissRequest = onDismiss) {
        Column(Modifier.fillMaxWidth()) {
            SearchField(
                value = query,
                onValueChange = { query = it },
                placeholder = t("contactsTasks.searchTeammates"),
                modifier = Modifier.padding(horizontal = 18.dp, vertical = 8.dp),
            )
            LazyColumn(Modifier.weight(1f, fill = false)) {
                items(matches, key = { it.user_id }) { member ->
                    PickerRow(
                        name = member.display_name.ifBlank { t("contactsTasks.teammate") } +
                            if (member.user_id == meUserId) t("contactsTasks.youSuffix") else "",
                        avatarName = member.display_name.ifBlank { null },
                        selected = member.user_id in picked,
                        role = Role.Checkbox,
                        onClick = {
                            val next = toggleAssignee(picked, member.user_id, max)
                            if (next == null) {
                                capHit = true
                            } else {
                                capHit = false
                                picked = next
                            }
                        },
                    )
                }
                if (matches.isEmpty()) {
                    item(key = "empty") {
                        Text(
                            t("contactsTasks.noTeammatesMatch"),
                            style = MaterialTheme.typography.bodyMedium,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                            modifier = Modifier.padding(16.dp),
                        )
                    }
                }
            }
            Row(
                Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 18.dp, vertical = 12.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(
                    if (capHit) {
                        t("contactsTasks.assigneesMax", "max" to "$max")
                    } else {
                        t(
                            "contactsTasks.assigneesCount",
                            "count" to "${picked.size}",
                            "max" to "$max",
                        )
                    },
                    style = MaterialTheme.typography.bodyMedium,
                    color = if (capHit) MaterialTheme.colorScheme.error
                    else MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.weight(1f),
                )
                Button(
                    onClick = { onApply(picked) },
                    enabled = allowEmpty || picked.isNotEmpty(),
                    modifier = Modifier.heightIn(min = 48.dp),
                ) { Text(t("contactsTasks.assigneesApply")) }
            }
        }
    }
}
