package com.loonext.android.features.foryou

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import com.loonext.android.core.model.PipelineReportResponse
import com.loonext.android.ui.common.PaperCard

/**
 * #354 — the pipeline panel on the home surface.
 *
 * # What this has to achieve
 *
 * #354 calls the win rate "the first honest business metric this product could
 * show an owner". That last word is the design constraint: an owner does not act
 * on a percentage, they act on "three quotes are still waiting on an answer",
 * which is a Monday morning's work.
 *
 * Applying: Meaningful Highlights & Context (the sentence is the headline and
 * the rate is the figure under it, matching the response-time card above it),
 * Chunking (four figures at most), and Loss Aversion (the outstanding quotes are
 * money the crew has not been paid yet).
 *
 * # Absent rather than empty
 *
 * The card renders NOTHING when nothing has been quoted. A zero state would tell
 * a crew who have not sent a quote that they have a 0% win rate, which is untrue
 * and discouraging in the same breath. The server is silent below five decided
 * jobs for the same reason: a 100% rate off two quotes is noise presented as an
 * achievement.
 */
@Composable
fun PipelineCard(report: PipelineReportResponse?) {
    // Null while it loads, and null forever for a workspace that has not quoted.
    // Both mean the same thing on screen: say nothing.
    if (report == null || report.current.quoted == 0) return

    val rate = report.win_rate
    val delta = if (rate != null && report.previous_win_rate != null) {
        rate - report.previous_win_rate
    } else {
        null
    }

    PaperCard(Modifier.fillMaxWidth().padding(top = 15.dp)) {
        Column(Modifier.padding(16.dp)) {
            Row(verticalAlignment = Alignment.Top) {
                Column(Modifier.weight(1f)) {
                    Text(
                        "Quotes, last 30 days",
                        style = MaterialTheme.typography.labelMedium,
                    )
                    Spacer(Modifier.height(4.dp))
                    Text(
                        report.insight ?: tooEarly(report.current.quoted),
                        style = MaterialTheme.typography.bodyLarge,
                    )
                }
                if (rate != null) {
                    Spacer(Modifier.width(12.dp))
                    Column(horizontalAlignment = Alignment.End) {
                        Text(
                            "$rate%",
                            style = MaterialTheme.typography.headlineSmall,
                        )
                        // Silent when there is no previous window: "unchanged"
                        // and "we do not know yet" are different facts and only
                        // one of them is reassuring.
                        if (delta != null && delta != 0) {
                            Text(
                                (if (delta > 0) "+" else "") + "$delta pts",
                                style = MaterialTheme.typography.labelSmall,
                            )
                        }
                    }
                }
            }

            Spacer(Modifier.height(14.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(16.dp)) {
                PipelineFigure("Quoted", report.current.quoted, Modifier.weight(1f))
                PipelineFigure("Won", report.current.won, Modifier.weight(1f))
                PipelineFigure("Still out", report.current.open, Modifier.weight(1f))
            }
        }
    }
}

/** The honest line for a workspace with quotes but nothing decided yet. */
internal fun tooEarly(quoted: Int): String =
    "$quoted ${if (quoted == 1) "quote" else "quotes"} sent. Too early to call a win rate."

@Composable
private fun PipelineFigure(label: String, value: Int, modifier: Modifier = Modifier) {
    Column(modifier) {
        Text(label, style = MaterialTheme.typography.labelSmall)
        Text(
            value.toString(),
            style = MaterialTheme.typography.titleLarge,
            textAlign = TextAlign.Start,
        )
    }
}
