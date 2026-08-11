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
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.loonext.android.core.i18n.t
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

    // Both failures are reported from a coroutine started by a press, where the
    // reader's locale is out of scope — so the sentences are read here.
    val previewFailed = t("settings.deletePreviewFailed")
    val deleteFailed = t("settings.deleteFailed")

    SettingsCard(
        title = t("settings.deleteTitle"),
        description = t("settings.deleteIntro"),
    ) {
        when {
            !expanded -> OutlinedButton(onClick = {
                expanded = true
                loading = true
                error = null
                coroutines.launch {
                    runCatching { scope.repo.accountDeletionPreview() }
                        .onSuccess { preview = it }
                        .onFailure { error = previewFailed }
                    loading = false
                }
            }) { Text(t("settings.deleteAction")) }

            loading -> Text(
                t("settings.deleteChecking"),
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )

            error != null -> InlineError(error)

            preview?.blockedByOwnership == true -> Column {
                // Specific, not generic: there is no ownership transfer yet
                // (#332), so the way out has to be spelled out.
                Text(
                    t(
                        "settings.deleteBlockedByOwnership",
                        "workspaces" to preview!!.owned_workspaces.joinToString { it.name },
                    ),
                    style = MaterialTheme.typography.bodyMedium,
                )
                Spacer(Modifier.height(4.dp))
                Text(
                    t("settings.deleteClosingIsElsewhere"),
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }

            else -> Column {
                Text(
                    t("settings.deleteSignedOut"),
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                preview?.let { current ->
                    if (current.memberships > 0) {
                        Spacer(Modifier.height(6.dp))
                        Text(
                            // Four WHOLE sentences rather than a stem plus a
                            // clause. The English happens to read correctly when
                            // the two halves are concatenated; French moves the
                            // verb and the count, so a shared stem would leave a
                            // translator with two fragments neither of which can
                            // be made into a sentence.
                            when {
                                current.memberships == 1 && current.openWork > 0 ->
                                    t("settings.deleteLeaveOneOpenWork")

                                current.memberships == 1 -> t("settings.deleteLeaveOne")

                                current.openWork > 0 -> t(
                                    "settings.deleteLeaveManyOpenWork",
                                    "count" to current.memberships.toString(),
                                )

                                else -> t(
                                    "settings.deleteLeaveMany",
                                    "count" to current.memberships.toString(),
                                )
                            },
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                }
                Spacer(Modifier.height(6.dp))
                Text(
                    t("settings.deleteRecordStays"),
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                Spacer(Modifier.height(6.dp))
                // #371: said here rather than after the fact, because the
                // moment this succeeds you are signed out and there is no
                // screen left to read a confirmation on.
                Text(
                    t("settings.deleteConfirmationEmail"),
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
                ) { Text(t("settings.deleteAction")) }
            }
        }
    }

    if (confirming) {
        AlertDialog(
            onDismissRequest = { if (!deleting) { confirming = false; typed = "" } },
            title = { Text(t("settings.deleteConfirmTitle")) },
            text = {
                Column {
                    Text(
                        t("settings.deleteConfirmBody"),
                        style = MaterialTheme.typography.bodyMedium,
                    )
                    Spacer(Modifier.height(12.dp))
                    OutlinedTextField(
                        value = typed,
                        onValueChange = { typed = it },
                        singleLine = true,
                        enabled = !deleting,
                        modifier = Modifier.fillMaxWidth(),
                        label = { Text(t("settings.deleteTypeToConfirm", "word" to CONFIRM_WORD)) },
                    )
                }
            },
            confirmButton = {
                LinkButton(
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
                                    scope.showMessage(cause.message ?: deleteFailed)
                                }
                        }
                    },
                ) {
                    Text(
                        if (deleting) t("settings.deletePending") else t("settings.deleteAction"),
                    )
                }
            },
            dismissButton = {
                LinkButton(
                    enabled = !deleting,
                    onClick = { confirming = false; typed = "" },
                ) { Text(t("settings.deleteKeep")) }
            },
            modifier = Modifier.padding(0.dp),
        )
    }
}
