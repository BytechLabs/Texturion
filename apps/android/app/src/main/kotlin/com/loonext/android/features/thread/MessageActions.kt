package com.loonext.android.features.thread

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
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
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.AddTask
import androidx.compose.material.icons.outlined.Check
import androidx.compose.material.icons.outlined.CheckCircle
import androidx.compose.material.icons.outlined.Close
import androidx.compose.material.icons.outlined.ContentCopy
import androidx.compose.material.icons.outlined.PushPin
import androidx.compose.material.icons.outlined.RadioButtonUnchecked
import androidx.compose.material.icons.outlined.Refresh
import androidx.compose.material3.DatePicker
import androidx.compose.material3.DatePickerDialog
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.rememberDatePickerState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.em
import androidx.compose.ui.unit.sp
import com.loonext.android.core.model.Member
import com.loonext.android.core.model.Message
import com.loonext.android.core.model.MessageDirection
import com.loonext.android.ui.common.initialsOf
import java.time.Instant
import java.time.LocalDate
import java.time.LocalTime
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
    ModalBottomSheet(onDismissRequest = onDismiss) {
        Column(Modifier.fillMaxWidth()) {
            if (message.body.isNotBlank()) {
                ActionRow(Icons.Outlined.ContentCopy, "Copy text") {
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
                onToggleDone()
                onDismiss()
            }
            ActionRow(
                icon = Icons.Outlined.PushPin,
                label = if (message.pinned_at == null) "Pin message" else "Unpin message",
            ) {
                onTogglePin()
                onDismiss()
            }
            if (message.retryable) {
                ActionRow(Icons.Outlined.Refresh, "Retry send") {
                    onRetry()
                    onDismiss()
                }
            }
            if (!message.has_task && message.promoted_task == null &&
                message.direction != MessageDirection.NOTE
            ) {
                ActionRow(Icons.Outlined.AddTask, "Make a task") {
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

/**
 * "Make a task" sheet: prefilled title, the quoted source message, an
 * assignee chip row, due chips (Today · Tomorrow 9 AM · Pick a time…), and
 * the ink Create pill. Assignee + due ride the same POST /v1/tasks create.
 */
@Composable
fun MakeTaskSheet(
    message: Message,
    contactName: String,
    members: List<Member>,
    onCreate: (title: String, assignedUserId: String?, dueAtIso: String?) -> Unit,
    onDismiss: () -> Unit,
) {
    var title by remember {
        mutableStateOf(message.body.trim().take(120).ifBlank { "Follow up" })
    }
    var assigneeId by remember { mutableStateOf<String?>(null) }
    var due by remember { mutableStateOf<DueChoice?>(null) }
    var pickerOpen by remember { mutableStateOf(false) }
    val zone = remember { ZoneId.systemDefault() }

    ModalBottomSheet(
        onDismissRequest = onDismiss,
        containerColor = MaterialTheme.colorScheme.background,
    ) {
        Column(
            Modifier
                .fillMaxWidth()
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
                                assigneeId =
                                    if (assigneeId == member.user_id) null else member.user_id
                            },
                        )
                    }
                    NobodyChip(
                        selected = assigneeId == null,
                        onClick = { assigneeId = null },
                    )
                }
            }

            // Due.
            Column {
                TaskFieldLabel("Due")
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
                        onClick = { due = if (due?.label == "Today") null else today },
                    )
                    DueChip(
                        label = "Tomorrow 9 AM",
                        selected = due?.label == "Tomorrow 9 AM",
                        onClick = {
                            due = if (due?.label == "Tomorrow 9 AM") null else tomorrow
                        },
                    )
                    val picked = due != null && due?.label != "Today" &&
                        due?.label != "Tomorrow 9 AM"
                    DueChip(
                        label = if (picked) due?.label.orEmpty() else "Pick a time…",
                        selected = picked,
                        onClick = { pickerOpen = true },
                    )
                }
            }

            // Create pill.
            val canCreate = title.isNotBlank()
            Row(
                Modifier
                    .fillMaxWidth()
                    .background(
                        MaterialTheme.colorScheme.primary.copy(
                            alpha = if (canCreate) 1f else 0.5f,
                        ),
                        CircleShape,
                    )
                    .clickable(enabled = canCreate) {
                        onCreate(title.trim(), assigneeId, due?.iso)
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
