package com.loonext.android.features.settings

import androidx.compose.foundation.layout.padding
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.loonext.android.features.notifications.NotificationPrefsCard

/**
 * Notifications (#157): hosts #156's embeddable card — per-user email/push
 * toggles plus this device's push-permission state — and states the one
 * exception plainly: billing and registration emails always reach owners
 * and admins.
 */
@Composable
fun NotificationsSection(scope: SettingsScope) {
    NotificationPrefsCard(
        graph = scope.graph,
        companyId = scope.companyId,
        modifier = Modifier.padding(horizontal = 20.dp, vertical = 8.dp),
    )
    Text(
        "Billing, usage, and registration emails always go to owners and admins. " +
            "They can't be turned off.",
        style = MaterialTheme.typography.bodySmall,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
        modifier = Modifier.padding(horizontal = 20.dp, vertical = 10.dp),
    )
}
