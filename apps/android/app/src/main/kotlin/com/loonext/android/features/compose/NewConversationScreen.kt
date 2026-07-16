package com.loonext.android.features.compose

import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.Send
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Description
import androidx.compose.material.icons.filled.Image
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.InputChip
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.runtime.snapshotFlow
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.loonext.android.AppGraph
import com.loonext.android.core.model.Contact
import com.loonext.android.core.model.Me
import com.loonext.android.core.model.NumberStatus
import com.loonext.android.core.model.PhoneNumberSummary
import com.loonext.android.core.net.ApiErrorCode
import com.loonext.android.core.net.ApiException
import com.loonext.android.features.thread.ComposeBody
import com.loonext.android.features.thread.MessagingRepository
import com.loonext.android.ui.common.CenteredError
import com.loonext.android.ui.common.CenteredLoading
import com.loonext.android.ui.common.InitialsAvatar
import com.loonext.android.ui.common.LoadState
import com.loonext.android.ui.common.formatPhone
import com.loonext.android.ui.common.userMessage
import java.time.format.DateTimeFormatter
import java.util.UUID
import kotlinx.coroutines.FlowPreview
import kotlinx.coroutines.flow.debounce
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.launch

private val localTimeFormat = DateTimeFormatter.ofPattern("h:mm a")

private data class ComposeIntentKey(
    val recipient: String,
    val body: String,
    val photoIds: List<String>,
)

/**
 * Outbound-first compose: pick a contact or type a US/CA number (live NANP
 * formatting), see the destination's local time, write the first message, and
 * send with a client Idempotency-Key. A quiet-hours 409 opens a confirm dialog
 * that resends with quiet_hours_confirmed=true under the SAME key.
 */
@OptIn(FlowPreview::class)
@Composable
fun NewConversationScreen(
    graph: AppGraph,
    companyId: String,
    me: Me,
    prefillContactId: String?,
    onCreated: (conversationId: String) -> Unit,
    onBack: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val repo = remember(graph) { MessagingRepository(graph.api) }
    val drafts = remember { ComposerDrafts(context.applicationContext) }
    val snackbar = remember { SnackbarHostState() }

    BackHandler(onBack = onBack)

    // --- Bootstrap: sending numbers + optional contact prefill. ---
    var bootstrap by remember(companyId) {
        mutableStateOf<LoadState<List<PhoneNumberSummary>>>(LoadState.Loading)
    }
    var businessName by remember { mutableStateOf<String?>(null) }
    var selectedContact by remember { mutableStateOf<Contact?>(null) }
    var bootKey by remember { mutableStateOf(0) }
    LaunchedEffect(companyId, bootKey) {
        bootstrap = try {
            val meView = graph.meRepo.me(companyId)
            businessName = meView.company?.name
            val numbers = meView.company?.numbers.orEmpty()
                .filter { it.status == NumberStatus.ACTIVE }
            if (prefillContactId != null && selectedContact == null) {
                runCatching { selectedContact = repo.contact(companyId, prefillContactId) }
            }
            LoadState.Ready(numbers)
        } catch (cause: Exception) {
            LoadState.Failed(cause.userMessage())
        }
    }

    when (val boot = bootstrap) {
        is LoadState.Loading -> {
            CenteredLoading(modifier)
            return
        }

        is LoadState.Failed -> {
            CenteredError(boot.message, onRetry = { bootKey++ }, modifier)
            return
        }

        is LoadState.Ready -> NewConversationLoaded(
            repo = repo,
            drafts = drafts,
            snackbar = snackbar,
            companyId = companyId,
            numbers = boot.value,
            businessName = businessName,
            selectedContact = selectedContact,
            onContactChange = { selectedContact = it },
            onCreated = onCreated,
            onBack = onBack,
            modifier = modifier,
        )
    }
}

