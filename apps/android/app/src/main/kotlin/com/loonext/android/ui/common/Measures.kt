package com.loonext.android.ui.common

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.layout.layout
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp

/**
 * #540 — the dashboard's measures, drawn.
 *
 * The hand-port of `apps/web/src/components/ui/proportion-ring.tsx` and
 * `share-bar.tsx`. The phones shipped the same four measures as numbers in boxes
 * while the laptop got the marks, which is the version of this issue that reads
 * as two different products — a founder comparing the two sees the same figures
 * presented as if one of the screens had not been finished.
 *
 * ## Two shapes, and the difference is not decorative
 *
 * A RING says "how much of one thing" — one part against one whole. A BAR says
 * what a whole is MADE of. The quotes panel asks the second question (won, still
 * out, gone quiet), and forcing that into an arc loses the middle one, which is
 * the only one anybody can still act on.
 *
 * ## Accessibility is the part these usually get wrong
 *
 * A shape alone is nothing to TalkBack and nothing to somebody who cannot
 * separate the tones. Both take a SENTENCE from the caller, and neither ever
 * carries a figure that is not also written on the card as text.
 *
 * Colour comes from the CALLER, not from a palette chosen here: a colour is a
 * fill or a label, never both (D100), and only the card knows which of its own
 * tones mean what.
 */

/**
 * A proportion, as a closing ring.
 *
 * Nothing done draws NO arc rather than a dot — a round cap at zero length still
 * paints a mark, and a mark reads as a small amount of something rather than none
 * of it. A caller reporting more done than exists gets a closed ring rather than
 * an arc that has wrapped round and looks like almost nothing.
 */
@Composable
fun ProportionRing(
    value: Float,
    total: Float,
    /** What TalkBack says. A sentence, not a percentage. */
    label: String,
    color: Color,
    modifier: Modifier = Modifier,
    size: Dp = 22.dp,
) {
    val safeTotal = total.coerceAtLeast(0f)
    val safeValue = value.coerceIn(0f, safeTotal)
    val fraction = if (safeTotal == 0f) 0f else safeValue / safeTotal
    val strokeDp = (size.value / 9f).coerceAtLeast(2.5f).dp

    Canvas(
        modifier
            .size(size)
            .semantics { contentDescription = label },
    ) {
        val stroke = strokeDp.toPx()
        val inset = stroke / 2f
        val arcSize = Size(this.size.width - stroke, this.size.height - stroke)
        // The track. Deliberately faint: it is the amount still to do, and a
        // strong ring for the part NOT done reads as a warning about work that
        // may be perfectly fine.
        drawArc(
            color = color.copy(alpha = 0.15f),
            startAngle = 0f,
            sweepAngle = 360f,
            useCenter = false,
            topLeft = Offset(inset, inset),
            size = arcSize,
            style = Stroke(width = stroke),
        )
        if (fraction > 0f) {
            drawArc(
                color = color,
                // From the top rather than from three o'clock, which is where
                // every reader expects a progress ring to start.
                startAngle = -90f,
                sweepAngle = 360f * fraction,
                useCenter = false,
                topLeft = Offset(inset, inset),
                size = arcSize,
                style = Stroke(width = stroke, cap = StrokeCap.Round),
            )
        }
    }
}

/** One part of a whole, for [ShareBar]. */
data class ShareSegment(val label: String, val value: Float, val color: Color)

/**
 * What share of the bar each part gets.
 *
 * PULLED OUT AS A PURE FUNCTION ON PURPOSE. This was first checked by rendering a
 * bar whose parts exceeded its whole and asserting the bar appeared — which it
 * did, clamp or no clamp, because an over-long segment overflows quietly rather
 * than failing. That test passed with the clamp deleted, so it was checking
 * nothing. Arithmetic is testable as arithmetic; rendering is testable as
 * rendering; and conflating them is how a guard ends up decorative.
 *
 * Clamped cumulatively, so a caller whose parts add to more than the whole gets a
 * full bar rather than segments running off the end. That happens for real: the
 * parts and the total are separate figures from the server, and a lagging window
 * can disagree with itself by one.
 */
internal fun shareFractions(values: List<Float>, total: Float): List<Float> {
    val safeTotal = total.coerceAtLeast(0f)
    if (safeTotal == 0f) return values.map { 0f }
    var used = 0f
    return values.map { value ->
        val v = value.coerceIn(0f, safeTotal - used)
        used += v
        v / safeTotal
    }
}

/**
 * A whole, split into its parts.
 *
 * Segments summing to LESS than the total leave the remainder as bare track,
 * which is the honest picture — the gap is the part nobody has accounted for, and
 * stretching the parts to fill the bar would hide the number worth chasing.
 */
@Composable
fun ShareBar(
    segments: List<ShareSegment>,
    total: Float,
    /** What TalkBack says. A sentence, not a set of percentages. */
    label: String,
    modifier: Modifier = Modifier,
    height: Dp = 6.dp,
) {
    val safeTotal = total.coerceAtLeast(0f)
    // Nothing to divide. An empty track reads as a panel that failed to load
    // rather than as a month with no quotes in it.
    if (safeTotal == 0f) return

    val drawn = segments.zip(shareFractions(segments.map { it.value }, safeTotal))

    Row(
        modifier
            .fillMaxWidth()
            .height(height)
            .clip(RoundedCornerShape(percent = 50))
            // The track BEHIND the segments, so the unaccounted remainder is
            // visible as a gap rather than as nothing at all.
            .background(MaterialTheme.colorScheme.surfaceVariant)
            .semantics { contentDescription = label },
    ) {
        drawn.forEach { (segment, fraction) ->
            if (fraction > 0f) {
                Canvas(
                    Modifier
                        .fillMaxHeight()
                        // `weight` cannot express "this share of the parent" when
                        // the remainder must stay empty, so the width is measured
                        // against the incoming constraint directly.
                        .layout { measurable, constraints ->
                            val w = (constraints.maxWidth * fraction).toInt()
                            val placeable = measurable.measure(
                                constraints.copy(minWidth = w, maxWidth = w),
                            )
                            layout(w, placeable.height) { placeable.place(0, 0) }
                        },
                ) {
                    drawRect(color = segment.color)
                }
            }
        }
    }
}

