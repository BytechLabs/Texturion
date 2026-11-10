package com.loonext.android.features.thread

import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.material3.TextButton
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import com.loonext.android.core.i18n.LocalAppLocale
import com.loonext.android.core.i18n.t
import com.loonext.android.core.model.ConversationDetail
import com.loonext.android.core.model.LeadSource
import com.loonext.android.core.model.MessageLocale
import com.loonext.android.features.contacts.contactRelationshipLine
import com.loonext.android.ui.common.RecordHeader
import com.loonext.android.ui.common.RecordOpenLink
import com.loonext.android.ui.common.RecordSection
import com.loonext.android.ui.common.choicesBesideDefault
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
import androidx.compose.material.icons.outlined.Check
import androidx.compose.material.icons.outlined.ContentCopy
import androidx.compose.material.icons.outlined.ExpandLess
import androidx.compose.material.icons.outlined.ExpandMore
import androidx.compose.material.icons.outlined.Phone
import androidx.compose.material3.Checkbox
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.LoadingIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.style.TextAlign
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
import com.loonext.android.features.tasks.LinkedOwner
import com.loonext.android.features.tasks.LinkedTasksList
import com.loonext.android.features.tasks.ReferenceSource
import com.loonext.android.ui.common.AppSheet
import com.loonext.android.ui.common.ChoiceChip
import com.loonext.android.ui.common.InitialsAvatar
import com.loonext.android.ui.common.LoadState
import com.loonext.android.ui.common.formatPhone
import com.loonext.android.ui.common.relativeTime

