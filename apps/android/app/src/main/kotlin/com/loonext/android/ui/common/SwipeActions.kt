package com.loonext.android.ui.common

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.Spring
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.spring
import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.detectHorizontalDragGestures
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.layout
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.unit.Constraints
import androidx.compose.ui.unit.Density
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.dp
import kotlin.math.abs
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt
import kotlin.math.sign
import kotlinx.coroutines.launch

/**
 * Reusable swipe-action row for list surfaces (#185): inbox conversations,
 * task rows, call-log rows.
 *
 * A11Y RULE (#185): a swipe is NEVER the only path to an action. Every action
 * wired here must ALSO have a visible tap path on the row (button, menu item,
 * detail screen control). Do not remove an existing affordance because the
 * swipe now exists; the swipe is a shortcut, not the door.
 *
 * Behavior:
 *  - Dragging right reveals [SwipeActionRow]'s startAction behind the leading
 *    edge; dragging left reveals endAction behind the trailing edge.
 *  - Commit threshold is 40% of row width or 96dp, whichever is smaller.
 *    Crossing it arms the action (tick haptic, icon springs up); releasing
 *    while armed fires onCommit and the row springs back to rest. These are
 *    NOT dismissals: the row stays where it is.
 *  - Below threshold the row springs back and nothing fires.
 *  - Past threshold the reveal resists, capped near 1.2x the threshold.
 *  - Vertical scrolling always wins (the detector only claims horizontal
 *    drags), and row taps / pressScale keep working untouched.
 *
 * Haptics contract: this component plays tick() at the moment of arming.
 * The CALLER plays the commit haptic inside onCommit (confirm/reject/tap by
 * the action's meaning, per Haptics.kt).
 */

/**
 * One swipe action. [tint] and [container] must be theme color ROLES from
 * MaterialTheme.colorScheme (Paper & Olive, no raw hex), e.g.
 * tint = onTertiaryContainer, container = tertiaryContainer.
 */
data class SwipeAction(
    val icon: ImageVector,
    val label: String,
    val tint: Color,
    val container: Color,
    val onCommit: () -> Unit,
)

/** 40% of the row or 96dp, whichever is smaller. */
private fun Density.commitThresholdPx(rowWidthPx: Float): Float =
    min(rowWidthPx * 0.4f, 96.dp.toPx())

/**
 * Maps raw drag to shown reveal: linear up to the threshold, then a
 * diminishing tail that never exceeds 1.2x the threshold.
 */
private fun resist(raw: Float, thresholdPx: Float): Float {
    val magnitude = abs(raw)
    if (magnitude <= thresholdPx) return raw
    val excess = magnitude - thresholdPx
    val tail = 0.2f * thresholdPx * (excess / (excess + thresholdPx))
    return sign(raw) * (thresholdPx + tail)
}

/**
 * Wraps [content] (one full-bleed list row) with reveal-behind swipe actions.
 * Safe inside a LazyColumn item (pair with animateItem at the call site).
 * Pass null for a side to disable that direction entirely.
 */
