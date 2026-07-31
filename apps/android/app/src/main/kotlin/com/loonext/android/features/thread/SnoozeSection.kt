package com.loonext.android.features.thread

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.DatePicker
import androidx.compose.material3.DatePickerDialog
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
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
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.loonext.android.core.model.ConversationDetail
import com.loonext.android.core.snooze.SnoozeTiming
import com.loonext.android.core.snooze.isSnoozed
import com.loonext.android.core.snooze.snoozePresets
import com.loonext.android.core.snooze.snoozeReturnLabel
import com.loonext.android.ui.common.rememberHaptics
import java.time.Instant
import java.time.LocalTime
import java.time.ZoneId
import java.time.ZoneOffset
import java.time.format.DateTimeFormatter
import java.time.format.FormatStyle

/**
 * #293 — "needs attention, but on Thursday", in the thread's actions sheet.
 *
 * Design notes, and the principles behind them:
 *
 * - **Chunking.** At most four presets are ever shown, and the ladder SHRINKS
 *   as the day goes: at 4pm there is no "This afternoon" to offer, so it is not
 *   offered. A disabled row is a worse answer than a shorter list.
 * - **Zen of Clarity.** When the thread is already deferred the whole section
 *   collapses to one row — "Bring back now" — because at that point there is
 *   exactly one thing a person wants from it.
 * - **Smart Defaults.** "Pick a date…" opens on the next preset's day, never on
 *   a blank calendar, and lands on the morning hour rather than midnight.
 * - **A reason, only where somebody is already deliberating.** The optional
 *   note lives in the date picker, not on the presets: a preset is one tap and
 *   stays one tap, but "waiting on the supplier" three days later is the
 *   difference between a list you can read and a list of names.
 * - **No ethical friction.** A snooze is reversible in one tap and cancels
 *   itself the moment the customer replies, so it confirms rather than asking.
 *
 * The instants come from core/snooze, which mirrors packages/shared — so this
 * sheet and the web overflow menu offer the same ladder to the minute.
 */
@Composable
fun SnoozeSection(
    detail: ConversationDetail,
    controller: ThreadController,
    onDismiss: () -> Unit,
    zone: ZoneId = ZoneId.systemDefault(),
) {
    val haptics = rememberHaptics()
    var pickerOpen by remember { mutableStateOf(false) }
    var note by remember { mutableStateOf("") }
    val snoozedUntil = detail.snoozed_until?.takeIf { isSnoozed(it) }

    Surface(
        shape = MaterialTheme.shapes.large,
        color = MaterialTheme.colorScheme.surface,
    ) {
        Column {
            if (snoozedUntil != null) {
                // Already deferred: the header line says when it comes back so
                // the one action below is unambiguous.
                SnoozeNote(snoozeReturnLabel(snoozedUntil, zone = zone))
                HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
                SnoozeRow("Bring back now") {
                    haptics.tap()
                    controller.unsnooze()
                    onDismiss()
                }
            } else {
                SnoozeNote("Snooze until")
                snoozePresets(zone = zone).forEach { preset ->
                    HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
                    SnoozeRow(
                        preset.label,
                        trailing = Instant.ofEpochMilli(preset.at)
                            .atZone(zone)
                            .format(
                                DateTimeFormatter.ofLocalizedTime(FormatStyle.SHORT),
                            ),
                    ) {
                        haptics.tap()
                        controller.snooze(Instant.ofEpochMilli(preset.at).toString())
                        onDismiss()
                    }
                }
                HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
                SnoozeRow("Pick a date…") {
                    note = ""
                    pickerOpen = true
                }
            }
        }
    }

    if (pickerOpen) {
        // Smart Defaults: opens on the next preset's DAY rather than an empty
        // calendar. The picker works in UTC-midnight millis, so the seed is
        // converted through the device zone and back.
        val seedMs = snoozePresets(zone = zone).firstOrNull()?.at
            ?: (System.currentTimeMillis() + 3_600_000L)
        val seedDate = Instant.ofEpochMilli(seedMs).atZone(zone).toLocalDate()
        val pickerState = rememberDatePickerState(
            initialSelectedDateMillis = seedDate
                .atStartOfDay(ZoneOffset.UTC)
                .toInstant()
                .toEpochMilli(),
        )
        DatePickerDialog(
            onDismissRequest = { pickerOpen = false },
            confirmButton = {
                TextButton(onClick = {
                    val millis = pickerState.selectedDateMillis
                    if (millis != null) {
                        val date = Instant.ofEpochMilli(millis)
                            .atZone(ZoneOffset.UTC)
                            .toLocalDate()
                        // The morning hour, not midnight: a thread that returns
                        // at 00:00 lands in the middle of the night and is read
                        // the next day anyway.
                        val instant = date
                            .atTime(LocalTime.of(SnoozeTiming.MORNING_HOUR, 0))
                            .atZone(zone)
                            .toInstant()
                        // A date already past resolves behind us; the API would
                        // refuse it, so the sheet simply does not send it.
                        if (instant.toEpochMilli() > System.currentTimeMillis()) {
                            haptics.tap()
                            controller.snooze(
                                instant.toString(),
                                note.trim().ifBlank { null },
                            )
                            onDismiss()
                        }
                    }
                    pickerOpen = false
                }) { Text("Snooze") }
            },
            dismissButton = {
                TextButton(onClick = { pickerOpen = false }) { Text("Cancel") }
            },
        ) {
            DatePicker(state = pickerState)
            OutlinedTextField(
                value = note,
                // The column's CHECK. Stopping here turns a Postgres error into
                // a field that simply stops taking characters.
                onValueChange = { if (it.length <= SnoozeTiming.NOTE_MAX) note = it },
                label = { Text("Why? (optional)") },
                singleLine = true,
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 24.dp, vertical = 8.dp),
            )
        }
    }
}

/** A section heading inside the sheet — says something, does nothing. */
@Composable
private fun SnoozeNote(text: String) {
    Text(
        text,
        style = MaterialTheme.typography.labelSmall.copy(
            fontSize = 11.sp,
            fontWeight = FontWeight.SemiBold,
        ),
        color = MaterialTheme.colorScheme.onSurfaceVariant,
        modifier = Modifier.padding(horizontal = 15.dp, vertical = 11.dp),
    )
}

@Composable
private fun SnoozeRow(
    label: String,
    trailing: String? = null,
    onClick: () -> Unit,
) {
    Row(
        Modifier
            .fillMaxWidth()
            .clickable(onClick = onClick)
            .padding(horizontal = 15.dp, vertical = 13.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Text(
            label,
            style = MaterialTheme.typography.bodyMedium.copy(
                fontSize = 13.5.sp,
                fontWeight = FontWeight.Medium,
            ),
            modifier = Modifier.weight(1f),
        )
        if (trailing != null) {
            Text(
                trailing,
                style = MaterialTheme.typography.labelSmall.copy(fontSize = 11.5.sp),
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
}
