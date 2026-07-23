package com.loonext.android.features.calls

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Call
import androidx.compose.material.icons.outlined.CallEnd
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.rotate
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.em
import androidx.compose.ui.unit.sp
import com.loonext.android.ui.common.initialsOf

/**
 * Paper & Olive atoms shared by the call surfaces (specs 03/04/05/25/26/32):
 *  - [callScreenColor]  the in-call/ring canvas (deep inset light, canvas dark)
 *  - [CallerAvatar]     112dp paper circle + lime ring + dotted halo (+ badge)
 *  - [ControlCircle]    a 58dp paper circle control with an 10.5sp label
 *  - [EndCallPill]      the full-width brick "End call" pill
 *  - [KeypadKey]        borderless paper keypad circle (digit + letters)
 *  - [LineStatusRow]    6dp status dot + 11sp semibold line ("Ready to ring")
 */

/** Spec 04/26 sit on the deep-inset wash in light; spec 32 pins near-canvas dark. */
@Composable
fun callScreenColor(): Color =
    if (isSystemInDarkTheme()) {
        MaterialTheme.colorScheme.background
    } else {
        MaterialTheme.colorScheme.surfaceContainerHigh
    }

/**
 * The identity circle from the ring/in-call specs: paper disc with Golos
 * initials, a lime ring at +9dp and a dotted ink halo at +19dp; the in-call
 * variant adds the small lime phone badge (spec 26/32). The halo drifts
 * slowly whenever a call surface is up, and while [ringing] the lime ring
 * breathes outward so an incoming ring never reads as a frozen frame.
 */
@Composable
fun CallerAvatar(
    name: String,
    modifier: Modifier = Modifier,
    size: Dp = 112.dp,
    badge: Boolean = false,
    ringing: Boolean = false,
    badgeBorder: Color = callScreenColor(),
) {
    val ring = MaterialTheme.colorScheme.tertiary
    val halo = MaterialTheme.colorScheme.onBackground
    val motion = rememberInfiniteTransition(label = "callerRing")
    val spin by motion.animateFloat(
        initialValue = 0f,
        targetValue = 360f,
        animationSpec = infiniteRepeatable(
            tween(durationMillis = 24_000, easing = LinearEasing),
        ),
        label = "haloSpin",
    )
    val breath by motion.animateFloat(
        initialValue = 0f,
        targetValue = 1f,
        animationSpec = infiniteRepeatable(
            tween(durationMillis = 1_500, easing = FastOutSlowInEasing),
            repeatMode = RepeatMode.Reverse,
        ),
        label = "ringBreath",
    )
    val pulse = if (ringing) breath else 0f
    Box(modifier.size(size + 42.dp), contentAlignment = Alignment.Center) {
        Box(
            Modifier
                .size(size)
                .drawBehind {
                    val stroke = 2.dp.toPx()
                    val radius = this.size.minDimension / 2f
                    drawCircle(
                        color = ring.copy(alpha = 0.5f - 0.22f * pulse),
                        radius = radius + 9.dp.toPx() + 5.dp.toPx() * pulse,
                        style = Stroke(stroke),
                    )
                    rotate(spin) {
                        drawCircle(
                            color = halo.copy(alpha = 0.2f),
                            radius = radius + 19.dp.toPx() + 2.dp.toPx() * pulse,
                            style = Stroke(
                                stroke,
                                pathEffect = PathEffect.dashPathEffect(
                                    floatArrayOf(2.dp.toPx(), 6.dp.toPx()),
                                ),
                            ),
                        )
                    }
                }
                .background(MaterialTheme.colorScheme.surface, CircleShape),
            contentAlignment = Alignment.Center,
        ) {
            Text(
                initialsOf(name.ifBlank { null }),
                fontSize = (size.value * 0.285f).sp,
                fontWeight = FontWeight.SemiBold,
                letterSpacing = (-0.02).em,
                color = MaterialTheme.colorScheme.onSurface,
            )
            if (badge) {
                Box(
                    Modifier
                        .align(Alignment.BottomEnd)
                        .offset(x = 4.dp, y = 4.dp)
                        .size(26.dp)
                        .background(MaterialTheme.colorScheme.tertiary, CircleShape)
                        .border(3.dp, badgeBorder, CircleShape),
                    contentAlignment = Alignment.Center,
                ) {
                    Icon(
                        Icons.Outlined.Call,
                        contentDescription = null,
                        tint = MaterialTheme.colorScheme.onTertiary,
                        modifier = Modifier.size(12.dp),
                    )
                }
            }
        }
    }
}

