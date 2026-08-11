package com.loonext.android.features.compose

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.DatePicker
import androidx.compose.material3.DatePickerDialog
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TimePicker
import com.loonext.android.core.i18n.t
import com.loonext.android.core.time.TwoClocks
import androidx.compose.material3.SingleChoiceSegmentedButtonRow
import androidx.compose.material3.SegmentedButtonDefaults
import androidx.compose.material3.SegmentedButton
import androidx.compose.material3.rememberDatePickerState
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.material3.rememberTimePickerState
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
import com.loonext.android.core.model.DestinationClock
import com.loonext.android.core.scheduled.ScheduledSend
import com.loonext.android.ui.common.AppSheet
import com.loonext.android.ui.common.rememberHaptics
import java.time.Instant
import java.time.LocalDate
import java.time.LocalDateTime
import java.time.LocalTime
import java.time.ZoneId
import java.time.ZoneOffset
import java.time.format.DateTimeFormatter
import java.time.format.FormatStyle
import kotlin.math.abs

/**
 * #233 — "send this Monday at 8", from the thread composer.
 *
 * Design notes, and the principles behind them:
 *
 * - **Zen of Clarity.** Send keeps the whole primary control. Scheduling is a
 *   separate 48dp icon button beside it that appears only when there are words
 *   to schedule, plus a long-press on Send for the muscle memory Google
 *   Messages already taught this audience. Splitting the send pill the way web
 *   does would put two halves of a 40dp control under a thumb, and neither half
 *   would meet the minimum touch target.
 * - **Chunking.** Two presets and a way out. #233 names exactly these, and the
 *   count is the point — a preset list long enough to read is slower than the
 *   picker it was meant to avoid.
 * - **Smart Defaults.** The picker opens on the next preset's date and the
 *   morning hour, never a blank calendar or midnight.
 * - **Ethical friction, reserved for the irreversible.** Scheduling is undoable
 *   until it fires, so it confirms rather than asking. The one dialog is quiet
 *   hours, where the message reaches a real person at a bad hour — and #225 ask
 *   2 is that a human is WARNED, never blocked, so it offers both doors.
 *
 * WHOSE 8AM. Presets are resolved in the DESTINATION's zone and the sheet says
 * which rung answered, rather than presenting an inference as a fact. On the
 * weakest rung it is the shop's own clock and the line admits it — the same
 * wording the thread's "their time" hint uses.
 */

/** What the API said when a send-later was submitted. */
enum class ScheduleOutcome {
    Scheduled,

    /**
     * #225: the fire instant lands in the customer's quiet window and nobody
     * has confirmed it yet. Distinct from [Failed] because the remedy is a
     * question, not an error — the retry carries `quiet_hours_confirmed`.
     */
    NeedsQuietHoursConfirm,

    /** Refused or unreachable. The caller has already said so. */
    Failed,
}

/**
 * The two presets plus the picker, as a bottom sheet.
 *
 * A sheet rather than a dropdown because this is a phone: the rows sit under
 * the thumb rather than above the keyboard, and they are the same rows the
 * snooze ladder uses, so the product has one way of offering a time.
 */
@Composable
fun SendLaterSheet(
    clock: DestinationClock?,
    onPick: (Instant) -> Unit,
    onPickCustom: () -> Unit,
    onDismiss: () -> Unit,
) {
    val haptics = rememberHaptics()
    val zone = destinationZone(clock)
    // Resolved on composition rather than remembered: the pair only changes
    // when the clock crosses 8am there, and on that recomposition the NEW pair
    // is the correct one.
    val presets = ScheduledSend.presets(Instant.now(), zone)

    // #199 host type 3: AppSheet, never a raw ModalBottomSheet. The sheet opens
    // over a composer whose keyboard is up, so pinned inset handling is not a
    // detail here — it is whether these rows are reachable at all.
    AppSheet(
        onDismissRequest = onDismiss,
        sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true),
    ) {
        Column {
            SendLaterNote(
                if (clock != null) {
                    "Send later — ${ScheduledSend.clockProvenance(clock.source)}"
                } else {
                    "Send later — your workspace's time"
                },
            )
            presets.forEach { preset ->
                val at = preset.at ?: return@forEach
                HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
                SendLaterRow(preset.label, trailing = clockOf(at, zone)) {
                    haptics.tap()
                    onPick(at)
                }
            }
            HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
            SendLaterRow(t("thread.pickATime")) {
                haptics.tap()
                onPickCustom()
            }
        }
    }
}

/**
 * The custom-time picker: a date, then a time, both in the DEVICE's zone.
 *
 * THE ZONE HERE IS THE SENDER'S, ON PURPOSE, and the dialog says so. A picker
 * showing the customer's wall clock would have to be read back through their
 * zone, and every place that conversion is missed is a send hours away from
 * where somebody put it — invisible in any test where the two zones happen to
 * agree. Presets stay the customer's morning and are hinted in their zone; one
 * ambiguous field showing two clocks would be worse than either.
 */
