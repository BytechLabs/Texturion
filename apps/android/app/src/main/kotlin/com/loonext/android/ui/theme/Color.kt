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
    val Canvas = Color(0xFFF3F3F3)

    /** Card / raised surface ("paper"). */
    val Paper = Color(0xFFFDFDFD)

    /** Primary text + the dark pill nav / dark buttons. */
    val Ink = Color(0xFF1A1A1A)

    // Muted ladder (headings → hints), verbatim from the canvas.
    val Muted900 = Color(0xFF4B4B4B)
    val Muted700 = Color(0xFF5D5D5D)
    // #320: Muted600/500/400/300/200 are gone — zero references anywhere in the
    // app, because Android reads MaterialTheme roles rather than these names.
    // A palette entry nobody reads is a value nobody checks; iOS kept the same
    // rungs, used them for text, and shipped 3.01:1 body copy for months.
    val Muted250 = Color(0xFFB5B5B5)

    /** Inset surface: row dividers, wells, pressed states. */
    val Inset = Color(0xFFEFEFEF)

    /** Slightly deeper inset (segmented tracks, input fills). */
    val InsetDeep = Color(0xFFE8E8E8)

    /** Avatar / identity tint. */
    val AvatarTint = Color(0xFFE5E5E5)

    // Accent family — exactly one hue, rationed.
    /**
     * Deep olive: counts, links, positive emphasis text, and the `secondary`
     * role — which means it is a FILL carrying a Paper label as well as text on
     * paper. #320: the canvas value 0xFF777777 gave that label 4.41:1 and the
     * text 4.04:1 on canvas, both under AA. 0xFF666666 is the same hue one step
     * down: 5.63:1 as a fill label, 5.15:1 as text. Matched on iOS and web.
     */
    val Olive = Color(0xFF666666)

    /** Lime: primary highlight fills (Answer, selected states). */
    val Lime = Color(0xFF84CC16)

    /** Brighter lime for small marks on dark ink. */
    val LimeBright = Color(0xFF6FAE12)

    /** Pale lime chip fill ("New lead"). */
    val LimeChip = Color(0xFFD8F5AC)

    /** Text on the pale lime chip. */
    val OnLimeChip = Color(0xFF1A1A1A)

    /** Selection / pale-lime wash. */
    val LimeWash = Color(0xFFBDEE6B)

    /** Attention dot (unread, notification badge). NOT an error color. */
    val Coral = Color(0xFFD96C47)

    /** Warm cream highlight (pinned/starred wells). */
    val Cream = Color(0xFFEFE3CE)

    // ---- Dark -----------------------------------------------------------
    val DarkCanvas = Color(0xFF151515)
    val DarkPaper = Color(0xFF212121)
    val DarkInset = Color(0xFF252525)
    val DarkInsetDeep = Color(0xFF282828)
    val DarkRaised = Color(0xFF2E2E2E)
    val DarkInk = Color(0xFFF0F0F0)
    /**
     * `onSurfaceVariant` — secondary text on every dark surface. #320: at
     * 0xFF909090 it was 4.28:1 on surfaceContainerHigh/Highest (DarkRaised),
     * under AA on the two most raised surfaces it lands on. 0xFF949494 clears
     * every one (4.51:1 worst). Matched to iOS muted700's dark value.
     */
    val DarkMuted500 = Color(0xFF979797)
    val DarkOutline = Color(0xFF4B4B4B)
    val DarkLime = Color(0xFFA3E635)
    val DarkLimeChipBg = Color(0xFF3E3E3E)
    val DarkOnLimeChip = Color(0xFFBDEE6B)
    val DarkCoral = Color(0xFFE0764B)

    // ---- Status (warm-family, used sparingly) ----------------------------
    /**
     * Destructive actions / errors — warm brick, not neon red. #320: 0xFFB0442B
     * measured 4.26:1 on its own container, i.e. the error message inside the
     * error box was the thing below AA. 0xFFA94129 clears it at 4.55:1.
     */
    val Destructive = Color(0xFFA94129)
    val DestructiveContainer = Color(0xFFF4DAD2)
    val DarkDestructive = Color(0xFFE08B72)

    /**
     * #320: the dark `errorContainer` role was pointed at [DarkLimeChipBg] —
     * the pale-lime "New lead" chip fill. Every error box on a dark phone was
     * green, and the message on it measured 4.12:1. This is the warm dark well
     * it should always have used (iOS has carried it as `destructiveContainer`
     * all along), and DarkDestructive on it is 5.66:1.
     */
    val DarkDestructiveContainer = Color(0xFF39231C)

    /**
     * Amber notice (billing warnings) — kept warm to sit on paper. #320: at
     * 0xFF9A6B15 it was 3.85:1 on its own well and 4.20:1 on canvas. 0xFF8C6113
     * clears both (4.50:1 / 4.92:1) without leaving the warm family.
     */
    val Amber = Color(0xFF8C6113)
    val AmberBg = Color(0xFFF4E8CD)

    /** Dark-theme amber companions (warm dark well, mirrors the LimeChip pair). */
    val DarkAmber = Color(0xFFE0B25C)
    val DarkAmberBg = Color(0xFF3A2F16)

}
