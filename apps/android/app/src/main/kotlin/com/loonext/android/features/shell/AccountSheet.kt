package com.loonext.android.features.shell

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ContentCopy
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.SegmentedButton
import androidx.compose.material3.SegmentedButtonDefaults
import androidx.compose.material3.SingleChoiceSegmentedButtonRow
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.loonext.android.AppGraph
import com.loonext.android.core.model.Me
import com.loonext.android.core.model.NumberStatus
import com.loonext.android.ui.common.InitialsAvatar
import com.loonext.android.ui.common.formatPhone
import kotlinx.coroutines.launch

/**
 * The 'You' sheet (#100): workspace tile + copyable numbers, workspace
 * switcher (multi-membership only), theme, sign out. Contacts/Settings entries
 * land with their feature passes (#155/#157).
 */
@Composable
fun AccountSheet(
    graph: AppGraph,
    me: Me,
    companyId: String,
    unreadNotifications: Int,
    onOpenContacts: () -> Unit,
    onOpenNotifications: () -> Unit,
    onOpenSettings: () -> Unit,
    onSwitchWorkspace: (String) -> Unit,
    onSignOut: () -> Unit,
    onDismiss: () -> Unit,
) {
    val context = LocalContext.current
    val scope = androidx.compose.runtime.rememberCoroutineScope()
    val theme by graph.prefs.theme.collectAsStateWithLifecycle(initialValue = "system")
    val membership = me.memberships.firstOrNull { it.company_id == companyId }
    val company = me.company

    ModalBottomSheet(onDismissRequest = onDismiss) {
        Column(Modifier.padding(horizontal = 20.dp, vertical = 8.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                InitialsAvatar(me.display_name.ifBlank { null })
                Spacer(Modifier.width(12.dp))
                Column {
                    Text(
                        me.display_name.ifBlank { me.memberships.firstOrNull()?.name ?: "You" },
                        style = MaterialTheme.typography.titleMedium,
                    )
                    Text(
                        membership?.let { "${it.name} · ${it.role}" } ?: "",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }

            // Workspace numbers with copy buttons.
            val activeNumbers = company?.numbers
                ?.filter { it.status == NumberStatus.ACTIVE && it.number_e164 != null }
                .orEmpty()
            if (activeNumbers.isNotEmpty()) {
                Spacer(Modifier.height(12.dp))
                activeNumbers.forEach { number ->
                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        modifier = Modifier.fillMaxWidth(),
                    ) {
                        Text(
                            formatPhone(number.number_e164),
                            style = MaterialTheme.typography.bodyLarge,
                            modifier = Modifier.weight(1f),
                        )
                        IconButton(onClick = { copy(context, number.number_e164!!) }) {
                            Icon(
                                Icons.Filled.ContentCopy,
                                contentDescription = "Copy number",
                            )
                        }
                    }
                }
            }

            // Workspace switcher only when >1 membership.
            if (me.memberships.size > 1) {
                Spacer(Modifier.height(8.dp))
                HorizontalDivider()
                Text(
                    "Workspaces",
                    style = MaterialTheme.typography.titleSmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.padding(vertical = 8.dp),
                )
                me.memberships.forEach { m ->
                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        modifier = Modifier
                            .fillMaxWidth()
                            .clickable(enabled = m.company_id != companyId) {
                                onSwitchWorkspace(m.company_id)
                                onDismiss()
                            }
                            .padding(vertical = 8.dp),
                    ) {
                        InitialsAvatar(m.name, size = 30.dp)
                        Spacer(Modifier.width(10.dp))
                        Text(
                            m.name,
                            style = MaterialTheme.typography.bodyLarge,
                            modifier = Modifier.weight(1f),
                        )
                        if (m.company_id == companyId) {
                            Text(
                                "Current",
                                style = MaterialTheme.typography.labelSmall,
                                color = MaterialTheme.colorScheme.primary,
                            )
                        }
                    }
                }
            }

            Spacer(Modifier.height(8.dp))
            HorizontalDivider()
            SheetLink("Contacts") {
                onOpenContacts()
                onDismiss()
            }
            SheetLink(
                if (unreadNotifications > 0) {
                    "Notifications ($unreadNotifications new)"
                } else {
                    "Notifications"
                },
            ) {
                onOpenNotifications()
                onDismiss()
            }
            SheetLink("Settings") {
                onOpenSettings()
                onDismiss()
            }

            Spacer(Modifier.height(8.dp))
            HorizontalDivider()
            Text(
                "Theme",
                style = MaterialTheme.typography.titleSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.padding(vertical = 8.dp),
            )
            SingleChoiceSegmentedButtonRow(Modifier.fillMaxWidth()) {
                listOf("system" to "System", "light" to "Light", "dark" to "Dark")
                    .forEachIndexed { index, (value, label) ->
                        SegmentedButton(
                            selected = theme == value,
                            onClick = { scope.launch { graph.prefs.setTheme(value) } },
                            shape = SegmentedButtonDefaults.itemShape(index = index, count = 3),
                        ) { Text(label) }
                    }
            }

            Spacer(Modifier.height(12.dp))
            HorizontalDivider()
            TextButton(
                onClick = {
                    onSignOut()
                    onDismiss()
                },
            ) { Text("Sign out", color = MaterialTheme.colorScheme.error) }
            Spacer(Modifier.height(20.dp))
        }
    }
}

@Composable
private fun SheetLink(label: String, onClick: () -> Unit) {
    Text(
        label,
        style = MaterialTheme.typography.bodyLarge,
        modifier = Modifier
            .fillMaxWidth()
            .clickable(onClick = onClick)
            .padding(vertical = 12.dp),
    )
}

private fun copy(context: Context, text: String) {
    val clipboard = context.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
    clipboard.setPrimaryClip(ClipData.newPlainText("Phone number", text))
}
