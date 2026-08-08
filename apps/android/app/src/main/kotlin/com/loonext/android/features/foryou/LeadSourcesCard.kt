package com.loonext.android.features.foryou

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.loonext.android.core.model.LeadSourceReport
import com.loonext.android.ui.common.PaperCard
import com.loonext.android.ui.common.MeasureHeader

/**
 * #301 — where these customers came from, on the home surface.
 *
 * Hand-port of `apps/web/src/components/for-you/lead-sources-card.tsx`.
 *
 * # The coverage row is the design
 *
 * #301's fourth Acceptance line — "reporting distinguishes attributed from
 * unknown, and never infers silently" — either happens on this panel or does
 * not. A ranking built on a third of the conversations can be reordered
 * completely by the other two thirds, and an owner acting on it spends real
 * money on an artefact.
 *
 * So "Don't know" is a ROW, in the same list and on the same bar scale as the
 * sources rather than a footnote under them. That is the only presentation in
 * which an owner sees it competing with the channels they are about to spend
 * on.
 *
 * # Absent rather than empty
 *
 * A quiet month renders NOTHING — not a zero, not an encouraging placeholder.
 * A workspace that has named no sources gets one sentence about the cheapest
 * way to start, because a table whose only row reads "Don't know: 40" is a
 * scolding rather than a finding.
 */
@Composable
fun LeadSourcesCard(report: LeadSourceReport?) {
    // Loading, or a month in which nothing happened. Silence, not a zero.
    if (report == null || report.total == 0) return

    // #540: the same heading treatment as the other three measures — see
    // PipelineCard for why the four have to agree.
    Column(Modifier.fillMaxWidth().padding(top = 12.dp)) {
    MeasureHeader("Where your customers come from")
    PaperCard(Modifier.fillMaxWidth()) {
        Column(Modifier.padding(16.dp)) {

            if (report.sources.isEmpty()) {
                // Sources exist as a feature and this workspace has set none
                // up, so every conversation is unknown.
                Text(
                    "You haven't told us yet. Put a source on the numbers you " +
                        "advertise — the one on the truck, the one in the ad — and " +
                        "every call and text to them is counted from then on, with " +
                        "nobody tapping anything.",
                    modifier = Modifier.padding(top = 6.dp),
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                return@Column
            }

            leadingSentence(report)?.let { headline ->
                Text(
                    headline,
                    modifier = Modifier.padding(top = 6.dp),
                    style = MaterialTheme.typography.bodyMedium,
                )
            }

            report.note?.let { note ->
                Text(
                    note,
                    modifier = Modifier.padding(top = 8.dp),
                    style = MaterialTheme.typography.bodySmall,
                )
            }

            val rows = visibleRows(report)
            val max = (rows.map { it.second } + report.unknown + 1).max()
            Spacer(Modifier.height(10.dp))
            rows.forEach { (name, total) ->
                SourceRow(name, total, max, muted = false)
            }
            if (report.unknown > 0) {
                SourceRow("Don't know", report.unknown, max, muted = true)
            }

            Text(
                "Last 30 days · ${report.total} conversation" +
                    if (report.total == 1) "" else "s",
                modifier = Modifier.padding(top = 10.dp),
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
    }
}

@Composable
private fun SourceRow(name: String, total: Int, max: Int, muted: Boolean) {
    Row(
        Modifier.fillMaxWidth().padding(vertical = 3.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(
            name,
            modifier = Modifier.width(104.dp),
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
            style = MaterialTheme.typography.bodyMedium,
            color = if (muted) {
                MaterialTheme.colorScheme.onSurfaceVariant
            } else {
                MaterialTheme.colorScheme.onSurface
            },
        )
        Spacer(Modifier.width(10.dp))
        Box(
            Modifier
                .weight(1f)
                .height(6.dp)
                .clip(RoundedCornerShape(3.dp))
                .background(MaterialTheme.colorScheme.surfaceVariant),
        ) {
            Box(
                Modifier
                    .fillMaxWidth(total.toFloat() / max.toFloat())
                    .height(6.dp)
                    .clip(RoundedCornerShape(3.dp))
                    .background(
                        if (muted) {
                            MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.4f)
                        } else {
                            MaterialTheme.colorScheme.primary.copy(alpha = 0.7f)
                        },
                    ),
            )
        }
        Spacer(Modifier.width(10.dp))
        Text(
            total.toString(),
            modifier = Modifier.width(28.dp),
            textAlign = TextAlign.End,
            style = MaterialTheme.typography.bodyMedium,
        )
    }
}

/** How many sources get their own row before the rest are folded together. */
private const val TOP_N = 4

/**
 * The headline, in words, or null when no honest one exists.
 *
 * Silent when the leading source is under a third of the attributed work: at
 * that point "most of your work came from X" is simply false, and the table
 * says it better than a wrong sentence would.
 */
internal fun leadingSentence(report: LeadSourceReport): String? {
    val top = report.sources.firstOrNull() ?: return null
    val attributed = report.total - report.unknown
    if (attributed <= 0) return null
    if (top.total.toDouble() / attributed < 0.34) return null
    return "Most of the work you can account for came from ${top.name} — " +
        "${top.total} of $attributed."
}

/** The rows to render: the top few, then everything else as one. */
internal fun visibleRows(report: LeadSourceReport): List<Pair<String, Int>> {
    val rows = report.sources.take(TOP_N).map { it.name to it.total }.toMutableList()
    val rest = report.sources.drop(TOP_N)
    if (rest.isNotEmpty()) {
        rows.add("${rest.size} more" to rest.sumOf { it.total })
    }
    return rows
}
