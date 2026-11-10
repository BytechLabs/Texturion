package com.loonext.android.features.tasks

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Add
import androidx.compose.material.icons.outlined.Check
import androidx.compose.material.icons.outlined.Flag
import androidx.compose.material.icons.outlined.Remove
import androidx.compose.material.icons.outlined.Repeat
import androidx.compose.material3.DatePicker
import androidx.compose.material3.DatePickerDialog
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Switch
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
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.loonext.android.core.i18n.LocalAppLocale
import com.loonext.android.core.i18n.t
import com.loonext.android.core.model.Tag
import com.loonext.android.core.model.Task
import com.loonext.android.core.model.TaskLabel
import com.loonext.android.core.model.TaskRepeat
import com.loonext.android.ui.common.AppSheet
import com.loonext.android.ui.common.rememberHaptics
import com.loonext.android.ui.common.touchTarget
import java.time.DayOfWeek
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneOffset
import java.time.format.TextStyle
import java.util.Locale

/**
 * #693: the pieces that draw priority, labels and repeats, shared by the list
 * row, the board card, the map card, the detail and the new-task form.
 */

/** A tag's colour as a fill, or null when it has none or it will not parse. */
internal fun tagFill(hex: String?): Color? = hex?.let {
    runCatching { Color(android.graphics.Color.parseColor(it)) }.getOrNull()
}

/**
 * The flag and word for a high or urgent task; nothing at all for the rest, so
 * the common case stays quiet. Urgent takes the error tone, high the olive.
 */
@Composable
internal fun PriorityMark(priority: String?, modifier: Modifier = Modifier) {
    if (!TaskPriority.isFlagged(priority)) return
    val tone = if (priority == TaskPriority.URGENT) {
        MaterialTheme.colorScheme.error
    } else {
        MaterialTheme.colorScheme.secondary
    }
    Row(
        modifier,
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(2.dp),
    ) {
        Icon(
            Icons.Outlined.Flag,
            contentDescription = null,
            tint = tone,
            modifier = Modifier.size(12.dp),
        )
        Text(
            t(TaskPriority.labelKey(priority)),
            fontSize = 11.sp,
            fontWeight = FontWeight.SemiBold,
            color = tone,
            maxLines = 1,
        )
    }
}

/** The repeat glyph, for a job that is still repeating. */
@Composable
internal fun RepeatMark(repeat: TaskRepeat?, modifier: Modifier = Modifier) {
    if (!showsRepeatIcon(repeat)) return
    val label = t("contactsTasks.repeats")
    Icon(
        Icons.Outlined.Repeat,
        contentDescription = label,
        tint = MaterialTheme.colorScheme.onSurfaceVariant,
        modifier = modifier.size(13.dp),
    )
}

