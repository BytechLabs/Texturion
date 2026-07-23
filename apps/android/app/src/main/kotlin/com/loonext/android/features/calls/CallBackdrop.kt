package com.loonext.android.features.calls

import android.provider.Settings
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.State
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.platform.LocalContext
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.compose.currentStateAsState
import com.loonext.android.telephony.CallPhase
import com.loonext.android.ui.theme.BrandColor
import kotlin.math.PI
import kotlin.math.cos
import kotlin.math.sin

/**
 * The living backdrop for the call surfaces (#204): three large, soft radial
 * blobs in the Paper & Olive family drifting slowly over the call wash -
 * olive, lime, and coral, each on its own prime-length loop (37s / 47s / 59s)
 * so the composition never visibly repeats.
 *
 * It listens to the call, gently: calm drift while ringing or dialing, one
 * soft brightening pulse the moment the call connects, near-still during the
 * conversation, cooling and fading as the call ends. The phase-to-mood
 * mapping is [backdropSpec] / [connectPulseFires] in CallsLogic.kt (pure,
 * JVM-tested); this file only renders it.
 *
 * Craft constraints, all deliberate:
 *  - DRAW-PHASE ONLY. Every per-frame value is a [State] read exclusively
 *    inside the [drawBehind] lambda - composition reads none of them, so the
 *    animation recomposes nothing at 0 recompositions per frame.
 *  - REDUCED MOTION. When the OS animator duration scale is 0 the infinite
 *    transition is never created; the blobs render once, statically.
 *  - BATTERY. The drift also stops whenever the host surface is not at least
 *    STARTED (backgrounded activity, overlay dialog behind another app), and
 *    the infinite transition is scoped to this composable, so a finished call
 *    disposes it with the screen - nothing leaks.
 *  - CONTRAST. Blob alphas are capped (≤ 0.16 light, ≤ 0.10 dark, pulse
 *    included) and centers hug the edges, so ink-on-wash and the dark theme's
 *    muted text stay ≥ AA under any blob on any frame.
 */
