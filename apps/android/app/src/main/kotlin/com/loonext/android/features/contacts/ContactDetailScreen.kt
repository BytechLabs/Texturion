package com.loonext.android.features.contacts

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.ContentCopy
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedCard
import androidx.compose.material3.OutlinedTextField
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
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.unit.dp
import com.loonext.android.core.model.Contact
import com.loonext.android.core.model.Member
import com.loonext.android.core.net.ApiErrorCode
import com.loonext.android.core.net.ApiException
import com.loonext.android.ui.common.CenteredError
import com.loonext.android.ui.common.CenteredLoading
import com.loonext.android.ui.common.InitialsAvatar
import com.loonext.android.ui.common.LoadState
import com.loonext.android.ui.common.formatPhone
import com.loonext.android.ui.common.userMessage
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

/** Auto-save lifecycle for one field: idle → saving → saved / failed. */
private enum class SaveState { Idle, Saving, Saved, Failed }

/**
 * Contact detail, the native sibling of the web's /contacts/[id]: auto-saving
 * Name/Address/Notes (800ms after the last keystroke, with a quiet
 * Saving…/Saved status line), the consent card ('Texted you first' vs
 * 'Consent recorded by {member}', the attester resolved against
 * GET /v1/members), the opted-out banner with 'Mark opted in again' and its
 * START caveat, opt-out and soft-delete behind confirm dialogs, and a
 * contextual primary button — 'Open conversation' when a thread already
 * exists (found via GET /v1/conversations?q=<phone>), otherwise 'Message'
 * into compose prefill. Both destinations are shell callbacks; the button
 * hides until the integrator wires them.
 */
