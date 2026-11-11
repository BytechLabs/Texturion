package com.loonext.android.ui.common

import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp

/** `Surface(onClick)` and a bare `clickable` set no role, so TalkBack never says "button". */
fun Modifier.asButton(): Modifier = semantics { role = Role.Button }

/** A button that is one of a set, so the reader hears "Selected" or "Not selected" with it. */
fun Modifier.asToggleButton(selected: Boolean): Modifier = semantics {
    role = Role.Button
    this.selected = selected
}

/** A segment of a tab strip: "Tab", and which one is on. */
fun Modifier.asTab(selected: Boolean): Modifier = semantics {
    role = Role.Tab
    this.selected = selected
}

/** A title the reader can jump to by heading. */
fun Modifier.asHeading(): Modifier = semantics { heading() }

/**
 * A row in a list that can be multi-selected. Only while a selection is open does it say
 * "Selected" or "Not selected": outside one, every row would say "Not selected" for nothing.
 */
fun Modifier.selectableRow(selecting: Boolean, selected: Boolean): Modifier =
    if (selecting) semantics { this.selected = selected } else this

/** Text the reader says by itself when it changes, such as the "3 selected" count. */
fun Modifier.announcesChanges(): Modifier = semantics { liveRegion = LiveRegionMode.Polite }

/** Text scaled past this is "large text": a fixed header may no longer fit beside its list. */
private const val LARGE_TEXT_SCALE = 1.3f

/**
 * A header that sits above a list and does not scroll with it. At 200% text the same header
 * took more than half of the screen and left the list a sliver, so past [LARGE_TEXT_SCALE] it is
 * held to [share] of the screen height and scrolls inside that.
 */
@Composable
fun Modifier.cappedAtLargeText(share: Float = 0.3f): Modifier {
    if (LocalDensity.current.fontScale <= LARGE_TEXT_SCALE) return this
    val limit = (LocalConfiguration.current.screenHeightDp * share).dp
    return this.heightIn(max = limit).verticalScroll(rememberScrollState())
}
