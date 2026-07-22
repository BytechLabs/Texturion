package com.loonext.android.ui.theme

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialExpressiveTheme
import androidx.compose.material3.MotionScheme
import androidx.compose.material3.Shapes
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
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
private val LightColors = lightColorScheme(
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

private val DarkColors = darkColorScheme(
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
    errorContainer = BrandColor.DarkLimeChipBg,
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