@Composable
fun SendLaterPicker(
    clock: DestinationClock?,
    onConfirm: (Instant) -> Unit,
    onDismiss: () -> Unit,
) {
    val haptics = rememberHaptics()
    val device = ZoneId.systemDefault()
    // Smart Defaults: opens on the next preset rather than an empty calendar.
    val seed = remember(clock) {
        ScheduledSend.presets(Instant.now(), destinationZone(clock))
            .firstOrNull { it.at != null }?.at
            ?: Instant.now().plusSeconds(3_600)
    }
    val seedLocal = seed.atZone(device)
    var pickedDate by remember { mutableStateOf<LocalDate?>(null) }
    var stage by remember { mutableStateOf(PickerStage.Date) }
    // #539: WHICH CLOCK THE TYPED TIME IS IN — the switch the issue asks for
    // ("why cant i choose? let me switch?").
    //
    // Only offered when it would change the answer: if the customer's clock reads
    // the same as this device's, a Their/Your toggle is two buttons that do the
    // same thing, which is worse than no toggle because it implies a difference
    // that is not there.
    var choice by remember { mutableStateOf(TwoClocks.DEFAULT_CHOICE) }
    val theirZone = destinationZone(clock)
    val canSwitch = clock != null &&
        !TwoClocks.sameClock(clockOf(seed, theirZone), clockOf(seed, device))

    when (stage) {
        PickerStage.Date -> {
            val dateState = rememberDatePickerState(
                initialSelectedDateMillis = seedLocal.toLocalDate()
                    .atStartOfDay(ZoneOffset.UTC)
                    .toInstant()
                    .toEpochMilli(),
            )
            DatePickerDialog(
                onDismissRequest = onDismiss,
                confirmButton = {
                    TextButton(
                        enabled = dateState.selectedDateMillis != null,
                        onClick = {
                            val millis = dateState.selectedDateMillis
                                ?: return@TextButton
                            pickedDate = Instant.ofEpochMilli(millis)
                                .atZone(ZoneOffset.UTC)
                                .toLocalDate()
                            stage = PickerStage.Time
                        },
                    ) { Text(t("thread.next")) }
                },
                dismissButton = {
                    TextButton(onClick = onDismiss) { Text(t("common.cancel")) }
                },
            ) { DatePicker(state = dateState) }
        }

        PickerStage.Time -> {
            val timeState = rememberTimePickerState(
                initialHour = seedLocal.hour,
                initialMinute = 0,
            )
            AlertDialog(
                onDismissRequest = onDismiss,
                title = { Text(t("thread.sendAt")) },
                text = {
                    Column {
                        TimePicker(state = timeState)
                        if (canSwitch) {
                            // Two buttons, not a zone picker. The question a sender
                            // has is "did I mean 8am here or 8am there"; offering
                            // 400 IANA zones to answer it would be a worse version
                            // of the same confusion.
                            SingleChoiceSegmentedButtonRow(Modifier.fillMaxWidth()) {
                                TwoClocks.Choice.entries.forEachIndexed { index, option ->
                                    SegmentedButton(
                                        selected = choice == option,
                                        onClick = { choice = option },
                                        shape = SegmentedButtonDefaults.itemShape(
                                            index = index,
                                            count = TwoClocks.Choice.entries.size,
                                        ),
                                    ) { Text(option.label) }
                                }
                            }
                        }
                        Text(
                            pickerClockNote(
                                clock = clock,
                                device = device,
                                canSwitch = canSwitch,
                                choice = choice,
                                at = wallInstant(
                                    pickedDate, timeState.hour, timeState.minute,
                                    device, theirZone, choice, canSwitch,
                                ),
                                theirZone = theirZone,
                            ),
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                },
                confirmButton = {
                    TextButton(onClick = {
                        // #539: resolved against whichever clock is selected. The
                        // digits do not change; what they mean does.
                        val at = wallInstant(
                            pickedDate, timeState.hour, timeState.minute,
                            device, theirZone, choice, canSwitch,
                        )
                        // A time already behind us would be refused by the API,
                        // so the dialog simply does not send it — the person
                        // stays in the picker they are already looking at.
                        if (at.isAfter(Instant.now())) {
                            haptics.confirm()
                            onConfirm(at)
                        }
                    }) { Text(t("thread.schedule")) }
                },
                dismissButton = {
                    TextButton(onClick = onDismiss) { Text(t("common.cancel")) }
                },
            )
        }
    }
}

private enum class PickerStage { Date, Time }

/**
 * #225 — that lands late where they are.
 *
 * The one dialog this feature earns. Ask 2 is warned and never blocked, so it
 * states the hour there and offers both doors rather than refusing.
 */
@Composable
fun QuietHoursScheduleDialog(
    localHour: Int?,
    onConfirm: () -> Unit,
    onDismiss: () -> Unit,
) {
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(t("thread.quietHoursTitle")) },
        text = {
            Text(
                if (localHour == null) {
                    ScheduledSend.copy("quiet_hours_unknown")
                } else {
                    "That is around ${formatHour(localHour)} for this customer."
                } + " " + ScheduledSend.copy("quiet_hours_choice"),
            )
        },
        confirmButton = {
            TextButton(onClick = onConfirm) { Text(t("thread.scheduleAnyway")) }
        },
        dismissButton = {
            TextButton(onClick = onDismiss) { Text(t("thread.pickAnotherTime")) }
        },
    )
}

