package com.loonext.android.features.thread

import com.loonext.android.ui.common.IconSize
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
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.wrapContentHeight
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.AddTask
import androidx.compose.material.icons.outlined.AutoAwesome
import androidx.compose.material.icons.outlined.Check
import androidx.compose.material.icons.outlined.CheckBox
import androidx.compose.material.icons.outlined.CheckBoxOutlineBlank
import androidx.compose.material.icons.outlined.CheckCircle
import androidx.compose.material.icons.outlined.Close
import androidx.compose.material.icons.outlined.ContentCopy
import androidx.compose.material.icons.outlined.Delete
import androidx.compose.material.icons.outlined.ExpandMore
import androidx.compose.material.icons.outlined.Place
import androidx.compose.material.icons.outlined.PushPin
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
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.toggleableState
import androidx.compose.ui.state.ToggleableState
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.em
import androidx.compose.ui.unit.sp
import com.loonext.android.core.data.AiRepository
import com.loonext.android.core.i18n.LocalAppLocale
import com.loonext.android.core.i18n.t
import com.loonext.android.core.model.AddressProvenance
import com.loonext.android.core.model.Member
import com.loonext.android.core.model.Message
import com.loonext.android.core.model.MessageDirection
import com.loonext.android.core.model.Tag
import com.loonext.android.core.model.TaskAddressInput
import com.loonext.android.core.model.TaskLabel
import com.loonext.android.core.model.TaskRepeat
import com.loonext.android.features.tasks.LabelPickerSheet
import com.loonext.android.features.tasks.MAX_TASK_ASSIGNEES
import com.loonext.android.features.tasks.PlanChip
import com.loonext.android.features.tasks.PriorityChips
import com.loonext.android.features.tasks.RepeatDraft
import com.loonext.android.features.tasks.RepeatLine
import com.loonext.android.features.tasks.RepeatSheet
import com.loonext.android.features.tasks.TaskPriority
import com.loonext.android.features.tasks.parseInstant
import com.loonext.android.features.tasks.toggleAssignee
import com.loonext.android.core.model.addressProvenanceLabel
import com.loonext.android.features.compose.AiOutcome
import com.loonext.android.ui.common.AiOrb
import com.loonext.android.ui.common.AiOrbState
import com.loonext.android.ui.common.AppSheet
import com.loonext.android.ui.common.CountryField
import com.loonext.android.ui.common.InitialsAvatar
import com.loonext.android.ui.common.MessageActionId
import com.loonext.android.ui.common.RecordViewer
import com.loonext.android.ui.common.messageActions
import com.loonext.android.ui.common.visible
import com.loonext.android.ui.common.pressScale
import com.loonext.android.ui.common.rememberHaptics
import java.time.Instant
import java.time.LocalDate
import java.time.LocalTime
import java.time.OffsetDateTime
import java.time.ZoneId
import java.time.ZoneOffset
import com.loonext.android.core.time.TimestampFormat
import kotlinx.coroutines.launch

/**
 * Long-press actions for one message, drawn from `messageActions` (#712): copy,
 * done toggle, pin/unpin, retry (failed sends only, honoring the retry rule),
 * Make a task, and delete.
 */
