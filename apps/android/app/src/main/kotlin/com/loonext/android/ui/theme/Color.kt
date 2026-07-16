package com.loonext.android.ui.theme

import androidx.compose.ui.graphics.Color

/**
 * Loonext brand palette — mirrors apps/web globals.css (G11 "calm petrol"):
 * warm stone neutrals + exactly one rationed petrol accent.
 */
object BrandColor {
    val Petrol = Color(0xFF0F766E)
    val PetrolDeep = Color(0xFF0B4F49)
    val PetrolTint = Color(0xFFEDF3F1)

    // Dark-mode petrol: the same hue lifted for contrast on stone-950.
    val PetrolBright = Color(0xFF3AA79B)

    // Warm stone neutrals (Tailwind stone scale — the web's neutral ramp).
    val Stone50 = Color(0xFFFAFAF9)
    val Stone100 = Color(0xFFF5F5F4)
    val Stone200 = Color(0xFFE7E5E4)
    val Stone300 = Color(0xFFD6D3D1)
    val Stone400 = Color(0xFFA8A29E)
    val Stone500 = Color(0xFF78716C)
    val Stone600 = Color(0xFF57534E)
    val Stone700 = Color(0xFF44403C)
    val Stone800 = Color(0xFF292524)
    val Stone900 = Color(0xFF1C1917)
    val Stone950 = Color(0xFF0C0A09)

    // Supporting hues (amber notices, red destructive — web tokens).
    val Amber = Color(0xFFB45309)
    val AmberBg = Color(0xFFFEF3C7)
    val Destructive = Color(0xFFB91C1C)
}
