package com.loonext.android.features.thread

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.outlined.Schedule
import androidx.compose.material.icons.outlined.WarningAmber
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.loonext.android.core.i18n.t
import com.loonext.android.core.time.TwoClocks
import com.loonext.android.core.model.ScheduledMessage
import com.loonext.android.core.scheduled.ScheduledSend
import com.loonext.android.features.compose.NoteAmber
import com.loonext.android.features.compose.sendAtLabel
import com.loonext.android.ui.common.rememberHaptics
import java.time.Instant
import java.time.ZoneId

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
 * - **Zen of Clarity.** One line each, and the strip disappears entirely when
 *   nothing is queued — which is almost always. A permanently-present empty
 *   panel would cost every reader attention to tell them nothing.
 * - **Disclosure is the point.** A held message says WHY in the API's own
 *   words, in the amber this product already uses for "needs a human".
 *   `docs/DECISIONS.md` makes that binding: silent disappearance is the one
 *   unacceptable option, and a strip showing only a time would be silent about
 *   the only state that matters.
 * - **No ethical friction.** Cancelling something that has not gone is
 *   reversible in the only sense that counts — you can schedule it again — so
 *   it is one tap and a snackbar, not a dialog.
 *
 * Mirrors apps/web/src/components/thread/scheduled-strip.tsx line for line.
 */
@Composable
fun ScheduledStrip(
    rows: List<ScheduledMessage>,
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
            ScheduledRow(row = row, onCancel = { onCancel(row.id) })
        }
    }
}

@Composable
private fun ScheduledRow(row: ScheduledMessage, onCancel: () -> Unit) {
    val haptics = rememberHaptics()
    val held = row.status == "held"
    val accent = if (held) NoteAmber.ink() else MaterialTheme.colorScheme.onSurfaceVariant

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
                .size(15.dp),
        )
        Column(Modifier.weight(1f)) {
            Text(
                buildString {
                    append(if (held) t("thread.scheduledWaiting") else sendAtOf(row))
                    append(" — ")
                    append(row.body)
                },
                style = MaterialTheme.typography.bodySmall.copy(fontSize = 12.5.sp),
                color = MaterialTheme.colorScheme.onSurface,
                maxLines = 2,
                overflow = TextOverflow.Ellipsis,
            )
            // The reason, in the API's own words. Not paraphrased here: three
            // clients paraphrasing one sentence is how one of them ends up
            // saying nothing at all.
            val reason = row.held_reason
            if (held && !reason.isNullOrBlank()) {
                Text(
                    reason,
                    style = MaterialTheme.typography.labelSmall.copy(fontSize = 11.sp),
                    color = NoteAmber.ink(),
                )
            } else if (!held) {
                Text(
                    ScheduledSend.clockProvenance(row.clock_source),
                    style = MaterialTheme.typography.labelSmall.copy(fontSize = 10.5.sp),
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }
        IconButton(onClick = {
            haptics.tap()
            onCancel()
        }) {
            Icon(
                Icons.Filled.Close,
                contentDescription = t(
                    "thread.cancelScheduledAria",
                    "when" to sendAtSpokenOf(row),
                ),
                tint = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.size(15.dp),
            )
        }
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
internal fun sendAtOf(row: ScheduledMessage): String = sendAtParts(row).first

/** The same, spelled out, for TalkBack. */
internal fun sendAtSpokenOf(row: ScheduledMessage): String = sendAtParts(row).second

private fun sendAtParts(row: ScheduledMessage): Pair<String, String> {
    val at = runCatching { Instant.parse(row.send_at) }.getOrNull()
        ?: return "Scheduled" to "Scheduled"
    val here = ZoneId.systemDefault()
    val zone = runCatching { ZoneId.of(row.clock_timezone) }.getOrElse { here }
    val there = sendAtLabel(at, zone)
    val mine = sendAtLabel(at, here)
    return TwoClocks.bothClocks(there, mine) to TwoClocks.bothClocksSpoken(there, mine)
}
