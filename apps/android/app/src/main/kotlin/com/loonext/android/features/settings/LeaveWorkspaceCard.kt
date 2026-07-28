package com.loonext.android.features.settings

import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.height
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
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
        title = "Leave this workspace",
        description = "End your own access to this workspace. You can do this yourself — " +
            "you don't need to ask an owner.",
    ) {
        ReadOnlyLine("Your access ends straight away, on every device you're signed in on.")
        ReadOnlyLine(
            "Anything you were working on goes back to the team, so nothing is left " +
                "pointing at someone who has gone.",
        )
        ReadOnlyLine(
            "Messages you sent stay on the record under your name. Leaving doesn't " +
                "erase your work, and isn't meant to.",
        )
        ReadOnlyLine("To come back, someone in the workspace has to invite you again.")
        InlineError(error)
        Spacer(Modifier.height(10.dp))
        OutlinedButton(onClick = { confirming = true }, enabled = !leaving) {
            Text("Leave workspace")
        }
    }

    if (confirming) {
        AlertDialog(
            onDismissRequest = { if (!leaving) confirming = false },
            title = { Text("Leave ${company.name}?") },
            text = {
                Text(
                    "Your access ends now and your open work goes back to the team. " +
                        "To come back, someone will need to invite you again.",
                )
            },
            confirmButton = {
                TextButton(
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
                ) { Text(if (leaving) "Leaving…" else "Leave workspace") }
            },
            dismissButton = {
                TextButton(
                    onClick = { confirming = false },
                    enabled = !leaving,
                ) { Text("Stay") }
            },
        )
    }
}
