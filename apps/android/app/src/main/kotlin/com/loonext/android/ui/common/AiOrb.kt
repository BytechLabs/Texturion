package com.loonext.android.ui.common

import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import android.provider.Settings
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.size
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import kotlin.math.PI
import kotlin.math.cos
import kotlin.math.sin

/**
 * True when the platform has been asked for no animation (the same
 * animator-duration-scale check the calls backdrop uses).
 */
@Composable
private fun rememberReducedMotion(): Boolean {
    val context = LocalContext.current
    return remember {
        Settings.Global.getFloat(
            context.contentResolver,
            Settings.Global.ANIMATOR_DURATION_SCALE,
            1f,
        ) == 0f
    }
}

/** What the assistant is doing right now. Mirrors the web AiOrbState. */
enum class AiOrbState { Idle, Thinking, Working, Done }

/**
 * THE AI MARK, Android twin of apps/web/src/components/ui/ai-orb.tsx.
 *
 * Every AI surface in the product wears this and nothing else, so a crew learns
 * "this is Lou" once and recognises it everywhere. A ring of dots rather than a
 * sparkle: sparkles are what every other product uses, and this reads at any
 * size.
 *
 * Idle rests evenly lit. Thinking runs a pulse around the ring, one dot at a
 * time. Working turns the whole ring. Motion is dropped when the platform asks
 * for reduced motion, where the states stay distinguishable by weight alone.
 */
@Composable
fun AiOrb(
    state: AiOrbState = AiOrbState.Idle,
    contentDescription: String? = null,
    size: androidx.compose.ui.unit.Dp = 20.dp,
    modifier: Modifier = Modifier,
) {
    val tint = MaterialTheme.colorScheme.primary
    val reduceMotion = rememberReducedMotion()
    val animate = !reduceMotion && (state == AiOrbState.Thinking || state == AiOrbState.Working)

    val transition = rememberInfiniteTransition(label = "ai-orb")
    val phase by if (animate) {
        transition.animateFloat(
            initialValue = 0f,
            targetValue = 1f,
            animationSpec = infiniteRepeatable(
                animation = tween(
                    durationMillis = if (state == AiOrbState.Working) 1400 else 1100,
                    easing = LinearEasing,
                ),
                repeatMode = RepeatMode.Restart,
            ),
            label = "ai-orb-phase",
        )
    } else {
        // A still orb still needs a value; a remembered constant keeps the
        // composable's shape identical in both branches.
        remember { mutableFloatStateOf(0f) }
    }

    Canvas(
        modifier
            .size(size)
            .then(
                if (contentDescription != null) {
                    Modifier.semantics { this.contentDescription = contentDescription }
                } else {
                    Modifier
                },
            ),
    ) {
        val count = 8
        val radius = this.size.minDimension / 2f * 0.78f
        val dot = this.size.minDimension * 0.13f
        val centre = Offset(this.size.width / 2f, this.size.height / 2f)

        for (i in 0 until count) {
            val fraction = i / count.toFloat()
            // Working turns the whole ring; thinking travels a pulse around it.
            val spin = if (state == AiOrbState.Working) phase else 0f
            val angle = (fraction + spin) * 2f * PI.toFloat() - PI.toFloat() / 2f
            val alpha = when {
                state == AiOrbState.Thinking && !reduceMotion -> {
                    // Distance from the travelling head, wrapped.
                    val d = ((fraction - phase) % 1f + 1f) % 1f
                    if (d < 0.25f) 0.3f + (1f - d / 0.25f) * 0.7f else 0.3f
                }
                state == AiOrbState.Idle -> 0.32f
                else -> 0.85f
            }
            drawCircle(
                color = Color(tint.red, tint.green, tint.blue, alpha),
                radius = dot / 2f,
                center = Offset(
                    centre.x + cos(angle) * radius,
                    centre.y + sin(angle) * radius,
                ),
            )
        }
    }
}
