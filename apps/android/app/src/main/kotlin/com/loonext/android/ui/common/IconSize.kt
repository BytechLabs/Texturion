package com.loonext.android.ui.common

import androidx.compose.ui.unit.dp

/**
 * #733: the three sizes an icon takes, the web's 14 / 16 / 20 px (`size-3.5`,
 * `size-4`, `size-5`) fitted to what this app already drew most: 14 beside small
 * text, 18 as the default, 20 where an icon stands alone.
 *
 * `IconSizeGuardTest` fails on an `Icon` sized with a literal. An avatar, an
 * illustration or the call screen keeps its own number, named there with why.
 */
object IconSize {
    /** Beside a caption or a chip label. */
    val Small = 14.dp

    /** Beside body text, in a button, in a row. */
    val Default = 18.dp

    /** An icon that stands alone: a toolbar action, an empty state's glyph. */
    val Large = 20.dp
}