@Composable
fun MessageActionsSheet(
    message: Message,
    onToggleDone: () -> Unit,
    onTogglePin: () -> Unit,
    onRetry: () -> Unit,
    onMakeTask: () -> Unit,
    onCopied: () -> Unit,
    /** #691: null when the member lacks records.delete. */
    onDelete: (() -> Unit)? = null,
    onDismiss: () -> Unit,
) {
    val clipboard = LocalClipboardManager.current
    val haptics = rememberHaptics()
    AppSheet(onDismissRequest = onDismiss) {
        // #180 contract: sheet roots scroll so rows are reachable at ANY
        // viewport height (inert on tall screens).
        Column(Modifier.fillMaxWidth().verticalScroll(rememberScrollState())) {
            // #720: the exact time with its zone; a bubble's own line shows only the clock.
            Text(
                TimestampFormat.exact(message.created_at, LocalAppLocale.current),
                style = MaterialTheme.typography.labelMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.padding(horizontal = 20.dp, vertical = 8.dp),
            )
            // #712: the rows ARE the message's action list. The long-press sheet is
            // the only surface a bubble has, and it draws what messageActions says.
            messageActions(message, RecordViewer(canWrite = true, canDelete = onDelete != null))
                .visible()
                .forEach { action ->
                    ActionRow(
                        icon = messageActionIcon(action.id),
                        label = t(action.labelKey),
                        on = action.checked,
                        destructive = action.destructive,
                    ) {
                        when (action.id) {
                            MessageActionId.COPY_TEXT -> {
                                haptics.tap()
                                clipboard.setText(AnnotatedString(message.body))
                                onCopied()
                                onDismiss()
                            }
                            MessageActionId.DONE -> {
                                haptics.confirm()
                                onToggleDone()
                                onDismiss()
                            }
                            MessageActionId.PIN -> {
                                haptics.tap()
                                onTogglePin()
                                onDismiss()
                            }
                            MessageActionId.RETRY -> {
                                haptics.confirm()
                                onRetry()
                                onDismiss()
                            }
                            // The sheet closes; the task sheet opens from the screen.
                            MessageActionId.MAKE_TASK -> {
                                haptics.tap()
                                onMakeTask()
                            }
                            MessageActionId.DELETE -> {
                                haptics.tap()
                                onDelete?.invoke()
                            }
                        }
                    }
                }
            Spacer(Modifier.height(24.dp))
        }
    }
}

private fun messageActionIcon(id: String): ImageVector = when (id) {
    MessageActionId.COPY_TEXT -> Icons.Outlined.ContentCopy
    MessageActionId.RETRY -> Icons.Outlined.Refresh
    MessageActionId.DONE -> Icons.Outlined.CheckCircle
    MessageActionId.MAKE_TASK -> Icons.Outlined.AddTask
    MessageActionId.PIN -> Icons.Outlined.PushPin
    else -> Icons.Outlined.Delete
}

/**
 * One sheet row.
 *
 * #465: a sheet holds two different kinds of thing and used to draw them the
 * same way — "Copy text" DOES something once, while done and pinned are STATES
 * you are in. `on` splits them: a state row carries a trailing mark and names
 * the state ("Pinned"), an action row carries none and names the verb. Same
 * rule on all three clients, so a crew that learns it once has learnt it
 * everywhere.
 */
