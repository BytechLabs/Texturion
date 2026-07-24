package com.loonext.android.features.thread

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Checkbox
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.LoadingIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.loonext.android.core.model.Member
import com.loonext.android.core.model.Task
import com.loonext.android.features.contacts.AutosaveField
import com.loonext.android.features.contacts.CONTACT_ADDRESS_MAX
import com.loonext.android.features.contacts.CONTACT_NAME_MAX
import com.loonext.android.features.contacts.CONTACT_NOTES_MAX
import com.loonext.android.features.contacts.consentLine
import com.loonext.android.ui.common.AppSheet
import com.loonext.android.ui.common.InitialsAvatar
import com.loonext.android.ui.common.LoadState
import com.loonext.android.ui.common.formatPhone
import com.loonext.android.ui.common.relativeTime

/**
 * The thread's contact panel (#165) — the web sidebar as a bottom sheet,
 * opened by tapping the header identity: inline name/address/notes with the
 * G6 800ms auto-save (the exact field the contact detail screen uses), the
 * consent attest line, prior conversations with this contact, and the
 * conversation's open-tasks checklist (T5.2 — done toggles through the
 * source message, never a task route).
 *
 * [onOpenConversation] is the caller's navigation into ANOTHER thread; rows
 * stay un-tappable until it's wired (a row that goes nowhere would be a lie).
 */