@Composable
fun SwipeActionRow(
    modifier: Modifier = Modifier,
    startAction: SwipeAction? = null,
    endAction: SwipeAction? = null,
    content: @Composable () -> Unit,
) {
    val haptics = rememberHaptics()
    val scope = rememberCoroutineScope()
    val offsetAnim = remember { Animatable(0f) }
    val currentStart by rememberUpdatedState(startAction)
    val currentEnd by rememberUpdatedState(endAction)
    // -1 end armed, 0 disarmed, +1 start armed.
    var armedSide by remember { mutableIntStateOf(0) }
    var rowWidthPx by remember { mutableFloatStateOf(0f) }

    Box(
        modifier
            .clipToBounds()
            .onSizeChanged { rowWidthPx = it.width.toFloat() },
    ) {
        if (startAction != null) {
            ActionPanel(
                action = startAction,
                isStart = true,
                revealPx = { max(0f, offsetAnim.value) },
                rowWidthPx = { rowWidthPx },
                armed = armedSide == 1,
                modifier = Modifier.matchParentSize(),
            )
        }
        if (endAction != null) {
            ActionPanel(
                action = endAction,
                isStart = false,
                revealPx = { max(0f, -offsetAnim.value) },
                rowWidthPx = { rowWidthPx },
                armed = armedSide == -1,
                modifier = Modifier.matchParentSize(),
            )
        }
        Box(
            Modifier
                .offset { IntOffset(offsetAnim.value.roundToInt(), 0) }
                .pointerInput(Unit) {
                    var raw = 0f

                    fun settle(commit: Boolean) {
                        val side = armedSide
                        armedSide = 0
                        raw = 0f
                        if (commit) {
                            when (side) {
                                1 -> currentStart?.onCommit()
                                -1 -> currentEnd?.onCommit()
                            }
                        }
                        scope.launch {
                            offsetAnim.animateTo(
                                targetValue = 0f,
                                animationSpec = spring(
                                    dampingRatio = Spring.DampingRatioNoBouncy,
                                    stiffness = Spring.StiffnessMediumLow,
                                ),
                            )
                        }
                    }

                    detectHorizontalDragGestures(
                        onDragStart = {
                            // Catching a row mid spring-back keeps continuity.
                            raw = offsetAnim.value
                        },
                        onDragEnd = { settle(commit = true) },
                        onDragCancel = { settle(commit = false) },
                    ) { change, dragAmount ->
                        change.consume()
                        raw += dragAmount
                        if (currentStart == null && raw > 0f) raw = 0f
                        if (currentEnd == null && raw < 0f) raw = 0f
                        val threshold = commitThresholdPx(size.width.toFloat())
                        val newArmed = when {
                            threshold <= 0f -> 0
                            raw >= threshold -> 1
                            raw <= -threshold -> -1
                            else -> 0
                        }
                        if (newArmed != armedSide) {
                            if (newArmed != 0) haptics.tick()
                            armedSide = newArmed
                        }
                        val shown = resist(raw, threshold)
                        scope.launch { offsetAnim.snapTo(shown) }
                    }
                },
        ) {
            content()
        }
    }
}

/**
 * The full-height gutter behind the row: container-colored, sized to the
 * current reveal, icon + label centered in the revealed width. The icon
 * springs up slightly when armed so the commit point is discoverable.
 */
@Composable
private fun ActionPanel(
    action: SwipeAction,
    isStart: Boolean,
    revealPx: () -> Float,
    rowWidthPx: () -> Float,
    armed: Boolean,
    modifier: Modifier = Modifier,
) {
    val iconScale by animateFloatAsState(
        targetValue = if (armed) 1.15f else 0.9f,
        animationSpec = spring(stiffness = Spring.StiffnessMediumLow),
        label = "swipeActionIcon",
    )
    Box(modifier) {
        Box(
            Modifier
                .align(if (isStart) Alignment.CenterStart else Alignment.CenterEnd)
                .fillMaxHeight()
                .layout { measurable, constraints ->
                    // Width follows the reveal in the layout phase only, so
                    // the drag never recomposes the row.
                    val reveal = revealPx()
                        .roundToInt()
                        .coerceIn(0, constraints.maxWidth)
                    val placeable = measurable.measure(
                        Constraints.fixed(reveal, constraints.maxHeight),
                    )
                    layout(reveal, constraints.maxHeight) {
                        placeable.place(0, 0)
                    }
                }
                .background(action.container)
                .clipToBounds(),
            contentAlignment = Alignment.Center,
        ) {
            Column(
                horizontalAlignment = Alignment.CenterHorizontally,
                modifier = Modifier.graphicsLayer {
                    val threshold = commitThresholdPx(rowWidthPx())
                    alpha = if (threshold > 0f) {
                        (revealPx() / threshold).coerceIn(0f, 1f)
                    } else {
                        0f
                    }
                },
            ) {
                Icon(
                    imageVector = action.icon,
                    contentDescription = null,
                    tint = action.tint,
                    modifier = Modifier.graphicsLayer {
                        scaleX = iconScale
                        scaleY = iconScale
                    },
                )
                Spacer(Modifier.height(2.dp))
                Text(
                    text = action.label,
                    style = MaterialTheme.typography.labelSmall,
                    color = action.tint,
                    maxLines = 1,
                    softWrap = false,
                )
            }
        }
    }
}