@Composable
private fun ActionRow(
    icon: ImageVector,
    label: String,
    /** Null = an action. Non-null = a state, drawn with a trailing mark. */
    on: Boolean? = null,
    /** #691: a row that removes something, drawn in the error colour. */
    destructive: Boolean = false,
    // Last so every call site keeps passing it as a trailing lambda.
    onClick: () -> Unit,
) {
    Row(
        Modifier
            .fillMaxWidth()
            .then(
                if (on != null) {
                    Modifier.semantics { toggleableState = ToggleableState(on) }
                } else {
                    Modifier
                }
            )
            .clickable(onClick = onClick)
            .padding(horizontal = 20.dp, vertical = 14.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(
            icon,
            contentDescription = null,
            tint = if (destructive) {
                MaterialTheme.colorScheme.error
            } else if (on == true) {
                MaterialTheme.colorScheme.primary
            } else {
                MaterialTheme.colorScheme.onSurfaceVariant
            },
            modifier = Modifier.size(IconSize.Large),
        )
        Spacer(Modifier.width(16.dp))
        Text(
            label,
            style = MaterialTheme.typography.bodyLarge.copy(fontWeight = FontWeight.Medium),
            color = if (destructive) MaterialTheme.colorScheme.error else Color.Unspecified,
            modifier = Modifier.weight(1f),
        )
        // The box is drawn in BOTH states. Showing it only when on leaves an
        // unchecked "Pinned" pixel-identical to "Copy text", which is the very
        // complaint this answers.
        if (on != null) {
            Icon(
                if (on) Icons.Outlined.CheckBox else Icons.Outlined.CheckBoxOutlineBlank,
                contentDescription = null,
                tint = if (on) {
                    MaterialTheme.colorScheme.primary
                } else {
                    MaterialTheme.colorScheme.outline
                },
                modifier = Modifier.size(IconSize.Default),
            )
        }
    }
}

// ---------------------------------------------------------------------------
// Make a task — from a message (spec 22)
// ---------------------------------------------------------------------------

/** One picked due-time option; null iso = no due date. */
private data class DueChoice(val label: String, val iso: String?)

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
        ?.let { TimestampFormat.label(it.toString(), TimestampFormat.Style.LONG, zone = zone) }
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
    /** The source message; null when the source is an answered call (D64). */
    message: Message?,
    contactName: String,
    members: List<Member>,
    /** Who to assign by default: the person making the task (web parity). */
    meUserId: String?,
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
    /** D64: set for an answered call; seeds the title and has no text to enrich. */
    callTitle: String? = null,
    /** #689: a task with no source: a blank title, and the rest under More. */
    standalone: Boolean = false,
    /**
     * #693: when set, More also offers Priority, Labels and Repeat, and Create
     * hands their choices here along with the rest. [tagsLoader] feeds the
     * label picker; [linked] says the task hangs off a conversation or contact,
     * which makes "after it's done" the repeat it starts on.
     */
    onCreateWithExtras: ((String, String?, String?, TaskAddressInput?, TaskCreateExtras) -> Unit)? = null,
    tagsLoader: (suspend () -> List<Tag>)? = null,
    linked: Boolean = false,
) {
    // Read in composition and held: `remember` runs outside it, and so does
    // every comparison below that has to line up with a chip's own label.
    val fallbackTitle = t("thread.taskTitleFallback")
    val todayLabel = t("thread.dueToday")
    val tomorrowLabel = t("thread.dueTomorrow9")
    var title by remember {
        mutableStateOf(
            callTitle
                ?: if (standalone) "" else message?.body?.trim().orEmpty().take(120).ifBlank { fallbackTitle },
        )
    }
    // Assigned to whoever is making it, matching the web. The default task
    // view is "open, assigned to me", so a task made on a phone and left
    // unassigned landed in a list nobody was looking at. Nobody stays
    // selectable.
    // #689 C: the standalone form (the one with extras) takes up to ten people;
    // a task made from a message or a call keeps the single-person chips.
    val multiAssign = onCreateWithExtras != null
    var assigneeIds by remember { mutableStateOf(listOfNotNull(meUserId)) }
    var assigneesTouched by remember { mutableStateOf(false) }
    var assigneeCapHit by remember { mutableStateOf(false) }
    val assigneeId = assigneeIds.firstOrNull()
    // meUserId can arrive after the sheet opens; default to it until the user chooses.
    LaunchedEffect(meUserId) {
        if (!assigneesTouched && meUserId != null && assigneeIds.isEmpty()) {
            assigneeIds = listOf(meUserId)
        }
    }
    var moreOpen by remember { mutableStateOf(!standalone) }
    var due by remember { mutableStateOf<DueChoice?>(null) }
    var priority by remember { mutableStateOf(TaskPriority.NORMAL) }
    var labels by remember { mutableStateOf<List<TaskLabel>>(emptyList()) }
    var labelsOpen by remember { mutableStateOf(false) }
    var repeatDraft by remember { mutableStateOf<RepeatDraft?>(null) }
    var repeatOpen by remember { mutableStateOf(false) }
    var dueSuggested by remember { mutableStateOf(false) }
    var pickerOpen by remember { mutableStateOf(false) }
    val zone = remember { ZoneId.systemDefault() }
    val haptics = rememberHaptics()
    // #431: the outcome report rides its own coroutine so it can never delay
    // the create it describes.
    val scope = rememberCoroutineScope()

    // #214 enrichment: the structured address + its provenance, the collapsible
    // state, and the in-flight spinner. Editing any field marks it "manual".
    var addr by remember { mutableStateOf(AddressFields()) }
    var addrProvenance by remember { mutableStateOf<String?>(null) }
    var addrOpen by remember { mutableStateOf(false) }
    var enriching by remember { mutableStateOf(false) }
    /**
     * #431: what enrichment actually filled in, so the outcome can be judged
     * against it at create time. `suggestedDueIso` holds the VALUE rather than a
     * flag, because "changed the due date" can only be told apart from "kept it"
     * by comparing against what Lou proposed.
     */
    var suggestedAddress by remember { mutableStateOf(false) }
    var suggestedDueIso by remember { mutableStateOf<String?>(null) }

    fun editAddr(update: (AddressFields) -> AddressFields) {
        addr = update(addr)
        addrProvenance = AddressProvenance.MANUAL
    }

    // #220: wipe every field and drop the provenance badge in one tap — a wrong
    // AI suggestion (or a typo) is gone whole. Create-time, so this just resets
    // local state; nothing is persisted until Create.
    fun clearAddr() {
        addr = AddressFields()
        addrProvenance = null
    }

    // Enrich once when the sheet opens: resolve the company's AI settings, and
    // if a toggle is on and the message text is non-empty, pre-fill the due (if
    // still empty) and/or the address. The enrich call is session-cached per
    // (company, message), so reopening this sheet never re-spends an AI call.
    LaunchedEffect(message?.id) {
        // A call has no text to read, so there is nothing to enrich (D64).
        if (message == null) return@LaunchedEffect
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
            suggestedDueIso = result.due_at
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
            suggestedAddress = true
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
                        t("thread.newTask"),
                        style = MaterialTheme.typography.titleLarge.copy(
                            fontSize = 21.sp,
                            fontWeight = FontWeight.SemiBold,
                            letterSpacing = (-0.01).em,
                        ),
                    )
                    if (!standalone || contactName.isNotBlank()) {
                        Text(
                            t(
                                when {
                                    standalone -> "thread.newTaskFor"
                                    callTitle != null -> "thread.newTaskFromCall"
                                    else -> "thread.newTaskFrom"
                                },
                                "name" to contactName,
                            ),
                            style = MaterialTheme.typography.bodySmall.copy(fontSize = 12.sp),
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                            modifier = Modifier.padding(top = 3.dp),
                        )
                    }
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
                        contentDescription = t("common.close"),
                        tint = MaterialTheme.colorScheme.onSurfaceVariant,
                        modifier = Modifier.size(IconSize.Small),
                    )
                }
            }

            // The quoted source message, lime-barred.
            if (message != null) {
                QuotedMessageWell(message = message, contactName = contactName, zone = zone)
            }

            // Title.
            Column {
                TaskFieldLabel(t("thread.taskTitle"))
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

            if (!moreOpen) {
                Text(
                    t("thread.newTaskMore"),
                    style = MaterialTheme.typography.labelLarge.copy(fontWeight = FontWeight.SemiBold),
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier
                        .clickable {
                            haptics.tap()
                            moreOpen = true
                        }
                        .padding(vertical = 8.dp),
                )
            }

            if (moreOpen) {
            // Assignee.
            Column {
                TaskFieldLabel(t("thread.assignTo"))
                Row(
                    Modifier
                        .fillMaxWidth()
                        .horizontalScroll(rememberScrollState()),
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    members.filter { it.deactivated_at == null }.forEach { member ->
                        AssigneeChip(
                            name = member.display_name.ifBlank { t("thread.teammate") },
                            selected = member.user_id in assigneeIds,
                            onClick = {
                                haptics.tap()
                                assigneesTouched = true
                                if (multiAssign) {
                                    val next = toggleAssignee(assigneeIds, member.user_id)
                                    assigneeCapHit = next == null
                                    if (next != null) assigneeIds = next
                                } else {
                                    assigneeIds =
                                        if (assigneeId == member.user_id) emptyList()
                                        else listOf(member.user_id)
                                }
                            },
                        )
                    }
                    NobodyChip(
                        selected = assigneeIds.isEmpty(),
                        onClick = {
                            haptics.tap()
                            assigneesTouched = true
                            assigneeCapHit = false
                            assigneeIds = emptyList()
                        },
                    )
                }
                if (multiAssign && (assigneeCapHit || assigneeIds.size > 1)) {
                    Text(
                        if (assigneeCapHit) {
                            t("contactsTasks.assigneesMax", "max" to "$MAX_TASK_ASSIGNEES")
                        } else {
                            t(
                                "contactsTasks.assigneesCount",
                                "count" to "${assigneeIds.size}",
                                "max" to "$MAX_TASK_ASSIGNEES",
                            )
                        },
                        style = MaterialTheme.typography.labelMedium,
                        color = if (assigneeCapHit) MaterialTheme.colorScheme.error
                        else MaterialTheme.colorScheme.onSurfaceVariant,
                        modifier = Modifier.padding(start = 4.dp, top = 6.dp),
                    )
                }
            }

            // Due.
            Column {
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(6.dp),
                ) {
                    TaskFieldLabel(t("thread.due"))
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
                        label = todayLabel,
                        iso = LocalDate.now(zone).atTime(LocalTime.of(17, 0))
                            .atZone(zone).toInstant().toString(),
                    )
                    val tomorrow = DueChoice(
                        label = tomorrowLabel,
                        iso = LocalDate.now(zone).plusDays(1).atTime(LocalTime.of(9, 0))
                            .atZone(zone).toInstant().toString(),
                    )
                    DueChip(
                        label = todayLabel,
                        selected = due?.label == todayLabel,
                        onClick = {
                            haptics.tap()
                            dueSuggested = false
                            due = if (due?.label == todayLabel) null else today
                        },
                    )
                    DueChip(
                        label = tomorrowLabel,
                        selected = due?.label == tomorrowLabel,
                        onClick = {
                            haptics.tap()
                            dueSuggested = false
                            due = if (due?.label == tomorrowLabel) null else tomorrow
                        },
                    )
                    val picked = due != null && due?.label != todayLabel &&
                        due?.label != tomorrowLabel
                    DueChip(
                        label = if (picked) due?.label.orEmpty()
                        else t("thread.pickATime"),
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
                onClear = {
                    haptics.tap()
                    clearAddr()
                },
            )

            // #693: priority, labels and repeat. Same field-label grammar as
            // the rows above; Normal and no labels and no repeat is the default.
            if (onCreateWithExtras != null) {
                Column {
                    TaskFieldLabel(t("contactsTasks.priority"))
                    PriorityChips(selected = priority, onPick = { priority = it })
                }
                Column {
                    TaskFieldLabel(t("contactsTasks.labels"))
                    Row(
                        Modifier
                            .fillMaxWidth()
                            .horizontalScroll(rememberScrollState()),
                        horizontalArrangement = Arrangement.spacedBy(8.dp),
                    ) {
                        labels.forEach { label ->
                            PlanChip(
                                label = label.name,
                                selected = true,
                                onClick = {
                                    haptics.tap()
                                    labels = labels - label
                                },
                            )
                        }
                        PlanChip(
                            label = t("contactsTasks.addLabel"),
                            selected = false,
                            onClick = {
                                haptics.tap()
                                labelsOpen = true
                            },
                        )
                    }
                }
                Column {
                    TaskFieldLabel(t("contactsTasks.repeat"))
                    val draft = repeatDraft
                    val dueDate = due?.iso?.let { parseInstant(it)?.atZone(zone)?.toLocalDate() }
                    val rule = draft?.toRepeat(dueDate)
                    Row(
                        Modifier
                            .fillMaxWidth()
                            .heightIn(min = 48.dp)
                            .clip(RoundedCornerShape(16.dp))
                            .background(MaterialTheme.colorScheme.surface)
                            .clickable {
                                haptics.tap()
                                repeatOpen = true
                            }
                            .padding(horizontal = 15.dp, vertical = 10.dp),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(8.dp),
                    ) {
                        if (rule != null) {
                            RepeatLine(rule, Modifier.weight(1f))
                        } else {
                            Text(
                                t("contactsTasks.repeatNone"),
                                style = MaterialTheme.typography.bodyMedium.copy(fontSize = 13.sp),
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                                modifier = Modifier.weight(1f),
                            )
                        }
                        Icon(
                            Icons.Outlined.ExpandMore,
                            contentDescription = null,
                            tint = MaterialTheme.colorScheme.outline,
                            modifier = Modifier.size(IconSize.Small),
                        )
                    }
                    if (draft != null && draft.problem(dueDate) != null) {
                        Text(
                            t(draft.problem(dueDate).orEmpty()),
                            style = MaterialTheme.typography.bodySmall.copy(fontSize = 12.sp),
                            color = MaterialTheme.colorScheme.error,
                            modifier = Modifier.padding(start = 4.dp, top = 4.dp),
                        )
                    }
                }
            }
            }

            // Create pill — gives under the finger like every other pill.
            val repeatDue = due?.iso?.let { parseInstant(it)?.atZone(zone)?.toLocalDate() }
            val canCreate = title.isNotBlank() &&
                (repeatDraft?.problem(repeatDue) == null)
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
                        // #431: report only on an actual create. Somebody who
                        // closed the sheet has told us nothing about whether
                        // the address was any good, and counting that as a
                        // rejection would blame Lou for an unrelated decision.
                        val outcome = AiOutcome.forEnrichment(
                            suggestedAddress = suggestedAddress,
                            suggestedDue = suggestedDueIso != null,
                            addressEdited = address != null &&
                                addrProvenance == AddressProvenance.MANUAL,
                            addressCleared = address == null,
                            dueEdited = due?.iso != null && due?.iso != suggestedDueIso,
                            dueCleared = due?.iso == null,
                        )
                        if (outcome != null) {
                            scope.launch {
                                aiRepo.reportAiOutcome(
                                    companyId,
                                    AiOutcome.FEATURE_ENRICH,
                                    outcome,
                                )
                            }
                        }
                        if (onCreateWithExtras != null) {
                            onCreateWithExtras(
                                title.trim(),
                                assigneeId,
                                due?.iso,
                                address,
                                TaskCreateExtras(
                                    priority = priority.takeIf { it != TaskPriority.NORMAL },
                                    labels = labels,
                                    repeat = repeatDraft?.toRepeat(repeatDue),
                                    assigneeIds = assigneeIds,
                                ),
                            )
                        } else {
                            onCreate(title.trim(), assigneeId, due?.iso, address)
                        }
                    }
                    .padding(start = 22.dp, top = 8.dp, bottom = 8.dp, end = 8.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(
                    t("thread.createTask"),
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
                        modifier = Modifier.size(IconSize.Default),
                    )
                }
            }

            Spacer(Modifier.height(22.dp))
        }
    }

    if (labelsOpen && tagsLoader != null) {
        LabelPickerSheet(
            loadTags = tagsLoader,
            selected = labels,
            onAdd = { labels = labels + it },
            onRemove = { gone ->
                labels = labels.filterNot {
                    if (gone.id.isEmpty()) it.id.isEmpty() && it.name.equals(gone.name, true)
                    else it.id == gone.id
                }
            },
            onDismiss = { labelsOpen = false },
        )
    }
    if (repeatOpen) {
        RepeatSheet(
            initial = repeatDraft ?: RepeatDraft.forLinked(linked),
            due = due?.iso?.let { parseInstant(it)?.atZone(zone)?.toLocalDate() },
            existing = false,
            onSave = {
                repeatDraft = it
                repeatOpen = false
            },
            onStop = {
                repeatDraft = null
                repeatOpen = false
            },
            onDismiss = { repeatOpen = false },
        )
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
                            label = TimestampFormat.label(instant.toString(), TimestampFormat.Style.LONG, zone = zone),
                            iso = instant.toString(),
                        )
                        dueSuggested = false
                    }
                    pickerOpen = false
                }) { Text(t("thread.setDueDate")) }
            },
            dismissButton = {
                TextButton(onClick = { pickerOpen = false }) { Text(t("common.cancel")) }
            },
        ) { DatePicker(state = pickerState) }
    }
}

