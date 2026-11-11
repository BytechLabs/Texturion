package com.loonext.android.ui.common

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
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.unit.dp
import com.loonext.android.ui.theme.BrandColor

/** 54dp: over the 48dp touch minimum, and the size every tab's action shares. */
val MAIN_ACTION_SIZE = 54.dp

/**
 * #732: a tab's ONE main action. Inbox "New text", Calls "Dial", Tasks "New
 * task" and Contacts "New contact" are each this button, in the same corner:
 * an ink circle at the bottom-trailing end, clear of the nav pill. Only the
 * icon and its spoken label differ. The web draws the same thing as the single
 * filled button at the trailing end of the page header.
 *
 * Every tab uses this function and nothing else for its main action;
 * MainActionWiringTest pins that, so a fifth hand-built circle cannot appear.
 */
@Composable
fun MainActionButton(
    icon: ImageVector,
    contentDescription: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val haptics = rememberHaptics()
    val interaction = remember { MutableInteractionSource() }
    Surface(
        onClick = {
            haptics.tap()
            onClick()
        },
        shape = CircleShape,
        color = MaterialTheme.colorScheme.primary,
        contentColor = MaterialTheme.colorScheme.onPrimary,
        interactionSource = interaction,
        modifier = modifier
            .size(MAIN_ACTION_SIZE)
            .pressScale(interaction)
            .shadow(14.dp, CircleShape, spotColor = BrandColor.Ink.copy(alpha = 0.3f)),
    ) {
        Box(contentAlignment = Alignment.Center) {
            Icon(icon, contentDescription = contentDescription, modifier = Modifier.size(IconSize.Large))
        }
    }
}