@Composable
internal fun ContactPanelSheet(
    controller: ThreadController,
    members: List<Member>,
    onOpenConversation: ((conversationId: String) -> Unit)?,
    onOpenTask: ((taskId: String) -> Unit)?,
    onDismiss: () -> Unit,
) {
    val detail = controller.conversation ?: return
    val contact = controller.contact
    val displayName = detail.contact.name ?: formatPhone(detail.contact.phone_e164)

    LaunchedEffect(controller) { controller.loadContactPanel() }

    fun memberName(userId: String?): String? =
        members.firstOrNull { it.user_id == userId }?.display_name?.ifBlank { null }

    AppSheet(onDismissRequest = onDismiss) {
        Column(
            Modifier
                .fillMaxWidth()
                .verticalScroll(rememberScrollState())
                .padding(horizontal = 20.dp),
            verticalArrangement = Arrangement.spacedBy(14.dp),
        ) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                InitialsAvatar(displayName, size = 44.dp)
                Spacer(Modifier.width(12.dp))
                Column(Modifier.weight(1f)) {
                    Text(
                        displayName,
                        style = MaterialTheme.typography.titleMedium,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )
                    Text(
                        if (contact?.opted_out == true) {
                            "${formatPhone(detail.contact.phone_e164)} · Opted out"
                        } else {
                            formatPhone(detail.contact.phone_e164)
                        },
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }

            // Details — the same auto-saving fields as the contact screen.
            SheetSection("Details") {
                AutosaveField(
                    fieldKey = "${detail.contact_id}:name",
                    label = "Name",
                    initial = (contact?.name ?: detail.contact.name).orEmpty(),
                    maxLength = CONTACT_NAME_MAX,
                    placeholder = "Add a name",
                    singleLine = true,
                    save = { value -> controller.saveContactField("name", value) },
                )
                AutosaveField(
                    fieldKey = "${detail.contact_id}:address",
                    label = "Address",
                    initial = (contact?.address ?: detail.contact.address).orEmpty(),
                    maxLength = CONTACT_ADDRESS_MAX,
                    placeholder = "Add an address",
                    singleLine = true,
                    save = { value -> controller.saveContactField("address", value) },
                )
                AutosaveField(
                    fieldKey = "${detail.contact_id}:notes",
                    label = "Notes",
                    initial = (contact?.notes ?: detail.contact.notes).orEmpty(),
                    maxLength = CONTACT_NOTES_MAX,
                    placeholder = "Gate code, dog's name, preferred arrival window…",
                    singleLine = false,
                    save = { value -> controller.saveContactField("notes", value) },
                )
            }

            SheetSection("Consent") {
                Text(
                    consentLine(
                        consentSource = contact?.consent_source
                            ?: detail.contact.consent_source,
                        consentAt = contact?.consent_at ?: detail.contact.consent_at,
                        consentAttestedBy = contact?.consent_attested_by,
                        memberName = ::memberName,
                    ),
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }

            SheetSection("Tasks in this conversation") {
                TasksChecklist(
                    state = controller.conversationTasks,
                    onToggle = { controller.toggleTaskDone(it) },
                    onOpenTask = onOpenTask,
                )
            }

            SheetSection("Other conversations") {
                OtherConversations(
                    state = controller.otherConversations,
                    onOpen = onOpenConversation,
                )
            }

            Spacer(Modifier.height(24.dp))
        }
    }
}

@Composable
private fun SheetSection(title: String, content: @Composable () -> Unit) {
    Column(Modifier.fillMaxWidth()) {
        Text(
            title,
            style = MaterialTheme.typography.labelMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.padding(bottom = 6.dp),
        )
        content()
    }
}

@Composable
private fun TasksChecklist(
    state: LoadState<List<Task>>?,
    onToggle: (Task) -> Unit,
    onOpenTask: ((taskId: String) -> Unit)?,
) {
    when (state) {
        null, is LoadState.Loading -> LoadingIndicator()
        is LoadState.Failed -> Text(
            "Couldn't load this conversation's tasks.",
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )

        is LoadState.Ready -> {
            if (state.value.isEmpty()) {
                Text(
                    "No tasks in this conversation.",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                return
            }
            Column {
                state.value.forEach { task ->
                    Row(
                        Modifier
                            .fillMaxWidth()
                            // #217: tapping the ROW opens the task detail; the
                            // Checkbox below stays a SEPARATE hit target so a
                            // done toggle never navigates.
                            .let { base ->
                                if (onOpenTask != null) base.clickable { onOpenTask(task.id) }
                                else base
                            },
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Checkbox(
                            checked = task.done,
                            onCheckedChange = { onToggle(task) },
                        )
                        Text(
                            task.title,
                            style = MaterialTheme.typography.bodyMedium,
                            textDecoration = if (task.done) TextDecoration.LineThrough else null,
                            color = if (task.done) {
                                MaterialTheme.colorScheme.onSurfaceVariant
                            } else {
                                MaterialTheme.colorScheme.onSurface
                            },
                            maxLines = 2,
                            overflow = TextOverflow.Ellipsis,
                            modifier = Modifier.weight(1f),
                        )
                    }
                }
            }
        }
    }
}

@Composable
private fun OtherConversations(
    state: LoadState<List<com.loonext.android.core.model.ConversationListItem>>?,
    onOpen: ((String) -> Unit)?,
) {
    when (state) {
        null, is LoadState.Loading -> LoadingIndicator()
        is LoadState.Failed -> Text(
            "Couldn't load prior conversations.",
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )

        is LoadState.Ready -> {
            if (state.value.isEmpty()) {
                Text(
                    "No other conversations with this contact.",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                return
            }
            Column {
                state.value.forEach { row ->
                    Row(
                        Modifier
                            .fillMaxWidth()
                            .let { base ->
                                if (onOpen != null) base.clickable { onOpen(row.id) }
                                else base
                            }
                            .padding(vertical = 8.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Column(Modifier.weight(1f)) {
                            Text(
                                row.last_message?.body?.ifBlank { null } ?: "Conversation",
                                style = MaterialTheme.typography.bodyMedium,
                                maxLines = 1,
                                overflow = TextOverflow.Ellipsis,
                            )
                            Text(
                                statusLabel(row.status),
                                style = MaterialTheme.typography.labelSmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        }
                        Spacer(Modifier.width(8.dp))
                        Text(
                            relativeTime(row.last_message_at),
                            style = MaterialTheme.typography.labelSmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                    HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
                }
            }
        }
    }
}
