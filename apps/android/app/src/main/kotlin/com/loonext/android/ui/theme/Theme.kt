package com.loonext.android.ui.theme

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialExpressiveTheme
import androidx.compose.material3.MotionScheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable

private val LightColors = lightColorScheme(
    primary = BrandColor.Petrol,
    onPrimary = BrandColor.Stone50,
    primaryContainer = BrandColor.PetrolTint,
    onPrimaryContainer = BrandColor.PetrolDeep,
    secondary = BrandColor.Stone600,
    onSecondary = BrandColor.Stone50,
    secondaryContainer = BrandColor.Stone200,
    onSecondaryContainer = BrandColor.Stone800,
    tertiary = BrandColor.PetrolDeep,
    onTertiary = BrandColor.Stone50,
    background = BrandColor.Stone50,
    onBackground = BrandColor.Stone900,
    surface = BrandColor.Stone50,
    onSurface = BrandColor.Stone900,
    surfaceVariant = BrandColor.Stone100,
    onSurfaceVariant = BrandColor.Stone600,
    surfaceContainerLowest = BrandColor.Stone50,
    surfaceContainerLow = BrandColor.Stone100,
    surfaceContainer = BrandColor.Stone100,
    surfaceContainerHigh = BrandColor.Stone200,
    surfaceContainerHighest = BrandColor.Stone200,
    outline = BrandColor.Stone300,
    outlineVariant = BrandColor.Stone200,
    error = BrandColor.Destructive,
    onError = BrandColor.Stone50,
)

private val DarkColors = darkColorScheme(
    primary = BrandColor.PetrolBright,
    onPrimary = BrandColor.Stone950,
    primaryContainer = BrandColor.PetrolDeep,
    onPrimaryContainer = BrandColor.PetrolTint,
    secondary = BrandColor.Stone400,
    onSecondary = BrandColor.Stone900,
    secondaryContainer = BrandColor.Stone700,
    onSecondaryContainer = BrandColor.Stone100,
    tertiary = BrandColor.PetrolTint,
    onTertiary = BrandColor.Stone900,
    background = BrandColor.Stone950,
    onBackground = BrandColor.Stone100,
    surface = BrandColor.Stone950,
    onSurface = BrandColor.Stone100,
    surfaceVariant = BrandColor.Stone800,
    onSurfaceVariant = BrandColor.Stone400,
    surfaceContainerLowest = BrandColor.Stone950,
    surfaceContainerLow = BrandColor.Stone900,
    surfaceContainer = BrandColor.Stone900,
    surfaceContainerHigh = BrandColor.Stone800,
    surfaceContainerHighest = BrandColor.Stone800,
    outline = BrandColor.Stone600,
    outlineVariant = BrandColor.Stone700,
    error = BrandColor.Destructive,
    onError = BrandColor.Stone50,
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
        content = content,
    )
}
