package com.loonext.android.ui.common

import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.Spring
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.spring
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.composed
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Shape
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp

/**
 * Paper & Olive motion kit. Three primitives every surface shares so the app
 * feels alive the same way everywhere:
 *
 *  - [rememberShimmerBrush] + the Skeleton pieces: first-fetch placeholders
 *    that shimmer in the row grammar of the screen they stand in for (with
 *    cache-first #176 these can only ever appear once per key per process).
 *  - [pressScale]: cards and circles give under the finger (0.97 spring).
 *  - Use LazyItemScope.animateItem() at call sites for list placement moves;
 *    this file deliberately holds no wrapper for it because the call site
 *    must live inside the LazyColumn DSL.
 */

/** A paper-tone gradient that sweeps left-to-right, 1.2s loop. */
@Composable
fun rememberShimmerBrush(): Brush {
    val motion = rememberInfiniteTransition(label = "shimmer")
    val progress by motion.animateFloat(
        initialValue = 0f,
        targetValue = 1f,
        animationSpec = infiniteRepeatable(
            tween(durationMillis = 1200, easing = LinearEasing),
        ),
        label = "sweep",
    )
    val rest = MaterialTheme.colorScheme.surfaceContainerHigh
    val sheen = MaterialTheme.colorScheme.surface
    val head = progress * 1600f
    return Brush.linearGradient(
        colors = listOf(rest, sheen, rest),
        start = Offset(head - 400f, 0f),
        end = Offset(head, 160f),
    )
}

/** One shimmering placeholder block in the given shape. */
@Composable
fun SkeletonBlock(
    width: Dp,
    height: Dp,
    modifier: Modifier = Modifier,
    shape: Shape = RoundedCornerShape(6.dp),
) {
    Box(
        modifier
            .size(width, height)
            .background(rememberShimmerBrush(), shape),
    )
}

/** A list-row skeleton in the app's row grammar: avatar circle + one or two lines. */
@Composable
private fun SkeletonListRow(
    modifier: Modifier = Modifier,
    avatar: Boolean = true,
    lines: Int = 2,
) {
    Row(
        modifier
            .fillMaxWidth()
            .padding(horizontal = 15.dp, vertical = 12.dp),
    ) {
        if (avatar) {
            SkeletonBlock(40.dp, 40.dp, shape = CircleShape)
            Spacer(Modifier.width(11.dp))
        }
        Column {
            SkeletonBlock(148.dp, 13.dp)
            if (lines > 1) {
                Spacer(Modifier.height(8.dp))
                SkeletonBlock(216.dp, 11.dp)
            }
        }
    }
}

/**
 * #733: the one loading skeleton for a list. [rows] shimmering rows of an
 * optional avatar and one or two [lines], pulsing where the content will land
 * so the page does not reflow. First load only, never on a realtime update.
 * Pass [label] when the loading state should be announced; otherwise it is
 * hidden from assistive tech. Callers wrap it in their own PaperCard when the
 * real list is carded. The web twin is
 * `apps/web/src/components/ui/list-skeleton.tsx`.
 *
 * A skeleton shaped like a board, a calendar, a map or a thread is not a list
 * and keeps its own markup, each named in `ListSkeletonGuardTest`.
 */
@Composable
fun SkeletonList(
    modifier: Modifier = Modifier,
    rows: Int = 8,
    avatar: Boolean = true,
    lines: Int = 2,
    label: String? = null,
) {
    Column(
        modifier.then(
            if (label != null) {
                Modifier.semantics { contentDescription = label }
            } else {
                Modifier.clearAndSetSemantics { }
            },
        ),
    ) {
        repeat(rows) {
            SkeletonListRow(avatar = avatar, lines = lines)
        }
    }
}

/**
 * Pressed surfaces give slightly under the finger and spring back. Pass the
 * SAME interaction source the clickable uses.
 */
fun Modifier.pressScale(
    interactionSource: MutableInteractionSource,
    pressed: Float = 0.97f,
): Modifier = composed {
    val isPressed by interactionSource.collectIsPressedAsState()
    val scale by animateFloatAsState(
        targetValue = if (isPressed) pressed else 1f,
        animationSpec = spring(stiffness = Spring.StiffnessMediumLow),
        label = "pressScale",
    )
    graphicsLayer {
        scaleX = scale
        scaleY = scale
    }
}
