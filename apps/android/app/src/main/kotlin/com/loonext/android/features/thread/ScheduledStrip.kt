package com.loonext.android.features.thread

import com.loonext.android.ui.common.IconSize
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.MoreVert
import androidx.compose.material.icons.outlined.Schedule
import androidx.compose.material.icons.outlined.WarningAmber
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.loonext.android.core.i18n.LocalAppLocale
import com.loonext.android.core.i18n.t
import com.loonext.android.core.time.TwoClocks
import com.loonext.android.core.model.allows
import com.loonext.android.core.model.DestinationClock
import com.loonext.android.core.model.ScheduledMessage
import com.loonext.android.core.scheduled.ScheduledSend
import com.loonext.android.features.compose.NoteAmber
import com.loonext.android.features.compose.QuietHoursScheduleDialog
import com.loonext.android.features.compose.ScheduleOutcome
import com.loonext.android.features.compose.SendLaterPicker
import com.loonext.android.features.compose.sendAtLabel
import com.loonext.android.ui.common.ActionGroup
import com.loonext.android.ui.common.ConfirmDialog
import com.loonext.android.ui.common.RecordAction
import com.loonext.android.ui.common.RecordMenu
import com.loonext.android.ui.common.rememberHaptics
import java.time.Instant
import java.time.ZoneId
import kotlinx.coroutines.launch

private val scheduledActions = listOf(
    RecordAction("edit", "thread.scheduledEditText", ActionGroup.STATE),
    RecordAction("change_time", "thread.scheduledChangeTime", ActionGroup.STATE),
)

/**
 * #233 — what this thread is about to say, before it says it.
 *
 * Design notes, and the principles behind them:
 *
 * - **It sits with the COMPOSER, not in the message history.** A scheduled
 *   message is not a message; it has no delivery status and may never become
 *   one. Putting it in the transcript would mean a reader has to check a badge
 *   before believing that anything above the fold was actually sent, which is
 *   the failure the separate table exists to prevent.
 * - A row opens to show the full text. The strip hides when the queue is empty.
 * - **Disclosure is the point.** A held message says WHY in the API's own
 *   words, in the amber this product already uses for "needs a human".
 *   `docs/DECISIONS.md` makes that binding: silent disappearance is the one
 *   unacceptable option, and a strip showing only a time would be silent about
 *   the only state that matters.
 * - Cancel takes effect immediately. The snackbar offers Undo.
 *
 * Mirrors apps/web/src/components/thread/scheduled-strip.tsx line for line.
 */
@Composable
fun ScheduledStrip(
    rows: List<ScheduledMessage>,
    clock: DestinationClock?,
    onUpdate: suspend (String, String?, String?, Boolean) -> ScheduleOutcome,
    onCancel: (String) -> Unit,
    modifier: Modifier = Modifier,
) {
    // No skeleton and no empty state. This is a strip that is usually absent,
    // and reserving space for it on every thread would be a permanent cost paid
    // for a rare event.
    if (rows.isEmpty()) return

    Column(
        modifier
            .fillMaxWidth()
            .padding(horizontal = 12.dp),
        verticalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        rows.forEach { row ->
            key(row.id) {
                ScheduledRow(
                    row,
                    clock,
                    onUpdate = { body, at, confirmed -> onUpdate(row.id, body, at, confirmed) },
                    onCancel = { onCancel(row.id) },
                )
            }
        }
    }
}

