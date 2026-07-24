package com.loonext.android.features.thread

import androidx.compose.foundation.LocalIndication
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.IntrinsicSize
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.AddTask
import androidx.compose.material.icons.outlined.AutoAwesome
import androidx.compose.material.icons.outlined.Check
import androidx.compose.material.icons.outlined.CheckCircle
import androidx.compose.material.icons.outlined.Close
import androidx.compose.material.icons.outlined.ContentCopy
import androidx.compose.material.icons.outlined.ExpandMore
import androidx.compose.material.icons.outlined.Place
import androidx.compose.material.icons.outlined.PushPin
import androidx.compose.material.icons.outlined.RadioButtonUnchecked
import androidx.compose.material.icons.outlined.Refresh
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DatePicker
import androidx.compose.material3.DatePickerDialog
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.rememberDatePickerState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.em
import androidx.compose.ui.unit.sp
import com.loonext.android.core.data.AiRepository
import com.loonext.android.core.model.AddressProvenance
import com.loonext.android.core.model.Member
import com.loonext.android.core.model.Message
import com.loonext.android.core.model.MessageDirection
import com.loonext.android.core.model.TaskAddressInput
import com.loonext.android.core.model.addressProvenanceLabel
import com.loonext.android.ui.common.AppSheet
import com.loonext.android.ui.common.initialsOf
import com.loonext.android.ui.common.pressScale
import com.loonext.android.ui.common.rememberHaptics
import java.time.Instant
import java.time.LocalDate
import java.time.LocalTime
import java.time.OffsetDateTime
import java.time.ZoneId
import java.time.ZoneOffset
import java.time.format.DateTimeFormatter

/**
 * Long-press actions for one message: copy, done toggle, pin/unpin, retry
 * (failed sends only, honoring the retry rule), and Make a task.
 */
@Composable
fun MessageActionsSheet(
    message: Message,
    onToggleDone: () -> Unit,
    onTogglePin: () -> Unit,
    onRetry: () -> Unit,
    onMakeTask: () -> Unit,
    onCopied: () -> Unit,
    onDismiss: () -> Unit,
) {
    val clipboard = LocalClipboardManager.current
    val haptics = rememberHaptics()
    AppSheet(onDismissRequest = onDismiss) {
        // #180 contract: sheet roots scroll so rows are reachable at ANY
        // viewport height (inert on tall screens).
        Column(Modifier.fillMaxWidth().verticalScroll(rememberScrollState())) {
            if (message.body.isNotBlank()) {
                ActionRow(Icons.Outlined.ContentCopy, "Copy text") {
                    haptics.tap()
                    clipboard.setText(AnnotatedString(message.body))
                    onCopied()
                    onDismiss()
                }
            }
            ActionRow(
                icon = if (message.done_at == null) Icons.Outlined.RadioButtonUnchecked
                else Icons.Outlined.CheckCircle,
                label = if (message.done_at == null) "Mark done" else "Mark not done",
            ) {
                haptics.confirm()
                onToggleDone()
                onDismiss()
            }
            ActionRow(
                icon = Icons.Outlined.PushPin,
                label = if (message.pinned_at == null) "Pin message" else "Unpin message",
            ) {
                haptics.tap()
                onTogglePin()
                onDismiss()
            }
            if (message.retryable) {
                ActionRow(Icons.Outlined.Refresh, "Retry send") {
                    haptics.confirm()
                    onRetry()
                    onDismiss()
                }
            }
            if (!message.has_task && message.promoted_task == null &&
                message.direction != MessageDirection.NOTE
            ) {
                ActionRow(Icons.Outlined.AddTask, "Make a task") {
                    haptics.tap()
                    onMakeTask()
                    // The sheet closes; the task sheet opens from the screen.
                }
            }
            Spacer(Modifier.height(24.dp))
        }
    }
}