@Composable
fun CallBackdrop(phase: CallPhase?, modifier: Modifier = Modifier) {
    val scheme = MaterialTheme.colorScheme
    // The ACTUAL theme in force (the call surfaces honor the in-app theme
    // preference, not just the system flag) - read off the scheme itself.
    val dark = scheme.background == BrandColor.DarkCanvas

    // Paper & Olive family only, straight from the theme roles / BrandColor:
    // deep olive + lime + the coral attention hue, quiet over paper or ink.
    val oliveBlob = if (dark) BrandColor.Olive else scheme.secondary
    val limeBlob = scheme.tertiary
    val coralBlob = if (dark) BrandColor.DarkCoral else BrandColor.Coral

    val spec = backdropSpec(phase)
    // Mood changes ease over a couple of seconds - the backdrop never snaps.
    val drift = animateFloatAsState(
        targetValue = spec.drift,
        animationSpec = tween(durationMillis = 2_600, easing = FastOutSlowInEasing),
        label = "backdropDrift",
    )
    val glow = animateFloatAsState(
        targetValue = spec.glow,
        animationSpec = tween(durationMillis = 2_600, easing = FastOutSlowInEasing),
        label = "backdropGlow",
    )

    // The one-shot connect pulse: snap up, breathe back down over ~2.2s.
    val pulse = remember { Animatable(0f) }
    val lastPhase = remember { arrayOf(phase) }
    LaunchedEffect(phase) {
        val fires = connectPulseFires(lastPhase[0], phase)
        lastPhase[0] = phase
        if (fires) {
            pulse.snapTo(1f)
            pulse.animateTo(0f, tween(durationMillis = 2_200, easing = FastOutSlowInEasing))
        }
    }

    // Reduced motion: animator duration scale 0 means the user asked for NO
    // animation - render the gradient statically, never start the loop.
    val context = LocalContext.current
    val reducedMotion = remember {
        Settings.Global.getFloat(
            context.contentResolver,
            Settings.Global.ANIMATOR_DURATION_SCALE,
            1f,
        ) == 0f
    }
    // Battery honesty: no drifting while the surface is not visible.
    val lifecycleState by LocalLifecycleOwner.current.lifecycle.currentStateAsState()
    val animate = !reducedMotion && lifecycleState.isAtLeast(Lifecycle.State.STARTED)

    val t1: State<Float>
    val t2: State<Float>
    val t3: State<Float>
    if (animate) {
        val motion = rememberInfiniteTransition(label = "callBackdrop")
        // Prime-length periods (37/47/59s) - incommensurate, so the three
        // blobs never realign into a visible repeat.
        t1 = motion.animateFloat(
            initialValue = 0f,
            targetValue = 1f,
            animationSpec = infiniteRepeatable(tween(37_000, easing = LinearEasing)),
            label = "blobOlive",
        )
        t2 = motion.animateFloat(
            initialValue = 0f,
            targetValue = 1f,
            animationSpec = infiniteRepeatable(tween(47_000, easing = LinearEasing)),
            label = "blobLime",
        )
        t3 = motion.animateFloat(
            initialValue = 0f,
            targetValue = 1f,
            animationSpec = infiniteRepeatable(tween(59_000, easing = LinearEasing)),
            label = "blobCoral",
        )
    } else {
        // Static frame: pleasant fixed offsets along each blob's path.
        t1 = remember { mutableFloatStateOf(0.12f) }
        t2 = remember { mutableFloatStateOf(0.41f) }
        t3 = remember { mutableFloatStateOf(0.73f) }
    }

    // Base center alphas + hard cap, tuned so the WORST case (full blob
    // center + connect pulse) keeps AA for the dimmest text on either theme.
    val oliveAlpha = if (dark) 0.10f else 0.11f
    val limeAlpha = if (dark) 0.07f else 0.13f
    val coralAlpha = if (dark) 0.05f else 0.07f
    val alphaCap = if (dark) 0.10f else 0.16f

    Box(
        modifier
            .fillMaxSize()
            .drawBehind {
                val w = size.width
                val h = size.height
                if (w <= 0f || h <= 0f) return@drawBehind
                // All per-frame State reads happen HERE, in the draw phase.
                val d = drift.value
                val g = glow.value * (1f + 0.35f * pulse.value)
                val a1 = t1.value * TWO_PI
                val a2 = t2.value * TWO_PI
                val a3 = t3.value * TWO_PI

                // Olive: upper-left, the widest and quietest wash.
                softBlob(
                    color = oliveBlob,
                    alpha = (oliveAlpha * g).coerceAtMost(alphaCap),
                    center = Offset(
                        w * 0.18f + w * 0.10f * d * cos(a1),
                        h * 0.16f + h * 0.07f * d * sin(a2 + 1.3f),
                    ),
                    radius = w * 0.85f,
                )
                // Lime: right of center, the brand's highlight hue.
                softBlob(
                    color = limeBlob,
                    alpha = (limeAlpha * g).coerceAtMost(alphaCap),
                    center = Offset(
                        w * 0.88f + w * 0.12f * d * cos(a2 + 2.1f),
                        h * 0.52f + h * 0.08f * d * sin(a3),
                    ),
                    radius = w * 0.8f,
                )
                // Coral: low-left, the smallest - a warm attention ember.
                softBlob(
                    color = coralBlob,
                    alpha = (coralAlpha * g).coerceAtMost(alphaCap),
                    center = Offset(
                        w * 0.24f + w * 0.09f * d * cos(a3 + 4.2f),
                        h * 0.90f + h * 0.05f * d * sin(a1 + 0.7f),
                    ),
                    radius = w * 0.62f,
                )
            },
    )
}

private const val TWO_PI = (2 * PI).toFloat()

/** One soft-edged radial blob: full color at center, feathered to nothing. */
private fun DrawScope.softBlob(color: Color, alpha: Float, center: Offset, radius: Float) {
    if (alpha <= 0.002f) return
    drawCircle(
        brush = Brush.radialGradient(
            0f to color.copy(alpha = alpha),
            0.55f to color.copy(alpha = alpha * 0.45f),
            1f to color.copy(alpha = 0f),
            center = center,
            radius = radius,
        ),
        radius = radius,
        center = center,
    )
}
