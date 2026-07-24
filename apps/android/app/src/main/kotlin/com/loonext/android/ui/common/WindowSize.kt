package com.loonext.android.ui.common

import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.layout.wrapContentWidth
import androidx.compose.material3.windowsizeclass.WindowHeightSizeClass
import androidx.compose.material3.windowsizeclass.WindowSizeClass
import androidx.compose.material3.windowsizeclass.WindowWidthSizeClass
import androidx.compose.runtime.Composable
import androidx.compose.runtime.ReadOnlyComposable
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp

/**
 * #180 — the app-wide responsive contract. The shell computes the
 * [WindowSizeClass] once (MainActivity → [androidx.compose.material3.windowsizeclass.calculateWindowSizeClass])
 * and publishes it here, so any surface can adapt to the viewport the founder
 * cares about — square flip-phone cover displays, foldable inner screens,
 * tablets, tiny phones, landscape — without re-measuring for itself.
 *
 * Two things are enough for every surface:
 *  - [isCompactHeight] collapses vertical rhythm (condensed headers, tighter
 *    padding) so a short/square viewport stops clipping. It is the polish that
 *    rides ON TOP of the hard rule that every scrollable surface already
 *    honours — content taller than the viewport scrolls (#180 scroll contract).
 *  - [contentMaxWidth] stops forms and cards from stretching absurdly wide on
 *    tablets and foldables; a no-op on phones (nothing is wider than the cap).
 *
 * Null outside the shell (previews inject their own via
 * [ui.common] `PreviewHarness`); the helpers degrade to the roomy default.
 */
val LocalWindowSizeClass = staticCompositionLocalOf<WindowSizeClass?> { null }

/** A comfortable reading width for centred forms/cards on wide viewports. */
val DefaultContentMaxWidth: Dp = 640.dp

/**
 * True on short viewports — landscape phones, square cover displays — where the
 * vertical rhythm must condense to keep every control on screen. False when the
 * size class is unknown (roomy default).
 */
@Composable
@ReadOnlyComposable
fun isCompactHeight(): Boolean =
    LocalWindowSizeClass.current?.heightSizeClass == WindowHeightSizeClass.Compact

/**
 * True on wide viewports (tablets, foldable inner displays) where full-bleed
 * content should instead be capped and centred. Medium counts too — a 600dp+
 * form already reads better constrained.
 */
@Composable
@ReadOnlyComposable
fun isExpandedWidth(): Boolean {
    val width = LocalWindowSizeClass.current?.widthSizeClass ?: return false
    return width == WindowWidthSizeClass.Medium || width == WindowWidthSizeClass.Expanded
}

/**
 * Cap the content to [max] and centre it in the parent. A pure width modifier:
 * height passes straight through, so it composes onto `fillMaxSize()` or a
 * `verticalScroll` column unchanged. On any viewport narrower than [max] it is
 * a no-op (the content already fills the width), so phones are untouched and
 * only tablets/foldables see the centred column.
 */
fun Modifier.contentMaxWidth(max: Dp = DefaultContentMaxWidth): Modifier =
    this
        .fillMaxWidth()
        .wrapContentWidth(Alignment.CenterHorizontally)
        .widthIn(max = max)