/** "8:00 AM" in a given zone, in the device's locale. */
internal fun clockOf(at: Instant, zone: ZoneId): String =
    at.atZone(zone).format(DateTimeFormatter.ofLocalizedTime(FormatStyle.SHORT))

/** "Tue, 8:00 AM" — enough to recognise what you picked, and no more. */
internal fun sendAtLabel(at: Instant, zone: ZoneId): String =
    at.atZone(zone).format(
        DateTimeFormatter.ofPattern("EEE, h:mm a"),
    )

private fun formatHour(hour: Int): String {
    val suffix = if (hour < 12) "am" else "pm"
    val twelve = if (hour % 12 == 0) 12 else hour % 12
    return "$twelve$suffix"
}

/** The destination's zone, falling back to this device's when unresolved. */
internal fun destinationZone(clock: DestinationClock?): ZoneId =
    runCatching { ZoneId.of(clock?.timezone ?: "") }.getOrElse { ZoneId.systemDefault() }

/**
 * The sentence under the time picker: whose clock this field is, and how far
 * the customer is from it.
 *
 * Measured against the real calendars rather than an offset table, so it stays
 * right across a DST boundary where two zones change on different dates.
 */
internal fun senderClockNote(clock: DestinationClock?, device: ZoneId): String {
    val reassurance = ScheduledSend.copy("picker_reassurance")
    val zone = clock?.timezone?.let { runCatching { ZoneId.of(it) }.getOrNull() }
    if (clock == null || zone == null || clock.source == "company" || zone == device) {
        return "This is your own time. $reassurance"
    }
    return "This is your own time, and they are ${hoursApart(zone, device)}. $reassurance"
}

/** "3 hours behind you", wrapped into (-12, 12] so 23 ahead reads as 1 behind. */
internal fun hoursApart(there: ZoneId, here: ZoneId, now: Instant = Instant.now()): String {
    val minutes = (
        there.rules.getOffset(now).totalSeconds -
            here.rules.getOffset(now).totalSeconds
        ) / 60
    var delta = minutes / 60
    if (delta > 12) delta -= 24
    if (delta < -12) delta += 24
    if (delta == 0) return "on the same clock"
    val magnitude = if (abs(delta) == 1) "an hour" else "${abs(delta)} hours"
    return "$magnitude ${if (delta > 0) "ahead of" else "behind"} you"
}

/** A heading inside the sheet — says something, does nothing. */
@Composable
private fun SendLaterNote(text: String) {
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
private fun SendLaterRow(
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

/**
 * #539 — the instant a picked date and time means, on the CHOSEN clock.
 *
 * The digits in the picker never change; the calendar they are resolved against
 * does. An unresolvable destination zone falls back to the device's, so a send goes
 * at the time the sender read on screen rather than at a guessed instant.
 */
internal fun wallInstant(
    date: LocalDate?,
    hour: Int,
    minute: Int,
    device: ZoneId,
    theirZone: ZoneId,
    choice: TwoClocks.Choice,
    canSwitch: Boolean,
): Instant {
    val wall = LocalDateTime.of(date ?: LocalDate.now(device), LocalTime.of(hour, minute))
    val zone = if (canSwitch && choice == TwoClocks.Choice.THEIRS) theirZone else device
    return TwoClocks.instantForWallClock(wall, zone.id) ?: wall.atZone(device).toInstant()
}

/**
 * The line under the picker: which clock this is, and the same moment on the other.
 *
 * #539 asked "what about my timzeone equivalent?" — answered with a rendered time
 * rather than an hours-apart number, which is wrong every day in the half-hour
 * zones and wrong twice a year everywhere else. Falls back to the original
 * reassurance sentence when there is only one clock in play.
 */
internal fun pickerClockNote(
    clock: DestinationClock?,
    device: ZoneId,
    canSwitch: Boolean,
    choice: TwoClocks.Choice,
    at: Instant,
    theirZone: ZoneId,
): String {
    if (!canSwitch) return senderClockNote(clock, device)
    return if (choice == TwoClocks.Choice.THEIRS) {
        "That's ${clockOf(at, device)} ${TwoClocks.HERE}"
    } else {
        "That's ${clockOf(at, theirZone)} ${TwoClocks.THERE}"
    }
}