@Composable
private fun ActionRow(icon: ImageVector, label: String, onClick: () -> Unit) {
    Row(
        Modifier
            .fillMaxWidth()
            .clickable(onClick = onClick)
            .padding(horizontal = 20.dp, vertical = 14.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(
            icon,
            contentDescription = null,
            tint = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.size(20.dp),
        )
        Spacer(Modifier.width(16.dp))
        Text(
            label,
            style = MaterialTheme.typography.bodyLarge.copy(fontWeight = FontWeight.Medium),
        )
    }
}

// ---------------------------------------------------------------------------
// Make a task — from a message (spec 22)
// ---------------------------------------------------------------------------

/** One picked due-time option; null iso = no due date. */
private data class DueChoice(val label: String, val iso: String?)

private val pickedDueFormat = DateTimeFormatter.ofPattern("MMM d, h a")

/** The 6 structured address fields as editable strings ("" = absent). */
private data class AddressFields(
    val street: String = "",
    val unit: String = "",
    val city: String = "",
    val state: String = "",
    val postalCode: String = "",
    val country: String = "",
) {
    fun isEmpty(): Boolean =
        street.isBlank() && unit.isBlank() && city.isBlank() &&
            state.isBlank() && postalCode.isBlank() && country.isBlank()
}

/** A UTC/offset ISO instant → a short "MMM d, h a" label in [zone] for a chip. */
private fun suggestedDueLabel(iso: String, zone: ZoneId): String =
    runCatching { OffsetDateTime.parse(iso).toInstant() }
        .recoverCatching { Instant.parse(iso) }
        .getOrNull()
        ?.atZone(zone)?.format(pickedDueFormat)
        ?: "Suggested time"

/**
 * "Make a task" sheet: prefilled title, the quoted source message, an
 * assignee chip row, due chips (Today · Tomorrow 9 AM · Pick a time…), a
 * collapsible structured job address, and the ink Create pill. #214: when the
 * company opted into AI enrichment (Settings → AI) and the message text is
 * non-empty, the sheet infers a due date/time and/or a structured address from
 * the text — each a SUGGESTION the user reviews and edits (any address edit
 * marks it "manual"). Assignee + due + the confirmed address ride the same
 * POST /v1/tasks create; enrichment never blocks it.
 */
@Composable
fun MakeTaskSheet(
    message: Message,
    contactName: String,
    members: List<Member>,
    aiRepo: AiRepository,
    companyId: String,
    conversationId: String,
    onCreate: (
        title: String,
        assignedUserId: String?,
        dueAtIso: String?,
        address: TaskAddressInput?,
    ) -> Unit,
    onDismiss: () -> Unit,
) {
    var title by remember {
        mutableStateOf(message.body.trim().take(120).ifBlank { "Follow up" })
    }
    var assigneeId by remember { mutableStateOf<String?>(null) }
    var due by remember { mutableStateOf<DueChoice?>(null) }
    var dueSuggested by remember { mutableStateOf(false) }
    var pickerOpen by remember { mutableStateOf(false) }
    val zone = remember { ZoneId.systemDefault() }
    val haptics = rememberHaptics()

    // #214 enrichment: the structured address + its provenance, the collapsible
    // state, and the in-flight spinner. Editing any field marks it "manual".
    var addr by remember { mutableStateOf(AddressFields()) }
    var addrProvenance by remember { mutableStateOf<String?>(null) }
    var addrOpen by remember { mutableStateOf(false) }
    var enriching by remember { mutableStateOf(false) }

    fun editAddr(update: (AddressFields) -> AddressFields) {
        addr = update(addr)
        addrProvenance = AddressProvenance.MANUAL
    }

    // Enrich once when the sheet opens: resolve the company's AI settings, and
    // if a toggle is on and the message text is non-empty, pre-fill the due (if
    // still empty) and/or the address. The enrich call is session-cached per
    // (company, message), so reopening this sheet never re-spends an AI call.
    LaunchedEffect(message.id) {
        val settings = runCatching { aiRepo.getAiSettings(companyId) }.getOrNull()
            ?: return@LaunchedEffect
        if (!settings.enrich_task_address && !settings.enrich_task_due) return@LaunchedEffect
        val text = message.body.trim()
        if (text.isEmpty()) return@LaunchedEffect

        enriching = true
        val result = aiRepo.enrichTask(companyId, text, message.id, conversationId)
        enriching = false
        if (result.enrichment_disabled) return@LaunchedEffect

        if (settings.enrich_task_due && result.due_at != null && due == null) {
            due = DueChoice(suggestedDueLabel(result.due_at, zone), result.due_at)
            dueSuggested = true
        }
        val suggested = result.address
        if (settings.enrich_task_address && suggested != null) {
            addr = AddressFields(
                street = suggested.street.orEmpty(),
                unit = suggested.unit.orEmpty(),
                city = suggested.city.orEmpty(),
                state = suggested.state.orEmpty(),
                postalCode = suggested.postal_code.orEmpty(),
                country = suggested.country.orEmpty(),
            )
            addrProvenance = result.address_provenance
            addrOpen = true
        }
    }

    AppSheet(
        onDismissRequest = onDismiss,
        containerColor = MaterialTheme.colorScheme.background,
    ) {
        // #180 contract: sheet roots scroll so every field is reachable at
        // ANY viewport height (inert on tall screens).
        Column(
            Modifier
                .fillMaxWidth()
                .verticalScroll(rememberScrollState())
                .padding(horizontal = 20.dp),
            verticalArrangement = Arrangement.spacedBy(15.dp),
        ) {
            // Header: title + provenance + close.
            Row(verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.weight(1f)) {
                    Text(
                        "New task",
                        style = MaterialTheme.typography.titleLarge.copy(
                            fontSize = 21.sp,
                            fontWeight = FontWeight.SemiBold,
                            letterSpacing = (-0.01).em,
                        ),
                    )
                    Text(
                        "From $contactName's message · posts to the thread",
                        style = MaterialTheme.typography.bodySmall.copy(fontSize = 12.sp),
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        modifier = Modifier.padding(top = 3.dp),
                    )
                }
                Box(
                    Modifier
                        .size(34.dp)
                        .background(MaterialTheme.colorScheme.surfaceContainer, CircleShape)
                        .clickable(onClick = onDismiss),
                    contentAlignment = Alignment.Center,
                ) {
                    Icon(
                        Icons.Outlined.Close,
                        contentDescription = "Close",
                        tint = MaterialTheme.colorScheme.onSurfaceVariant,
                        modifier = Modifier.size(15.dp),
                    )
                }
            }

            // The quoted source message, lime-barred.
            QuotedMessageWell(message = message, contactName = contactName, zone = zone)

            // Title.
            Column {
                TaskFieldLabel("Title")
                BasicTextField(
                    value = title,
                    onValueChange = { title = it.take(200) },
                    textStyle = MaterialTheme.typography.bodyMedium.copy(
                        fontSize = 14.5.sp,
                        fontWeight = FontWeight.SemiBold,
                        color = MaterialTheme.colorScheme.onSurface,
                    ),
                    cursorBrush = SolidColor(MaterialTheme.colorScheme.primary),
                    decorationBox = { inner ->
                        Box(
                            Modifier
                                .fillMaxWidth()
                                .background(
                                    MaterialTheme.colorScheme.surface,
                                    RoundedCornerShape(16.dp),
                                )
                                .border(
                                    1.5.dp,
                                    MaterialTheme.colorScheme.surfaceContainerHigh,
                                    RoundedCornerShape(16.dp),
                                )
                                .padding(horizontal = 15.dp, vertical = 13.dp),
                        ) { inner() }
                    },
                    modifier = Modifier.fillMaxWidth(),
                )
            }

            // Assignee.
            Column {
                TaskFieldLabel("Assign to")
                Row(
                    Modifier
                        .fillMaxWidth()
                        .horizontalScroll(rememberScrollState()),
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    members.filter { it.deactivated_at == null }.forEach { member ->
                        AssigneeChip(
                            name = member.display_name.ifBlank { "Teammate" },
                            selected = assigneeId == member.user_id,
                            onClick = {
                                haptics.tap()
                                assigneeId =
                                    if (assigneeId == member.user_id) null else member.user_id
                            },
                        )
                    }
                    NobodyChip(
                        selected = assigneeId == null,
                        onClick = {
                            haptics.tap()
                            assigneeId = null
                        },
                    )
                }
            }

            // Due.
            Column {
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(6.dp),
                ) {
                    TaskFieldLabel("Due")
                    // #214: a due read out of the message text is flagged
                    // "Suggested" until the user changes it.
                    if (dueSuggested) SuggestedHint()
                }
                Row(
                    Modifier
                        .fillMaxWidth()
                        .horizontalScroll(rememberScrollState()),
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    val today = DueChoice(
                        label = "Today",
                        iso = LocalDate.now(zone).atTime(LocalTime.of(17, 0))
                            .atZone(zone).toInstant().toString(),
                    )
                    val tomorrow = DueChoice(
                        label = "Tomorrow 9 AM",
                        iso = LocalDate.now(zone).plusDays(1).atTime(LocalTime.of(9, 0))
                            .atZone(zone).toInstant().toString(),
                    )
                    DueChip(
                        label = "Today",
                        selected = due?.label == "Today",
                        onClick = {
                            haptics.tap()
                            dueSuggested = false
                            due = if (due?.label == "Today") null else today
                        },
                    )
                    DueChip(
                        label = "Tomorrow 9 AM",
                        selected = due?.label == "Tomorrow 9 AM",
                        onClick = {
                            haptics.tap()
                            dueSuggested = false
                            due = if (due?.label == "Tomorrow 9 AM") null else tomorrow
                        },
                    )
                    val picked = due != null && due?.label != "Today" &&
                        due?.label != "Tomorrow 9 AM"
                    DueChip(
                        label = if (picked) due?.label.orEmpty() else "Pick a time…",
                        selected = picked,
                        onClick = {
                            haptics.tap()
                            pickerOpen = true
                        },
                    )
                }
            }

            // #214 structured job address — collapsible; auto-opens when
            // enrichment suggests one, with a provenance badge; any edit marks
            // it "manual" (the badge clears).
            AddressSection(
                fields = addr,
                provenance = addrProvenance,
                open = addrOpen,
                enriching = enriching,
                onToggle = {
                    haptics.tap()
                    addrOpen = !addrOpen
                },
                onEdit = ::editAddr,
            )

            // Create pill — gives under the finger like every other pill.
            val canCreate = title.isNotBlank()
            val createInteraction = remember { MutableInteractionSource() }
            Row(
                Modifier
                    .fillMaxWidth()
                    .pressScale(createInteraction)
                    .background(
                        MaterialTheme.colorScheme.primary.copy(
                            alpha = if (canCreate) 1f else 0.5f,
                        ),
                        CircleShape,
                    )
                    .clickable(
                        interactionSource = createInteraction,
                        indication = LocalIndication.current,
                        enabled = canCreate,
                    ) {
                        haptics.confirm()
                        val address = if (addr.isEmpty()) {
                            null
                        } else {
                            TaskAddressInput(
                                street = addr.street.trim().ifEmpty { null },
                                unit = addr.unit.trim().ifEmpty { null },
                                city = addr.city.trim().ifEmpty { null },
                                state = addr.state.trim().ifEmpty { null },
                                postal_code = addr.postalCode.trim().ifEmpty { null },
                                country = addr.country.trim().ifEmpty { null },
                                provenance = addrProvenance ?: AddressProvenance.MANUAL,
                            )
                        }
                        onCreate(title.trim(), assigneeId, due?.iso, address)
                    }
                    .padding(start = 22.dp, top = 8.dp, bottom = 8.dp, end = 8.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(
                    "Create task",
                    style = MaterialTheme.typography.titleSmall.copy(
                        fontSize = 15.sp,
                        fontWeight = FontWeight.SemiBold,
                    ),
                    color = MaterialTheme.colorScheme.onPrimary,
                    modifier = Modifier.weight(1f),
                )
                Box(
                    Modifier
                        .size(42.dp)
                        .background(MaterialTheme.colorScheme.tertiary, CircleShape),
                    contentAlignment = Alignment.Center,
                ) {
                    Icon(
                        Icons.Outlined.Check,
                        contentDescription = null,
                        tint = MaterialTheme.colorScheme.onTertiary,
                        modifier = Modifier.size(18.dp),
                    )
                }
            }

            Spacer(Modifier.height(22.dp))
        }
    }

    if (pickerOpen) {
        val pickerState = rememberDatePickerState(
            initialSelectedDateMillis = Instant.now().toEpochMilli(),
        )
        DatePickerDialog(
            onDismissRequest = { pickerOpen = false },
            confirmButton = {
                TextButton(onClick = {
                    val millis = pickerState.selectedDateMillis
                    if (millis != null) {
                        val date = Instant.ofEpochMilli(millis)
                            .atZone(ZoneOffset.UTC).toLocalDate()
                        val instant = date.atTime(LocalTime.of(9, 0))
                            .atZone(zone).toInstant()
                        due = DueChoice(
                            label = instant.atZone(zone).format(pickedDueFormat),
                            iso = instant.toString(),
                        )
                        dueSuggested = false
                    }
                    pickerOpen = false
                }) { Text("Set due date") }
            },
            dismissButton = {
                TextButton(onClick = { pickerOpen = false }) { Text("Cancel") }
            },
        ) { DatePicker(state = pickerState) }
    }
}

