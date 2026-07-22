package com.loonext.android.features.compose

import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.ArrowUpward
import androidx.compose.material.icons.outlined.Close
import androidx.compose.material.icons.outlined.Image
import androidx.compose.material.icons.outlined.Schedule
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Surface
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
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.em
import androidx.compose.ui.unit.sp
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
import com.loonext.android.ui.common.PaperCard
import com.loonext.android.ui.common.RowDivider
import com.loonext.android.ui.common.formatPhone
import com.loonext.android.ui.common.userMessage
import com.loonext.android.ui.theme.BrandColor
import java.time.format.DateTimeFormatter
import java.util.UUID
import kotlinx.coroutines.FlowPreview
import kotlinx.coroutines.flow.debounce
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.launch

private val localTimeFormat = DateTimeFormatter.ofPattern("h:mm a")

/** Destination quiet hours (8pm–8am local) — the window the API confirms. */
private const val QUIET_HOURS_START = 20
private const val QUIET_HOURS_END = 8

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

    Box(
        modifier
            .fillMaxSize()
            .background(MaterialTheme.colorScheme.background),
    ) {
        Column(Modifier.fillMaxSize()) {
            // Header: paper close circle · centered muted title.
            Box(
                Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 18.dp, vertical = 8.dp),
            ) {
                PaperCircleButton(
                    icon = Icons.Outlined.Close,
                    contentDescription = "Back",
                    onClick = onBack,
                    modifier = Modifier.align(Alignment.CenterStart),
                )
                Text(
                    "New text",
                    style = MaterialTheme.typography.labelMedium.copy(
                        fontSize = 13.sp,
                        fontWeight = FontWeight.SemiBold,
                    ),
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.align(Alignment.Center),
                )
            }

            if (numbers.isEmpty()) {
                Column(
                    Modifier
                        .fillMaxSize()
                        .padding(horizontal = 18.dp),
                    horizontalAlignment = Alignment.CenterHorizontally,
                    verticalArrangement = Arrangement.Center,
                ) {
                    PaperCard(Modifier.fillMaxWidth()) {
                        Column(Modifier.padding(horizontal = 18.dp, vertical = 20.dp)) {
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
                    }
                }
                return@Column
            }

            Column(
                Modifier
                    .weight(1f)
                    .verticalScroll(rememberScrollState())
                    .padding(start = 20.dp, end = 20.dp, top = 10.dp),
                verticalArrangement = Arrangement.spacedBy(13.dp),
            ) {
                // --- To. ---
                Column {
                    MicroLabel("To")
                    if (selectedContact != null) {
                        RecipientChip(
                            contact = selectedContact,
                            onClear = { onContactChange(null) },
                        )
                    } else {
                        RecipientField(
                            value = recipientInput,
                            onValueChange = { value ->
                                recipientInput =
                                    if (value.any { it.isLetter() }) value
                                    else Nanp.formatAsYouType(Nanp.nationalDigits(value))
                            },
                        )
                        val hint = when {
                            rawDigits.length == 10 && rawE164 != null && !validDestination ->
                                "US and Canadian numbers only."

                            rawDigits.length == 10 && rawE164 != null &&
                                contactMatches.isEmpty() ->
                                "No match in contacts — this starts a new conversation."

                            rawDigits.length == 10 && rawE164 != null ->
                                "Will text ${formatPhone(rawE164)}"

                            else -> null
                        }
                        if (hint != null) {
                            Text(
                                hint,
                                style = MaterialTheme.typography.labelSmall.copy(
                                    fontSize = 10.5.sp,
                                ),
                                color = MaterialTheme.colorScheme.onSurfaceVariant
                                    .copy(alpha = 0.75f),
                                modifier = Modifier.padding(start = 4.dp, top = 5.dp),
                            )
                        }
                        if (contactMatches.isNotEmpty()) {
                            PaperCard(
                                Modifier
                                    .fillMaxWidth()
                                    .padding(top = 8.dp),
                            ) {
                                contactMatches.forEachIndexed { index, contact ->
                                    if (index > 0) RowDivider()
                                    ContactMatchRow(
                                        contact = contact,
                                        onClick = {
                                            onContactChange(contact)
                                            recipientInput = ""
                                            contactMatches = emptyList()
                                        },
                                    )
                                }
                            }
                        }
                    }
                }

                // Destination local time: cream quiet-hours notice, else a
                // quiet muted hint.
                if (localTime != null) {
                    val inQuietHours =
                        localTime.hour >= QUIET_HOURS_START || localTime.hour < QUIET_HOURS_END
                    if (inQuietHours) {
                        QuietHoursNotice(
                            text = "It's ${localTime.format(localTimeFormat)} for this " +
                                "customer — we'll ask before sending this late.",
                        )
                    } else {
                        Text(
                            "It's ${localTime.format(localTimeFormat)} for them.",
                            style = MaterialTheme.typography.labelSmall.copy(
                                fontSize = 10.5.sp,
                            ),
                            color = MaterialTheme.colorScheme.onSurfaceVariant
                                .copy(alpha = 0.75f),
                            modifier = Modifier.padding(start = 4.dp),
                        )
                    }
                }

                // From-number picker (only when there's a real choice).
                if (numbers.size > 1) {
                    var fromMenuOpen by remember { mutableStateOf(false) }
                    val selected = numbers.firstOrNull { it.id == fromNumberId }
                    Box {
                        Text(
                            "From: ${formatPhone(selected?.number_e164)}",
                            style = MaterialTheme.typography.labelMedium.copy(
                                fontWeight = FontWeight.SemiBold,
                            ),
                            color = MaterialTheme.colorScheme.secondary,
                            modifier = Modifier
                                .clickable { fromMenuOpen = true }
                                .padding(horizontal = 4.dp),
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

                // --- Message. ---
                Column {
                    MicroLabel("Message")
                    MessageBox(
                        value = composer.text,
                        onValueChange = { composer.onTextChange(it.take(4096)) },
                    )
                    Row(
                        Modifier
                            .fillMaxWidth()
                            .padding(horizontal = 4.dp, vertical = 6.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        val meter = segmentMeter(composer.text, composer.photos.isNotEmpty())
                        val meta = when {
                            meter.visible -> meter.label
                            composer.text.isNotEmpty() ->
                                "${composer.text.length} characters"

                            else -> null
                        }
                        if (meta != null) {
                            Text(
                                meta,
                                style = MaterialTheme.typography.labelSmall.copy(
                                    fontSize = 10.5.sp,
                                ),
                                color = if (meter.warn) NoteAmber.ink()
                                else MaterialTheme.colorScheme.onSurfaceVariant
                                    .copy(alpha = 0.75f),
                            )
                        }
                        Spacer(Modifier.weight(1f))
                        Text(
                            "Templates",
                            style = MaterialTheme.typography.labelSmall.copy(
                                fontSize = 10.5.sp,
                                fontWeight = FontWeight.SemiBold,
                            ),
                            color = MaterialTheme.colorScheme.secondary,
                            modifier = Modifier
                                .clickable { templatePickerOpen = true }
                                .padding(vertical = 2.dp),
                        )
                    }
                    if (MergeFields.hasMergeFields(composer.text)) {
                        Text(
                            "Sends as: " + MergeFields.applyMergeFields(
                                composer.text,
                                selectedContact?.name,
                                businessName,
                            ),
                            style = MaterialTheme.typography.labelSmall.copy(
                                fontSize = 10.5.sp,
                            ),
                            color = MaterialTheme.colorScheme.onSurfaceVariant
                                .copy(alpha = 0.75f),
                            maxLines = 2,
                            overflow = TextOverflow.Ellipsis,
                            modifier = Modifier.padding(horizontal = 4.dp),
                        )
                    }
                }

                // --- Photos. ---
                if (composer.photos.isNotEmpty()) {
                    PhotoChipsRow(
                        photos = composer.photos,
                        onRemove = { id ->
                            composer.photos = composer.photos.filterNot { it.id == id }
                        },
                    )
                }
                Row(verticalAlignment = Alignment.CenterVertically) {
                    PaperCircleButton(
                        icon = Icons.Outlined.Image,
                        contentDescription = "Attach a photo",
                        onClick = {
                            photoPicker.launch(
                                PickVisualMediaRequest(
                                    ActivityResultContracts.PickVisualMedia.ImageOnly,
                                ),
                            )
                        },
                        enabled = composer.photos.size < MAX_PHOTOS,
                    )
                }

                Spacer(Modifier.height(4.dp))
            }

            // --- Send bar: full-width ink pill with a lime send mark. ---
            SendPill(
                label = if (sending) "Sending…" else "Send text",
                enabled = canSend,
                onClick = { send() },
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 20.dp, vertical = 12.dp)
                    .imePadding(),
            )
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

/** Tracked uppercase micro-label above a field group ("TO", "MESSAGE"). */
@Composable
private fun MicroLabel(text: String) {
    Text(
        text.uppercase(),
        style = MaterialTheme.typography.labelSmall.copy(
            fontSize = 10.5.sp,
            fontWeight = FontWeight.Bold,
            letterSpacing = 0.1.em,
        ),
        color = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.85f),
        modifier = Modifier.padding(start = 4.dp, bottom = 6.dp),
    )
}

/** 44dp paper circle icon button — the design's header/action affordance. */
@Composable
private fun PaperCircleButton(
    icon: ImageVector,
    contentDescription: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
) {
    Surface(
        onClick = onClick,
        enabled = enabled,
        shape = CircleShape,
        color = MaterialTheme.colorScheme.surface,
        shadowElevation = 1.dp,
        modifier = modifier.size(44.dp),
    ) {
        Box(contentAlignment = Alignment.Center) {
            Icon(
                icon,
                contentDescription = contentDescription,
                tint = MaterialTheme.colorScheme.onSurface.copy(
                    alpha = if (enabled) 1f else 0.4f,
                ),
                modifier = Modifier.size(18.dp),
            )
        }
    }
}

/** The To entry: paper pill, ink focus ring, tabular numerals. */
@Composable
private fun RecipientField(
    value: String,
    onValueChange: (String) -> Unit,
) {
    var focused by remember { mutableStateOf(false) }
    val ring = if (focused) MaterialTheme.colorScheme.primary
    else MaterialTheme.colorScheme.surfaceContainerHigh
    val ringWidth = if (focused) 2.dp else 1.5.dp
    Surface(
        shape = RoundedCornerShape(16.dp),
        color = MaterialTheme.colorScheme.surface,
        modifier = Modifier
            .fillMaxWidth()
            .border(ringWidth, ring, RoundedCornerShape(16.dp)),
    ) {
        BasicTextField(
            value = value,
            onValueChange = onValueChange,
            singleLine = true,
            textStyle = MaterialTheme.typography.bodyLarge.copy(
                fontSize = 15.sp,
                fontWeight = FontWeight.SemiBold,
                fontFeatureSettings = "tnum",
                color = MaterialTheme.colorScheme.onSurface,
            ),
            cursorBrush = SolidColor(MaterialTheme.colorScheme.primary),
            modifier = Modifier
                .fillMaxWidth()
                .onFocusChanged { focused = it.isFocused }
                .padding(horizontal = 15.dp, vertical = 13.dp),
            decorationBox = { inner ->
                Box {
                    if (value.isEmpty()) {
                        Text(
                            "Name or phone number",
                            style = MaterialTheme.typography.bodyLarge.copy(fontSize = 15.sp),
                            color = MaterialTheme.colorScheme.onSurfaceVariant
                                .copy(alpha = 0.7f),
                        )
                    }
                    inner()
                }
            },
        )
    }
}

/** The chosen recipient as a paper pill with a clear affordance. */
@Composable
private fun RecipientChip(
    contact: Contact,
    onClear: () -> Unit,
) {
    Surface(
        shape = RoundedCornerShape(16.dp),
        color = MaterialTheme.colorScheme.surface,
        modifier = Modifier
            .fillMaxWidth()
            .border(2.dp, MaterialTheme.colorScheme.primary, RoundedCornerShape(16.dp)),
    ) {
        Row(
            Modifier.padding(horizontal = 12.dp, vertical = 9.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            InitialsAvatar(contact.name ?: formatPhone(contact.phone_e164), size = 28.dp)
            Spacer(Modifier.width(10.dp))
            Text(
                (contact.name ?: formatPhone(contact.phone_e164)) +
                    if (contact.opted_out) " · Opted out" else "",
                style = MaterialTheme.typography.bodyLarge.copy(
                    fontSize = 15.sp,
                    fontWeight = FontWeight.SemiBold,
                ),
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                modifier = Modifier.weight(1f),
            )
            Icon(
                Icons.Outlined.Close,
                contentDescription = "Clear recipient",
                tint = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier
                    .size(18.dp)
                    .clickable(onClick = onClear),
            )
        }
    }
}

@Composable
private fun ContactMatchRow(
    contact: Contact,
    onClick: () -> Unit,
) {
    Row(
        Modifier
            .fillMaxWidth()
            .clickable(onClick = onClick)
            .padding(horizontal = 16.dp, vertical = 11.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        InitialsAvatar(contact.name ?: formatPhone(contact.phone_e164), size = 32.dp)
        Spacer(Modifier.width(10.dp))
        Column(Modifier.weight(1f)) {
            Text(
                contact.name ?: formatPhone(contact.phone_e164),
                style = MaterialTheme.typography.bodyMedium.copy(
                    fontSize = 13.5.sp,
                    fontWeight = FontWeight.SemiBold,
                ),
            )
            Text(
                formatPhone(contact.phone_e164) +
                    if (contact.opted_out) " · Opted out" else "",
                style = MaterialTheme.typography.labelSmall.copy(fontSize = 11.5.sp),
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
}

/** The message body well: paper, soft inset ring, roomy min height. */
@Composable
private fun MessageBox(
    value: String,
    onValueChange: (String) -> Unit,
) {
    Surface(
        shape = RoundedCornerShape(18.dp),
        color = MaterialTheme.colorScheme.surface,
        modifier = Modifier
            .fillMaxWidth()
            .border(
                1.5.dp,
                MaterialTheme.colorScheme.surfaceContainerHigh,
                RoundedCornerShape(18.dp),
            ),
    ) {
        BasicTextField(
            value = value,
            onValueChange = onValueChange,
            textStyle = MaterialTheme.typography.bodyMedium.copy(
                fontSize = 14.sp,
                lineHeight = 21.sp,
                color = MaterialTheme.colorScheme.onSurface,
            ),
            cursorBrush = SolidColor(MaterialTheme.colorScheme.primary),
            modifier = Modifier
                .fillMaxWidth()
                .heightIn(min = 96.dp)
                .padding(horizontal = 15.dp, vertical = 14.dp),
            decorationBox = { inner ->
                Box {
                    if (value.isEmpty()) {
                        Text(
                            "Text message",
                            style = MaterialTheme.typography.bodyMedium.copy(
                                fontSize = 14.sp,
                            ),
                            color = MaterialTheme.colorScheme.onSurfaceVariant
                                .copy(alpha = 0.7f),
                        )
                    }
                    inner()
                }
            },
        )
    }
}

/** Cream quiet-hours notice — informational, never an error. */
@Composable
private fun QuietHoursNotice(text: String) {
    val dark = isSystemInDarkTheme()
    val bg = if (dark) NoteAmber.DarkBg else BrandColor.Cream
    val ink = NoteAmber.ink()
    Row(
        Modifier
            .fillMaxWidth()
            .background(bg, RoundedCornerShape(14.dp))
            .padding(horizontal = 13.dp, vertical = 10.dp),
        verticalAlignment = Alignment.Top,
    ) {
        Icon(
            Icons.Outlined.Schedule,
            contentDescription = null,
            tint = ink,
            modifier = Modifier
                .padding(top = 2.dp)
                .size(13.dp),
        )
        Spacer(Modifier.width(8.dp))
        Text(
            text,
            style = MaterialTheme.typography.labelSmall.copy(
                fontSize = 11.5.sp,
                lineHeight = 17.sp,
            ),
            color = ink,
        )
    }
}

/** Full-width ink send pill with the lime action mark. */
@Composable
private fun SendPill(
    label: String,
    enabled: Boolean,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val alpha = if (enabled) 1f else 0.5f
    Surface(
        onClick = onClick,
        enabled = enabled,
        shape = CircleShape,
        color = MaterialTheme.colorScheme.primary.copy(alpha = alpha),
        modifier = modifier,
    ) {
        Row(
            Modifier.padding(start = 22.dp, top = 8.dp, bottom = 8.dp, end = 8.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(
                label,
                style = MaterialTheme.typography.bodyLarge.copy(
                    fontSize = 15.sp,
                    fontWeight = FontWeight.SemiBold,
                ),
                color = MaterialTheme.colorScheme.onPrimary,
                modifier = Modifier.weight(1f),
            )
            Surface(
                shape = CircleShape,
                color = MaterialTheme.colorScheme.tertiary,
                modifier = Modifier.size(42.dp),
            ) {
                Box(contentAlignment = Alignment.Center) {
                    Icon(
                        Icons.Outlined.ArrowUpward,
                        contentDescription = null,
                        tint = MaterialTheme.colorScheme.onTertiary,
                        modifier = Modifier.size(17.dp),
                    )
                }
            }
        }
    }
}
