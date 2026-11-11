package com.loonext.android.ui.common

import androidx.compose.foundation.background
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.unit.dp

/**
 * #733: a header's secondary action: a 44dp paper circle with one stroke icon
 * (search, back, more, scheduled). Every page and record header draws these
 * through this one function; `PageHeaderGuardTest` fails a screen that keeps a
 * circle of its own. The main action is [MainActionButton], never this.
 * [badge] adds the small dot for "something is waiting here".
 */
@Composable
fun PaperIconButton(
    icon: ImageVector,
    contentDescription: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
    badge: Boolean = false,
) {
    val haptics = rememberHaptics()
    val interaction = remember { MutableInteractionSource() }
    // pressScale on the wrapper so the badge dot gives with the circle.
    Box(modifier.pressScale(interaction)) {
        Surface(
            onClick = {
                haptics.tap()
                onClick()
            },
            enabled = enabled,
            shape = CircleShape,
            color = MaterialTheme.colorScheme.surface,
            contentColor = MaterialTheme.colorScheme.onSurface,
            shadowElevation = 1.dp,
            interactionSource = interaction,
            modifier = Modifier.size(44.dp).asButton(),
        ) {
            Box(contentAlignment = Alignment.Center) {
                Icon(
                    icon,
                    contentDescription = contentDescription,
                    tint = MaterialTheme.colorScheme.onSurface.copy(alpha = if (enabled) 1f else 0.4f),
                    modifier = Modifier.size(IconSize.Default),
                )
            }
        }
        if (badge) {
            Box(
                Modifier
                    .align(Alignment.TopEnd)
                    .size(9.dp)
                    .background(MaterialTheme.colorScheme.secondary, CircleShape),
            )
        }
    }
}