/** #693: what the New task form adds to a create: priority, labels, a repeat. */
data class TaskCreateExtras(
    /** Null leaves the server's default (normal). */
    val priority: String? = null,
    /** An empty id marks a label to create by name once the task exists. */
    val labels: List<TaskLabel> = emptyList(),
    val repeat: TaskRepeat? = null,
    /** #689 C: the whole crew, first first. Empty means nobody. */
    val assigneeIds: List<String>? = null,
)

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
            // The quotation MARKS come from the catalogue with the text inside
            // them: French sets a quotation in guillemets, with spaces.
            val quoted = message.body.trim().ifBlank { t("thread.photo") }
            Text(
                t("thread.quoted", "text" to quoted),
                style = MaterialTheme.typography.bodySmall.copy(
                    fontSize = 12.5.sp,
                    lineHeight = 18.sp,
                ),
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                maxLines = 3,
                overflow = TextOverflow.Ellipsis,
            )
            val locale = LocalAppLocale.current
            val day = localDayOf(message.created_at, zone)
            val whenLabel = buildString {
                if (day != null) {
                    append(dayLabel(day, LocalDate.now(zone), locale))
                    append(" ")
                }
                append(bubbleTime(message.created_at))
            }
            val author =
                if (message.direction == MessageDirection.INBOUND) contactName
                else t("thread.you")
            // Named rather than written into the call: there is no copy in this
            // line at all — it is a name, a middle dot and a clock — and the
            // hardcoded-string guard reads any literal inside `Text(` as one.
            val byline = "$author · $whenLabel"
            Text(
                byline,
                style = MaterialTheme.typography.labelSmall.copy(
                    fontSize = 10.5.sp,
                    fontWeight = FontWeight.SemiBold,
                ),
                color = MaterialTheme.colorScheme.onSurfaceVariant,
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
            .heightIn(min = 44.dp)
            .padding(start = 6.dp, top = 6.dp, bottom = 6.dp, end = 13.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(7.dp),
    ) {
        InitialsAvatar(name, 26.dp, glyph = 10.sp)
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
                contentDescription = t("thread.selected"),
                tint = MaterialTheme.colorScheme.secondary,
                modifier = Modifier.size(IconSize.Small),
            )
        }
    }
}

