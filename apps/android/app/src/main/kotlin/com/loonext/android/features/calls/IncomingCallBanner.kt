package com.loonext.android.features.calls

import android.Manifest
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.MutableTransitionState
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.slideOutVertically
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Call
import androidx.compose.material.icons.filled.CallEnd
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.SideEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Popup
import androidx.compose.ui.window.PopupProperties
import com.loonext.android.core.model.CompanyView
import com.loonext.android.telephony.CallSnapshot
import com.loonext.android.telephony.SoftphoneManager
import com.loonext.android.ui.common.formatPhone

/**
 * The unmissable in-app incoming-call banner (#167): an expressively
 * spring-in card pinned to the TOP of the screen while an inbound call rings
 * and the app is foreground. Rendered in its own [Popup] window so it floats
 * over EVERY surface — tabs, thread overlays, sheets — without taking over
 * or blocking the UI underneath (the popup is non-focusable and only its own
 * bounds receive touches; the founder's direction is unmissable, not modal).
 *
 * Presentation is decided by the pure [bannerRingingCall] reducer: only a
 * RINGING inbound shows here — answering/declining hands off to the existing
 * chip + in-call surfaces, and the [com.loonext.android.telephony.Ringer]
 * (sound + vibration) runs alongside. Tapping the card body expands the same
 * full in-call screen the chip expands into. Accept preflights the mic
 * permission; a refusal keeps the call ringing with an inline notice — it
 * never auto-declines.
 */
@Composable
fun IncomingCallBanner(
    call: CallSnapshot?,
    manager: SoftphoneManager,
    company: CompanyView?,
    onExpand: () -> Unit,
) {
    val visibleState = remember { MutableTransitionState(false) }
    visibleState.targetState = call != null

    // Keep the last ringing call renderable through the exit animation.
    var remembered by remember { mutableStateOf<CallSnapshot?>(null) }
    SideEffect { if (call != null) remembered = call }
    val presented = call ?: remembered

    if (presented == null || (!visibleState.currentState && !visibleState.targetState)) return

    Popup(
        alignment = Alignment.TopCenter,
        properties = PopupProperties(focusable = false),
    ) {
        AnimatedVisibility(
            visibleState = visibleState,
            enter = slideInVertically(MaterialTheme.motionScheme.defaultSpatialSpec()) { -it } +
                fadeIn(MaterialTheme.motionScheme.defaultEffectsSpec()),
            exit = slideOutVertically(MaterialTheme.motionScheme.fastSpatialSpec()) { -it } +
                fadeOut(MaterialTheme.motionScheme.fastEffectsSpec()),
        ) {
            IncomingCallCard(
                call = presented,
                manager = manager,
                company = company,
                onExpand = onExpand,
            )
        }
    }
}

@Composable
private fun IncomingCallCard(
    call: CallSnapshot,
    manager: SoftphoneManager,
    company: CompanyView?,
    onExpand: () -> Unit,
) {
    // Mic preflight on Accept: refusal keeps ringing with an inline notice.
    var micNotice by remember(call.id) { mutableStateOf(false) }
    val micLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestPermission(),
    ) { granted ->
        if (granted) manager.answer(call.id) else micNotice = true
    }

    Surface(
        onClick = onExpand,
        shape = MaterialTheme.shapes.extraLarge,
        color = MaterialTheme.colorScheme.surfaceContainerLow,
        border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant),
        shadowElevation = 6.dp,
        modifier = Modifier
            .fillMaxWidth()
            .statusBarsPadding()
            .padding(horizontal = 12.dp, vertical = 8.dp),
    ) {
        Column(Modifier.padding(horizontal = 16.dp, vertical = 14.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                PulsingCallIndicator()
                Spacer(Modifier.width(14.dp))
                Column(Modifier.weight(1f)) {
                    Text(
                        "Incoming call",
                        style = MaterialTheme.typography.labelMedium,
                        color = MaterialTheme.colorScheme.primary,
                    )
                    Text(
                        call.peerName.ifBlank { "Unknown caller" },
                        style = MaterialTheme.typography.titleLarge,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )
                    secondaryLine(call, company)?.let { line ->
                        Text(
                            line,
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis,
                        )
                    }
                }
            }

            if (micNotice) {
                Spacer(Modifier.height(8.dp))
                Text(
                    "Allow microphone access to answer this call.",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.error,
                )
            }

            Spacer(Modifier.height(14.dp))
            Row {
                OutlinedButton(
                    onClick = { manager.hangup(call.id) },
                    colors = ButtonDefaults.outlinedButtonColors(
                        contentColor = MaterialTheme.colorScheme.error,
                    ),
                    border = BorderStroke(
                        1.dp,
                        MaterialTheme.colorScheme.error.copy(alpha = 0.4f),
                    ),
                    modifier = Modifier
                        .weight(1f)
                        .height(48.dp),
                ) {
                    Icon(
                        Icons.Filled.CallEnd,
                        contentDescription = null,
                        modifier = Modifier.size(18.dp),
                    )
                    Spacer(Modifier.width(8.dp))
                    Text("Decline")
                }
                Spacer(Modifier.width(12.dp))
                Button(
                    onClick = {
                        if (manager.hasMicPermission()) {
                            manager.answer(call.id)
                        } else {
                            micLauncher.launch(Manifest.permission.RECORD_AUDIO)
                        }
                    },
                    modifier = Modifier
                        .weight(1f)
                        .height(48.dp),
                ) {
                    Icon(
                        Icons.Filled.Call,
                        contentDescription = null,
                        modifier = Modifier.size(18.dp),
                    )
                    Spacer(Modifier.width(8.dp))
                    Text("Accept")
                }
            }
        }
    }
}

/** "(415) 555-0134 · to (555) 111-2222" — whichever parts are truthful. */
private fun secondaryLine(call: CallSnapshot, company: CompanyView?): String? {
    val number = formatPhone(call.peerNumber)
        .takeIf { call.peerNumber.isNotBlank() && it != call.peerName }
    val called = calledNumberLine(company)
    val parts = listOfNotNull(number, called)
    return parts.joinToString(" · ").ifBlank { null }
}

/** The subtle pulse while ringing — one rationed petrol accent, no strobe. */
@Composable
private fun PulsingCallIndicator() {
    val transition = rememberInfiniteTransition(label = "ring-pulse")
    val scale by transition.animateFloat(
        initialValue = 1f,
        targetValue = 1.55f,
        animationSpec = infiniteRepeatable(tween(1_200), RepeatMode.Restart),
        label = "pulse-scale",
    )
    val fade by transition.animateFloat(
        initialValue = 0.35f,
        targetValue = 0f,
        animationSpec = infiniteRepeatable(tween(1_200), RepeatMode.Restart),
        label = "pulse-alpha",
    )
    Box(Modifier.size(48.dp), contentAlignment = Alignment.Center) {
        Box(
            Modifier
                .matchParentSize()
                .graphicsLayer {
                    scaleX = scale
                    scaleY = scale
                    alpha = fade
                }
                .background(MaterialTheme.colorScheme.primary, CircleShape),
        )
        Box(
            Modifier
                .size(44.dp)
                .background(MaterialTheme.colorScheme.primaryContainer, CircleShape),
            contentAlignment = Alignment.Center,
        ) {
            Icon(
                Icons.Filled.Call,
                contentDescription = null,
                tint = MaterialTheme.colorScheme.onPrimaryContainer,
                modifier = Modifier.size(22.dp),
            )
        }
    }
}
