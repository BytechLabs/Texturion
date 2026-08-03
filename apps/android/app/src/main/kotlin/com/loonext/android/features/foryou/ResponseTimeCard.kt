package com.loonext.android.features.foryou

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ArrowForward
import androidx.compose.material.icons.outlined.Schedule
import androidx.compose.material.icons.outlined.TrendingDown
import androidx.compose.material.icons.outlined.TrendingUp
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.minimumInteractiveComponentSize
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.em
import androidx.compose.ui.unit.sp
import com.loonext.android.core.format.ResponseTimeFormat
import com.loonext.android.core.model.ResponseTimeReport
import com.loonext.android.ui.common.PaperCard
import com.loonext.android.ui.common.formatPhone

/**
 * #239 — the response-time panel, Paper & Olive.
 *
 * WHAT IT HAS TO ACHIEVE, before layout. The number is not the point; the ARC is.
 * "You answer in 4 minutes — down from 3 hours when you started" is the sentence
 * a contractor repeats to another contractor, and the reason they do not churn. A
 * panel leading with a bare median leads with the least persuasive thing it knows.
 *
 * Applying: Meaningful Highlights & Context — never just show the stat; package
 * it into a highlight the owner feels. Chunking — four things at most, with the
 * hours split and p90 behind disclosure. Loss Aversion — the unanswered leads are
 * named as leads nobody answered, with a way into the inbox, because a metric
 * that only congratulates is one nobody acts on.
 *
 * PARITY. Word-for-word identical copy to web's `response-time-card.tsx` and
 * iOS's `ResponseTimeCard.swift`; `ResponseTimeCopyTest` asserts the sentences so
 * a crew comparing the phone and the laptop cannot read two different numbers for
 * the same fortnight.
 */

/** The arc sentence, or null when there is no arc worth drawing. */
fun responseArcSentence(report: ResponseTimeReport): String? {
    val direction = ResponseTimeFormat.arcDirection(report.improved_by_seconds)
        ?: return null
    val then = report.baseline?.median_seconds ?: return null
    val label = ResponseTimeFormat.format(then)
    return if (direction == "faster") {
        "Down from $label when you started"
    } else {
        "Up from $label when you started"
    }
}

/** Why there is no arc yet, said plainly rather than left blank. */
fun responseNoArcReason(report: ResponseTimeReport): String = when (report.baseline_unavailable) {
    "too_new" -> "Your starting point lands once you have been here a fortnight"
    "no_answered_leads" ->
        "No answered leads in your first two weeks, so there is nothing to compare"
    // A baseline exists and the change is under a minute: the same performance
    // measured twice, which is not a story.
    else -> "About the same as when you started"
}

@Composable
fun ResponseTimeCard(
    report: ResponseTimeReport?,
    days: Int,
    onWindow: (Int) -> Unit,
    /**
     * #508: into the inbox, filtered to the leads this row is counting.
     *
     * REQUIRED. It was nullable-with-a-default and `ForYouTab` never passed it,
     * so the row named the leak and offered no way to act on it while web
     * linked the same sentence — the parity gap the issue is about. A default of
     * null on a navigation callback turns "nobody wired this" into a silently
     * inert row instead of a compile error (#503).
     */
    onOpenUnanswered: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Column(modifier.padding(top = 14.dp)) {
        Row(
            Modifier.fillMaxWidth().padding(start = 6.dp, end = 6.dp, bottom = 7.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(
                "RESPONSE TIME",
                style = MaterialTheme.typography.labelSmall.copy(
                    fontSize = 10.5.sp,
                    fontWeight = FontWeight.Bold,
                    letterSpacing = 0.12.em,
                ),
                color = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.85f),
                modifier = Modifier.weight(1f),
            )
            // Segmented, not a menu: three choices are faster to hit, and the
            // current window stays readable at a glance.
            Row(horizontalArrangement = Arrangement.spacedBy(2.dp)) {
                for (option in listOf(7, 30, 90)) {
                    val selected = option == days
                    Text(
                        "${option}d",
                        style = MaterialTheme.typography.labelSmall.copy(
                            fontSize = 10.5.sp,
                            fontWeight = FontWeight.Bold,
                        ),
                        color = if (selected) {
                            MaterialTheme.colorScheme.secondary
                        } else {
                            MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.7f)
                        },
                        modifier = Modifier
                            .minimumInteractiveComponentSize()
                            .clickable { onWindow(option) }
                            .padding(4.dp),
                    )
                }
            }
        }

        PaperCard(Modifier.fillMaxWidth()) {
            when {
                report == null ->
                    Text(
                        "Working out your response time…",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        modifier = Modifier.padding(14.dp),
                    )

                // Not a zero. A workspace with no new leads has no response time,
                // and "0 sec" would read as instant service.
                report.leads == 0 ->
                    Text(
                        "No new customers texted you in the last $days days, so " +
                            "there is nothing to measure yet.",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        modifier = Modifier.padding(14.dp),
                    )

                else -> ResponseTimeBody(report, onOpenUnanswered)
            }
        }
    }
}

