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
import androidx.compose.material.icons.outlined.StarOutline
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
import com.loonext.android.core.format.SatisfactionFormat
import com.loonext.android.core.model.SatisfactionReport
import com.loonext.android.ui.common.PaperCard

/**
 * #313 — the satisfaction panel, Paper & Olive, under response time.
 *
 * WHAT IT HAS TO ACHIEVE. Response time says how fast the business answers;
 * this says whether that mattered. "Satisfaction alongside response time is the
 * beginnings of an honest picture of how the business is doing" — and a panel
 * that only ever shows a flattering average adds nothing to that pair.
 *
 * Applying: Meaningful Highlights & Context — the arc is the headline, not the
 * mean. Loss Aversion — the jobs that needed a call back are named and tappable
 * rather than folded into a satisfaction percentage. Chunking — four things in
 * the primary view, with the distribution and the per-person breakdown behind
 * disclosure.
 *
 * PARITY. Word-for-word identical copy to web's `satisfaction-card.tsx` and
 * iOS's `SatisfactionCard.swift`; `SatisfactionCopyTest` asserts the sentences.
 */

/** The arc sentence, or null when there is no arc worth drawing. */
fun satisfactionArcSentence(report: SatisfactionReport): String? {
    val direction = SatisfactionFormat.arcDirection(report.improved_by) ?: return null
    val baseline = report.baseline ?: return null
    val then = SatisfactionFormat.format(baseline.average)
    return if (direction == "better") {
        "Up from $then the month before"
    } else {
        "Down from $then the month before"
    }
}

/**
 * Why there is no number yet — four different facts, never collapsed into one.
 *
 * Saying "no data" for all of them is what makes an owner think the feature is
 * broken when it is working exactly as intended.
 */
fun satisfactionGap(report: SatisfactionReport): String = when {
    report.asked == 0 ->
        "No finished jobs have been asked about in this window. The question " +
            "goes out a few hours after a job is marked done."
    report.answered == 0 ->
        "Nobody has answered yet. Most people do not, which is why one answer " +
            "is worth reading rather than counting."
    else ->
        "Too few answers to average yet — ${report.answered} of ${report.minimum_sample}"
}

@Composable
fun SatisfactionCard(
    report: SatisfactionReport?,
    days: Int,
    onWindow: (Int) -> Unit,
    /**
     * Into the inbox. Required rather than nullable-with-a-default: #508's
     * lesson is that a defaulted navigation callback turns "nobody wired this"
     * into a silently inert row instead of a compile error.
     */
    onOpenPoor: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Column(modifier.padding(top = 14.dp)) {
        Row(
            Modifier.fillMaxWidth().padding(start = 6.dp, end = 6.dp, bottom = 7.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(
                "SATISFACTION",
                style = MaterialTheme.typography.labelSmall.copy(
                    fontSize = 10.5.sp,
                    fontWeight = FontWeight.Bold,
                    letterSpacing = 0.12.em,
                ),
                color = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.85f),
                modifier = Modifier.weight(1f),
            )
            // The same control in the same place as the card above it.
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
                        "Reading your ratings…",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        modifier = Modifier.padding(14.dp),
                    )

                report.average == null -> SatisfactionGapBody(report, onOpenPoor)

                else -> SatisfactionBody(report, days, onOpenPoor)
            }
        }
    }
}

/**
 * No average, and why.
 *
 * The poor count still shows. Two answers is too thin to average but not too
 * thin to act on, and burying an unhappy customer behind a sample-size rule
 * would be the panel choosing tidiness over the thing that matters.
 */
