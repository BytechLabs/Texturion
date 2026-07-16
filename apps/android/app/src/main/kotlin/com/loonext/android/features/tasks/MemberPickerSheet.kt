package com.loonext.android.features.tasks

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Check
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.loonext.android.core.model.Member
import com.loonext.android.ui.common.InitialsAvatar

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

    ModalBottomSheet(onDismissRequest = onDismiss) {
        Column(Modifier.fillMaxWidth()) {
            OutlinedTextField(
                value = query,
                onValueChange = { query = it },
                label = { Text("Search teammates") },
                singleLine = true,
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 16.dp, vertical = 8.dp),
            )
            LazyColumn(Modifier.fillMaxWidth()) {
                if (showUnassigned && query.isBlank()) {
                    item(key = "unassigned") {
                        PickerRow(
                            name = "Unassigned",
                            avatarName = null,
                            selected = selectedUserId == null,
                            onClick = { onPick(null) },
                        )
                    }
                }
                items(matches, key = { it.user_id }) { member ->
                    PickerRow(
                        name = member.display_name.ifBlank { "Teammate" } +
                            if (member.user_id == meUserId) " (you)" else "",
                        avatarName = member.display_name.ifBlank { null },
                        selected = selectedUserId == member.user_id,
                        onClick = { onPick(member.user_id) },
                    )
                }
                if (matches.isEmpty()) {
                    item(key = "empty") {
                        Text(
                            "No teammates match.",
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
) {
    Row(
        Modifier
            .fillMaxWidth()
            .clickable(onClick = onClick)
            .padding(horizontal = 16.dp, vertical = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        if (avatarName != null) {
            InitialsAvatar(avatarName, size = 32.dp)
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
                Icons.Filled.Check,
                contentDescription = "Selected",
                tint = MaterialTheme.colorScheme.primary,
            )
        }
    }
    HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
}