@Composable
private fun ResponseTimeBody(
    report: ResponseTimeReport,
    onOpenUnanswered: () -> Unit,
) {
    var open by remember { mutableStateOf(false) }

    Column(Modifier.padding(start = 14.dp, end = 14.dp, top = 13.dp, bottom = 10.dp)) {
        Row(verticalAlignment = Alignment.Bottom) {
            Icon(
                Icons.Outlined.Schedule,
                contentDescription = null,
                modifier = Modifier.size(15.dp).padding(bottom = 2.dp),
                tint = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            Text(
                ResponseTimeFormat.format(report.median_seconds),
                style = MaterialTheme.typography.headlineSmall.copy(
                    fontWeight = FontWeight.SemiBold,
                ),
                modifier = Modifier.padding(start = 7.dp, end = 6.dp),
            )
            Text(
                "to answer a new customer",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.padding(bottom = 2.dp),
            )
        }

        val arc = responseArcSentence(report)
        val direction = ResponseTimeFormat.arcDirection(report.improved_by_seconds)
        if (arc == null) {
            Text(
                responseNoArcReason(report),
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.padding(top = 3.dp),
            )
        } else {
            Row(
                verticalAlignment = Alignment.CenterVertically,
                modifier = Modifier.padding(top = 3.dp),
            ) {
                Icon(
                    if (direction == "faster") {
                        Icons.Outlined.TrendingDown
                    } else {
                        Icons.Outlined.TrendingUp
                    },
                    contentDescription = null,
                    modifier = Modifier.size(14.dp),
                    // Olive for the good direction, and the theme's error tint
                    // for the wrong one. A workspace that got slower is TOLD —
                    // a metric that only reports improvement is one nobody
                    // believes.
                    tint = if (direction == "faster") {
                        MaterialTheme.colorScheme.secondary
                    } else {
                        MaterialTheme.colorScheme.error
                    },
                )
                Text(
                    arc,
                    style = MaterialTheme.typography.bodySmall.copy(
                        fontWeight = FontWeight.Medium,
                    ),
                    color = if (direction == "faster") {
                        MaterialTheme.colorScheme.secondary
                    } else {
                        MaterialTheme.colorScheme.error
                    },
                    modifier = Modifier.padding(start = 5.dp),
                )
            }
        }
    }

    if (report.unanswered > 0) {
        HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant.copy(alpha = 0.5f))
        Row(
            Modifier
                .fillMaxWidth()
                .clickable(onClick = onOpenUnanswered)
                .padding(horizontal = 14.dp, vertical = 10.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(
                buildUnansweredLine(report.unanswered),
                style = MaterialTheme.typography.bodySmall,
                modifier = Modifier.weight(1f),
            )
            Icon(
                Icons.AutoMirrored.Outlined.ArrowForward,
                contentDescription = null,
                modifier = Modifier.size(15.dp),
                tint = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }

    HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant.copy(alpha = 0.5f))
    Text(
        if (open) "Hide details" else "Details",
        style = MaterialTheme.typography.labelSmall.copy(fontWeight = FontWeight.Medium),
        color = MaterialTheme.colorScheme.onSurfaceVariant,
        modifier = Modifier
            .fillMaxWidth()
            .minimumInteractiveComponentSize()
            .clickable { open = !open }
            .padding(horizontal = 14.dp, vertical = 8.dp),
    )
    if (open) {
        HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant.copy(alpha = 0.5f))
        Column(Modifier.padding(horizontal = 14.dp, vertical = 6.dp)) {
            DetailRow("Slowest 10% of answers", ResponseTimeFormat.format(report.p90_seconds))
            DetailRow(
                "During hours (${report.business_hours.leads})",
                ResponseTimeFormat.format(report.business_hours.median_seconds),
            )
            DetailRow(
                "After hours (${report.after_hours.leads})",
                ResponseTimeFormat.format(report.after_hours.median_seconds),
            )
            // #482: which line is letting people down. Slowest first, and
            // present only when there is more than one to compare.
            report.by_number.forEach { number ->
                DetailRow(
                    "${formatPhone(number.number_e164)} · " +
                        "${number.leads - number.answered} unanswered",
                    ResponseTimeFormat.format(number.median_seconds),
                )
            }
            report.by_member?.forEach { member ->
                DetailRow(
                    "Member · ${member.answered} answered",
                    ResponseTimeFormat.format(member.median_seconds),
                )
            }
            if (report.split_truncated) {
                // Said out loud. A cap that reports nothing reads as "we looked
                // at everything".
                Text(
                    "The hours split covers your most recent ${report.split_row_limit} " +
                        "leads; the numbers above it cover all ${report.leads}.",
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.padding(top = 4.dp),
                )
            }
        }
    }
}

/** "2 leads nobody answered" — singular when it is one, because it often is. */
fun buildUnansweredLine(count: Int): String =
    if (count == 1) "1 lead nobody answered" else "$count leads nobody answered"

@Composable
private fun DetailRow(label: String, value: String) {
    Row(
        Modifier.fillMaxWidth().padding(vertical = 4.dp),
        verticalAlignment = Alignment.Bottom,
    ) {
        Text(
            label,
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.weight(1f),
        )
        Text(value, style = MaterialTheme.typography.bodySmall)
    }
}
