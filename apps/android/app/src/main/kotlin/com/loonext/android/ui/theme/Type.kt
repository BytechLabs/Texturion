package com.loonext.android.ui.theme

import androidx.compose.material3.Typography
import androidx.compose.ui.text.font.Font
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontVariation
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.em
import com.loonext.android.R

/**
 * Loonext type system (Loonext Mobile.dc.html):
 *  - Golos Text — everything functional: body, labels, titles.
 *  - Bricolage Grotesque — DISPLAY ONLY: the big screen headings
 *    ("For you", "Inbox", "Tasks"…), always SemiBold with -0.01em tracking.
 * Both are variable OFL files instantiated per weight.
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

private fun bricolage(weight: FontWeight) = Font(
    resId = R.font.bricolage_grotesque,
    weight = weight,
    variationSettings = FontVariation.Settings(
        FontVariation.weight(weight.weight),
        // The variable font's optical-size axis: the display cut. Without
        // pinning it, small sizes render the cramped 12pt master.
        FontVariation.Setting("opsz", 24f),
    ),
)

val BricolageGrotesque = FontFamily(
    bricolage(FontWeight.Normal),
    bricolage(FontWeight.Medium),
    bricolage(FontWeight.SemiBold),
    bricolage(FontWeight.Bold),
)

private val Defaults = Typography()

val LoonextTypography = Typography(
    // Display + headline = Bricolage, the design's screen-title voice
    // (30px/SemiBold/-0.01em on the canvas).
    displayLarge = Defaults.displayLarge.copy(
        fontFamily = BricolageGrotesque, fontWeight = FontWeight.SemiBold, letterSpacing = (-0.01).em,
    ),
    displayMedium = Defaults.displayMedium.copy(
        fontFamily = BricolageGrotesque, fontWeight = FontWeight.SemiBold, letterSpacing = (-0.01).em,
    ),
    displaySmall = Defaults.displaySmall.copy(
        fontFamily = BricolageGrotesque, fontWeight = FontWeight.SemiBold, letterSpacing = (-0.01).em,
    ),
    headlineLarge = Defaults.headlineLarge.copy(
        fontFamily = BricolageGrotesque, fontWeight = FontWeight.SemiBold, letterSpacing = (-0.01).em,
    ),
    headlineMedium = Defaults.headlineMedium.copy(
        fontFamily = BricolageGrotesque, fontWeight = FontWeight.SemiBold, letterSpacing = (-0.01).em,
    ),
    headlineSmall = Defaults.headlineSmall.copy(
        fontFamily = BricolageGrotesque, fontWeight = FontWeight.SemiBold, letterSpacing = (-0.01).em,
    ),
    titleLarge = Defaults.titleLarge.copy(fontFamily = GolosText, fontWeight = FontWeight.SemiBold),
    titleMedium = Defaults.titleMedium.copy(fontFamily = GolosText, fontWeight = FontWeight.SemiBold),
    titleSmall = Defaults.titleSmall.copy(fontFamily = GolosText, fontWeight = FontWeight.SemiBold),
    bodyLarge = Defaults.bodyLarge.copy(fontFamily = GolosText),
    bodyMedium = Defaults.bodyMedium.copy(fontFamily = GolosText),
    bodySmall = Defaults.bodySmall.copy(fontFamily = GolosText),
    labelLarge = Defaults.labelLarge.copy(fontFamily = GolosText),
    labelMedium = Defaults.labelMedium.copy(fontFamily = GolosText),
    labelSmall = Defaults.labelSmall.copy(fontFamily = GolosText),
)
