package com.loonext.android.features.settings

import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.height
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.loonext.android.core.i18n.t
import com.loonext.android.core.model.CompanyView
import com.loonext.android.ui.common.userMessage
import kotlinx.coroutines.launch

/**
 * #406 — leaving a workspace yourself.
 *
 * Every membership action was something done TO a member and never BY one, so a
 * tech who quit on Friday still had the customer list on Monday: the app kept
 * working until the owner remembered to open settings. The person with the
 * strongest reason to sever the connection was the only one who could not.
 *
 * The phone is where this actually happens — the person leaving is a field
 * tech, not somebody at a desk.
 *
 * Deliberately not dressed as destruction: nothing is deleted, everything they
 * sent stays attributed to them, and the workspace carries on. It still
 * confirms, because one tap in a truck should not end somebody's access.
 */
@Composable
fun LeaveWorkspaceCard(
    scope: SettingsScope,
    company: CompanyView,
    onLeft: () -> Unit,
) {
    var confirming by remember { mutableStateOf(false) }
    var leaving by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    val coroutines = rememberCoroutineScope()

    SettingsCard(
        title = t("settings.leaveTitle"),
        description = t("settings.leaveIntro"),
    ) {
        ReadOnlyLine(t("settings.leaveAccessEnds"))
        ReadOnlyLine(t("settings.leaveWorkReturns"))
        ReadOnlyLine(t("settings.leaveHistoryStays"))
        ReadOnlyLine(t("settings.leaveComeBack"))
        InlineError(error)
        Spacer(Modifier.height(10.dp))
        OutlinedButton(onClick = { confirming = true }, enabled = !leaving) {
            Text(t("settings.leaveAction"))
        }
    }

    if (confirming) {
        AlertDialog(
            onDismissRequest = { if (!leaving) confirming = false },
            title = { Text(t("settings.leaveConfirmTitle", "workspace" to company.name)) },
            text = { Text(t("settings.leaveConfirmBody")) },
            confirmButton = {
                LinkButton(
                    onClick = {
                        error = null
                        leaving = true
                        coroutines.launch {
                            try {
                                scope.repo.leaveWorkspace(scope.companyId)
                                confirming = false
                                onLeft()
                            } catch (cause: Exception) {
                                error = cause.userMessage()
                                confirming = false
                            } finally {
                                leaving = false
                            }
                        }
                    },
                    enabled = !leaving,
                ) {
                    Text(
                        if (leaving) t("settings.leavePending") else t("settings.leaveAction"),
                    )
                }
            },
            dismissButton = {
                LinkButton(
                    onClick = { confirming = false },
                    enabled = !leaving,
                ) { Text(t("settings.leaveStay")) }
            },
        )
    }
}
