package com.loonext.android.ui.theme

import androidx.compose.ui.graphics.Color

/**
 * Loonext mobile palette — the "paper & olive" system from the founder's
 * Claude Design project (Loonext Mobile.dc.html, project 42514b71). Warm
 * paper surfaces, near-black olive ink, one rationed lime/olive accent
 * family, and a coral attention dot. Every value below is lifted verbatim
 * from the design canvas — do not eyeball-adjust.
 */
object BrandColor {
    // ---- Light ----------------------------------------------------------
    /** Screen background. */
    val Canvas = Color(0xFFF3F3EE)

    /** Card / raised surface ("paper"). */
    val Paper = Color(0xFFFDFDF9)

    /** Primary text + the dark pill nav / dark buttons. */
    val Ink = Color(0xFF191B14)

    // Muted ladder (headings → hints), verbatim from the canvas.
    val Muted900 = Color(0xFF4A4D3C)
    val Muted700 = Color(0xFF5C5F4E)
    val Muted600 = Color(0xFF6E7163)
    val Muted500 = Color(0xFF8B8E7D)
    val Muted400 = Color(0xFF9A9D8B)
    val Muted300 = Color(0xFFA6A996)
    val Muted250 = Color(0xFFB4B7A6)
    val Muted200 = Color(0xFFBEC1AF)

    /** Inset surface: row dividers, wells, pressed states. */
    val Inset = Color(0xFFF0F0E8)

    /** Slightly deeper inset (segmented tracks, input fills). */
    val InsetDeep = Color(0xFFE7E9DC)

    /** Avatar / identity tint. */
    val AvatarTint = Color(0xFFE4E6D7)

    // Accent family — exactly one hue, rationed.
    /** Deep olive: counts, links, positive emphasis text. */
    val Olive = Color(0xFF66801F)

    /** Lime: primary highlight fills (Answer, selected states). */
    val Lime = Color(0xFFC9DE54)

    /** Brighter lime for small marks on dark ink. */
    val LimeBright = Color(0xFFA9C42B)

    /** Pale lime chip fill ("New lead"). */
    val LimeChip = Color(0xFFE3EFA3)

    /** Text on the pale lime chip. */
    val OnLimeChip = Color(0xFF3A430F)

    /** Selection / pale-lime wash. */
    val LimeWash = Color(0xFFD6E77E)

    /** Attention dot (unread, notification badge). NOT an error color. */
    val Coral = Color(0xFFD96C47)

    /** Warm cream highlight (pinned/starred wells). */
    val Cream = Color(0xFFEFE3CE)

    // ---- Dark -----------------------------------------------------------
    val DarkCanvas = Color(0xFF141610)
    val DarkPaper = Color(0xFF1F2218)
    val DarkInset = Color(0xFF23261A)
    val DarkInsetDeep = Color(0xFF262A1D)
    val DarkRaised = Color(0xFF2C2F22)
    val DarkInk = Color(0xFFF0F1E5)
    val DarkMuted500 = Color(0xFF8F927E)
    val DarkMuted400 = Color(0xFF7F826F)
    val DarkMuted300 = Color(0xFF6F7260)
    val DarkOutline = Color(0xFF4A4D3C)
    val DarkLime = Color(0xFFB9CF57)
    val DarkLimeChipBg = Color(0xFF39421A)
    val DarkOnLimeChip = Color(0xFFD6E77E)
    val DarkCoral = Color(0xFFE0764B)

    // ---- Status (warm-family, used sparingly) ----------------------------
    /** Destructive actions / errors — warm brick, not neon red. */
    val Destructive = Color(0xFFB0442B)
    val DestructiveContainer = Color(0xFFF4DAD2)
    val DarkDestructive = Color(0xFFE08B72)

    /** Amber notice (billing warnings) — kept warm to sit on paper. */
    val Amber = Color(0xFF9A6B15)
    val AmberBg = Color(0xFFF4E8CD)

    /** Legacy alias still referenced by settings; equals Muted300. */
    val Stone400 = Muted300
}
