package com.loonext.android.features.settings

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
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
import kotlinx.coroutines.launch

/** What has to be typed. Fixed, unambiguous, and not a name we might change. */
private const val CONFIRM_WORD = "delete"

/**
 * #346 — deleting your own account, from the phone.
 *
 * Apple 5.1.1(v) and Play both require this, but the reason to build it well
 * is that a crew member who wants to leave has had no way to: closing a
 * workspace is the owner's alone, and being removed by somebody else is not
 * the same thing.
 *
 * The copy draws the line the server actually draws. Someone deleting their
 * account will assume their texts to customers go with them; they do not, they
 * cannot (that record belongs to the business, and part of it sits under a
 * legal retention floor), and discovering it afterwards would be a betrayal.
 * So it is said before the button, not after.
 */
@Composable
fun DeleteAccountCard(scope: SettingsScope, onDeleted: () -> Unit) {
    var expanded by remember { mutableStateOf(false) }
    var preview by remember { mutableStateOf<AccountDeletionPreview?>(null) }
    var loading by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    var confirming by remember { mutableStateOf(false) }
    var typed by remember { mutableStateOf("") }
    var deleting by remember { mutableStateOf(false) }
    val coroutines = rememberCoroutineScope()

    SettingsCard(
        title = "Delete your account",
        description = "Removes you from Loonext entirely. This cannot be undone.",
    ) {
        when {
            !expanded -> OutlinedButton(onClick = {
                expanded = true
                loading = true
                error = null
                coroutines.launch {
                    runCatching { scope.repo.accountDeletionPreview() }
                        .onSuccess { preview = it }
                        .onFailure { error = "Couldn't check your account. Try again in a moment." }
                    loading = false
                }
            }) { Text("Delete my account") }

            loading -> Text(
                "Checking your account…",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )

            error != null -> InlineError(error)

            preview?.blockedByOwnership == true -> Column {
                // Specific, not generic: there is no ownership transfer yet
                // (#332), so the way out has to be spelled out.
                Text(
                    "You own ${preview!!.owned_workspaces.joinToString { it.name }}. " +
                        "A workspace cannot be left without an owner, so hand it to " +
                        "someone else or close it first — then you can delete your account.",
                    style = MaterialTheme.typography.bodyMedium,
                )
                Spacer(Modifier.height(4.dp))
                Text(
                    "Closing a workspace is on the workspace settings screen.",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }

            else -> Column {
                Text(
                    "You are signed out everywhere and cannot sign back in. Your name " +
                        "comes off the app, and notifications stop.",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                preview?.let { current ->
                    if (current.memberships > 0) {
                        Spacer(Modifier.height(6.dp))
                        Text(
                            buildString {
                                append(
                                    if (current.memberships == 1) "You leave your workspace"
                                    else "You leave all ${current.memberships} of your workspaces",
                                )
                                append(
                                    if (current.openWork > 0) {
                                        ", and anything you are still working on goes back " +
                                            "to the crew so nothing is lost."
                                    } else "."
                                )
                            },
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                }
                Spacer(Modifier.height(6.dp))
                Text(
                    "Texts you sent to customers, jobs you logged and notes you wrote stay " +
                        "with the business. They have to — that record is theirs, and some of " +
                        "it we are required by law to keep. They will no longer carry your name.",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                Spacer(Modifier.height(12.dp))
                Button(
                    onClick = { confirming = true },
                    colors = ButtonDefaults.buttonColors(
                        containerColor = MaterialTheme.colorScheme.error,
                        contentColor = MaterialTheme.colorScheme.onError,
                    ),
                ) { Text("Delete my account") }
            }
        }
    }

    if (confirming) {
        AlertDialog(
            onDismissRequest = { if (!deleting) { confirming = false; typed = "" } },
            title = { Text("Delete your account?") },
            text = {
                Column {
                    Text(
                        "You will be signed out everywhere and will not be able to sign back " +
                            "in. Your work stays with the business, without your name on it. " +
                            "Nobody can undo this.",
                        style = MaterialTheme.typography.bodyMedium,
                    )
                    Spacer(Modifier.height(12.dp))
                    OutlinedTextField(
                        value = typed,
                        onValueChange = { typed = it },
                        singleLine = true,
                        enabled = !deleting,
                        modifier = Modifier.fillMaxWidth(),
                        label = { Text("Type $CONFIRM_WORD to confirm") },
                    )
                }
            },
            confirmButton = {
                TextButton(
                    enabled = !deleting && typed.trim().equals(CONFIRM_WORD, ignoreCase = true),
                    onClick = {
                        deleting = true
                        coroutines.launch {
                            runCatching { scope.repo.deleteAccount() }
                                .onSuccess {
                                    confirming = false
                                    onDeleted()
                                }
                                .onFailure { cause ->
                                    deleting = false
                                    confirming = false
                                    typed = ""
                                    scope.showMessage(
                                        cause.message
                                            ?: "Couldn't delete your account. Try again in a moment.",
                                    )
                                }
                        }
                    },
                ) { Text(if (deleting) "Deleting…" else "Delete my account") }
            },
            dismissButton = {
                TextButton(
                    enabled = !deleting,
                    onClick = { confirming = false; typed = "" },
                ) { Text("Keep my account") }
            },
            modifier = Modifier.padding(0.dp),
        )
    }
}
