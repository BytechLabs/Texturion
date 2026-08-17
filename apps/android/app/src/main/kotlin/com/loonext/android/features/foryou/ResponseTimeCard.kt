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
import com.loonext.android.core.format.ResponseTimeFormat
import com.loonext.android.core.i18n.AppStrings
import com.loonext.android.core.i18n.LocalAppLocale
import com.loonext.android.core.i18n.t
import com.loonext.android.ui.common.MeasureHeader
import com.loonext.android.core.model.ResponseTimeReport
import com.loonext.android.ui.common.PaperCard
import com.loonext.android.ui.common.ProportionRing
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

/**
 * The arc sentence, or null when there is no arc worth drawing.
 *
 * #228: the SENTENCES moved to `InboxStrings`; the DIRECTION did not, and that
 * split is the point. Which way the arc points is still decided here by the
 * shared helper, so a client cannot quietly stop reporting the bad direction by
 * rewording a string.
 *
 * The locale is a required parameter rather than a defaulted one, for the reason
 * the navigation callbacks on this card are: a default turns "nobody passed it"
 * into an English sentence on a French phone instead of a compile error.
 */
fun responseArcSentence(report: ResponseTimeReport, locale: String): String? {
    val direction = ResponseTimeFormat.arcDirection(report.improved_by_seconds)
        ?: return null
    val then = report.baseline?.median_seconds ?: return null
    val label = ResponseTimeFormat.format(then)
    return AppStrings.translate(
        locale,
        if (direction == "faster") "inbox.responseArcDown" else "inbox.responseArcUp",
        mapOf("then" to label),
    )
}

/** Why there is no arc yet, said plainly rather than left blank. */
fun responseNoArcReason(report: ResponseTimeReport, locale: String): String =
    AppStrings.translate(
        locale,
        when (report.baseline_unavailable) {
            "too_new" -> "inbox.responseNoArcTooNew"
            "no_answered_leads" -> "inbox.responseNoArcNoLeads"
            // A baseline exists and the change is under a minute: the same
            // performance measured twice, which is not a story.
            else -> "inbox.responseNoArcSame"
        },
    )

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
        // #540: the SHARED heading, not a second copy of it. This card and
        // Satisfaction each carried their own Row+Text saying the same thing as
        // MeasureHeader, which is how four cards on one screen end up two
        // pixels apart in a list nobody can put a finger on.
        MeasureHeader(t("inbox.responseTimeTitle")) {
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
                        t("inbox.responseLoading"),
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        modifier = Modifier.padding(14.dp),
                    )

                // Not a zero. A workspace with no new leads has no response time,
                // and "0 sec" would read as instant service.
                report.leads == 0 ->
                    Text(
                        t("inbox.responseNoLeads", "days" to days.toString()),
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
    val locale = LocalAppLocale.current

    Column(Modifier.padding(start = 14.dp, end = 14.dp, top = 13.dp, bottom = 10.dp)) {
        Row(verticalAlignment = Alignment.Bottom) {
            // #540: how much of the week actually got answered, as a shape. The
            // laptop has had this since the dashboard overhaul and the phones did
            // not, which read as two different products. Absent when there were no
            // new customers in the window, because an empty ring beside a dash is
            // a picture of nothing.
            if (report.leads > 0) {
                ProportionRing(
                    value = report.answered.toFloat(),
                    total = report.leads.toFloat(),
                    label = t(
                        "inbox.responseRingAria",
                        "answered" to report.answered.toString(),
                        "leads" to report.leads.toString(),
                    ),
                    color = MaterialTheme.colorScheme.secondary,
                    // #540: the same mark web draws — 40, with the count
                    // inside it. At 22 the arc is an icon, and there is no room
                    // for the figure that says what it is counting.
                    size = 40.dp,
                    centre = report.answered.toString(),
                    modifier = Modifier.padding(bottom = 2.dp),
                )
            }
            Icon(
                Icons.Outlined.Schedule,
                contentDescription = null,
                // #540: PADDING FIRST, THEN SIZE. Compose applies modifiers
                // outside-in, so `.size(15.dp).padding(start = 7.dp)` gave the
                // glyph 15 - 7 = 8dp to draw a clock face in — it rendered as an
                // unrecognisable dot beside the number. Found by looking at a
                // screenshot; a compile and every existing test were happy.
                modifier = Modifier.padding(start = 7.dp, bottom = 2.dp).size(15.dp),
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
                t("inbox.responseToAnswer"),
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.padding(bottom = 2.dp),
            )
        }

        val arc = responseArcSentence(report, locale)
        val direction = ResponseTimeFormat.arcDirection(report.improved_by_seconds)
        if (arc == null) {
            Text(
                responseNoArcReason(report, locale),
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
                buildUnansweredLine(report.unanswered, locale),
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
            if (open) t("inbox.responseHideDetails") else t("inbox.responseDetails"),
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
            DetailRow(
                t("inbox.responseSlowest"),
                ResponseTimeFormat.format(report.p90_seconds),
            )
            DetailRow(
                t(
                    "inbox.responseDuringHours",
                    "count" to report.business_hours.leads.toString(),
                ),
                ResponseTimeFormat.format(report.business_hours.median_seconds),
            )
            DetailRow(
                t("inbox.responseAfterHours", "count" to report.after_hours.leads.toString()),
                ResponseTimeFormat.format(report.after_hours.median_seconds),
            )
            // #482: which line is letting people down. Slowest first, and
            // present only when there is more than one to compare.
            report.by_number.forEach { number ->
                DetailRow(
                    t(
                        "inbox.responseByNumber",
                        "number" to formatPhone(number.number_e164),
                        "count" to (number.leads - number.answered).toString(),
                    ),
                    ResponseTimeFormat.format(number.median_seconds),
                )
            }
            report.by_member?.forEach { member ->
                DetailRow(
                    t("inbox.responseByMember", "count" to member.answered.toString()),
                    ResponseTimeFormat.format(member.median_seconds),
                )
            }
            if (report.split_truncated) {
                // Said out loud. A cap that reports nothing reads as "we looked
                // at everything".
                Text(
                    t(
                        "inbox.responseSplitTruncated",
                        "limit" to report.split_row_limit.toString(),
                        "total" to report.leads.toString(),
                    ),
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.padding(top = 4.dp),
                )
            }
        }
    }
}

/** "2 leads nobody answered" — singular when it is one, because it often is. */
fun buildUnansweredLine(count: Int, locale: String): String = AppStrings.translate(
    locale,
    if (count == 1) "inbox.responseUnansweredOne" else "inbox.responseUnansweredMany",
    mapOf("count" to count.toString()),
)

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