/** One in-call control: paper circle (ink-filled when active) + tiny label. */
@Composable
fun ControlCircle(
    icon: ImageVector,
    label: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    contentDescription: String? = null,
    active: Boolean = false,
    enabled: Boolean = true,
    size: Dp = 58.dp,
) {
    Column(
        modifier,
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        Surface(
            onClick = onClick,
            enabled = enabled,
            shape = CircleShape,
            color = if (active) {
                MaterialTheme.colorScheme.primary
            } else {
                MaterialTheme.colorScheme.surface
            },
            contentColor = if (active) {
                MaterialTheme.colorScheme.onPrimary
            } else {
                MaterialTheme.colorScheme.onSurface
            },
            shadowElevation = if (active) 0.dp else 1.dp,
            modifier = Modifier
                .size(size)
                .alpha(if (enabled) 1f else 0.45f),
        ) {
            Box(contentAlignment = Alignment.Center) {
                Icon(icon, contentDescription, modifier = Modifier.size(20.dp))
            }
        }
        Text(
            label,
            fontSize = 10.5.sp,
            fontWeight = if (active) FontWeight.Bold else FontWeight.SemiBold,
            color = if (active) {
                MaterialTheme.colorScheme.onBackground
            } else {
                MaterialTheme.colorScheme.onSurfaceVariant
            },
            modifier = Modifier.alpha(if (enabled) 1f else 0.45f),
        )
    }
}

/** Full-width brick pill: "End call" left, translucent icon disc right. */
@Composable
fun EndCallPill(
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    label: String = "End call",
    enabled: Boolean = true,
) {
    Surface(
        onClick = onClick,
        enabled = enabled,
        shape = CircleShape,
        color = MaterialTheme.colorScheme.error,
        contentColor = MaterialTheme.colorScheme.onError,
        modifier = modifier.alpha(if (enabled) 1f else 0.45f),
    ) {
        Row(
            Modifier.padding(start = 24.dp, top = 8.dp, end = 8.dp, bottom = 8.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(
                label,
                fontSize = 15.sp,
                fontWeight = FontWeight.SemiBold,
                modifier = Modifier.weight(1f),
            )
            Box(
                Modifier
                    .size(44.dp)
                    .background(
                        MaterialTheme.colorScheme.onError.copy(alpha = 0.16f),
                        CircleShape,
                    ),
                contentAlignment = Alignment.Center,
            ) {
                Icon(
                    Icons.Outlined.CallEnd,
                    contentDescription = null,
                    modifier = Modifier.size(20.dp),
                )
            }
        }
    }
}

/** Borderless paper keypad circle: Golos digit + tracked letter caption. */
@Composable
fun KeypadKey(
    digit: String,
    letters: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    size: Dp = 72.dp,
    /** Shrinks the digit/letter type with the key on short viewports (#180). */
    textScale: Float = 1f,
) {
    val symbol = digit == "*" || digit == "#"
    Surface(
        onClick = onClick,
        shape = CircleShape,
        color = MaterialTheme.colorScheme.surface,
        shadowElevation = 1.dp,
        modifier = modifier.size(size),
    ) {
        Column(
            Modifier.fillMaxSize(),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.Center,
        ) {
            Text(
                digit,
                fontSize = (if (symbol) 22.sp else 24.sp) * textScale,
                fontWeight = FontWeight.SemiBold,
                color = if (symbol) {
                    MaterialTheme.colorScheme.onSurfaceVariant
                } else {
                    MaterialTheme.colorScheme.onSurface
                },
            )
            if (letters.isNotEmpty()) {
                Text(
                    letters,
                    fontSize = 8.5.sp * textScale,
                    fontWeight = FontWeight.Bold,
                    letterSpacing = 0.14.em,
                    color = MaterialTheme.colorScheme.outline,
                )
            }
        }
    }
}

/** "· Ready to ring" — 6dp dot + 11sp semibold line status (specs 03/25). */
@Composable
fun LineStatusRow(
    text: String,
    dot: Color,
    textColor: Color,
    modifier: Modifier = Modifier,
) {
    Row(
        modifier,
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        Box(
            Modifier
                .size(6.dp)
                .background(dot, CircleShape),
        )
        Text(text, fontSize = 11.sp, fontWeight = FontWeight.SemiBold, color = textColor)
    }
}
