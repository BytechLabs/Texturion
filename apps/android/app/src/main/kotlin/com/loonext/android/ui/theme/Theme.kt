package com.loonext.android.ui.theme

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialExpressiveTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.MotionScheme
import androidx.compose.material3.Shapes
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp

/**
 * "Paper & olive" theme (Loonext Mobile.dc.html). Role mapping, so surfaces
 * that already read MaterialTheme tokens land on the new language for free:
 *  - background  = canvas (#F3F3EE)         surface = paper cards (#FDFDF9)
 *  - primary     = ink (dark buttons, the pill nav)
 *  - secondary   = olive (counts, emphasis)  tertiary = lime (highlight fills)
 *  - primaryContainer = pale lime chip       secondaryContainer = avatar tint
 *  - outlineVariant   = hairline row dividers (#F0F0E8)
 */
// `internal`, not `private`: ThemeContrastTest reads these tables directly,
// because the bug #320 found (a green error container) lived in the MAPPING
// rather than in any single colour value.
internal val LightColors = lightColorScheme(
    primary = BrandColor.Ink,
    onPrimary = BrandColor.Paper,
    primaryContainer = BrandColor.LimeChip,
    onPrimaryContainer = BrandColor.OnLimeChip,
    secondary = BrandColor.Olive,
    onSecondary = BrandColor.Paper,
    secondaryContainer = BrandColor.AvatarTint,
    onSecondaryContainer = BrandColor.Muted900,
    tertiary = BrandColor.Lime,
    onTertiary = BrandColor.Ink,
    tertiaryContainer = BrandColor.LimeWash,
    onTertiaryContainer = BrandColor.OnLimeChip,
    background = BrandColor.Canvas,
    onBackground = BrandColor.Ink,
    surface = BrandColor.Paper,
    onSurface = BrandColor.Ink,
    surfaceVariant = BrandColor.Inset,
    onSurfaceVariant = BrandColor.Muted700,
    surfaceContainerLowest = BrandColor.Paper,
    surfaceContainerLow = BrandColor.Canvas,
    surfaceContainer = BrandColor.Inset,
    surfaceContainerHigh = BrandColor.InsetDeep,
    surfaceContainerHighest = BrandColor.AvatarTint,
    outline = BrandColor.Muted250,
    outlineVariant = BrandColor.Inset,
    error = BrandColor.Destructive,
    onError = BrandColor.Paper,
    errorContainer = BrandColor.DestructiveContainer,
    onErrorContainer = BrandColor.Destructive,
)

internal val DarkColors = darkColorScheme(
    primary = BrandColor.DarkInk,
    onPrimary = BrandColor.Ink,
    primaryContainer = BrandColor.DarkLimeChipBg,
    onPrimaryContainer = BrandColor.DarkOnLimeChip,
    secondary = BrandColor.DarkLime,
    onSecondary = BrandColor.Ink,
    secondaryContainer = BrandColor.DarkRaised,
    onSecondaryContainer = BrandColor.DarkInk,
    tertiary = BrandColor.DarkLime,
    onTertiary = BrandColor.Ink,
    tertiaryContainer = BrandColor.DarkLimeChipBg,
    onTertiaryContainer = BrandColor.DarkOnLimeChip,
    background = BrandColor.DarkCanvas,
    onBackground = BrandColor.DarkInk,
    surface = BrandColor.DarkPaper,
    onSurface = BrandColor.DarkInk,
    surfaceVariant = BrandColor.DarkInsetDeep,
    onSurfaceVariant = BrandColor.DarkMuted500,
    surfaceContainerLowest = BrandColor.DarkCanvas,
    surfaceContainerLow = BrandColor.DarkInset,
    surfaceContainer = BrandColor.DarkInsetDeep,
    surfaceContainerHigh = BrandColor.DarkRaised,
    surfaceContainerHighest = BrandColor.DarkRaised,
    outline = BrandColor.DarkOutline,
    outlineVariant = BrandColor.DarkInset,
    error = BrandColor.DarkDestructive,
    onError = BrandColor.DarkCanvas,
    // #320: this was DarkLimeChipBg — the pale-lime "New lead" chip fill — so
    // every error box on a dark phone rendered green, with its message at
    // 4.12:1. Nothing caught it because nothing had ever read this table.
    errorContainer = BrandColor.DarkDestructiveContainer,
    onErrorContainer = BrandColor.DarkDestructive,
)

/** Card grammar from the canvas: cards 22, sheets/screens 30, chips pill. */
private val LoonextShapes = Shapes(
    extraSmall = RoundedCornerShape(8.dp),
    small = RoundedCornerShape(12.dp),
    medium = RoundedCornerShape(16.dp),
    large = RoundedCornerShape(22.dp),
    extraLarge = RoundedCornerShape(30.dp),
)

private val LightAssigneeTones = listOf(
    Color(0xFFE4E6D7) to Color(0xFF3D4828),
    Color(0xFFDDE8EB) to Color(0xFF2F4D59),
    Color(0xFFE9E0EB) to Color(0xFF5A3D63),
    Color(0xFFF1E5D2) to Color(0xFF644922),
)

private val DarkAssigneeTones = listOf(
    Color(0xFF333C25) to Color(0xFFD9E7BE),
    Color(0xFF2B3E47) to Color(0xFFC9E1EA),
    Color(0xFF43334A) to Color(0xFFE4CCE9),
    Color(0xFF493924) to Color(0xFFF2D9AD),
)

@Composable
fun LoonextTheme(
    darkTheme: Boolean = isSystemInDarkTheme(),
    content: @Composable () -> Unit,
) {
    MaterialExpressiveTheme(
        colorScheme = if (darkTheme) DarkColors else LightColors,
        motionScheme = MotionScheme.expressive(),
        typography = LoonextTypography,
        shapes = LoonextShapes,
        content = content,
    )
}

@Composable
internal fun assigneeTone(memberId: String): Pair<Color, Color> {
    val tones = if (MaterialTheme.colorScheme.background == DarkColors.background) DarkAssigneeTones else LightAssigneeTones
    return tones[memberId.hashCode() and 3]
}