@Composable
private fun ScheduledRow(
    row: ScheduledMessage,
    clock: DestinationClock?,
    onUpdate: suspend (String?, String?, Boolean) -> ScheduleOutcome,
    onCancel: () -> Unit,
) {
    val haptics = rememberHaptics()
    val scope = rememberCoroutineScope()
    val locale = LocalAppLocale.current
    val held = row.status == "held"
    val canEdit = row.allowed_actions.allows("edit")
    val accent = if (held) NoteAmber.ink() else MaterialTheme.colorScheme.onSurfaceVariant
    var menu by remember { mutableStateOf(false) }
    var expanded by remember { mutableStateOf(false) }
    var draft by remember { mutableStateOf<String?>(null) }
    var pickingTime by remember { mutableStateOf(false) }
    var quietTime by remember { mutableStateOf<Instant?>(null) }
    var saving by remember { mutableStateOf(false) }

    fun save(body: String? = null, at: Instant? = null, confirmed: Boolean = false) {
        if (saving) return
        saving = true
        scope.launch {
            try {
                when (onUpdate(body, at?.toString(), confirmed)) {
                    ScheduleOutcome.Scheduled -> draft = null
                    ScheduleOutcome.NeedsQuietHoursConfirm -> quietTime = at
                    ScheduleOutcome.Failed -> Unit
                }
            } finally {
                saving = false
            }
        }
    }

    Row(
        Modifier
            .fillMaxWidth()
            .background(
                if (held) NoteAmber.bg() else MaterialTheme.colorScheme.surfaceVariant,
                RoundedCornerShape(10.dp),
            )
            .border(
                1.dp,
                if (held) NoteAmber.line() else MaterialTheme.colorScheme.outlineVariant,
                RoundedCornerShape(10.dp),
            )
            .padding(start = 10.dp, top = 8.dp, bottom = 8.dp),
        verticalAlignment = Alignment.Top,
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Icon(
            if (held) Icons.Outlined.WarningAmber else Icons.Outlined.Schedule,
            contentDescription = null,
            tint = accent,
            modifier = Modifier
                .padding(top = 1.dp)
                .size(IconSize.Small),
        )
        Column(Modifier.weight(1f)) {
            Box(
                Modifier
                    .fillMaxWidth()
                    .heightIn(min = 48.dp)
                    .clickable(role = Role.Button) { expanded = !expanded },
                contentAlignment = Alignment.CenterStart,
            ) {
                Text(
                    buildString {
                        append(if (held) t("thread.scheduledWaiting") else sendAtOf(row, locale))
                        append(" — ")
                        append(row.body)
                    },
                    style = MaterialTheme.typography.bodySmall.copy(fontSize = 12.5.sp),
                    color = MaterialTheme.colorScheme.onSurface,
                    maxLines = if (expanded) Int.MAX_VALUE else 2,
                    overflow = TextOverflow.Ellipsis,
                )
            }
            // The reason, in the API's own words. Not paraphrased here: three
            // clients paraphrasing one sentence is how one of them ends up
            // saying nothing at all.
            // #228: the key where this build has words for it, the stored
            // English otherwise.
            val reason = ScheduledSend.holdText(
                row.held_reason_key, row.held_reason, locale,
            )
            if (held && !reason.isNullOrBlank()) {
                Text(
                    reason,
                    style = MaterialTheme.typography.labelSmall.copy(fontSize = 11.sp),
                    color = NoteAmber.ink(),
                )
            } else if (!held) {
                Text(
                    ScheduledSend.clockProvenance(row.clock_source, locale),
                    style = MaterialTheme.typography.labelSmall.copy(fontSize = 10.5.sp),
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            if (held && canEdit) {
                TextButton(onClick = { pickingTime = true }, enabled = !saving) {
                    Text(t("thread.pickAnotherTime"))
                }
            }
        }
        if (canEdit) {
            Box {
                IconButton(onClick = { menu = true }, enabled = !saving) {
                    Icon(Icons.Filled.MoreVert, contentDescription = t("thread.scheduledActions"))
                }
                RecordMenu(
                    expanded = menu,
                    actions = scheduledActions,
                    onDismiss = { menu = false },
                    onSelect = { action, _ ->
                        when (action) {
                            "edit" -> draft = row.body
                            "change_time" -> pickingTime = true
                            else -> Unit
                        }
                    },
                )
            }
        }
        // #722: no cancel where the server will not take it.
        if (row.allowed_actions.allows("cancel")) IconButton(enabled = !saving, onClick = {
            haptics.tap()
            onCancel()
        }) {
            Icon(
                Icons.Filled.Close,
                contentDescription = t(
                    "thread.cancelScheduledAria",
                    "when" to sendAtSpokenOf(row, locale),
                ),
                tint = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.size(IconSize.Small),
            )
        }
    }

    draft?.let { text ->
        ConfirmDialog(
            title = t("thread.scheduledEditText"),
            body = "",
            confirmLabel = t("common.save"),
            confirmEnabled = text.isNotBlank(),
            pending = saving,
            onConfirm = { save(body = text) },
            onDismiss = { draft = null },
            extraContent = {
                OutlinedTextField(
                    value = text,
                    onValueChange = { if (it.length <= ScheduledSend.BODY_MAX) draft = it },
                    label = { Text(t("thread.scheduledEditText")) },
                )
            },
        )
    }
    if (pickingTime) {
        SendLaterPicker(clock, onConfirm = { at ->
            pickingTime = false
            save(at = at)
        }, onDismiss = { pickingTime = false })
    }
    quietTime?.let { at ->
        QuietHoursScheduleDialog(
            localHour = null,
            onConfirm = {
                quietTime = null
                save(at = at, confirmed = true)
            },
            onDismiss = {
                quietTime = null
                pickingTime = true
            },
        )
    }
}

/**
 * "Tue, 8:00 AM" in the DESTINATION's zone — and this device's, when they differ.
 *
 * The zone stored on the row, not this device's: a dispatcher in Toronto
 * looking at a send scheduled for a customer in Vancouver has to see the time
 * that customer will experience, because that is the time the sender chose.
 *
 * #539: AND IT HAS TO SAY SO. This used to render the destination's clock with
 * nothing marking it, so the Toronto dispatcher above read "8:00 AM" as their own
 * eight o'clock and was three hours out — the string was correct and the reader
 * was wrong, which is the worst kind of label because there is nothing on screen
 * to argue with. [TwoClocks] adds the second clock only when the two actually read
 * differently, so a crew whose customers are all in town still sees one time.
 *
 * An unknown stored zone falls back to THIS DEVICE'S, so the two read the same and
 * the label stays quiet — rather than inventing a third clock and announcing a
 * difference about nothing.
 */
internal fun sendAtOf(row: ScheduledMessage, locale: String): String = sendAtParts(row, locale).first

/** The same, spelled out, for TalkBack. */
internal fun sendAtSpokenOf(row: ScheduledMessage, locale: String): String = sendAtParts(row, locale).second

private fun sendAtParts(row: ScheduledMessage, locale: String): Pair<String, String> {
    val at = runCatching { Instant.parse(row.send_at) }.getOrNull()
        ?: return "Scheduled" to "Scheduled"
    val here = ZoneId.systemDefault()
    val zone = runCatching { ZoneId.of(row.clock_timezone) }.getOrElse { here }
    val there = sendAtLabel(at, zone)
    val mine = sendAtLabel(at, here)
    return TwoClocks.bothClocks(there, mine, locale) to TwoClocks.bothClocksSpoken(there, mine, locale)
}
