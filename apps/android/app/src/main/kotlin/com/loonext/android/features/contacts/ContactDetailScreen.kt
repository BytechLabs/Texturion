package com.loonext.android.features.contacts

import android.Manifest
import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
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
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ArrowBack
import androidx.compose.material.icons.automirrored.outlined.Chat
import androidx.compose.material.icons.automirrored.outlined.KeyboardArrowRight
import androidx.compose.material.icons.outlined.Call
import androidx.compose.material.icons.outlined.Check
import androidx.compose.material.icons.outlined.ContentCopy
import androidx.compose.material.icons.outlined.QuestionMark
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
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
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.loonext.android.AppGraph
import com.loonext.android.core.model.Contact
import com.loonext.android.core.model.ConversationListItem
import com.loonext.android.core.model.Member
import com.loonext.android.core.net.ApiErrorCode
import com.loonext.android.core.net.ApiException
import com.loonext.android.telephony.SoftphoneManager
import com.loonext.android.ui.common.CenteredError
import com.loonext.android.ui.common.CenteredLoading
import com.loonext.android.ui.common.DsChip
import com.loonext.android.ui.common.LoadState
import com.loonext.android.ui.common.PaperCard
import com.loonext.android.ui.common.RowDivider
import com.loonext.android.ui.common.SectionHeader
import com.loonext.android.ui.common.formatPhone
import com.loonext.android.ui.common.initialsOf
import com.loonext.android.ui.common.relativeTime
import com.loonext.android.ui.common.userMessage
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

/** Auto-save lifecycle for one field: idle → saving → saved / failed. */
internal enum class SaveState { Idle, Saving, Saved, Failed }

/**
 * Contact detail, the native sibling of the web's /contacts/[id]: auto-saving
 * Name/Address/Notes (800ms after the last keystroke, with a quiet
 * Saving…/Saved status line), the consent strip ('Texted you first' vs
 * 'Consent recorded by {member}', the attester resolved against
 * GET /v1/members), the opted-out banner with 'Mark opted in again' and its
 * START caveat, opt-out and soft-delete behind confirm dialogs, and a
 * contextual primary pill — 'Open conversation' when a thread already
 * exists (found via GET /v1/conversations?q=<phone>), otherwise 'Text'
 * into compose prefill. Both destinations are shell callbacks; the pill
 * hides until the integrator wires them.
 */
