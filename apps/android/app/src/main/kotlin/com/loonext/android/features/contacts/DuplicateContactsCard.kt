package com.loonext.android.features.contacts

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.selection.selectable
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.RadioButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.loonext.android.core.model.ContactMergeResult
import com.loonext.android.core.model.DuplicatePair
import com.loonext.android.ui.common.formatPhone
import com.loonext.android.ui.common.rememberHaptics
import com.loonext.android.ui.common.userMessage
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch

/**
 * #246 — the duplicates this workspace has, offered rather than hunted for.
 *
 * # Why it sits above the contact list and not behind its own screen
 *
 * "The workspace can find its likely duplicates without knowing they exist."
 * Somebody who does not know they have duplicates will not navigate to a screen
 * about them. The card appears above the list only when there is something to
 * act on, which makes it a finding rather than a feature — a workspace with no
 * duplicates sees the list exactly as it always did.
 *
 * *Applying: Meaningful Highlights & Context — the pair IS the insight, so it
 * is one line each with the server's reason attached. Zen of Clarity — no card
 * at all when there is nothing to merge.*
 */
@Composable
fun DuplicateContactsCard(
    repo: ContactMutations,
    companyId: String,
    /** #246: merging needs settings.manage. A member still sees the finding. */
    canMerge: Boolean,
    /**
     * Handed the result rather than a bare signal, because the opt-out union is
     * the one outcome the crew has to be told about — a merged contact can come
     * out opted out when neither record they were looking at said so.
     */
    onMerged: (ContactMergeResult) -> Unit,
    modifier: Modifier = Modifier,
) {
    var pairs by remember { mutableStateOf<List<DuplicatePair>>(emptyList()) }
    var refreshKey by remember { mutableIntStateOf(0) }
    var merging by remember { mutableStateOf<DuplicatePair?>(null) }

    LaunchedEffect(companyId, refreshKey) {
        pairs = try {
            repo.duplicates(companyId).data
        } catch (cause: CancellationException) {
            throw cause
        } catch (_: Exception) {
            // A finding nobody asked for must never become an error somebody
            // has to dismiss. Silence is the honest failure here.
            emptyList()
        }
    }

    if (pairs.isEmpty()) return

    Surface(
        color = MaterialTheme.colorScheme.surface,
        modifier = modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp),
    ) {
        Column(Modifier.padding(14.dp)) {
            Text(
                if (pairs.size == 1) "These two look like the same customer"
                else "${pairs.size} pairs look like the same customer",
                style = MaterialTheme.typography.titleSmall,
            )
            Text(
                "Merging keeps every message, task and photo from both, under one record.",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.padding(top = 2.dp),
            )
            pairs.forEach { pair ->
                Spacer(Modifier.height(10.dp))
                Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                    Column(Modifier.weight(1f)) {
                        Text(
                            describeContact(pair.name_a, pair.phone_a) +
                                " and " + describeContact(pair.name_b, pair.phone_b),
                            style = MaterialTheme.typography.bodyMedium,
                            maxLines = 2,
                            overflow = TextOverflow.Ellipsis,
                        )
                        // The reason, in the words the server used. A suggestion
                        // somebody cannot verify is one they learn to dismiss.
                        Text(
                            pair.reason,
                            style = MaterialTheme.typography.labelSmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                    if (canMerge) {
                        TextButton(onClick = { merging = pair }) { Text("Merge") }
                    }
                }
            }
        }
    }

    merging?.let { pair ->
        MergeContactsDialog(
            repo = repo,
            companyId = companyId,
            pair = pair,
            onDismiss = { merging = null },
            onMerged = { result ->
                merging = null
                refreshKey++
                onMerged(result)
            },
        )
    }
}

/** A contact as somebody recognises it: the name if there is one, else the number. */
internal fun describeContact(name: String?, phone: String): String {
    val trimmed = name?.trim()
    return if (trimmed.isNullOrEmpty()) formatPhone(phone)
    else "$trimmed (${formatPhone(phone)})"
}

/**
 * # Ethical Friction, and which direction the dialog states
 *
 * A merge moves somebody's whole history under a different record. The undo
 * restores the second contact but NOT which thread came from which, so this
 * says out loud what survives and names the direction in the way people get
 * backwards ("merge A into B" is ambiguous to almost everyone).
 *
 * Both numbers keep working either way — the fact that makes the decision safe
 * and the one most likely to be assumed wrong.
 */
@Composable
private fun MergeContactsDialog(
    repo: ContactMutations,
    companyId: String,
    pair: DuplicatePair,
    onDismiss: () -> Unit,
    onMerged: (ContactMergeResult) -> Unit,
) {
    var keepFirst by remember(pair) { mutableStateOf(true) }
    var saving by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    val coroutines = rememberCoroutineScope()
    val haptics = rememberHaptics()

    val survivorId = if (keepFirst) pair.contact_a else pair.contact_b
    val foldedId = if (keepFirst) pair.contact_b else pair.contact_a
    val survivorLabel =
        if (keepFirst) describeContact(pair.name_a, pair.phone_a)
        else describeContact(pair.name_b, pair.phone_b)
    val foldedLabel =
        if (keepFirst) describeContact(pair.name_b, pair.phone_b)
        else describeContact(pair.name_a, pair.phone_a)

    AlertDialog(
        onDismissRequest = { if (!saving) onDismiss() },
        title = { Text("Merge these two customers") },
        text = {
            Column {
                Text(
                    "Everything from both — messages, tasks, photos, notes — ends up " +
                        "under the record you keep. Both phone numbers keep working.",
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                Spacer(Modifier.height(10.dp))
                Text("Which one to keep", style = MaterialTheme.typography.labelLarge)
                listOf(true, false).forEach { first ->
                    val label =
                        if (first) describeContact(pair.name_a, pair.phone_a)
                        else describeContact(pair.name_b, pair.phone_b)
                    Row(
                        Modifier
                            .fillMaxWidth()
                            .selectable(
                                selected = keepFirst == first,
                                enabled = !saving,
                                onClick = { keepFirst = first },
                            )
                            .padding(vertical = 4.dp),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(4.dp),
                    ) {
                        RadioButton(
                            selected = keepFirst == first,
                            onClick = { keepFirst = first },
                            enabled = !saving,
                        )
                        Text(label, style = MaterialTheme.typography.bodyMedium)
                    }
                }
                Spacer(Modifier.height(6.dp))
                // Said back in the direction people get backwards.
                Text(
                    "$foldedLabel stops being a separate customer. Its history moves " +
                        "to $survivorLabel.",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                error?.let {
                    Spacer(Modifier.height(6.dp))
                    Text(
                        it,
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.error,
                    )
                }
            }
        },
        confirmButton = {
            TextButton(
                enabled = !saving,
                onClick = {
                    haptics.confirm()
                    error = null
                    saving = true
                    coroutines.launch {
                        try {
                            onMerged(repo.merge(companyId, foldedId, survivorId))
                        } catch (cause: Exception) {
                            error = cause.userMessage()
                        } finally {
                            saving = false
                        }
                    }
                },
            ) { Text(if (saving) "Merging…" else "Merge") }
        },
        dismissButton = {
            TextButton(enabled = !saving, onClick = onDismiss) { Text("Cancel") }
        },
    )
}
