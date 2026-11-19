package com.loonext.android.features.foryou

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.DatePicker
import androidx.compose.material3.DatePickerDialog
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TimePicker
import androidx.compose.material3.rememberDatePickerState
import androidx.compose.material3.rememberTimePickerState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.loonext.android.core.i18n.LocalAppLocale
import com.loonext.android.core.i18n.t
import com.loonext.android.core.model.ScheduleDecision
import com.loonext.android.core.model.ScheduleDecisionRequest
import com.loonext.android.core.model.ScheduleDecisionSnapshot
import com.loonext.android.core.time.TimestampFormat
import com.loonext.android.features.tasks.parseInstant
import com.loonext.android.ui.common.ConfirmDialog
import java.time.Instant
import java.time.LocalDate
import java.time.LocalDateTime
import java.time.LocalTime
import java.time.ZoneId
import java.time.ZoneOffset
import java.time.ZonedDateTime
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch

@OptIn(ExperimentalLayoutApi::class)
@Composable
internal fun ScheduleDecisionsCard(
    rows: List<ScheduleDecision>,
    onResolve: suspend (String, ScheduleDecisionRequest) -> Unit,
    onOpenTask: (String) -> Unit,
) {
    val scope = rememberCoroutineScope()
    var pendingId by remember { mutableStateOf<String?>(null) }
    var failedId by remember { mutableStateOf<String?>(null) }
    var moving by remember { mutableStateOf<ScheduleDecision?>(null) }
    var dismissed by remember { mutableStateOf(emptySet<String>()) }
    val visible = rows.filterNot { it.id in dismissed }
    if (visible.isEmpty()) return

    fun resolve(row: ScheduleDecision, request: ScheduleDecisionRequest) {
        pendingId = row.id
        failedId = null
        scope.launch {
            try {
                onResolve(row.id, request)
                if (request.action == "not_sure") dismissed = dismissed + row.id
            } catch (error: CancellationException) {
                throw error
            } catch (_: Exception) {
                failedId = row.id
            } finally {
                pendingId = null
            }
        }
    }

    QueueSection(t("calendarFeed.attentionTitle"), count = visible.size) {
        visible.forEachIndexed { index, row ->
            if (index > 0) HorizontalDivider()
            Column(Modifier.fillMaxWidth().padding(12.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                Text(row.task.title, style = MaterialTheme.typography.titleSmall)
                Text(t(scheduleReason(row)), style = MaterialTheme.typography.bodyMedium)
                if (row.state == "conflict") {
                    row.ours?.let { snapshot ->
                        ScheduleSnapshot(t("calendarFeed.loonextSchedule"), snapshot)
                    }
                    row.theirs?.let { snapshot ->
                        val provider = t(if (row.connection.provider == "google") "calendarFeed.googleProvider" else "calendarFeed.microsoftProvider")
                        ScheduleSnapshot(t("calendarFeed.providerSchedule", "provider" to provider), snapshot)
                    }
                }
                FlowRow {
                    val enabled = pendingId == null
                    if (row.state == "conflict" && "resolve_conflict" in row.allowed_actions) {
                        TextButton(enabled = enabled, onClick = { resolve(row, ScheduleDecisionRequest("use_app")) }) {
                            Text(t("calendarFeed.useLoonext"))
                        }
                        if (row.provider_condition == "conflict") {
                            TextButton(enabled = enabled, onClick = { resolve(row, ScheduleDecisionRequest("use_calendar")) }) {
                                Text(t("calendarFeed.useCalendar"))
                            }
                        }
                    }
                    if (row.state == "event_removed" && "resolve_event_removed" in row.allowed_actions) {
                        TextButton(enabled = enabled, onClick = { resolve(row, ScheduleDecisionRequest("cancelled")) }) {
                            Text(t("calendarFeed.cancelJob"))
                        }
                        TextButton(enabled = enabled && row.zone != null, onClick = { moving = row }) {
                            Text(t("calendarFeed.movedJob"))
                        }
                    }
                    if (row.allowed_actions.any { it == "resolve_conflict" || it == "resolve_event_removed" }) {
                        TextButton(enabled = enabled, onClick = { resolve(row, ScheduleDecisionRequest("not_sure")) }) {
                            Text(t("calendarFeed.notSure"))
                        }
                    }
                    TextButton(onClick = { onOpenTask(row.task.id) }) { Text(t("calendarFeed.openTask")) }
                }
                if (failedId == row.id) {
                    Text(t("calendarFeed.resolutionFailed"), color = MaterialTheme.colorScheme.error)
                }
            }
        }
    }

    moving?.let { row ->
        row.zone?.let { zone ->
            MovedSchedulePicker(row.task.due_at, zone, onDismiss = { moving = null }) { instant ->
                moving = null
                resolve(row, ScheduleDecisionRequest("moved", instant.toString()))
            }
        }
    }
}

@Composable
private fun ScheduleSnapshot(label: String, snapshot: ScheduleDecisionSnapshot) {
    Text(label, style = MaterialTheme.typography.labelMedium)
    Text(snapshot.title, style = MaterialTheme.typography.bodySmall)
    runCatching { ZoneId.of(snapshot.time_zone) }.getOrNull()?.let { zone ->
        val locale = LocalAppLocale.current
        val start = TimestampFormat.exact(snapshot.start, locale, zone)
        val end = TimestampFormat.exact(snapshot.end, locale, zone)
        Text("$start – $end", style = MaterialTheme.typography.bodySmall)
    }
}

private val ScheduleDecision.zone: ZoneId?
    get() = runCatching { ZoneId.of(ours?.time_zone ?: theirs?.time_zone ?: connection.time_zone) }.getOrNull()

private fun scheduleReason(row: ScheduleDecision): String = when (row.state) {
    "conflict" -> when (row.provider_condition) {
        "event_removed" -> "calendarFeed.conflictProviderRemoved"
        "refused" -> "calendarFeed.conflictProviderRefused"
        else -> "calendarFeed.conflictTitle"
    }
    "event_removed" -> "calendarFeed.removedTitle"
    else -> when (row.refusal?.code) {
        "all_day" -> "calendarFeed.refusedAllDayTitle"
        "invalid_time" -> "calendarFeed.refusedTimeTitle"
        "invalid_title" -> "calendarFeed.refusedTitleTitle"
        "unknown_time_zone" -> "calendarFeed.refusedZoneTitle"
        "description_too_long" -> "calendarFeed.refusedDescriptionTitle"
        "outside_sync_window" -> "calendarFeed.refusedWindowTitle"
        "unsafe_meeting" -> "calendarFeed.refusedMeetingTitle"
        "recurrence" -> "calendarFeed.refusedRecurrenceTitle"
        else -> "calendarFeed.refusedUnknownTitle"
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun MovedSchedulePicker(due: String?, zone: ZoneId, onDismiss: () -> Unit, onPick: (Instant) -> Unit) {
    val starting = remember(due, zone) { parseInstant(due)?.atZone(zone) ?: ZonedDateTime.now(zone) }
    var pickedDate by remember { mutableStateOf<LocalDate?>(null) }
    val chosen = pickedDate
    if (chosen == null) {
        val dates = rememberDatePickerState(initialSelectedDateMillis = starting.toLocalDate().atStartOfDay(ZoneOffset.UTC).toInstant().toEpochMilli())
        DatePickerDialog(
            onDismissRequest = onDismiss,
            confirmButton = {
                TextButton(enabled = dates.selectedDateMillis != null, onClick = {
                    pickedDate = dates.selectedDateMillis?.let { Instant.ofEpochMilli(it).atZone(ZoneOffset.UTC).toLocalDate() }
                }) { Text(t("contactsTasks.next")) }
            },
            dismissButton = { TextButton(onClick = onDismiss) { Text(t("common.cancel")) } },
        ) { DatePicker(state = dates) }
    } else {
        val time = rememberTimePickerState(initialHour = starting.hour, initialMinute = starting.minute)
        val local = LocalDateTime.of(chosen, LocalTime.of(time.hour, time.minute))
        val offsets = zone.rules.getValidOffsets(local)
        ConfirmDialog(
            title = t("calendarFeed.newDateLabel"),
            body = t("calendarFeed.newDateTimeZone", "zone" to zone.id),
            confirmLabel = t("calendarFeed.saveMovedDate"),
            confirmEnabled = offsets.size == 1,
            onDismiss = onDismiss,
            onConfirm = { offsets.singleOrNull()?.let { onPick(local.toInstant(it)) } },
            extraContent = {
                Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    TimePicker(state = time)
                    if (offsets.size != 1) {
                        Text(t(if (offsets.isEmpty()) "calendarFeed.movedDateNonexistent" else "calendarFeed.movedDateAmbiguous"))
                    }
                }
            },
        )
    }
}
