package com.loonext.android.ui.common

import androidx.compose.material3.minimumInteractiveComponentSize
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.semantics

/**
 * A 48dp target around a control drawn smaller, such as a 28dp pill or a 24dp
 * eye icon: the layout reserves the room, so the touch area Compose grows small
 * controls to cannot overlap a neighbour, and a screen reader's focus covers the
 * whole of it. Put it first, before the control's own clip, background and
 * clickable, so the drawn control and its ripple keep their size.
 */
fun Modifier.touchTarget(): Modifier = semantics(mergeDescendants = true) {}.minimumInteractiveComponentSize()
