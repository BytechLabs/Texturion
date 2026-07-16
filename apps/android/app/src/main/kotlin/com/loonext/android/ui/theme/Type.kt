package com.loonext.android.ui.theme

import androidx.compose.material3.Typography
import androidx.compose.ui.text.font.Font
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontVariation
import androidx.compose.ui.text.font.FontWeight
import com.loonext.android.R

/**
 * Golos Text — the app-shell typeface the web uses (G11). One variable file
 * (res/font/golos_text.ttf, OFL) instantiated per weight.
 */
private fun golos(weight: FontWeight) = Font(
    resId = R.font.golos_text,
    weight = weight,
    variationSettings = FontVariation.Settings(FontVariation.weight(weight.weight)),
)

val GolosText = FontFamily(
    golos(FontWeight.Normal),
    golos(FontWeight.Medium),
    golos(FontWeight.SemiBold),
    golos(FontWeight.Bold),
)

private val Defaults = Typography()

val LoonextTypography = Typography(
    displayLarge = Defaults.displayLarge.copy(fontFamily = GolosText),
    displayMedium = Defaults.displayMedium.copy(fontFamily = GolosText),
    displaySmall = Defaults.displaySmall.copy(fontFamily = GolosText),
    headlineLarge = Defaults.headlineLarge.copy(fontFamily = GolosText),
    headlineMedium = Defaults.headlineMedium.copy(fontFamily = GolosText),
    headlineSmall = Defaults.headlineSmall.copy(fontFamily = GolosText),
    titleLarge = Defaults.titleLarge.copy(fontFamily = GolosText),
    titleMedium = Defaults.titleMedium.copy(fontFamily = GolosText),
    titleSmall = Defaults.titleSmall.copy(fontFamily = GolosText),
    bodyLarge = Defaults.bodyLarge.copy(fontFamily = GolosText),
    bodyMedium = Defaults.bodyMedium.copy(fontFamily = GolosText),
    bodySmall = Defaults.bodySmall.copy(fontFamily = GolosText),
    labelLarge = Defaults.labelLarge.copy(fontFamily = GolosText),
    labelMedium = Defaults.labelMedium.copy(fontFamily = GolosText),
    labelSmall = Defaults.labelSmall.copy(fontFamily = GolosText),
)