/**
 * The thread's contact panel (#165) — the web sidebar as a bottom sheet,
 * opened by tapping the header identity: a header (inline name, number, how
 * long they have been a customer) over an action row (call, copy, open the
 * contact), then one section style for the auto-saving address/notes (the exact
 * field the contact detail screen uses), the consent attest line, the
 * conversation's open-tasks checklist (T5.2 — done toggles through the
 * source message, never a task route) and prior conversations, with the
 * rarely-changed settings folded into Preferences (#717).
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
     * without this it is a dead end. #717: it is the header's labelled
     * "Open contact" link, never an icon in a corner.
     */
    onOpenContact: ((contactId: String) -> Unit)?,
    onDismiss: () -> Unit,
    /** #690: the tasks that point at this conversation. Null hides the section. */
    references: ReferenceSource? = null,
    /** Places a call to this contact. Null hides the Call action. */
    onCall: (() -> Unit)? = null,
    /** A call is being placed, so Call waits. */
    calling: Boolean = false,
    /** #726: opens where lead sources are managed. Null hides it from whoever cannot add one. */
    onAddLeadSource: (() -> Unit)? = null,
) {
    val detail = controller.conversation ?: return
    val contact = controller.contact
    val displayName = detail.contact.name ?: formatPhone(detail.contact.phone_e164)

    LaunchedEffect(controller) { controller.loadContactPanel() }

    fun memberName(userId: String?): String? =
        members.firstOrNull { it.user_id == userId }?.display_name?.ifBlank { null }

    val locale = LocalAppLocale.current
    val clipboard = LocalClipboardManager.current
    var copied by remember { mutableStateOf(false) }
    var leadSources by remember { mutableStateOf<List<LeadSource>>(emptyList()) }
    LaunchedEffect(detail.id) {
        leadSources = runCatching { controller.leadSources() }.getOrDefault(emptyList())
    }
    // #301: an unanswered source stays out in the open as the one-tap ask;
    // once answered it is a setting, and joins Preferences.
    val asksForSource =
        leadSources.any { it.archived_at == null } && detail.lead_source_id == null
    val shownTasks = (controller.conversationTasks as? LoadState.Ready)
        ?.value?.map { it.id }?.toSet().orEmpty()

    AppSheet(onDismissRequest = onDismiss) {
        Column(
            Modifier
                .fillMaxWidth()
                .verticalScroll(rememberScrollState())
                .padding(horizontal = 20.dp),
            verticalArrangement = Arrangement.spacedBy(18.dp),
        ) {
            // #717: the header says who, their number and how long they have
            // been a customer; the action row calls, copies and opens the
            // contact as a labelled link, never a corner icon.
            RecordHeader(
                leading = { InitialsAvatar(displayName, size = 44.dp) },
                title = {
                    AutosaveField(
                        fieldKey = "${detail.contact_id}:name",
                        label = t("thread.fieldName"),
                        initial = (contact?.name ?: detail.contact.name).orEmpty(),
                        maxLength = CONTACT_NAME_MAX,
                        placeholder = t("thread.addName"),
                        singleLine = true,
                        save = { value -> controller.saveContactField("name", value) },
                        quiet = true,
                        textStyle = MaterialTheme.typography.titleMedium.copy(
                            color = MaterialTheme.colorScheme.onSurface,
                        ),
                    )
                },
                meta = {
                    Text(
                        if (contact?.opted_out == true) {
                            "${formatPhone(detail.contact.phone_e164)} · " +
                                t("thread.optedOut")
                        } else {
                            formatPhone(detail.contact.phone_e164)
                        },
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        modifier = Modifier.padding(horizontal = 16.dp),
                    )
                    // #410: how long they have been a customer, and how often.
                    contactRelationshipLine(
                        contact?.conversation_count,
                        contact?.first_conversation_at,
                        locale,
                    )?.let { line ->
                        Text(
                            line,
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                            modifier = Modifier.padding(horizontal = 16.dp),
                        )
                    }
                },
                actions = {
                    if (onCall != null) {
                        OutlinedButton(onClick = onCall, enabled = !calling) {
                            Icon(
                                Icons.Outlined.Phone,
                                contentDescription = null,
                                modifier = Modifier.size(18.dp),
                            )
                            Spacer(Modifier.width(6.dp))
                            Text(t("contactsTasks.call"))
                        }
                    }
                    OutlinedButton(
                        onClick = {
                            clipboard.setText(AnnotatedString(detail.contact.phone_e164))
                            copied = true
                        },
                    ) {
                        Icon(
                            if (copied) Icons.Outlined.Check else Icons.Outlined.ContentCopy,
                            contentDescription = null,
                            modifier = Modifier.size(18.dp),
                        )
                        Spacer(Modifier.width(6.dp))
                        Text(
                            if (copied) {
                                t("thread.numberCopied")
                            } else {
                                t("contactsTasks.copyNumber")
                            },
                        )
                    }
                    if (onOpenContact != null) {
                        Spacer(Modifier.weight(1f))
                        RecordOpenLink(
                            label = t("thread.openContact"),
                            onClick = {
                                onDismiss()
                                onOpenContact(detail.contact_id)
                            },
                        )
                    }
                },
            )

            RecordSection(t("thread.sectionDetails")) {
                // The same auto-saving fields as the contact screen.
                AutosaveField(
                    fieldKey = "${detail.contact_id}:address",
                    label = t("thread.fieldAddress"),
                    initial = (contact?.address ?: detail.contact.address).orEmpty(),
                    maxLength = CONTACT_ADDRESS_MAX,
                    placeholder = t("thread.addAddress"),
                    singleLine = true,
                    save = { value -> controller.saveContactField("address", value) },
                    quiet = true,
                )
                AutosaveField(
                    fieldKey = "${detail.contact_id}:notes",
                    label = t("thread.fieldNotes"),
                    initial = (contact?.notes ?: detail.contact.notes).orEmpty(),
                    maxLength = CONTACT_NOTES_MAX,
                    placeholder = t("thread.notesPlaceholder"),
                    singleLine = false,
                    save = { value -> controller.saveContactField("notes", value) },
                    quiet = true,
                )
            }

            RecordSection(t("thread.sectionConsent")) {
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

            RecordSection(t("thread.sectionTasks")) {
                TasksChecklist(
                    state = controller.conversationTasks,
                    onToggle = { controller.toggleTaskDone(it) },
                    onOpenTask = onOpenTask,
                )
                // Linked tasks continue the checklist; one the checklist
                // already shows is not repeated.
                if (references != null) {
                    LinkedTasksList(
                        repo = references.repo,
                        companyId = references.companyId,
                        owner = LinkedOwner.Conversation(detail.id),
                        onOpenTask = onOpenTask,
                        shownElsewhere = shownTasks,
                    )
                }
            }

            // #301: where this customer came from, only while it is a question
            // somebody ASKS in the first minute of a call.
            if (asksForSource) {
                RecordSection(t("thread.sectionLeadSource")) {
                    LeadSourcePicker(
                        controller = controller,
                        detail = detail,
                        onAddSource = onAddLeadSource,
                    )
                }
            }

            RecordSection(t("thread.sectionOtherConversations")) {
                OtherConversations(
                    state = controller.otherConversations,
                    onOpen = onOpenConversation,
                )
            }

            PreferencesSection(
                controller = controller,
                detail = detail,
                withSource = !asksForSource,
                leadSources = leadSources,
                onAddLeadSource = onAddLeadSource,
            )

            Spacer(Modifier.height(24.dp))
        }
    }
}

/**
 * #717: the settings a crew sets once per customer, if ever, folded into one
 * row that says what they are set to and opens on demand.
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun PreferencesSection(
    controller: ThreadController,
    detail: ConversationDetail,
    /** The source is answered, so it is a setting rather than an ask. */
    withSource: Boolean,
    leadSources: List<LeadSource>,
    onAddLeadSource: (() -> Unit)?,
) {
    val locale = LocalAppLocale.current
    val scope = rememberCoroutineScope()
    var open by remember { mutableStateOf(false) }
    var saving by remember { mutableStateOf(false) }
    val contactLocale = controller.contact?.locale
    val companyLocale = controller.company?.locale
    val inheritLabel = MessageLocale.inheritLabel(companyLocale, locale)
    val languageLabel = if (contactLocale != null) {
        MessageLocale.label(contactLocale)
    } else {
        inheritLabel
    }
    val sourceName = if (withSource) {
        leadSources.firstOrNull { it.id == detail.lead_source_id }?.name
    } else {
        null
    }
    val summary = listOfNotNull(languageLabel, sourceName).joinToString(" · ")

    fun chooseLanguage(next: String?) {
        saving = true
        scope.launch {
            runCatching { controller.saveContactField("locale", next) }
            saving = false
        }
    }

    Column(Modifier.fillMaxWidth()) {
        Row(
            Modifier
                .fillMaxWidth()
                .clickable(role = Role.Button) { open = !open }
                .padding(vertical = 8.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Text(
                t("thread.sectionPreferences").uppercase(),
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            Text(
                summary,
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                textAlign = TextAlign.End,
                modifier = Modifier.weight(1f),
            )
            Icon(
                if (open) Icons.Outlined.ExpandLess else Icons.Outlined.ExpandMore,
                contentDescription = null,
                tint = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.size(18.dp),
            )
        }
        if (open) {
            Column(
                Modifier.padding(top = 4.dp),
                verticalArrangement = Arrangement.spacedBy(14.dp),
            ) {
                Column {
                    Text(
                        t("thread.sectionLanguage"),
                        style = MaterialTheme.typography.labelLarge,
                    )
                    // #717: the workspace's own language is the inherit chip's
                    // answer, so it is a second chip only when this contact is
                    // already set to it.
                    FlowRow(
                        Modifier.fillMaxWidth().padding(top = 6.dp),
                        horizontalArrangement = Arrangement.spacedBy(6.dp),
                    ) {
                        ChoiceChip(
                            label = inheritLabel,
                            chosen = contactLocale == null,
                            enabled = !saving,
                            onClick = { chooseLanguage(null) },
                        )
                        choicesBesideDefault(
                            MessageLocale.ALL,
                            companyLocale?.takeIf { it in MessageLocale.ALL },
                            contactLocale,
                        ).forEach { candidate ->
                            ChoiceChip(
                                label = MessageLocale.label(candidate),
                                chosen = contactLocale == candidate,
                                enabled = !saving,
                                onClick = { chooseLanguage(candidate) },
                            )
                        }
                    }
                    Text(
                        t("contactsTasks.localeCaveat"),
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        modifier = Modifier.padding(top = 4.dp),
                    )
                }
                if (withSource && leadSources.any { it.archived_at == null }) {
                    Column {
                        Text(
                            t("thread.sectionLeadSource"),
                            style = MaterialTheme.typography.labelLarge,
                        )
                        Spacer(Modifier.height(4.dp))
                        LeadSourcePicker(
                            controller = controller,
                            detail = detail,
                            onAddSource = onAddLeadSource,
                        )
                    }
                }
            }
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
private fun LeadSourcePicker(
    controller: ThreadController,
    detail: ConversationDetail,
    /** #726: where lead sources are managed; null for someone who cannot add one. */
    onAddSource: (() -> Unit)?,
) {
    val scope = rememberCoroutineScope()
    var sources by remember { mutableStateOf<List<LeadSource>>(emptyList()) }
    var pending by remember { mutableStateOf(false) }
    // #726: held per conversation, so a thread never starts from the last
    // thread's choice.
    val choice = remember(detail.id) { LeadSourceChoice.of(detail) }
    val current = choice.sourceId
    val origin = choice.origin

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
                choice.sourceId = next.lead_source_id
                choice.origin = next.lead_source_origin
            } finally {
                pending = false
            }
        }
    }

    Column(Modifier.fillMaxWidth()) {
        // #726: the empty state is a value of its own, said in words, so the
        // chips below read as choices rather than as the answer.
        when (val view = leadSourceView(currentName, origin)) {
            is LeadSourceView.Chosen -> Text(
                t(
                    if (view.fromNumber) "thread.leadFromLine" else "thread.leadSaidSo",
                    "name" to view.name,
                ),
                style = MaterialTheme.typography.bodyMedium,
            )
            LeadSourceView.Unasked -> Text(
                t("thread.leadAsk"),
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        FlowRow(
            Modifier.fillMaxWidth().padding(top = 6.dp),
            horizontalArrangement = Arrangement.spacedBy(6.dp),
        ) {
            options.forEach { source ->
                val selected = source.id == current
                ChoiceChip(
                    label = source.name,
                    chosen = selected,
                    enabled = !pending,
                    // Tapping the chosen one again clears it: the fastest way
                    // back from a mistap is the control you just used.
                    onClick = { choose(if (selected) null else source.id) },
                )
            }
            if (current != null) {
                TextButton(enabled = !pending, onClick = { choose(null) }) {
                    Text(t("thread.dontKnow"))
                }
            }
            // One source is still a question, so whoever can add another is
            // offered the way to.
            if (onAddSource != null) {
                TextButton(onClick = onAddSource) { Text(t("thread.addLeadSource")) }
            }
        }
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
                                // #228: `statusLabel` defaults to English for
                                // its pure callers, so the reader's language
                                // has to be handed in here.
                                statusLabel(row.status, LocalAppLocale.current),
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
