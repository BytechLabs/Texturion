package com.loonext.android.features.calls

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.CallMade
import androidx.compose.material.icons.automirrored.outlined.CallReceived
import androidx.compose.material.icons.outlined.Call
import androidx.compose.material.icons.outlined.CallEnd
import androidx.compose.material.icons.outlined.Pause
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.loonext.android.core.i18n.t
import com.loonext.android.telephony.CallPhase
import com.loonext.android.ui.common.IconSize
import com.loonext.android.ui.common.announcesChanges
import com.loonext.android.ui.theme.BrandColor

private data class CallPhaseStyle(
    val label: String,
    val icon: ImageVector,
    val fill: Color,
    val foreground: Color,
    val litPixels: Int,
)

@Composable
private fun callPhaseStyle(phase: CallPhase): CallPhaseStyle {
    val colors = MaterialTheme.colorScheme
    val dark = colors.background == BrandColor.DarkCanvas
    return when (phase) {
        CallPhase.RINGING -> CallPhaseStyle(
            "contactsTasks.phaseIncoming", Icons.AutoMirrored.Outlined.CallReceived,
            colors.errorContainer, colors.onErrorContainer, 5,
        )
        CallPhase.CONNECTING -> CallPhaseStyle(
            "contactsTasks.phaseCalling", Icons.AutoMirrored.Outlined.CallMade,
            colors.surfaceContainer, colors.onSurface, 3,
        )
        CallPhase.ACTIVE -> CallPhaseStyle(
            "contactsTasks.phaseActive", Icons.Outlined.Call,
            colors.primaryContainer, colors.onPrimaryContainer, 4,
        )
        CallPhase.HELD -> CallPhaseStyle(
            "contactsTasks.phaseOnHold", Icons.Outlined.Pause,
            if (dark) BrandColor.DarkAmberBg else BrandColor.AmberBg,
            if (dark) BrandColor.DarkAmber else BrandColor.Amber, 2,
        )
        CallPhase.ENDED -> CallPhaseStyle(
            "contactsTasks.phaseEnded", Icons.Outlined.CallEnd,
            colors.surfaceContainer, colors.onSurfaceVariant, 1,
        )
    }
}

@Composable
internal fun CallPhaseIcon(phase: CallPhase) {
    val style = callPhaseStyle(phase)
    Box(
        Modifier.size(40.dp).background(style.fill, MaterialTheme.shapes.medium),
        contentAlignment = Alignment.Center,
    ) {
        Icon(style.icon, contentDescription = null, tint = style.foreground, modifier = Modifier.size(IconSize.Large))
    }
}

@Composable
internal fun CallPhaseBadge(phase: CallPhase, modifier: Modifier = Modifier, announce: Boolean = false) {
    val style = callPhaseStyle(phase)
    val brightness = remember { Animatable(1f) }
    LaunchedEffect(phase) {
        brightness.snapTo(1f)
        if (phase == CallPhase.RINGING) {
            repeat(3) {
                brightness.animateTo(0.35f, tween(560))
                brightness.animateTo(1f, tween(560))
            }
        }
    }
    Row(
        modifier.background(style.fill, CircleShape).padding(horizontal = 8.dp, vertical = 3.dp),
        horizontalArrangement = Arrangement.spacedBy(5.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Canvas(Modifier.size(18.dp, 7.dp)) {
            val pixel = 2.dp.toPx()
            val step = 4.dp.toPx()
            for (index in 0 until 5) {
                drawRoundRect(
                    color = style.foreground,
                    topLeft = Offset(index * step, if (index % 2 == 0) 2.dp.toPx() else 0f),
                    size = Size(pixel, if (index % 2 == 0) 3.dp.toPx() else size.height),
                    cornerRadius = CornerRadius(pixel / 2),
                    alpha = if (index < style.litPixels) brightness.value else 0.25f,
                )
            }
        }
        Text(
            t(style.label),
            style = MaterialTheme.typography.labelSmall,
            color = style.foreground,
            modifier = if (announce) Modifier.announcesChanges() else Modifier,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )
    }
}
