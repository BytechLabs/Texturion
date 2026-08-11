package com.loonext.android.features.inbox

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Schedule
import androidx.compose.material.icons.outlined.WarningAmber
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.loonext.android.core.i18n.AppStrings
import com.loonext.android.core.i18n.LocalAppLocale
import com.loonext.android.core.i18n.t
import com.loonext.android.core.model.ScheduledMessage
import com.loonext.android.core.scheduled.ScheduledSend
import com.loonext.android.features.compose.NoteAmber
import com.loonext.android.features.thread.sendAtOf
import com.loonext.android.ui.common.AppSheet
import com.loonext.android.ui.common.rememberHaptics

/**
 * #233 — everything the workspace has queued, in one place.
 *
 * The issue asks for this "so nobody is surprised", and that phrasing is the
 * whole brief. A crew shares one inbox: the owner writing six follow-ups on a
 * Sunday night is invisible to the tech who answers the same customer on
 * Monday morning, and the tech finds out when the customer replies to a
 * message they never saw.
 *
 * Design notes, and the principles behind them:
 *
 * - **Chunking.** Held rows lift to the top. A held message is the only kind
 *   that needs a decision, and mixed into a chronological list it reads as one
 *   more thing that is going fine.
 * - **Zen of Clarity.** Who, when, and the words. The reason is the only second
 *   line, and only when there is one.
 * - **No ethical friction.** Cancelling something that has not gone is
 *   reversible in the only sense that counts, so it is one tap.
 *
 * A sheet rather than a routed screen, matching how every other secondary
 * surface on this tab is reached. Rows deliberately do NOT offer editing: a
 * body worth rewriting is worth rewriting in the thread it belongs to, where
 * the conversation above it is visible.
 *
 * Mirrors apps/web/src/components/scheduled/scheduled-view.tsx.
 */
@Composable
fun ScheduledSheet(
    rows: List<ScheduledMessage>,
    onOpenConversation: (String) -> Unit,
    onCancel: (String) -> Unit,
    onDismiss: () -> Unit,
) {
    val held = rows.filter { it.status == "held" }
    val pending = rows.filter { it.status != "held" }

    AppSheet(
        onDismissRequest = onDismiss,
        sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true),
    ) {
        Text(
            t("inbox.scheduledTitle"),
            style = MaterialTheme.typography.titleMedium,
            modifier = Modifier.padding(horizontal = 20.dp, vertical = 12.dp),
        )
        if (rows.isEmpty()) {
            // Reassurance IS the honest empty answer: the question this sheet
            // exists to settle is "is something about to go out that I don't
            // know about", and "no" is a complete reply.
            Text(
                ScheduledSend.copy("nothing_scheduled"),
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.padding(horizontal = 20.dp, vertical = 24.dp),
            )
            return@AppSheet
        }

        LazyColumn {
            if (held.isNotEmpty()) {
                item { ScheduledSectionLabel(t("inbox.scheduledNeedsYou")) }
                items(held, key = { it.id }) { row ->
                    HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
                    ScheduledSheetRow(row, onOpenConversation, onCancel)
                }
            }
            if (pending.isNotEmpty()) {
                item { ScheduledSectionLabel(t("inbox.scheduledGoingOut")) }
                items(pending, key = { it.id }) { row ->
                    HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
                    ScheduledSheetRow(row, onOpenConversation, onCancel)
                }
            }
        }
    }
}

@Composable
private fun ScheduledSectionLabel(text: String) {
    Text(
        text,
        style = MaterialTheme.typography.labelSmall.copy(
            fontSize = 11.sp,
            fontWeight = FontWeight.SemiBold,
        ),
        color = MaterialTheme.colorScheme.onSurfaceVariant,
        modifier = Modifier.padding(horizontal = 20.dp, vertical = 11.dp),
    )
}

@Composable
private fun ScheduledSheetRow(
    row: ScheduledMessage,
    onOpenConversation: (String) -> Unit,
    onCancel: (String) -> Unit,
) {
    val haptics = rememberHaptics()
    val held = row.status == "held"
    Row(
        Modifier
            .fillMaxWidth()
            // The thread, not a detail screen. A queued text only makes sense
            // beside what the customer last said, and that is one tap away.
            .clickable { onOpenConversation(row.conversation_id) }
            .padding(start = 20.dp, top = 11.dp, bottom = 11.dp, end = 8.dp),
        verticalAlignment = Alignment.Top,
        horizontalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Icon(
            if (held) Icons.Outlined.WarningAmber else Icons.Outlined.Schedule,
            contentDescription = null,
            tint = if (held) NoteAmber.ink() else MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier
                .padding(top = 2.dp)
                .size(16.dp),
        )
        Column(Modifier.weight(1f)) {
            Row(
                Modifier.fillMaxWidth(),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                Text(
                    scheduledRecipient(row, LocalAppLocale.current),
                    style = MaterialTheme.typography.bodyMedium.copy(
                        fontSize = 13.5.sp,
                        fontWeight = FontWeight.Medium,
                    ),
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.weight(1f),
                )
                Text(
                    if (held) t("inbox.scheduledWaiting") else sendAtOf(row),
                    style = MaterialTheme.typography.labelSmall.copy(fontSize = 11.5.sp),
                    color = if (held) {
                        NoteAmber.ink()
                    } else {
                        MaterialTheme.colorScheme.onSurfaceVariant
                    },
                )
            }
            Text(
                row.body,
                style = MaterialTheme.typography.bodySmall.copy(fontSize = 12.5.sp),
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            // The reason, in the API's own words. Not paraphrased per surface:
            // two surfaces paraphrasing one sentence is how they end up
            // disagreeing about why a text did not go.
            val reason = row.held_reason
            if (held && !reason.isNullOrBlank()) {
                Text(
                    reason,
                    style = MaterialTheme.typography.labelSmall.copy(fontSize = 11.sp),
                    color = NoteAmber.ink(),
                    modifier = Modifier.padding(top = 2.dp),
                )
            } else if (!held) {
                Text(
                    ScheduledSend.clockProvenance(row.clock_source),
                    style = MaterialTheme.typography.labelSmall.copy(fontSize = 10.5.sp),
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.padding(top = 2.dp),
                )
            }
        }
        TextButton(onClick = {
            haptics.tap()
            onCancel(row.id)
        }) {
            Text(t("common.cancel"), style = MaterialTheme.typography.labelMedium)
        }
    }
}

/**
 * Who this text is going to.
 *
 * The list route embeds the contact, because the workspace view is a list of
 * texts to DIFFERENT people and a list of bodies with no names is the surprise
 * #233 asks us to prevent rather than the answer to it.
 */
internal fun scheduledRecipient(row: ScheduledMessage, locale: String): String {
    val contact = row.conversations?.contacts
        ?: return AppStrings.translate(locale, "inbox.scheduledThisConversation")
    val name = contact.name?.trim()
    return if (!name.isNullOrEmpty()) name else formatE164(contact.phone_e164)
}

/** "(416) 555-0134" for NANP, otherwise the number as stored. */
private fun formatE164(e164: String): String {
    val digits = e164.filter { it.isDigit() }
    return if (digits.length == 11 && digits.startsWith("1")) {
        "(${digits.substring(1, 4)}) ${digits.substring(4, 7)}-${digits.substring(7)}"
    } else {
        e164
    }
}