@Composable
internal fun ContactDetailScreen(
    graph: AppGraph,
    mutations: ContactMutations,
    companyId: String,
    contactId: String,
    onBack: () -> Unit,
    onOpenConversation: ((conversationId: String) -> Unit)?,
    onComposeNew: ((contactId: String) -> Unit)?,
    modifier: Modifier = Modifier,
    callerIdName: String = "",
) {
    BackHandler(onBack = onBack)

    var state by remember(contactId) { mutableStateOf<LoadState<Contact>>(LoadState.Loading) }
    var members by remember(companyId) { mutableStateOf<List<Member>>(emptyList()) }
    var conversation by remember(contactId) { mutableStateOf<ConversationListItem?>(null) }
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
    // #82: the primary pill is contextual — find this contact's existing
    // thread once the phone is known. A lookup failure just leaves the
    // compose fallback, which reuses the same thread on send anyway.
    val phone = (state as? LoadState.Ready)?.value?.phone_e164
    LaunchedEffect(phone) {
        if (phone == null) return@LaunchedEffect
        runCatching { mutations.findConversation(companyId, phone) }
            .onSuccess { conversation = it }
    }

    Column(modifier.fillMaxSize()) {
        // Paper-circle back button · centered muted crumb · balancing spacer.
        Row(
            Modifier
                .fillMaxWidth()
                .padding(horizontal = 18.dp, vertical = 8.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            PaperCircleButton(
                onClick = onBack,
                contentDescription = "Back to contacts",
            )
            Text(
                "Contact",
                style = MaterialTheme.typography.labelMedium.copy(
                    fontSize = 13.sp,
                    fontWeight = FontWeight.SemiBold,
                ),
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                textAlign = TextAlign.Center,
                modifier = Modifier.weight(1f),
            )
            Spacer(Modifier.size(44.dp))
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
                graph = graph,
                mutations = mutations,
                companyId = companyId,
                callerIdName = callerIdName,
                contact = current.value,
                members = members,
                conversation = conversation,
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
    graph: AppGraph,
    mutations: ContactMutations,
    companyId: String,
    callerIdName: String,
    contact: Contact,
    members: List<Member>,
    conversation: ConversationListItem?,
    onChanged: () -> Unit,
    onDeleted: () -> Unit,
    onOpenConversation: ((String) -> Unit)?,
    onComposeNew: ((String) -> Unit)?,
) {
    val scope = rememberCoroutineScope()
    val clipboard = LocalClipboardManager.current
    val context = LocalContext.current

    var actionError by remember(contact.id) { mutableStateOf<String?>(null) }
    var confirmOptOut by remember(contact.id) { mutableStateOf(false) }
    var confirmDelete by remember(contact.id) { mutableStateOf(false) }
    var working by remember(contact.id) { mutableStateOf(false) }

    // Call (#165): authorize + place via the softphone (contact_id — no
    // thread required). Mic preflight BEFORE authorizing; enabled for
    // opted-out contacts (voice consent ≠ SMS consent); coded gate refusals
    // (usage_cap_reached, subscription_inactive, conflict) surface their
    // honest server copy in the existing error line.
    val softphone = remember(graph) { SoftphoneManager.get(context, graph.api) }
    var placingCall by remember(contact.id) { mutableStateOf(false) }
    fun placeCall() {
        if (placingCall) return
        placingCall = true
        actionError = null
        softphone.start(companyId, callerIdName)
        scope.launch {
            try {
                softphone.placeCall(
                    displayName = contact.name?.ifBlank { null }
                        ?: formatPhone(contact.phone_e164),
                    contactId = contact.id,
                )
            } catch (cause: Exception) {
                actionError = cause.userMessage()
            } finally {
                placingCall = false
            }
        }
    }
    val micLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestPermission(),
    ) { granted ->
        if (granted) {
            placeCall()
        } else {
            actionError = "Loonext needs the microphone to place calls. " +
                "Allow it in Settings › Apps › Loonext › Permissions."
        }
    }

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

    val displayName = contact.name?.ifBlank { null } ?: formatPhone(contact.phone_e164)

    Column(
        Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(horizontal = 18.dp),
        verticalArrangement = Arrangement.spacedBy(13.dp),
    ) {
        // Identity header: 78dp tinted squircle, Bricolage name, muted phone.
        Column(
            Modifier
                .fillMaxWidth()
                .padding(top = 6.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Box(
                Modifier
                    .size(78.dp)
                    .background(
                        MaterialTheme.colorScheme.surfaceContainerHigh,
                        RoundedCornerShape(26.dp),
                    ),
                contentAlignment = Alignment.Center,
            ) {
                Text(
                    initialsOf(displayName),
                    style = MaterialTheme.typography.titleLarge.copy(
                        fontSize = 24.sp,
                        fontWeight = FontWeight.SemiBold,
                    ),
                    color = MaterialTheme.colorScheme.onSurface,
                )
            }
            Text(
                displayName,
                style = MaterialTheme.typography.headlineMedium.copy(fontSize = 24.sp),
                color = MaterialTheme.colorScheme.onBackground,
                textAlign = TextAlign.Center,
                modifier = Modifier.padding(top = 10.dp),
            )
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(
                    formatPhone(contact.phone_e164),
                    style = MaterialTheme.typography.bodySmall.copy(fontSize = 12.5.sp),
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                IconButton(
                    onClick = { clipboard.setText(AnnotatedString(contact.phone_e164)) },
                    modifier = Modifier.size(28.dp),
                ) {
                    Icon(
                        Icons.Outlined.ContentCopy,
                        contentDescription = "Copy number",
                        modifier = Modifier.size(13.dp),
                        tint = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }
            if (contact.opted_out) {
                DsChip(
                    "Opted out",
                    container = MaterialTheme.colorScheme.errorContainer,
                    content = MaterialTheme.colorScheme.onErrorContainer,
                    modifier = Modifier.padding(top = 4.dp),
                )
            }

            // Contextual primary pill (#82) beside Call (#165). The messaging
            // destination hides until the shell wires it — a pill that goes
            // nowhere would be a lie; Call needs no shell wiring.
            Row(
                Modifier.padding(top = 10.dp),
                horizontalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                if (conversation != null && onOpenConversation != null) {
                    ActionPill(
                        label = "Open conversation",
                        icon = Icons.AutoMirrored.Outlined.Chat,
                        container = MaterialTheme.colorScheme.primary,
                        content = MaterialTheme.colorScheme.onPrimary,
                        onClick = { onOpenConversation(conversation.id) },
                    )
                } else if (conversation == null && onComposeNew != null) {
                    ActionPill(
                        label = "Text",
                        icon = Icons.AutoMirrored.Outlined.Chat,
                        container = MaterialTheme.colorScheme.primary,
                        content = MaterialTheme.colorScheme.onPrimary,
                        onClick = { onComposeNew(contact.id) },
                    )
                }
                ActionPill(
                    label = if (placingCall) "Calling…" else "Call",
                    icon = Icons.Outlined.Call,
                    container = MaterialTheme.colorScheme.surface,
                    content = MaterialTheme.colorScheme.onSurface,
                    enabled = !placingCall,
                    onClick = {
                        if (softphone.hasMicPermission()) {
                            placeCall()
                        } else {
                            micLauncher.launch(Manifest.permission.RECORD_AUDIO)
                        }
                    },
                )
            }
        }

        if (actionError != null) {
            Text(
                actionError.orEmpty(),
                style = MaterialTheme.typography.bodySmall.copy(fontSize = 12.sp),
                color = MaterialTheme.colorScheme.error,
                textAlign = TextAlign.Center,
                modifier = Modifier.fillMaxWidth(),
            )
        }

        if (contact.opted_out) {
            PaperCard(Modifier.fillMaxWidth()) {
                Column(Modifier.padding(14.dp)) {
                    Text(
                        "This customer opted out of texting. Sends to them are blocked.",
                        style = MaterialTheme.typography.bodyMedium.copy(fontSize = 12.5.sp),
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

        // Consent strip: lime check when consent is on file, muted otherwise.
        ConsentStrip(
            hasConsent = contact.consent_source != null,
            text = consentLine(
                consentSource = contact.consent_source,
                consentAt = contact.consent_at,
                consentAttestedBy = contact.consent_attested_by,
                memberName = ::memberName,
            ),
        )

        // Info card: label-left auto-saving rows (Name / Address / Notes).
        PaperCard(Modifier.fillMaxWidth()) {
            AutosaveRow(
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
            RowDivider()
            AutosaveRow(
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
            RowDivider()
            AutosaveRow(
                fieldKey = "${contact.id}:notes",
                label = "Notes",
                initial = contact.notes.orEmpty(),
                maxLength = CONTACT_NOTES_MAX,
                placeholder = "Gate code, dog's name, preferred arrival window…",
                singleLine = false,
                idleCaption = "Saves automatically · visible to the crew",
                save = { value ->
                    mutations.updateField(companyId, contact.id, "notes", value)
                },
            )
        }

        // The contact's live thread, when one exists and the shell wired it.
        val conversationRow = conversation
        if (conversationRow != null && onOpenConversation != null) {
            Column {
                SectionHeader("Conversations")
                PaperCard(Modifier.fillMaxWidth()) {
                    Row(
                        Modifier
                            .fillMaxWidth()
                            .clickable { onOpenConversation(conversationRow.id) }
                            .padding(horizontal = 15.dp, vertical = 12.dp),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(11.dp),
                    ) {
                        Column(Modifier.weight(1f)) {
                            Text(
                                conversationRow.last_message?.body
                                    ?.replace('\n', ' ')?.trim()?.ifEmpty { null }
                                    ?: "Conversation",
                                style = MaterialTheme.typography.bodyMedium.copy(
                                    fontSize = 13.sp,
                                    fontWeight = FontWeight.SemiBold,
                                ),
                                maxLines = 1,
                                overflow = TextOverflow.Ellipsis,
                            )
                            Row(
                                Modifier.padding(top = 3.dp),
                                verticalAlignment = Alignment.CenterVertically,
                                horizontalArrangement = Arrangement.spacedBy(6.dp),
                            ) {
                                DsChip(
                                    conversationRow.status
                                        .replaceFirstChar { it.uppercase() },
                                    container =
                                    MaterialTheme.colorScheme.secondaryContainer,
                                    content =
                                    MaterialTheme.colorScheme.onSecondaryContainer,
                                )
                                Text(
                                    "Updated " +
                                        relativeTime(conversationRow.last_message_at),
                                    style = MaterialTheme.typography.labelSmall.copy(
                                        fontSize = 11.sp,
                                    ),
                                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                                )
                            }
                        }
                        Icon(
                            Icons.AutoMirrored.Outlined.KeyboardArrowRight,
                            contentDescription = null,
                            modifier = Modifier.size(16.dp),
                            tint = MaterialTheme.colorScheme.outline,
                        )
                    }
                }
            }
        }

        // §3.3: routine, reversible actions stay quiet — the confirm dialogs
        // carry the weight, not red scare-styling on the triggers.
        Column(
            Modifier
                .fillMaxWidth()
                .padding(top = 2.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            if (!contact.opted_out) {
                FooterAction(
                    label = "Opt out this contact",
                    caption = "Blocks all texting to this number",
                    color = MaterialTheme.colorScheme.error,
                    enabled = !working,
                    onClick = { confirmOptOut = true },
                )
                Spacer(Modifier.height(10.dp))
            }
            FooterAction(
                label = "Delete contact",
                caption = "Texting history stays — they reappear if they text you again",
                color = MaterialTheme.colorScheme.onSurfaceVariant,
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

/** 44dp paper circle with a 17dp stroke back arrow. */
@Composable
private fun PaperCircleButton(
    onClick: () -> Unit,
    contentDescription: String,
    modifier: Modifier = Modifier,
) {
    Surface(
        onClick = onClick,
        shape = CircleShape,
        color = MaterialTheme.colorScheme.surface,
        shadowElevation = 1.dp,
        modifier = modifier.size(44.dp),
    ) {
        Box(contentAlignment = Alignment.Center) {
            Icon(
                Icons.AutoMirrored.Outlined.ArrowBack,
                contentDescription = contentDescription,
                modifier = Modifier.size(17.dp),
            )
        }
    }
}

/** Identity-header action pill: 14dp icon + 12sp SemiBold label. */
@Composable
private fun ActionPill(
    label: String,
    icon: androidx.compose.ui.graphics.vector.ImageVector,
    container: androidx.compose.ui.graphics.Color,
    content: androidx.compose.ui.graphics.Color,
    onClick: () -> Unit,
    enabled: Boolean = true,
) {
    Surface(
        onClick = onClick,
        enabled = enabled,
        shape = CircleShape,
        color = container,
        contentColor = content,
    ) {
        Row(
            Modifier.padding(horizontal = 17.dp, vertical = 10.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(7.dp),
        ) {
            Icon(icon, contentDescription = null, modifier = Modifier.size(14.dp))
            Text(
                label,
                style = MaterialTheme.typography.labelMedium.copy(
                    fontSize = 12.sp,
                    fontWeight = FontWeight.SemiBold,
                ),
            )
        }
    }
}

/** Paper strip with a 22dp lime-check (or muted question) consent mark. */
@Composable
private fun ConsentStrip(hasConsent: Boolean, text: String) {
    Surface(
        shape = RoundedCornerShape(16.dp),
        color = MaterialTheme.colorScheme.surface,
        modifier = Modifier.fillMaxWidth(),
    ) {
        Row(
            Modifier.padding(horizontal = 14.dp, vertical = 11.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(9.dp),
        ) {
            Box(
                Modifier
                    .size(22.dp)
                    .background(
                        if (hasConsent) {
                            MaterialTheme.colorScheme.tertiary
                        } else {
                            MaterialTheme.colorScheme.surfaceVariant
                        },
                        CircleShape,
                    ),
                contentAlignment = Alignment.Center,
            ) {
                Icon(
                    if (hasConsent) Icons.Outlined.Check else Icons.Outlined.QuestionMark,
                    contentDescription = null,
                    modifier = Modifier.size(12.dp),
                    tint = if (hasConsent) {
                        MaterialTheme.colorScheme.onTertiary
                    } else {
                        MaterialTheme.colorScheme.onSurfaceVariant
                    },
                )
            }
            Text(
                text,
                style = MaterialTheme.typography.bodySmall.copy(
                    fontSize = 12.5.sp,
                    lineHeight = 17.sp,
                ),
                color = if (hasConsent) {
                    MaterialTheme.colorScheme.onSurface
                } else {
                    MaterialTheme.colorScheme.onSurfaceVariant
                },
            )
        }
    }
}

/** Quiet centered footer trigger: 12sp colored label over a 10sp caption. */
@Composable
private fun FooterAction(
    label: String,
    caption: String,
    color: androidx.compose.ui.graphics.Color,
    enabled: Boolean,
    onClick: () -> Unit,
) {
    Column(horizontalAlignment = Alignment.CenterHorizontally) {
        Text(
            label,
            style = MaterialTheme.typography.labelMedium.copy(
                fontSize = 12.sp,
                fontWeight = FontWeight.SemiBold,
            ),
            color = color,
            modifier = Modifier
                .clickable(enabled = enabled, onClick = onClick)
                .padding(horizontal = 12.dp, vertical = 4.dp),
        )
        Text(
            caption,
            style = MaterialTheme.typography.labelSmall.copy(fontSize = 10.sp),
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            textAlign = TextAlign.Center,
        )
    }
}

/**
 * One label-left auto-saving row inside the info card (spec 07): 56dp muted
 * 11sp label, borderless 13sp field, and a reserved 10sp status/caption line
 * ('Saving…' / 'Saved' / a calm failure sentence — or [idleCaption] at rest).
 * Same 800ms-debounce semantics as [AutosaveField].
 */
@Composable
private fun AutosaveRow(
    fieldKey: String,
    label: String,
    initial: String,
    maxLength: Int,
    placeholder: String,
    singleLine: Boolean,
    save: suspend (String?) -> Unit,
    idleCaption: String? = null,
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

    Row(
        Modifier
            .fillMaxWidth()
            .padding(horizontal = 15.dp, vertical = 11.dp),
        verticalAlignment = if (singleLine) Alignment.CenterVertically else Alignment.Top,
    ) {
        Text(
            label,
            style = MaterialTheme.typography.labelSmall.copy(
                fontSize = 11.sp,
                fontWeight = FontWeight.SemiBold,
            ),
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier
                .width(56.dp)
                .padding(top = if (singleLine) 0.dp else 2.dp),
        )
        Column(Modifier.weight(1f)) {
            val textStyle = if (singleLine) {
                MaterialTheme.typography.bodyMedium.copy(
                    fontSize = 13.sp,
                    fontWeight = FontWeight.SemiBold,
                    color = MaterialTheme.colorScheme.onSurface,
                )
            } else {
                MaterialTheme.typography.bodySmall.copy(
                    fontSize = 12.5.sp,
                    lineHeight = 19.sp,
                    color = MaterialTheme.colorScheme.onSurface,
                )
            }
            Box {
                if (value.isEmpty()) {
                    Text(
                        placeholder,
                        style = textStyle.copy(fontWeight = FontWeight.Normal),
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                            .copy(alpha = 0.62f),
                    )
                }
                BasicTextField(
                    value = value,
                    onValueChange = { value = it.take(maxLength) },
                    singleLine = singleLine,
                    maxLines = if (singleLine) 1 else 6,
                    textStyle = textStyle,
                    cursorBrush = SolidColor(MaterialTheme.colorScheme.secondary),
                    modifier = Modifier.fillMaxWidth(),
                )
            }
            Text(
                when (state) {
                    SaveState.Idle -> idleCaption.orEmpty()
                    SaveState.Saving -> "Saving…"
                    SaveState.Saved -> "Saved"
                    SaveState.Failed -> "Couldn't save. Check your connection."
                },
                style = MaterialTheme.typography.labelSmall.copy(fontSize = 10.sp),
                color = if (state == SaveState.Failed) {
                    MaterialTheme.colorScheme.error
                } else {
                    MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.75f)
                },
                modifier = Modifier
                    .padding(top = 3.dp)
                    .height(14.dp),
            )
        }
    }
}

/**
 * G6 auto-save: writes the field 800ms after the last keystroke (blank
 * clears — an explicit null on the wire) with a quiet status line the web
 * renders identically ('Saving…' / 'Saved' / a calm failure sentence). A new
 * keystroke during a pending save restarts the clock; the newest value wins.
 * Internal: the thread contact panel (#165) reuses the exact same field.
 */
@Composable
internal fun AutosaveField(
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