/** The "Nobody yet" (unassigned) chip. */
@Composable
private fun NobodyChip(selected: Boolean, onClick: () -> Unit) {
    Text(
        t("thread.nobodyYet"),
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
            .heightIn(min = 44.dp)
            .wrapContentHeight(Alignment.CenterVertically)
            .padding(horizontal = 13.dp, vertical = 10.dp),
    )
}

/** One due chip; selected = ink fill, paper text. */
@Composable
private fun DueChip(label: String, selected: Boolean, onClick: () -> Unit) {
    Row(
        Modifier
            .clip(CircleShape)
            .background(
                if (selected) MaterialTheme.colorScheme.primary
                else MaterialTheme.colorScheme.surface,
            )
            .clickable(onClick = onClick)
            .padding(horizontal = 14.dp, vertical = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        // #726: chosen is a fill AND a check, so a lone chip is never the answer.
        if (selected) {
            Icon(
                Icons.Outlined.Check,
                contentDescription = t("thread.selected"),
                tint = MaterialTheme.colorScheme.onPrimary,
                modifier = Modifier.size(IconSize.Small),
            )
        }
        Text(
            label,
            style = MaterialTheme.typography.labelMedium.copy(
                fontSize = 12.5.sp,
                fontWeight = if (selected) FontWeight.SemiBold else FontWeight.Normal,
            ),
            color = if (selected) MaterialTheme.colorScheme.onPrimary
            else MaterialTheme.colorScheme.onSurfaceVariant,
            maxLines = 1,
        )
    }
}

/** #214 the sparkle + "Suggested" micro hint next to the due label. */
@Composable
private fun SuggestedHint() {
    Row(
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(3.dp),
    ) {
        AiOrb(state = AiOrbState.Idle, size = 11.dp)
        Text(
            t("thread.suggested"),
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
        AiOrb(state = AiOrbState.Idle, size = 11.dp)
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
    onClear: () -> Unit,
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
                modifier = Modifier.size(IconSize.Default),
            )
            Text(
                t("thread.addressSection"),
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
            addressProvenanceLabel(provenance, LocalAppLocale.current)?.let { ProvenanceBadge(it) }
            Spacer(Modifier.weight(1f))
            // #220: one-click dismissal of a suggested (or typed) address —
            // shown whenever any field has content, so it covers every AI
            // suggestion. Its own clickable consumes the tap, so it never
            // toggles the section. Here it just resets local sheet state.
            if (!fields.isEmpty()) {
                Text(
                    t("thread.clear"),
                    style = MaterialTheme.typography.labelMedium.copy(
                        fontSize = 12.sp,
                        fontWeight = FontWeight.SemiBold,
                    ),
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier
                        .clip(RoundedCornerShape(8.dp))
                        .clickable(onClick = onClear)
                        .padding(horizontal = 8.dp, vertical = 4.dp),
                )
            }
            Icon(
                Icons.Outlined.ExpandMore,
                contentDescription = if (open) t("thread.hideAddress")
                else t("thread.showAddress"),
                tint = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier
                    .size(IconSize.Default)
                    .rotate(if (open) 180f else 0f),
            )
        }
        if (open) {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                AddressField(
                    value = fields.street,
                    placeholder = t("thread.addrStreet"),
                    onValue = { v -> onEdit { it.copy(street = v) } },
                    modifier = Modifier.fillMaxWidth(),
                )
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    AddressField(
                        value = fields.unit,
                        placeholder = t("thread.addrUnit"),
                        onValue = { v -> onEdit { it.copy(unit = v) } },
                        modifier = Modifier.weight(1f),
                    )
                    AddressField(
                        value = fields.city,
                        placeholder = t("thread.addrCity"),
                        onValue = { v -> onEdit { it.copy(city = v) } },
                        modifier = Modifier.weight(1f),
                    )
                }
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    AddressField(
                        value = fields.state,
                        placeholder = t("thread.addrState"),
                        onValue = { v -> onEdit { it.copy(state = v) } },
                        modifier = Modifier.weight(1f),
                    )
                    AddressField(
                        value = fields.postalCode,
                        placeholder = t("thread.addrPostal"),
                        onValue = { v -> onEdit { it.copy(postalCode = v) } },
                        modifier = Modifier.weight(1f),
                    )
                }
                CountryField(
                    value = fields.country,
                    onValueChange = { v -> onEdit { it.copy(country = v) } },
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