/** The lime-barred quote of the source message ("from this message"). */
@Composable
private fun QuotedMessageWell(message: Message, contactName: String, zone: ZoneId) {
    Row(
        Modifier
            .fillMaxWidth()
            .height(IntrinsicSize.Min)
            .background(MaterialTheme.colorScheme.surfaceContainer, RoundedCornerShape(16.dp))
            .padding(horizontal = 13.dp, vertical = 10.dp),
    ) {
        Box(
            Modifier
                .width(3.dp)
                .fillMaxHeight()
                .background(MaterialTheme.colorScheme.tertiary, CircleShape),
        )
        Spacer(Modifier.width(9.dp))
        Column(Modifier.weight(1f)) {
            Text(
                "“${message.body.trim().ifBlank { "Photo" }}”",
                style = MaterialTheme.typography.bodySmall.copy(
                    fontSize = 12.5.sp,
                    lineHeight = 18.sp,
                ),
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                maxLines = 3,
                overflow = TextOverflow.Ellipsis,
            )
            val day = localDayOf(message.created_at, zone)
            val whenLabel = buildString {
                if (day != null) {
                    append(dayLabel(day, LocalDate.now(zone)))
                    append(" ")
                }
                append(bubbleTime(message.created_at))
            }
            val author =
                if (message.direction == MessageDirection.INBOUND) contactName else "You"
            Text(
                "$author · $whenLabel",
                style = MaterialTheme.typography.labelSmall.copy(
                    fontSize = 10.5.sp,
                    fontWeight = FontWeight.SemiBold,
                ),
                color = MaterialTheme.colorScheme.outline,
                modifier = Modifier.padding(top = 3.dp),
            )
        }
    }
}