@Composable
internal fun ContactDetailScreen(
    mutations: ContactMutations,
    companyId: String,
    contactId: String,
    onBack: () -> Unit,
    onOpenConversation: ((conversationId: String) -> Unit)?,
    onComposeNew: ((contactId: String) -> Unit)?,
    modifier: Modifier = Modifier,
) {
    BackHandler(onBack = onBack)

    var state by remember(contactId) { mutableStateOf<LoadState<Contact>>(LoadState.Loading) }
    var members by remember(companyId) { mutableStateOf<List<Member>>(emptyList()) }
    var conversationId by remember(contactId) { mutableStateOf<String?>(null) }
    var refreshKey by remember(contactId) { mutableIntStateOf(0) }

    LaunchedEffect(contactId, refreshKey) {
        state = try {
            LoadState.Ready(mutations.detail(companyId, contactId))
        } catch (cause: Exception) {
            if (state is LoadState.Ready) state // keep data on a quiet refresh failure
            else LoadState.Failed(cause.userMessage(), (cause as? ApiException)?.code)
        }
    }
    LaunchedEffect(companyId) {
        runCatching { mutations.members(companyId) }.onSuccess { members = it.data }
    }
    // #82: the primary button is contextual — find this contact's existing
    // thread once the phone is known. A lookup failure just leaves the
    // compose fallback, which reuses the same thread on send anyway.
    val phone = (state as? LoadState.Ready)?.value?.phone_e164
    LaunchedEffect(phone) {
        if (phone == null) return@LaunchedEffect
        runCatching { mutations.findConversation(companyId, phone) }
            .onSuccess { conversationId = it?.id }
    }

    Column(modifier.fillMaxSize()) {
        Row(
            Modifier
                .fillMaxWidth()
                .padding(horizontal = 4.dp, vertical = 4.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            IconButton(onClick = onBack) {
                Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Back to contacts")
            }
            Text(
                "Contact",
                style = MaterialTheme.typography.titleMedium,
                modifier = Modifier.weight(1f),
            )
        }

        when (val current = state) {
            is LoadState.Loading -> CenteredLoading()
            is LoadState.Failed ->
                if (current.code == ApiErrorCode.NOT_FOUND) {
                    Text(
                        "This contact doesn't exist or was removed.",
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        modifier = Modifier.padding(24.dp),
                    )
                } else {
                    CenteredError(current.message, onRetry = { refreshKey++ })
                }

            is LoadState.Ready -> ContactDetailBody(
                mutations = mutations,
                companyId = companyId,
                contact = current.value,
                members = members,
                conversationId = conversationId,
                onChanged = { refreshKey++ },
                onDeleted = onBack,
                onOpenConversation = onOpenConversation,
                onComposeNew = onComposeNew,
            )
        }
    }
}

@Composable
private fun ContactDetailBody(
    mutations: ContactMutations,
    companyId: String,
    contact: Contact,
    members: List<Member>,
    conversationId: String?,
    onChanged: () -> Unit,
    onDeleted: () -> Unit,
    onOpenConversation: ((String) -> Unit)?,
    onComposeNew: ((String) -> Unit)?,
) {
    val scope = rememberCoroutineScope()
    val clipboard = LocalClipboardManager.current

    var actionError by remember(contact.id) { mutableStateOf<String?>(null) }
    var confirmOptOut by remember(contact.id) { mutableStateOf(false) }
    var confirmDelete by remember(contact.id) { mutableStateOf(false) }
    var working by remember(contact.id) { mutableStateOf(false) }

    fun memberName(userId: String?): String? =
        members.firstOrNull { it.user_id == userId }?.display_name?.ifBlank { null }

    fun runAction(action: suspend () -> Unit) {
        working = true
        actionError = null
        scope.launch {
            try {
                action()
            } catch (cause: Exception) {
                actionError = cause.userMessage()
            } finally {
                working = false
            }
        }
    }

    Column(
        Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(horizontal = 16.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            InitialsAvatar(contact.name ?: formatPhone(contact.phone_e164), size = 48.dp)
            Spacer(Modifier.width(12.dp))
            Column(Modifier.weight(1f)) {
                Text(
                    contact.name?.ifBlank { null } ?: formatPhone(contact.phone_e164),
                    style = MaterialTheme.typography.titleLarge,
                )
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(
                        formatPhone(contact.phone_e164),
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                    IconButton(
                        onClick = {
                            clipboard.setText(AnnotatedString(contact.phone_e164))
                        },
                        modifier = Modifier.size(32.dp),
                    ) {
                        Icon(
                            Icons.Filled.ContentCopy,
                            contentDescription = "Copy number",
                            modifier = Modifier.size(16.dp),
                            tint = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                    if (contact.opted_out) {
                        Text(
                            "Opted out",
                            style = MaterialTheme.typography.labelMedium,
                            color = MaterialTheme.colorScheme.error,
                        )
                    }
                }
            }
        }

        // Contextual primary action (#82). Hidden until the shell wires the
        // destinations — a button that goes nowhere would be a lie.
        if (conversationId != null && onOpenConversation != null) {
            Button(
                onClick = { onOpenConversation(conversationId) },
                modifier = Modifier.fillMaxWidth(),
            ) { Text("Open conversation") }
        } else if (conversationId == null && onComposeNew != null) {
            Button(
                onClick = { onComposeNew(contact.id) },
                modifier = Modifier.fillMaxWidth(),
            ) { Text("Message") }
        }

        if (actionError != null) {
            Text(
                actionError.orEmpty(),
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.error,
            )
        }

        if (contact.opted_out) {
            OutlinedCard(Modifier.fillMaxWidth()) {
                Column(Modifier.padding(12.dp)) {
                    Text(
                        "This customer opted out of texting. Sends to them are blocked.",
                        style = MaterialTheme.typography.bodyMedium,
                    )
                    TextButton(
                        enabled = !working,
                        onClick = {
                            runAction {
                                mutations.revokeOptOut(companyId, contact.id)
                                onChanged()
                            }
                        },
                        contentPadding = androidx.compose.foundation.layout.PaddingValues(0.dp),
                    ) { Text(if (working) "Working…" else "Mark opted in again") }
                    Text(
                        "If they texted STOP, they also need to text START before " +
                            "messages will deliver.",
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }
        }

        SectionCard("Details") {
            AutosaveField(
                fieldKey = "${contact.id}:name",
                label = "Name",
                initial = contact.name.orEmpty(),
                maxLength = CONTACT_NAME_MAX,
                placeholder = "Add a name",
                singleLine = true,
                save = { value ->
                    mutations.updateField(companyId, contact.id, "name", value)
                },
            )
            AutosaveField(
                fieldKey = "${contact.id}:address",
                label = "Address",
                initial = contact.address.orEmpty(),
                maxLength = CONTACT_ADDRESS_MAX,
                placeholder = "Add an address",
                singleLine = true,
                save = { value ->
                    mutations.updateField(companyId, contact.id, "address", value)
                },
            )
            AutosaveField(
                fieldKey = "${contact.id}:notes",
                label = "Notes",
                initial = contact.notes.orEmpty(),
                maxLength = CONTACT_NOTES_MAX,
                placeholder = "Gate code, dog's name, preferred arrival window…",
                singleLine = false,
                save = { value ->
                    mutations.updateField(companyId, contact.id, "notes", value)
                },
            )
        }

        SectionCard("Consent") {
            Text(
                consentLine(
                    consentSource = contact.consent_source,
                    consentAt = contact.consent_at,
                    consentAttestedBy = contact.consent_attested_by,
                    memberName = ::memberName,
                ),
                style = MaterialTheme.typography.bodyMedium,
                color = if (contact.consent_source == null) {
                    MaterialTheme.colorScheme.onSurfaceVariant
                } else {
                    MaterialTheme.colorScheme.onSurface
                },
            )
        }

        // §3.3: routine, reversible actions stay quiet — the confirm dialogs
        // carry the weight, not red scare-styling on the triggers.
        SectionCard("Manage this contact") {
            if (!contact.opted_out) {
                ManageRow(
                    text = "Stop all texting to this customer.",
                    actionLabel = "Opt out this contact",
                    enabled = !working,
                    onClick = { confirmOptOut = true },
                )
            }
            ManageRow(
                text = "Hide this contact from your list. Texting history stays, " +
                    "and they reappear if they text you again.",
                actionLabel = "Delete contact",
                enabled = !working,
                onClick = { confirmDelete = true },
            )
        }

        Spacer(Modifier.height(24.dp))
    }

    if (confirmOptOut) {
        AlertDialog(
            onDismissRequest = { confirmOptOut = false },
            title = { Text("Opt out this contact?") },
            text = {
                Text(
                    "All texting to ${formatPhone(contact.phone_e164)} is blocked until " +
                        "they're opted back in. Use this when a customer asks you to " +
                        "stop texting them.",
                )
            },
            confirmButton = {
                TextButton(
                    enabled = !working,
                    onClick = {
                        confirmOptOut = false
                        runAction {
                            mutations.optOut(companyId, contact.id)
                            onChanged()
                        }
                    },
                ) { Text("Opt out", color = MaterialTheme.colorScheme.error) }
            },
            dismissButton = {
                TextButton(onClick = { confirmOptOut = false }) { Text("Cancel") }
            },
        )
    }

    if (confirmDelete) {
        AlertDialog(
            onDismissRequest = { confirmDelete = false },
            title = { Text("Delete this contact?") },
            text = {
                Text(
                    "They disappear from your contact list. Conversations and messages " +
                        "stay, and the contact comes back automatically if they text " +
                        "you again.",
                )
            },
            confirmButton = {
                TextButton(
                    enabled = !working,
                    onClick = {
                        confirmDelete = false
                        runAction {
                            mutations.delete(companyId, contact.id)
                            onDeleted()
                        }
                    },
                ) { Text("Delete", color = MaterialTheme.colorScheme.error) }
            },
            dismissButton = {
                TextButton(onClick = { confirmDelete = false }) { Text("Keep contact") }
            },
        )
    }
}

@Composable
private fun SectionCard(title: String, content: @Composable () -> Unit) {
    Column(Modifier.fillMaxWidth()) {
        Text(
            title,
            style = MaterialTheme.typography.labelMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.padding(bottom = 6.dp),
        )
        OutlinedCard(Modifier.fillMaxWidth()) {
            Column(
                Modifier.padding(12.dp),
                verticalArrangement = Arrangement.spacedBy(10.dp),
            ) { content() }
        }
    }
}

@Composable
private fun ManageRow(
    text: String,
    actionLabel: String,
    enabled: Boolean,
    onClick: () -> Unit,
) {
    Row(verticalAlignment = Alignment.CenterVertically) {
        Text(
            text,
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.weight(1f),
        )
        // Quiet trigger (§3.3) — the confirm dialog carries the weight.
        TextButton(
            enabled = enabled,
            onClick = onClick,
            colors = ButtonDefaults.textButtonColors(
                contentColor = MaterialTheme.colorScheme.onSurfaceVariant,
            ),
        ) { Text(actionLabel) }
    }
}

/**
 * G6 auto-save: writes the field 800ms after the last keystroke (blank
 * clears — an explicit null on the wire) with a quiet status line the web
 * renders identically ('Saving…' / 'Saved' / a calm failure sentence). A new
 * keystroke during a pending save restarts the clock; the newest value wins.
 */
@Composable
private fun AutosaveField(
    fieldKey: String,
    label: String,
    initial: String,
    maxLength: Int,
    placeholder: String,
    singleLine: Boolean,
    save: suspend (String?) -> Unit,
) {
    var value by remember(fieldKey) { mutableStateOf(initial) }
    var lastSaved by remember(fieldKey) { mutableStateOf(initial) }
    var state by remember(fieldKey) { mutableStateOf(SaveState.Idle) }

    LaunchedEffect(value) {
        val trimmed = value.trim()
        if (trimmed == lastSaved.trim()) return@LaunchedEffect
        delay(800)
        state = SaveState.Saving
        try {
            save(trimmed.ifEmpty { null })
            lastSaved = value
            state = SaveState.Saved
        } catch (_: Exception) {
            state = SaveState.Failed
        }
    }

    Column(Modifier.fillMaxWidth()) {
        OutlinedTextField(
            value = value,
            onValueChange = { value = it.take(maxLength) },
            label = { Text(label) },
            placeholder = { Text(placeholder) },
            singleLine = singleLine,
            minLines = if (singleLine) 1 else 3,
            modifier = Modifier.fillMaxWidth(),
        )
        Text(
            when (state) {
                SaveState.Idle -> ""
                SaveState.Saving -> "Saving…"
                SaveState.Saved -> "Saved"
                SaveState.Failed -> "Couldn't save. Check your connection."
            },
            style = MaterialTheme.typography.labelSmall,
            color = if (state == SaveState.Failed) MaterialTheme.colorScheme.error
            else MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier
                .padding(top = 2.dp)
                .height(16.dp),
        )
    }
}
