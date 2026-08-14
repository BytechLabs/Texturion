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
import androidx.compose.material.icons.outlined.ExpandMore
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.em
import androidx.compose.ui.unit.sp
import com.loonext.android.core.format.SatisfactionFormat
import com.loonext.android.core.i18n.AppStrings
import com.loonext.android.core.i18n.LocalAppLocale
import com.loonext.android.core.i18n.t
import com.loonext.android.core.model.SatisfactionReport
import com.loonext.android.ui.common.PaperCard
import com.loonext.android.ui.common.ProportionRing

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

/**
 * The arc sentence, or null when there is no arc worth drawing.
 *
 * #228: the sentences live in `InboxStrings`; the DIRECTION still comes from the
 * shared formatter, so no client can stop reporting the bad one by rewording a
 * string. The locale is required rather than defaulted for the same reason the
 * navigation callbacks here are.
 */
fun satisfactionArcSentence(report: SatisfactionReport, locale: String): String? {
    val direction = SatisfactionFormat.arcDirection(report.improved_by) ?: return null
    val baseline = report.baseline ?: return null
    val then = SatisfactionFormat.format(baseline.average)
    return AppStrings.translate(
        locale,
        if (direction == "better") "inbox.satisfactionArcUp" else "inbox.satisfactionArcDown",
        mapOf("then" to then),
    )
}

/**
 * Why there is no number yet — four different facts, never collapsed into one.
 *
 * Saying "no data" for all of them is what makes an owner think the feature is
 * broken when it is working exactly as intended.
 */
fun satisfactionGap(report: SatisfactionReport, locale: String): String = when {
    report.asked == 0 ->
        AppStrings.translate(locale, "inbox.satisfactionGapNoneAsked")
    report.answered == 0 ->
        AppStrings.translate(locale, "inbox.satisfactionGapNoneAnswered")
    else -> AppStrings.translate(
        locale,
        "inbox.satisfactionGapTooFew",
        mapOf(
            "answered" to report.answered.toString(),
            "minimum" to report.minimum_sample.toString(),
        ),
    )
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
                t("inbox.satisfactionTitle"),
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
                        t("inbox.satisfactionLoading"),
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
            satisfactionGap(report, LocalAppLocale.current),
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
    val locale = LocalAppLocale.current

    Column(Modifier.padding(start = 14.dp, end = 14.dp, top = 13.dp, bottom = 10.dp)) {
        Row(verticalAlignment = Alignment.Bottom) {
            // #540: the mark, in place of the star. A star beside a score out of
            // five was decoration — it said "this is a rating", which the words
            // already say. The ring says how far up the scale the month landed,
            // which is the fact a glance wants and cannot get from "4.2" without
            // already knowing the ceiling.
            ProportionRing(
                value = (report.average ?: 0.0).toFloat(),
                total = 5f,
                label = t(
                    "inbox.satisfactionRingAria",
                    "score" to SatisfactionFormat.format(report.average),
                    "count" to report.answered.toString(),
                ),
                color = MaterialTheme.colorScheme.secondary,
                // #540: 26, not 18. At the smaller size a 4.6-out-of-5 arc
                // and a closed circle are indistinguishable, so the mark
                // carried nothing — it read as an icon that happened to be
                // round. Web made this change and both phones kept the size
                // its own comment rejects.
                size = 26.dp,
                modifier = Modifier.padding(bottom = 2.dp),
            )
            Text(
                SatisfactionFormat.format(report.average),
                style = MaterialTheme.typography.headlineSmall.copy(
                    fontWeight = FontWeight.SemiBold,
                ),
                modifier = Modifier.padding(start = 7.dp, end = 6.dp),
            )
            Text(
                t("inbox.satisfactionOutOfFive", "count" to report.answered.toString()),
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.padding(bottom = 2.dp),
            )
        }

        val arc = satisfactionArcSentence(report, locale)
        val direction = SatisfactionFormat.arcDirection(report.improved_by)
        if (arc == null) {
            Text(
                if (report.baseline == null) {
                    t("inbox.satisfactionNoBaseline")
                } else {
                    t("inbox.satisfactionSame")
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
    // #540: a disclosure control that LOOKS like one.
    //
    // This was a Text with `.clickable` on it: no chevron, no rotation, and
    // the same muted label style as the sentence above it — so the one
    // control on the card that expands looked exactly like the copy that
    // does not. The row directly above carries an arrow; this carried
    // nothing, which is the inconsistency #540 means by "amateur".
    //
    // It also announced nothing. A clickable Text has no role and no
    // expanded state, so TalkBack read the word and stopped; the web twin
    // has been a real <button aria-expanded> all along.
    //
    // *Applying: the Safety principle — a control that expands uses the
    // affordance everybody already knows.*
    Row(
        Modifier
            .fillMaxWidth()
            .minimumInteractiveComponentSize()
            .clickable { open = !open }
            .semantics { role = Role.Button }
            .padding(horizontal = 14.dp, vertical = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(
            if (open) t("inbox.satisfactionHideDetails") else t("inbox.satisfactionDetails"),
            style = MaterialTheme.typography.labelSmall.copy(fontWeight = FontWeight.Medium),
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.weight(1f),
        )
        Icon(
            Icons.Outlined.ExpandMore,
            contentDescription = null,
            modifier = Modifier
                .size(16.dp)
                // Points down when closed and up when open, so the glyph
                // says which way the control goes rather than only that it
                // is one.
                .rotate(if (open) 180f else 0f),
            tint = MaterialTheme.colorScheme.onSurfaceVariant,
        )
    }
    if (open) {
        HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant.copy(alpha = 0.5f))
        Column(Modifier.padding(horizontal = 14.dp, vertical = 6.dp)) {
            for (score in listOf(5, 4, 3, 2, 1)) {
                SatisfactionDetailRow(
                    if (score == 1) {
                        t("inbox.satisfactionStarsOne")
                    } else {
                        t("inbox.satisfactionStarsMany", "count" to score.toString())
                    },
                    "${report.distribution[score.toString()] ?: 0}",
                )
            }
            SatisfactionDetailRow(
                t("inbox.satisfactionAsked"),
                t(
                    "inbox.satisfactionAskedValue",
                    "count" to report.asked.toString(),
                    "days" to days.toString(),
                ),
            )

            if (report.by_member == null) {
                Text(
                    t("inbox.satisfactionByMemberOff"),
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.padding(top = 6.dp, bottom = 4.dp),
                )
            } else {
                for (member in report.by_member) {
                    SatisfactionDetailRow(
                        t(
                            "inbox.satisfactionByMember",
                            "name" to (member.name ?: t("inbox.satisfactionMemberFallback")),
                            "count" to member.answered.toString(),
                        ),
                        if (member.average == null) {
                            t("inbox.satisfactionMemberTooFew")
                        } else {
                            SatisfactionFormat.format(member.average)
                        },
                    )
                }
            }

            if (report.truncated) {
                Text(
                    t("inbox.satisfactionTruncated", "count" to report.row_limit.toString()),
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