@OptIn(FlowPreview::class)
@Composable
private fun NewConversationLoaded(
    repo: MessagingRepository,
    drafts: ComposerDrafts,
    snackbar: SnackbarHostState,
    companyId: String,
    numbers: List<PhoneNumberSummary>,
    businessName: String?,
    selectedContact: Contact?,
    onContactChange: (Contact?) -> Unit,
    onCreated: (String) -> Unit,
    onBack: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()

    var recipientInput by remember { mutableStateOf("") }
    var contactMatches by remember { mutableStateOf<List<Contact>>(emptyList()) }
    var fromNumberId by remember(numbers) {
        mutableStateOf(numbers.firstOrNull()?.id)
    }
    val composer = rememberComposerState(ComposerDrafts.NEW_CONVERSATION, drafts)
    var sending by remember { mutableStateOf(false) }
    var quietHoursPrompt by remember { mutableStateOf<ComposeBody?>(null) }
    var templatePickerOpen by remember { mutableStateOf(false) }
    var lastIntent by remember { mutableStateOf<Pair<ComposeIntentKey, String>?>(null) }

    // Contact search over the recipient input (debounced, ≥2 chars).
    LaunchedEffect(Unit) {
        snapshotFlow { recipientInput }
            .debounce(250)
            .distinctUntilChanged()
            .collect { raw ->
                val q = raw.trim()
                if (q.length < 2) {
                    contactMatches = emptyList()
                    return@collect
                }
                contactMatches = try {
                    repo.contacts(companyId, q = q, limit = 6).data
                } catch (_: Exception) {
                    emptyList()
                }
            }
    }

    val rawDigits = Nanp.nationalDigits(recipientInput)
    val rawE164 = Nanp.toE164(recipientInput)
    val recipientE164 = selectedContact?.phone_e164 ?: rawE164
    val localTime = recipientE164?.let { Nanp.destinationLocalTime(it) }
    val validDestination = recipientE164 != null && Nanp.isUsCaDestination(recipientE164)

    val canSend = !sending &&
        fromNumberId != null &&
        (selectedContact != null || rawE164 != null) &&
        composer.text.isNotBlank()

    fun handleFailure(cause: Exception, body: ComposeBody) {
        sending = false
        if (cause is ApiException &&
            cause.code == ApiErrorCode.QUIET_HOURS_CONFIRMATION_REQUIRED
        ) {
            // lastIntent keeps its key — the confirmed resend replays under it.
            quietHoursPrompt = body
            return
        }
        scope.launch { snackbar.showSnackbar(cause.userMessage()) }
    }

    fun dispatch(body: ComposeBody, key: String) {
        sending = true
        scope.launch {
            try {
                val result = repo.compose(companyId, body, key)
                sending = false
                lastIntent = null
                composer.clearForSend()
                onCreated(result.conversation.id)
            } catch (cause: Exception) {
                handleFailure(cause, body)
            }
        }
    }

    fun send(confirmedQuietHours: Boolean = false, resend: ComposeBody? = null) {
        if (resend == null && !canSend) return
        val photos = composer.photos
        val bodyText = composer.text.trim()
        val recipientKey = selectedContact?.id ?: rawE164 ?: return
        val intentKey = ComposeIntentKey(recipientKey, bodyText, photos.map { it.id })
        val existing = lastIntent
        val key = if (existing != null && existing.first == intentKey) existing.second
        else UUID.randomUUID().toString()
        lastIntent = intentKey to key

        val request = resend?.copy(quiet_hours_confirmed = true) ?: ComposeBody(
            contact_id = selectedContact?.id,
            phone_e164 = if (selectedContact == null) rawE164 else null,
            phone_number_id = fromNumberId ?: return,
            body = bodyText,
            quiet_hours_confirmed = if (confirmedQuietHours) true else null,
            media = photos.takeIf { it.isNotEmpty() }?.map { it.toOutboundMedia() },
        )
        dispatch(request, key)
    }

    val photoPicker = rememberLauncherForActivityResult(
        ActivityResultContracts.PickMultipleVisualMedia(MAX_PHOTOS),
    ) { uris ->
        if (uris.isEmpty()) return@rememberLauncherForActivityResult
        scope.launch {
            var trimmed = false
            for (uri in uris) {
                if (composer.photos.size >= MAX_PHOTOS) {
                    trimmed = true
                    break
                }
                when (val result = preparePhoto(context, uri)) {
                    is PhotoPrepResult.Ready ->
                        composer.photos = composer.photos + result.photo

                    is PhotoPrepResult.Rejected ->
                        snackbar.showSnackbar(result.reason)
                }
            }
            if (trimmed) snackbar.showSnackbar("You can attach up to 3 photos per text.")
        }
    }

    Box(modifier.fillMaxSize()) {
        Column(Modifier.fillMaxSize()) {
            // Header.
            Row(
                Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 4.dp, vertical = 6.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                IconButton(onClick = onBack) {
                    Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Back")
                }
                Text(
                    "New message",
                    style = MaterialTheme.typography.titleMedium,
                    fontWeight = FontWeight.SemiBold,
                )
            }
            HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)

            if (numbers.isEmpty()) {
                Column(
                    Modifier
                        .fillMaxSize()
                        .padding(32.dp),
                    horizontalAlignment = Alignment.CenterHorizontally,
                    verticalArrangement = androidx.compose.foundation.layout.Arrangement.Center,
                ) {
                    Text(
                        "Your number isn't ready yet.",
                        style = MaterialTheme.typography.titleSmall,
                    )
                    Text(
                        "You need an active number to start a conversation. " +
                            "Check the web app for its status.",
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        modifier = Modifier.padding(top = 6.dp),
                    )
                }
                return@Column
            }

            Column(
                Modifier
                    .weight(1f)
                    .verticalScroll(rememberScrollState())
                    .padding(16.dp),
            ) {
                // Recipient.
                if (selectedContact != null) {
                    InputChip(
                        selected = true,
                        onClick = {},
                        label = {
                            Text(
                                (selectedContact.name
                                    ?: formatPhone(selectedContact.phone_e164)) +
                                    if (selectedContact.opted_out) " · Opted out" else "",
                            )
                        },
                        trailingIcon = {
                            Icon(
                                Icons.Filled.Close,
                                contentDescription = "Clear recipient",
                                modifier = Modifier.clickable { onContactChange(null) },
                            )
                        },
                    )
                } else {
                    OutlinedTextField(
                        value = recipientInput,
                        onValueChange = { value ->
                            recipientInput =
                                if (value.any { it.isLetter() }) value
                                else Nanp.formatAsYouType(Nanp.nationalDigits(value))
                        },
                        label = { Text("To — name or phone number") },
                        singleLine = true,
                        supportingText = {
                            when {
                                rawDigits.length == 10 && rawE164 != null &&
                                    !validDestination ->
                                    Text("US and Canadian numbers only.")

                                rawDigits.length == 10 && rawE164 != null ->
                                    Text("Will text ${formatPhone(rawE164)}")

                                else -> Unit
                            }
                        },
                        modifier = Modifier.fillMaxWidth(),
                    )
                    contactMatches.forEach { contact ->
                        Row(
                            Modifier
                                .fillMaxWidth()
                                .clickable {
                                    onContactChange(contact)
                                    recipientInput = ""
                                    contactMatches = emptyList()
                                }
                                .padding(vertical = 8.dp),
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            InitialsAvatar(
                                contact.name ?: formatPhone(contact.phone_e164),
                                size = 32.dp,
                            )
                            Spacer(Modifier.width(10.dp))
                            Column(Modifier.weight(1f)) {
                                Text(
                                    contact.name ?: formatPhone(contact.phone_e164),
                                    style = MaterialTheme.typography.bodyLarge,
                                )
                                Text(
                                    formatPhone(contact.phone_e164) +
                                        if (contact.opted_out) " · Opted out" else "",
                                    style = MaterialTheme.typography.labelSmall,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                                )
                            }
                        }
                        HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
                    }
                }

                // Destination local time hint.
                if (localTime != null) {
                    Text(
                        "It's ${localTime.format(localTimeFormat)} for them.",
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        modifier = Modifier.padding(top = 6.dp),
                    )
                }

                // From-number picker (only when there's a real choice).
                if (numbers.size > 1) {
                    var fromMenuOpen by remember { mutableStateOf(false) }
                    val selected = numbers.firstOrNull { it.id == fromNumberId }
                    Box(Modifier.padding(top = 12.dp)) {
                        Text(
                            "From: ${formatPhone(selected?.number_e164) }",
                            style = MaterialTheme.typography.labelMedium,
                            color = MaterialTheme.colorScheme.primary,
                            modifier = Modifier.clickable { fromMenuOpen = true },
                        )
                        DropdownMenu(
                            expanded = fromMenuOpen,
                            onDismissRequest = { fromMenuOpen = false },
                        ) {
                            numbers.forEach { number ->
                                DropdownMenuItem(
                                    text = { Text(formatPhone(number.number_e164)) },
                                    onClick = {
                                        fromNumberId = number.id
                                        fromMenuOpen = false
                                    },
                                )
                            }
                        }
                    }
                }

                Spacer(Modifier.height(16.dp))

                // Body.
                OutlinedTextField(
                    value = composer.text,
                    onValueChange = { composer.onTextChange(it.take(4096)) },
                    label = { Text("Text message") },
                    minLines = 3,
                    maxLines = 8,
                    modifier = Modifier.fillMaxWidth(),
                )

                if (composer.photos.isNotEmpty()) {
                    PhotoChipsRow(
                        photos = composer.photos,
                        onRemove = { id ->
                            composer.photos = composer.photos.filterNot { it.id == id }
                        },
                        modifier = Modifier.padding(top = 4.dp),
                    )
                }

                Row(
                    Modifier.padding(top = 4.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    IconButton(
                        onClick = {
                            photoPicker.launch(
                                PickVisualMediaRequest(
                                    ActivityResultContracts.PickVisualMedia.ImageOnly,
                                ),
                            )
                        },
                        enabled = composer.photos.size < MAX_PHOTOS,
                    ) {
                        Icon(
                            Icons.Filled.Image,
                            contentDescription = "Attach a photo",
                            tint = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                    IconButton(onClick = { templatePickerOpen = true }) {
                        Icon(
                            Icons.Filled.Description,
                            contentDescription = "Saved replies",
                            tint = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                }

                ComposerHints(
                    text = composer.text,
                    hasMedia = composer.photos.isNotEmpty(),
                    contactName = selectedContact?.name,
                    businessName = businessName,
                    modifier = Modifier.padding(top = 2.dp),
                )
            }

            HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
            Row(
                Modifier
                    .fillMaxWidth()
                    .padding(16.dp)
                    .imePadding(),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Spacer(Modifier.weight(1f))
                Button(onClick = { send() }, enabled = canSend) {
                    Text(if (sending) "Sending…" else "Send")
                    Spacer(Modifier.width(6.dp))
                    Icon(
                        Icons.AutoMirrored.Filled.Send,
                        contentDescription = null,
                        modifier = Modifier.width(16.dp),
                    )
                }
            }
        }
        SnackbarHost(snackbar, modifier = Modifier.align(Alignment.BottomCenter))
    }

    if (templatePickerOpen) {
        TemplatePickerSheet(
            loadTemplates = { repo.templates(companyId).data },
            onPick = { body ->
                templatePickerOpen = false
                val current = composer.text
                composer.onTextChange(
                    if (current.isEmpty()) body
                    else current + (if (current.endsWith(" ")) "" else " ") + body,
                )
            },
            onDismiss = { templatePickerOpen = false },
        )
    }

    quietHoursPrompt?.let { pendingBody ->
        AlertDialog(
            onDismissRequest = { quietHoursPrompt = null },
            title = { Text("It's late where they are") },
            text = {
                Text(
                    buildString {
                        append("It's ")
                        append(
                            localTime?.format(localTimeFormat) ?: "between 8pm and 8am",
                        )
                        append(" at this number. Send anyway?")
                    },
                )
            },
            confirmButton = {
                TextButton(onClick = {
                    quietHoursPrompt = null
                    send(confirmedQuietHours = true, resend = pendingBody)
                }) { Text("Send anyway") }
            },
            dismissButton = {
                TextButton(onClick = { quietHoursPrompt = null }) { Text("Wait") }
            },
        )
    }
}