@Composable
private fun SatisfactionGapBody(report: SatisfactionReport, onOpenPoor: () -> Unit) {
    Column(Modifier.padding(14.dp)) {
        Text(
            satisfactionGap(report),
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        if (report.poor > 0) {
            Row(
                Modifier
                    .fillMaxWidth()
                    .minimumInteractiveComponentSize()
                    .clickable(onClick = onOpenPoor)
                    .padding(top = 8.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(
                    SatisfactionFormat.poorRatingLine(report.poor),
                    style = MaterialTheme.typography.bodySmall.copy(
                        fontWeight = FontWeight.Medium,
                    ),
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
    }
}

@Composable
private fun SatisfactionBody(
    report: SatisfactionReport,
    days: Int,
    onOpenPoor: () -> Unit,
) {
    var open by remember { mutableStateOf(false) }

    Column(Modifier.padding(start = 14.dp, end = 14.dp, top = 13.dp, bottom = 10.dp)) {
        Row(verticalAlignment = Alignment.Bottom) {
            Icon(
                Icons.Outlined.StarOutline,
                contentDescription = null,
                modifier = Modifier.size(15.dp).padding(bottom = 2.dp),
                tint = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            Text(
                SatisfactionFormat.format(report.average),
                style = MaterialTheme.typography.headlineSmall.copy(
                    fontWeight = FontWeight.SemiBold,
                ),
                modifier = Modifier.padding(start = 7.dp, end = 6.dp),
            )
            Text(
                "out of 5, from ${report.answered} answers",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.padding(bottom = 2.dp),
            )
        }

        val arc = satisfactionArcSentence(report)
        val direction = SatisfactionFormat.arcDirection(report.improved_by)
        if (arc == null) {
            Text(
                if (report.baseline == null) {
                    "No month before this one to compare against yet"
                } else {
                    "About the same as the month before"
                },
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
                    if (direction == "better") {
                        Icons.Outlined.TrendingUp
                    } else {
                        Icons.Outlined.TrendingDown
                    },
                    contentDescription = null,
                    modifier = Modifier.size(14.dp),
                    // Olive for the good direction, the theme's error tint for
                    // the wrong one. A workspace whose customers are less happy
                    // is TOLD.
                    tint = if (direction == "better") {
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
                    color = if (direction == "better") {
                        MaterialTheme.colorScheme.secondary
                    } else {
                        MaterialTheme.colorScheme.error
                    },
                    modifier = Modifier.padding(start = 5.dp),
                )
            }
        }
    }

    if (report.poor > 0) {
        HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant.copy(alpha = 0.5f))
        Row(
            Modifier
                .fillMaxWidth()
                .clickable(onClick = onOpenPoor)
                .padding(horizontal = 14.dp, vertical = 10.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(
                SatisfactionFormat.poorRatingLine(report.poor),
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
            for (score in listOf(5, 4, 3, 2, 1)) {
                SatisfactionDetailRow(
                    if (score == 1) "1 star" else "$score stars",
                    "${report.distribution[score.toString()] ?: 0}",
                )
            }
            SatisfactionDetailRow("Asked", "${report.asked} in $days days")

            if (report.by_member == null) {
                Text(
                    "Per-person scores are off. In a small crew a bad week is " +
                        "noise, so this stays a coaching signal rather than a " +
                        "scoreboard — turn it on in Settings.",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.padding(top = 6.dp, bottom = 4.dp),
                )
            } else {
                for (member in report.by_member) {
                    SatisfactionDetailRow(
                        "${member.name ?: "Member"} · ${member.answered} answered",
                        if (member.average == null) {
                            "Too few answers to average yet"
                        } else {
                            SatisfactionFormat.format(member.average)
                        },
                    )
                }
            }

            if (report.truncated) {
                Text(
                    "Showing the most recent ${report.row_limit} ratings.",
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.padding(top = 4.dp, bottom = 2.dp),
                )
            }
        }
    }
}

/**
 * Its own row rather than reaching into ResponseTimeCard's private one.
 *
 * Same look on purpose — these two panels sit together and a different row
 * metric between them would read as a rendering bug — but widening #239's
 * helper to `internal` for this file's benefit makes an unrelated card's
 * surface bigger every time a neighbour wants a row.
 */
@Composable
private fun SatisfactionDetailRow(label: String, value: String) {
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