/** Small tag chips, capped at [max] with a "+N" for the rest. */
@Composable
internal fun LabelChips(labels: List<TaskLabel>, modifier: Modifier = Modifier, max: Int = 2) {
    if (labels.isEmpty()) return
    Row(
        modifier,
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        labels.take(max).forEach { label -> LabelChip(label.name, tagFill(label.color)) }
        val extra = labels.size - max
        if (extra > 0) {
            Text(
                t("contactsTasks.labelMore", "count" to "$extra"),
                fontSize = 10.5.sp,
                fontWeight = FontWeight.SemiBold,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
}

@Composable
internal fun LabelChip(name: String, fill: Color?, modifier: Modifier = Modifier) {
    Row(
        modifier
            .clip(CircleShape)
            .background(MaterialTheme.colorScheme.surfaceContainer)
            .padding(horizontal = 7.dp, vertical = 2.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        if (fill != null) {
            Box(Modifier.size(6.dp).background(fill, CircleShape))
        }
        Text(
            name,
            fontSize = 10.5.sp,
            fontWeight = FontWeight.SemiBold,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
            modifier = Modifier.widthIn(max = 84.dp),
        )
    }
}

/**
 * The compact meta line a row, card or pin shows under the title: priority
 * (high and urgent only), the repeat glyph, and the labels. Draws nothing for a
 * task with none of them, so a plain list stays as quiet as it was.
 */
@Composable
internal fun TaskBadges(task: Task, modifier: Modifier = Modifier, maxLabels: Int = 2) {
    val flagged = TaskPriority.isFlagged(task.priority)
    val repeating = showsRepeatIcon(task.repeat)
    if (!flagged && !repeating && task.labels.isEmpty()) return
    Row(
        modifier,
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(7.dp),
    ) {
        PriorityMark(task.priority)
        RepeatMark(task.repeat)
        LabelChips(task.labels, max = maxLabels)
    }
}

/** A selectable chip: ink when chosen, paper when not; a 48dp touch target. */
@Composable
internal fun PlanChip(
    label: String,
    selected: Boolean,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    leading: (@Composable () -> Unit)? = null,
) {
    Row(
        modifier
            .touchTarget()
            .clip(CircleShape)
            .background(
                if (selected) MaterialTheme.colorScheme.primary
                else MaterialTheme.colorScheme.surface,
            )
            .clickable(role = Role.Button, onClick = onClick)
            .padding(horizontal = 14.dp, vertical = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        leading?.invoke()
        Text(
            label,
            fontSize = 12.5.sp,
            fontWeight = if (selected) FontWeight.SemiBold else FontWeight.Normal,
            color = if (selected) MaterialTheme.colorScheme.onPrimary
            else MaterialTheme.colorScheme.onSurfaceVariant,
            maxLines = 1,
        )
    }
}

/** The five priorities as one scrolling chip row (the new-task form). */
@Composable
internal fun PriorityChips(
    selected: String,
    onPick: (String) -> Unit,
    modifier: Modifier = Modifier,
) {
    val haptics = rememberHaptics()
    Row(
        modifier.horizontalScroll(rememberScrollState()),
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        TaskPriority.PICKER.forEach { p ->
            PlanChip(
                label = t(TaskPriority.labelKey(p)),
                selected = selected == p,
                onClick = {
                    haptics.tap()
                    onPick(p)
                },
            )
        }
    }
}

internal data class SheetOption(val id: String, val label: String, val fill: Color? = null)

/**
 * A titled list of 48dp rows in a sheet. [selected] rows carry a check; a
 * caller that wants single choice dismisses from [onPick], one that wants many
 * leaves the sheet up.
 */
@Composable
internal fun OptionSheet(
    title: String,
    options: List<SheetOption>,
    selected: Set<String>,
    onPick: (String) -> Unit,
    onDismiss: () -> Unit,
    emptyText: String? = null,
    footer: (@Composable () -> Unit)? = null,
) {
    val haptics = rememberHaptics()
    AppSheet(onDismissRequest = onDismiss) {
        Column(Modifier.fillMaxWidth().verticalScroll(rememberScrollState())) {
            Text(
                title,
                style = MaterialTheme.typography.titleMedium,
                modifier = Modifier.padding(horizontal = 20.dp, vertical = 8.dp),
            )
            if (options.isEmpty() && emptyText != null) {
                Text(
                    emptyText,
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.padding(horizontal = 20.dp, vertical = 8.dp),
                )
            }
            options.forEach { option ->
                val chosen = option.id in selected
                Row(
                    Modifier
                        .fillMaxWidth()
                        .heightIn(min = 48.dp)
                        .clickable(role = Role.Button) {
                            haptics.tap()
                            onPick(option.id)
                        }
                        .padding(horizontal = 20.dp, vertical = 8.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(10.dp),
                ) {
                    if (option.fill != null) {
                        Box(Modifier.size(10.dp).background(option.fill, CircleShape))
                    }
                    Text(
                        option.label,
                        style = MaterialTheme.typography.bodyLarge,
                        fontWeight = if (chosen) FontWeight.SemiBold else FontWeight.Normal,
                        modifier = Modifier.weight(1f),
                    )
                    if (chosen) {
                        Icon(
                            Icons.Outlined.Check,
                            contentDescription = t("thread.selected"),
                            tint = MaterialTheme.colorScheme.secondary,
                            modifier = Modifier.size(18.dp),
                        )
                    }
                }
            }
            footer?.invoke()
            Spacer(Modifier.size(20.dp))
        }
    }
}

/** Priority choice as a sheet (detail row, bulk menu). */
@Composable
internal fun PrioritySheet(
    title: String,
    selected: String?,
    onPick: (String) -> Unit,
    onDismiss: () -> Unit,
) {
    val options = TaskPriority.PICKER.map { SheetOption(it, t(TaskPriority.labelKey(it))) }
    OptionSheet(
        title = title,
        options = options,
        selected = setOfNotNull(selected),
        onPick = onPick,
        onDismiss = onDismiss,
    )
}

/** One workspace tag chosen from the list: the label filter and the bulk label actions. */
@Composable
internal fun TagChoiceSheet(
    title: String,
    loadTags: suspend () -> List<Tag>,
    selectedId: String?,
    onPick: (Tag) -> Unit,
    onDismiss: () -> Unit,
) {
    var tags by remember { mutableStateOf<List<Tag>?>(null) }
    LaunchedEffect(Unit) { tags = runCatching { loadTags() }.getOrDefault(emptyList()) }
    OptionSheet(
        title = title,
        options = tags.orEmpty().map { SheetOption(it.id, it.name, tagFill(it.color)) },
        selected = setOfNotNull(selectedId),
        onPick = { id -> tags?.firstOrNull { it.id == id }?.let(onPick) },
        onDismiss = onDismiss,
        emptyText = if (tags == null) t("contactsTasks.loading") else t("contactsTasks.noLabelsYet"),
    )
}

/**
 * Pick many labels, and invent one by typing its name. An id of "" marks a
 * label that does not exist yet; the caller creates it when it saves.
 */
@Composable
internal fun LabelPickerSheet(
    loadTags: suspend () -> List<Tag>,
    selected: List<TaskLabel>,
    onAdd: (TaskLabel) -> Unit,
    onRemove: (TaskLabel) -> Unit,
    onDismiss: () -> Unit,
) {
    var tags by remember { mutableStateOf<List<Tag>?>(null) }
    var input by remember { mutableStateOf("") }
    LaunchedEffect(Unit) { tags = runCatching { loadTags() }.getOrDefault(emptyList()) }
    val haptics = rememberHaptics()

    fun isSelected(label: TaskLabel) =
        selected.any { if (label.id.isEmpty()) it.id.isEmpty() && it.name.equals(label.name, true) else it.id == label.id }

    val known = tags.orEmpty().map { TaskLabel(it.id, it.name, it.color) }
    val pending = selected.filter { it.id.isEmpty() }
    val all = known + pending
    val typed = input.trim()
    val match = all.firstOrNull { it.name.equals(typed, ignoreCase = true) }

    OptionSheet(
        title = t("contactsTasks.labels"),
        options = all.map { SheetOption(it.id.ifEmpty { "new:" + it.name }, it.name, tagFill(it.color)) },
        selected = all.filter { isSelected(it) }.map { it.id.ifEmpty { "new:" + it.name } }.toSet(),
        onPick = { id ->
            all.firstOrNull { it.id.ifEmpty { "new:" + it.name } == id }?.let { label ->
                if (isSelected(label)) onRemove(label) else onAdd(label)
            }
        },
        onDismiss = onDismiss,
        emptyText = if (tags == null) t("contactsTasks.loading") else t("contactsTasks.noLabelsYet"),
        footer = {
            Row(
                Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 20.dp, vertical = 4.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                BasicTextField(
                    value = input,
                    onValueChange = { input = it.take(40) },
                    singleLine = true,
                    textStyle = MaterialTheme.typography.bodyMedium.copy(
                        color = MaterialTheme.colorScheme.onSurface,
                    ),
                    cursorBrush = SolidColor(MaterialTheme.colorScheme.primary),
                    decorationBox = { inner ->
                        Box(
                            Modifier
                                .fillMaxWidth()
                                .heightIn(min = 48.dp)
                                .background(MaterialTheme.colorScheme.surface, CircleShape)
                                .padding(horizontal = 16.dp),
                            contentAlignment = Alignment.CenterStart,
                        ) {
                            if (input.isEmpty()) {
                                Text(
                                    t("contactsTasks.addOrCreateLabel"),
                                    style = MaterialTheme.typography.bodyMedium,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                                )
                            }
                            inner()
                        }
                    },
                    modifier = Modifier.weight(1f),
                )
                TextButton(
                    enabled = typed.isNotEmpty(),
                    onClick = {
                        haptics.tap()
                        val existing = match
                        if (existing == null) onAdd(TaskLabel(id = "", name = typed))
                        else if (!isSelected(existing)) onAdd(existing)
                        input = ""
                    },
                    modifier = Modifier.heightIn(min = 48.dp),
                ) { Text(t(if (match == null) "contactsTasks.createLabel" else "contactsTasks.addLabel")) }
            }
        },
    )
}

@Composable
private fun Stepper(
    value: Int,
    onChange: (Int) -> Unit,
    min: Int,
    max: Int,
    decreaseLabel: String,
    increaseLabel: String,
) {
    Row(verticalAlignment = Alignment.CenterVertically) {
        IconButton(onClick = { if (value > min) onChange(value - 1) }, enabled = value > min) {
            Icon(Icons.Outlined.Remove, contentDescription = decreaseLabel, modifier = Modifier.size(18.dp))
        }
        Text(
            "$value",
            fontSize = 15.sp,
            fontWeight = FontWeight.SemiBold,
            modifier = Modifier.widthIn(min = 28.dp),
        )
        IconButton(onClick = { if (value < max) onChange(value + 1) }, enabled = value < max) {
            Icon(Icons.Outlined.Add, contentDescription = increaseLabel, modifier = Modifier.size(18.dp))
        }
    }
}

/**
 * The repeat sheet: "On a schedule" or "After it's done", how often, and when
 * it ends. A schedule needs a due date to count from, so with none set it says
 * so and cannot be saved. [existing] adds Pause and Stop repeating.
 */
@Composable
internal fun RepeatSheet(
    initial: RepeatDraft,
    due: LocalDate?,
    existing: Boolean,
    onSave: (RepeatDraft) -> Unit,
    onStop: () -> Unit,
    onDismiss: () -> Unit,
) {
    val locale = LocalAppLocale.current
    val haptics = rememberHaptics()
    var draft by remember {
        mutableStateOf(
            if (initial.kind == RepeatKind.SCHEDULE && initial.unit == RepeatUnit.WEEK &&
                initial.weekdays.isEmpty() && due != null
            ) {
                initial.copy(weekdays = setOf(due.dayOfWeek.value))
            } else {
                initial
            },
        )
    }
    var endPickerOpen by remember { mutableStateOf(false) }
    val problem = draft.problem(due)
    val schedule = draft.kind == RepeatKind.SCHEDULE
    val tag = Locale.forLanguageTag(locale ?: "en")

    AppSheet(onDismissRequest = onDismiss) {
        Column(
            Modifier
                .fillMaxWidth()
                .verticalScroll(rememberScrollState())
                .padding(horizontal = 20.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Text(t("contactsTasks.repeat"), style = MaterialTheme.typography.titleLarge)

            Row(
                Modifier.horizontalScroll(rememberScrollState()),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                PlanChip(
                    label = t("contactsTasks.repeatKindSchedule"),
                    selected = schedule,
                    onClick = {
                        haptics.tap()
                        draft = draft.copy(kind = RepeatKind.SCHEDULE)
                    },
                )
                PlanChip(
                    label = t("contactsTasks.repeatKindAfterDone"),
                    selected = !schedule,
                    onClick = {
                        haptics.tap()
                        draft = draft.copy(
                            kind = RepeatKind.AFTER_DONE,
                            unit = if (draft.unit == RepeatUnit.YEAR) RepeatUnit.MONTH else draft.unit,
                        )
                    },
                )
            }
            Text(
                t(if (schedule) "contactsTasks.repeatKindScheduleHint" else "contactsTasks.repeatKindAfterDoneHint"),
                fontSize = 12.sp,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            if (schedule && due == null) {
                Text(
                    t("contactsTasks.repeatNeedsDue"),
                    fontSize = 12.5.sp,
                    fontWeight = FontWeight.SemiBold,
                    color = MaterialTheme.colorScheme.error,
                )
            }

            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(
                    t("contactsTasks.repeatEveryLabel"),
                    fontSize = 13.sp,
                    fontWeight = FontWeight.SemiBold,
                    modifier = Modifier.padding(end = 4.dp),
                )
                Stepper(
                    value = draft.every,
                    onChange = { draft = draft.copy(every = it) },
                    min = 1,
                    max = 99,
                    decreaseLabel = t("contactsTasks.repeatFewer"),
                    increaseLabel = t("contactsTasks.repeatMore"),
                )
            }
            Row(
                Modifier.horizontalScroll(rememberScrollState()),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                RepeatUnit.allowed(draft.kind).forEach { unit ->
                    PlanChip(
                        label = repeatUnitWord(unit, draft.every, locale),
                        selected = draft.unit == unit,
                        onClick = {
                            haptics.tap()
                            draft = draft.copy(unit = unit)
                        },
                    )
                }
            }

            if (schedule && draft.unit == RepeatUnit.WEEK) {
                Row(
                    Modifier.horizontalScroll(rememberScrollState()),
                    horizontalArrangement = Arrangement.spacedBy(6.dp),
                ) {
                    (1..7).forEach { day ->
                        PlanChip(
                            label = DayOfWeek.of(day).getDisplayName(TextStyle.SHORT, tag),
                            selected = day in draft.weekdays,
                            onClick = {
                                haptics.tap()
                                val next = if (day in draft.weekdays) draft.weekdays - day else draft.weekdays + day
                                if (next.isNotEmpty()) draft = draft.copy(weekdays = next)
                            },
                        )
                    }
                }
            }
            if (schedule && draft.unit == RepeatUnit.MONTH && due != null) {
                Row(
                    Modifier.horizontalScroll(rememberScrollState()),
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    PlanChip(
                        label = t("contactsTasks.repeatOnDay", "date" to "${due.dayOfMonth}"),
                        selected = draft.monthly == MonthlyMode.Date,
                        onClick = {
                            haptics.tap()
                            draft = draft.copy(monthly = MonthlyMode.Date)
                        },
                    )
                    PlanChip(
                        label = t(
                            "contactsTasks.repeatOnNth",
                            "nth" to ordinalWord(nthOfMonth(due), locale),
                            "day" to weekdayName(due.dayOfWeek.value, locale),
                        ),
                        selected = draft.monthly == MonthlyMode.Nth,
                        onClick = {
                            haptics.tap()
                            draft = draft.copy(monthly = MonthlyMode.Nth)
                        },
                    )
                }
            }

            Text(t("contactsTasks.repeatEnds"), fontSize = 13.sp, fontWeight = FontWeight.SemiBold)
            Row(
                Modifier.horizontalScroll(rememberScrollState()),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                PlanChip(
                    label = t("contactsTasks.repeatEndsNever"),
                    selected = draft.endKind == RepeatEnd.NEVER,
                    onClick = { draft = draft.copy(endKind = RepeatEnd.NEVER) },
                )
                PlanChip(
                    label = draft.endOn?.toString() ?: t("contactsTasks.repeatEndsOn"),
                    selected = draft.endKind == RepeatEnd.ON,
                    onClick = {
                        haptics.tap()
                        draft = draft.copy(endKind = RepeatEnd.ON)
                        endPickerOpen = true
                    },
                )
                PlanChip(
                    label = t("contactsTasks.repeatEndsAfter"),
                    selected = draft.endKind == RepeatEnd.AFTER,
                    onClick = { draft = draft.copy(endKind = RepeatEnd.AFTER) },
                )
            }
            if (draft.endKind == RepeatEnd.AFTER) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Stepper(
                        value = draft.endAfter,
                        onChange = { draft = draft.copy(endAfter = it) },
                        min = 1,
                        max = 999,
                        decreaseLabel = t("contactsTasks.repeatFewer"),
                        increaseLabel = t("contactsTasks.repeatMore"),
                    )
                    Text(t("contactsTasks.repeatTimesLabel"), fontSize = 13.sp)
                }
            }

            if (existing) {
                Row(
                    Modifier
                        .fillMaxWidth()
                        .heightIn(min = 48.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Text(
                        t("contactsTasks.repeatPause"),
                        fontSize = 13.sp,
                        fontWeight = FontWeight.SemiBold,
                        modifier = Modifier.weight(1f),
                    )
                    Switch(
                        checked = draft.paused,
                        onCheckedChange = {
                            haptics.tap()
                            draft = draft.copy(paused = it)
                        },
                    )
                }
                TextButton(
                    onClick = {
                        haptics.tap()
                        onStop()
                    },
                    modifier = Modifier.heightIn(min = 48.dp),
                ) {
                    Text(t("contactsTasks.repeatStop"), color = MaterialTheme.colorScheme.error)
                }
            }

            if (problem != null && !(schedule && due == null)) {
                Text(t(problem), fontSize = 12.5.sp, color = MaterialTheme.colorScheme.error)
            }
            Surface(
                onClick = {
                    haptics.confirm()
                    onSave(draft)
                },
                enabled = problem == null,
                shape = CircleShape,
                color = MaterialTheme.colorScheme.primary.copy(alpha = if (problem == null) 1f else 0.5f),
                contentColor = MaterialTheme.colorScheme.onPrimary,
                modifier = Modifier
                    .fillMaxWidth()
                    .heightIn(min = 48.dp),
            ) {
                Box(contentAlignment = Alignment.Center) {
                    Text(
                        t("contactsTasks.repeatApply"),
                        fontSize = 15.sp,
                        fontWeight = FontWeight.SemiBold,
                        modifier = Modifier.padding(vertical = 12.dp),
                    )
                }
            }
            Spacer(Modifier.size(22.dp))
        }
    }

    if (endPickerOpen) {
        val state = rememberDatePickerState(
            initialSelectedDateMillis = Instant.now().toEpochMilli(),
        )
        DatePickerDialog(
            onDismissRequest = { endPickerOpen = false },
            confirmButton = {
                TextButton(onClick = {
                    state.selectedDateMillis?.let { millis ->
                        draft = draft.copy(
                            endKind = RepeatEnd.ON,
                            endOn = Instant.ofEpochMilli(millis).atZone(ZoneOffset.UTC).toLocalDate(),
                        )
                    }
                    endPickerOpen = false
                }) { Text(t("contactsTasks.repeatPickEndDate")) }
            },
            dismissButton = {
                TextButton(onClick = { endPickerOpen = false }) { Text(t("common.cancel")) }
            },
        ) { DatePicker(state = state) }
    }
}

/** The ask before an edit or delete on a repeating job: this one, or this and later ones. */
@Composable
internal fun ScopeDialog(
    title: String,
    thisLabel: String,
    futureLabel: String,
    onPick: (TaskScope) -> Unit,
    onDismiss: () -> Unit,
    destructive: Boolean = false,
) {
    androidx.compose.material3.AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(title) },
        text = { Text(t("contactsTasks.scopeBody")) },
        confirmButton = {
            Column(horizontalAlignment = Alignment.End) {
                TextButton(
                    onClick = { onPick(TaskScope.Future) },
                    modifier = Modifier.heightIn(min = 48.dp),
                ) {
                    Text(
                        futureLabel,
                        color = if (destructive) MaterialTheme.colorScheme.error
                        else MaterialTheme.colorScheme.primary,
                    )
                }
                TextButton(
                    onClick = { onPick(TaskScope.This) },
                    modifier = Modifier.heightIn(min = 48.dp),
                ) {
                    Text(
                        thisLabel,
                        color = if (destructive) MaterialTheme.colorScheme.error
                        else MaterialTheme.colorScheme.primary,
                    )
                }
            }
        },
        dismissButton = {
            TextButton(onClick = onDismiss, modifier = Modifier.heightIn(min = 48.dp)) {
                Text(t("common.cancel"))
            }
        },
    )
}

/** A repeat summary line with its glyph, for the detail and the new-task form. */
@Composable
internal fun RepeatLine(repeat: TaskRepeat, modifier: Modifier = Modifier) {
    val locale = LocalAppLocale.current
    val summary = repeatSummary(repeat, locale)
    Row(
        modifier.semantics(mergeDescendants = true) { contentDescription = summary },
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        Icon(
            Icons.Outlined.Repeat,
            contentDescription = null,
            tint = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.size(14.dp),
        )
        Text(
            summary,
            fontSize = 13.sp,
            color = MaterialTheme.colorScheme.onSurface,
            maxLines = 2,
            overflow = TextOverflow.Ellipsis,
        )
    }
}