/** Tracked-uppercase micro field label ("TITLE", "ASSIGN TO", "DUE"). */
@Composable
private fun TaskFieldLabel(text: String) {
    Text(
        text.uppercase(),
        style = MaterialTheme.typography.labelSmall.copy(
            fontSize = 10.5.sp,
            fontWeight = FontWeight.Bold,
            letterSpacing = 0.1.em,
        ),
        color = MaterialTheme.colorScheme.onSurfaceVariant,
        modifier = Modifier.padding(start = 4.dp, bottom = 6.dp),
    )
}

/** One member chip: 26dp avatar + name; selected = ink ring + olive check. */
@Composable
private fun AssigneeChip(name: String, selected: Boolean, onClick: () -> Unit) {
    Row(
        Modifier
            .clip(CircleShape)
            .background(MaterialTheme.colorScheme.surface)
            .let {
                if (selected) it.border(2.dp, MaterialTheme.colorScheme.primary, CircleShape)
                else it
            }
            .clickable(onClick = onClick)
            .padding(start = 6.dp, top = 6.dp, bottom = 6.dp, end = 13.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(7.dp),
    ) {
        Box(
            Modifier
                .size(26.dp)
                .background(MaterialTheme.colorScheme.secondaryContainer, CircleShape),
            contentAlignment = Alignment.Center,
        ) {
            Text(
                initialsOf(name),
                style = MaterialTheme.typography.labelSmall.copy(
                    fontSize = 10.sp,
                    fontWeight = FontWeight.SemiBold,
                ),
                color = MaterialTheme.colorScheme.onSecondaryContainer,
            )
        }
        Text(
            name,
            style = MaterialTheme.typography.labelMedium.copy(
                fontSize = 12.5.sp,
                fontWeight = if (selected) FontWeight.SemiBold else FontWeight.Medium,
            ),
            color = if (selected) MaterialTheme.colorScheme.onSurface
            else MaterialTheme.colorScheme.onSurfaceVariant,
        )
        if (selected) {
            Icon(
                Icons.Outlined.Check,
                contentDescription = "Selected",
                tint = MaterialTheme.colorScheme.secondary,
                modifier = Modifier.size(13.dp),
            )
        }
    }
}

/** The "Nobody yet" (unassigned) chip. */
@Composable
private fun NobodyChip(selected: Boolean, onClick: () -> Unit) {
    Text(
        "Nobody yet",
        style = MaterialTheme.typography.labelMedium.copy(
            fontSize = 12.5.sp,
            fontWeight = if (selected) FontWeight.SemiBold else FontWeight.Normal,
        ),
        color = if (selected) MaterialTheme.colorScheme.onSurface
        else MaterialTheme.colorScheme.onSurfaceVariant,
        modifier = Modifier
            .clip(CircleShape)
            .background(MaterialTheme.colorScheme.surface)
            .let {
                if (selected) it.border(2.dp, MaterialTheme.colorScheme.primary, CircleShape)
                else it
            }
            .clickable(onClick = onClick)
            .padding(horizontal = 13.dp, vertical = 10.dp),
    )
}

/** One due chip; selected = ink fill, paper text. */
@Composable
private fun DueChip(label: String, selected: Boolean, onClick: () -> Unit) {
    Text(
        label,
        style = MaterialTheme.typography.labelMedium.copy(
            fontSize = 12.5.sp,
            fontWeight = if (selected) FontWeight.SemiBold else FontWeight.Normal,
        ),
        color = if (selected) MaterialTheme.colorScheme.onPrimary
        else MaterialTheme.colorScheme.onSurfaceVariant,
        maxLines = 1,
        modifier = Modifier
            .clip(CircleShape)
            .background(
                if (selected) MaterialTheme.colorScheme.primary
                else MaterialTheme.colorScheme.surface,
            )
            .clickable(onClick = onClick)
            .padding(horizontal = 14.dp, vertical = 8.dp),
    )
}

/** #214 the sparkle + "Suggested" micro hint next to the due label. */
@Composable
private fun SuggestedHint() {
    Row(
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(3.dp),
    ) {
        Icon(
            Icons.Outlined.AutoAwesome,
            contentDescription = null,
            tint = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.size(11.dp),
        )
        Text(
            "Suggested",
            style = MaterialTheme.typography.labelSmall.copy(fontSize = 10.5.sp),
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
    }
}

/** #214 the provenance pill: sparkle + "From the message" / etc. */
@Composable
private fun ProvenanceBadge(label: String) {
    Row(
        Modifier
            .clip(CircleShape)
            .background(MaterialTheme.colorScheme.surfaceContainer)
            .padding(horizontal = 8.dp, vertical = 3.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(3.dp),
    ) {
        Icon(
            Icons.Outlined.AutoAwesome,
            contentDescription = null,
            tint = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.size(11.dp),
        )
        Text(
            label,
            style = MaterialTheme.typography.labelSmall.copy(fontSize = 10.5.sp),
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
    }
}

/**
 * #214 the collapsible structured job-address group. The header carries the
 * place icon, an in-flight spinner while enrichment runs, the provenance badge
 * (only for AI sources), and a rotating chevron. Open reveals the 6 fields.
 */
@Composable
private fun AddressSection(
    fields: AddressFields,
    provenance: String?,
    open: Boolean,
    enriching: Boolean,
    onToggle: () -> Unit,
    onEdit: ((AddressFields) -> AddressFields) -> Unit,
) {
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Row(
            Modifier
                .fillMaxWidth()
                .clip(RoundedCornerShape(10.dp))
                .clickable(onClick = onToggle)
                .padding(vertical = 4.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Icon(
                Icons.Outlined.Place,
                contentDescription = null,
                tint = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.size(16.dp),
            )
            Text(
                "Address",
                style = MaterialTheme.typography.labelLarge.copy(
                    fontSize = 13.sp,
                    fontWeight = FontWeight.SemiBold,
                ),
                color = MaterialTheme.colorScheme.onSurface,
            )
            if (enriching) {
                CircularProgressIndicator(
                    strokeWidth = 1.5.dp,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.size(12.dp),
                )
            }
            addressProvenanceLabel(provenance)?.let { ProvenanceBadge(it) }
            Spacer(Modifier.weight(1f))
            Icon(
                Icons.Outlined.ExpandMore,
                contentDescription = if (open) "Hide address" else "Show address",
                tint = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier
                    .size(18.dp)
                    .rotate(if (open) 180f else 0f),
            )
        }
        if (open) {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                AddressField(
                    value = fields.street,
                    placeholder = "Street",
                    onValue = { v -> onEdit { it.copy(street = v) } },
                    modifier = Modifier.fillMaxWidth(),
                )
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    AddressField(
                        value = fields.unit,
                        placeholder = "Unit / suite",
                        onValue = { v -> onEdit { it.copy(unit = v) } },
                        modifier = Modifier.weight(1f),
                    )
                    AddressField(
                        value = fields.city,
                        placeholder = "City",
                        onValue = { v -> onEdit { it.copy(city = v) } },
                        modifier = Modifier.weight(1f),
                    )
                }
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    AddressField(
                        value = fields.state,
                        placeholder = "State / province",
                        onValue = { v -> onEdit { it.copy(state = v) } },
                        modifier = Modifier.weight(1f),
                    )
                    AddressField(
                        value = fields.postalCode,
                        placeholder = "Postal code",
                        onValue = { v -> onEdit { it.copy(postalCode = v) } },
                        modifier = Modifier.weight(1f),
                    )
                }
                AddressField(
                    value = fields.country,
                    placeholder = "Country",
                    onValue = { v -> onEdit { it.copy(country = v) } },
                    modifier = Modifier.fillMaxWidth(),
                )
            }
        }
    }
}

/** One address input, styled like the sheet's title well (surface + hairline). */
@Composable
private fun AddressField(
    value: String,
    placeholder: String,
    onValue: (String) -> Unit,
    modifier: Modifier = Modifier,
) {
    BasicTextField(
        value = value,
        onValueChange = { onValue(it.take(200)) },
        singleLine = true,
        textStyle = MaterialTheme.typography.bodyMedium.copy(
            fontSize = 13.5.sp,
            color = MaterialTheme.colorScheme.onSurface,
        ),
        cursorBrush = SolidColor(MaterialTheme.colorScheme.primary),
        decorationBox = { inner ->
            Box(
                Modifier
                    .background(MaterialTheme.colorScheme.surface, RoundedCornerShape(12.dp))
                    .border(
                        1.5.dp,
                        MaterialTheme.colorScheme.surfaceContainerHigh,
                        RoundedCornerShape(12.dp),
                    )
                    .padding(horizontal = 13.dp, vertical = 11.dp),
            ) {
                if (value.isEmpty()) {
                    Text(
                        placeholder,
                        style = MaterialTheme.typography.bodyMedium.copy(fontSize = 13.5.sp),
                        color = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.6f),
                    )
                }
                inner()
            }
        },
        modifier = modifier,
    )
}
