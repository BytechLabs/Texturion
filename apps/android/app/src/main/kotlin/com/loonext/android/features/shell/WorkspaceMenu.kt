package com.loonext.android.features.shell

import androidx.compose.foundation.layout.Box
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Business
import androidx.compose.material.icons.outlined.Check
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import com.loonext.android.core.i18n.t
import com.loonext.android.core.model.Membership
import com.loonext.android.ui.common.PaperIconButton

@Composable
internal fun WorkspaceMenu(
    memberships: List<Membership>,
    companyId: String,
    onSwitchWorkspace: (String) -> Unit,
) {
    if (memberships.size < 2) return
    var open by remember(companyId) { mutableStateOf(false) }
    Box {
        PaperIconButton(
            icon = Icons.Outlined.Business,
            contentDescription = t("shell.workspaces"),
            onClick = { open = true },
        )
        DropdownMenu(expanded = open, onDismissRequest = { open = false }) {
            memberships.forEach { membership ->
                val current = membership.company_id == companyId
                DropdownMenuItem(
                    text = { Text(membership.name) },
                    enabled = !current,
                    onClick = {
                        open = false
                        onSwitchWorkspace(membership.company_id)
                    },
                    trailingIcon = if (current) {
                        { Icon(Icons.Outlined.Check, contentDescription = t("shell.currentWorkspace")) }
                    } else {
                        null
                    },
                )
            }
        }
    }
}
