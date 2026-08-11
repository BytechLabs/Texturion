package com.loonext.android.features.thread

import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.material3.FilterChip
import androidx.compose.material3.TextButton
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import com.loonext.android.core.i18n.t
import com.loonext.android.core.model.ConversationDetail
import com.loonext.android.core.model.LeadSource
import kotlinx.coroutines.launch
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.OpenInNew
import androidx.compose.material3.Checkbox
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
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
    /**
     * #465: open the FULL contact screen — its history, call log and every
     * conversation. This panel holds a copy of the fields and nothing else, so
     * without this it is a dead end, which is exactly what was reported. Web
     * has had the jump since #82.
     */
    onOpenContact: ((contactId: String) -> Unit)?,
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
                            "${formatPhone(detail.contact.phone_e164)} · " +
                                t("thread.optedOut")
                        } else {
                            formatPhone(detail.contact.phone_e164)
                        },
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
                if (onOpenContact != null) {
                    IconButton(
                        onClick = {
                            onDismiss()
                            onOpenContact(detail.contact_id)
                        },
                    ) {
                        Icon(
                            Icons.AutoMirrored.Outlined.OpenInNew,
                            contentDescription = t("thread.openFullContact"),
                            tint = MaterialTheme.colorScheme.onSurfaceVariant,
                            modifier = Modifier.size(19.dp),
                        )
                    }
                }
            }

            // Details — the same auto-saving fields as the contact screen.
            SheetSection(t("thread.sectionDetails")) {
                AutosaveField(
                    fieldKey = "${detail.contact_id}:name",
                    label = t("thread.fieldName"),
                    initial = (contact?.name ?: detail.contact.name).orEmpty(),
                    maxLength = CONTACT_NAME_MAX,
                    placeholder = t("thread.addName"),
                    singleLine = true,
                    save = { value -> controller.saveContactField("name", value) },
                )
                AutosaveField(
                    fieldKey = "${detail.contact_id}:address",
                    label = t("thread.fieldAddress"),
                    initial = (contact?.address ?: detail.contact.address).orEmpty(),
                    maxLength = CONTACT_ADDRESS_MAX,
                    placeholder = t("thread.addAddress"),
                    singleLine = true,
                    save = { value -> controller.saveContactField("address", value) },
                )
                AutosaveField(
                    fieldKey = "${detail.contact_id}:notes",
                    label = t("thread.fieldNotes"),
                    initial = (contact?.notes ?: detail.contact.notes).orEmpty(),
                    maxLength = CONTACT_NOTES_MAX,
                    placeholder = t("thread.notesPlaceholder"),
                    singleLine = false,
                    save = { value -> controller.saveContactField("notes", value) },
                )
            }

            SheetSection(t("thread.sectionConsent")) {
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

            // #301: where this customer came from. Above the tasks because it
            // is a question somebody ASKS in the first minute of a call, while
            // a task is what they write down afterwards — and because the ask
            // disappears the moment it is answered.
            SheetSection(t("thread.sectionLeadSource")) {
                LeadSourcePicker(controller = controller, detail = detail)
            }

            SheetSection(t("thread.sectionTasks")) {
                TasksChecklist(
                    state = controller.conversationTasks,
                    onToggle = { controller.toggleTaskDone(it) },
                    onOpenTask = onOpenTask,
                )
            }

            SheetSection(t("thread.sectionOtherConversations")) {
                OtherConversations(
                    state = controller.otherConversations,
                    onOpen = onOpenConversation,
                )
            }

            Spacer(Modifier.height(24.dp))
        }
    }
}

/**
 * #301 — "how did you hear about us?", as one tap.
 *
 * Hand-port of `apps/web/src/components/contact-panel/lead-source-picker.tsx`.
 *
 * #301's devil's-advocate section names the trap this is built around: asking
 * the tech to categorise every inbound is a tax on the person with the least
 * time, and if it is not one tap it will not happen — which produces a source
 * field empty 80% of the time and a MISLEADING report rather than no report.
 * So it is chips and not a menu.
 *
 * IT NEVER ASKS A QUESTION IT ALREADY KNOWS THE ANSWER TO. When the LINE
 * attributed the conversation there is nothing to ask, so it states the answer
 * and offers no prompt; asking anyway is how a crew learns to dismiss this
 * control, and the whole value of per-number attribution is that nobody has to
 * do anything.
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun LeadSourcePicker(controller: ThreadController, detail: ConversationDetail) {
    val scope = rememberCoroutineScope()
    var sources by remember { mutableStateOf<List<LeadSource>>(emptyList()) }
    var pending by remember { mutableStateOf(false) }
    var current by remember(detail.id) { mutableStateOf(detail.lead_source_id) }
    var origin by remember(detail.id) { mutableStateOf(detail.lead_source_origin) }

    LaunchedEffect(detail.id) {
        // A list that will not load hides the picker rather than showing a
        // prompt with no answers on offer.
        sources = runCatching { controller.leadSources() }.getOrDefault(emptyList())
    }

    val options = sources.filter { it.archived_at == null }
    if (options.isEmpty()) return

    // An archived source still NAMES the thread it attributed — this
    // conversation genuinely came from the yard sign, even after it came down.
    val currentName = sources.firstOrNull { it.id == current }?.name

    fun choose(id: String?) {
        pending = true
        scope.launch {
            try {
                val next = controller.setLeadSource(detail.id, id)
                current = next.lead_source_id
                origin = next.lead_source_origin
            } finally {
                pending = false
            }
        }
    }

    Column(Modifier.fillMaxWidth()) {
        when {
            origin == "number" && currentName != null -> Text(
                t("thread.leadFromLine", "name" to currentName),
                style = MaterialTheme.typography.bodyMedium,
            )
            currentName != null -> Text(
                t("thread.leadSaidSo", "name" to currentName),
                style = MaterialTheme.typography.bodyMedium,
            )
            else -> Text(
                t("thread.leadAsk"),
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        FlowRow(
            Modifier.fillMaxWidth().padding(top = 6.dp),
            horizontalArrangement = Arrangement.spacedBy(6.dp),
        ) {
            options.forEach { source ->
                val selected = source.id == current
                FilterChip(
                    selected = selected,
                    enabled = !pending,
                    // Tapping the chosen one again clears it: the fastest way
                    // back from a mistap is the control you just used.
                    onClick = { choose(if (selected) null else source.id) },
                    label = { Text(source.name) },
                )
            }
            if (current != null) {
                TextButton(enabled = !pending, onClick = { choose(null) }) {
                    Text(t("thread.dontKnow"))
                }
            }
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
            t("thread.tasksLoadFailed"),
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )

        is LoadState.Ready -> {
            if (state.value.isEmpty()) {
                Text(
                    t("thread.noTasks"),
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
            t("thread.priorLoadFailed"),
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )

        is LoadState.Ready -> {
            if (state.value.isEmpty()) {
                Text(
                    t("thread.noOtherConversations"),
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
                                row.last_message?.body?.ifBlank { null }
                                    ?: t("thread.conversationFallback"),
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
