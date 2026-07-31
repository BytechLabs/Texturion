package com.loonext.android.ui.theme

import androidx.compose.material3.ColorScheme
import androidx.compose.ui.graphics.Color
import kotlin.math.max
import kotlin.math.min
import kotlin.math.pow
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * #320 — nothing had ever measured the phone palettes.
 *
 * Theme bugs kept arriving one at a time, found by whoever happened to toggle:
 * auth screens unreadable in light (#218), map pins illegible in dark (#219).
 * Each was fixed properly; the pattern was the problem. The web app grew
 * `globals.contrast.test.ts` for exactly this and neither phone client ever got
 * the equivalent, so their colour tables were checked by nobody.
 *
 * The first run of this file found two things the app had been shipping:
 *
 *  - `errorContainer` in the DARK scheme was [BrandColor.DarkLimeChipBg], the
 *    pale-lime "New lead" chip fill. Every error box on a dark phone was GREEN,
 *    and its message measured 4.12:1. That is not a contrast rounding error, it
 *    is the wrong colour entirely, and no ratio check would have been needed to
 *    see it — only something that read the table.
 *  - `onSecondary` on `secondary` was 4.41:1 and `onErrorContainer` on
 *    `errorContainer` 4.26:1 in light. Both are labels people read.
 *
 * WHY THE SCHEME OBJECTS AND NOT THE SOURCE. Reading `LightColors`/`DarkColors`
 * means the assertion is about the pairs Material actually hands to every
 * composable. A source parse would test the literals; this tests the mapping,
 * which is where the green error box lived.
 *
 * WHY NOT SCREENSHOTS. #320's own devil's advocate is right that pixel diffs
 * produce noisy diffs that get rubber-stamped, turning a gate into a rubber
 * stamp. A ratio fails only when something is genuinely wrong.
 */
class ThemeContrastTest {

    /** WCAG 1.4.3 — body text. */
    private val aa = 4.5

    /** WCAG 1.4.11 — non-text: marks, icons, control boundaries. */
    private val nonText = 3.0

    private fun luminance(color: Color): Double {
        fun channel(c: Float): Double {
            val v = c.toDouble()
            return if (v <= 0.04045) v / 12.92 else ((v + 0.055) / 1.055).pow(2.4)
        }
        return 0.2126 * channel(color.red) +
            0.7152 * channel(color.green) +
            0.0722 * channel(color.blue)
    }

    private fun contrast(a: Color, b: Color): Double {
        val x = luminance(a)
        val y = luminance(b)
        return (max(x, y) + 0.05) / (min(x, y) + 0.05)
    }

    private fun assertReadable(
        theme: String,
        fg: Color,
        fgName: String,
        bg: Color,
        bgName: String,
        floor: Double,
    ) {
        val ratio = contrast(fg, bg)
        assertTrue(
            "[$theme] $fgName on $bgName is ${"%.2f".format(ratio)}:1, below $floor:1. " +
                "A role pair below the floor is text somebody cannot read — raise the " +
                "colour, do not lower the bar.",
            ratio >= floor,
        )
    }

    /**
     * Every Material `onX`/`X` pair the app actually uses. Written out rather
     * than reflected over `ColorScheme` on purpose: reflection would also drag
     * in the roles this app never sets, and a check that fails on a default
     * nobody reads is a check people delete.
     */
    private fun assertScheme(theme: String, s: ColorScheme) {
        assertReadable(theme, s.onPrimary, "onPrimary", s.primary, "primary", aa)
        assertReadable(theme, s.onPrimaryContainer, "onPrimaryContainer", s.primaryContainer, "primaryContainer", aa)
        assertReadable(theme, s.onSecondary, "onSecondary", s.secondary, "secondary", aa)
        assertReadable(theme, s.onSecondaryContainer, "onSecondaryContainer", s.secondaryContainer, "secondaryContainer", aa)
        assertReadable(theme, s.onTertiary, "onTertiary", s.tertiary, "tertiary", aa)
        assertReadable(theme, s.onTertiaryContainer, "onTertiaryContainer", s.tertiaryContainer, "tertiaryContainer", aa)
        assertReadable(theme, s.onBackground, "onBackground", s.background, "background", aa)
        assertReadable(theme, s.onSurface, "onSurface", s.surface, "surface", aa)
        assertReadable(theme, s.onError, "onError", s.error, "error", aa)
        assertReadable(theme, s.onErrorContainer, "onErrorContainer", s.errorContainer, "errorContainer", aa)

        // `onSurfaceVariant` is the secondary-text role, and it lands on EVERY
        // container level, not just surfaceVariant. Checking only the obvious
        // pair is how it stayed 4.28:1 on the two most raised surfaces.
        val containers = listOf(
            "surfaceVariant" to s.surfaceVariant,
            "surfaceContainerLowest" to s.surfaceContainerLowest,
            "surfaceContainerLow" to s.surfaceContainerLow,
            "surfaceContainer" to s.surfaceContainer,
            "surfaceContainerHigh" to s.surfaceContainerHigh,
            "surfaceContainerHighest" to s.surfaceContainerHighest,
        )
        for ((name, bg) in containers) {
            assertReadable(theme, s.onSurfaceVariant, "onSurfaceVariant", bg, name, aa)
            assertReadable(theme, s.onSurface, "onSurface", bg, name, aa)
        }

        // `secondary` is the accent, and it is read as TEXT (counts, emphasis)
        // as well as used as a fill — which is why its own legibility on the
        // grounds matters separately from its label's.
        assertReadable(theme, s.secondary, "secondary (as text)", s.background, "background", aa)
        assertReadable(theme, s.secondary, "secondary (as text)", s.surface, "surface", aa)
    }

    @Test
    fun `every role pair is readable in light`() = assertScheme("light", LightColors)

    @Test
    fun `every role pair is readable in dark`() = assertScheme("dark", DarkColors)

    @Test
    fun `the error container is an error colour, not the lime chip`() {
        // The specific regression this file was written after. A ratio check
        // alone would have called 4.12:1 a near miss; the real fault was that
        // the dark error box was painted with the "New lead" chip fill.
        assertEquals(
            "dark errorContainer must not be the lime chip background",
            BrandColor.DarkDestructiveContainer,
            DarkColors.errorContainer,
        )
        assertTrue(
            "an error container has to read as warm, not as the accent hue: " +
                "red channel must lead",
            DarkColors.errorContainer.red > DarkColors.errorContainer.green,
        )
    }

    @Test
    fun `hairlines are held to the non-text bar, and marks to their own`() {
        // `outline` draws 1px dividers and control edges. WCAG 1.4.11 covers
        // what IDENTIFIES a component or its state — a divider that could be
        // whitespace does not, which is why it is measured against the softer
        // bar rather than AA. The coral attention dot DOES carry state (unread)
        // and is held to the non-text bar in earnest.
        for ((theme, s) in listOf("light" to LightColors, "dark" to DarkColors)) {
            assertTrue(
                "[$theme] outline must at least be distinguishable from the surface",
                contrast(s.outline, s.surface) > 1.2,
            )
        }
        assertReadable("light", BrandColor.Coral, "coral", BrandColor.Canvas, "canvas", nonText)
        assertReadable("dark", BrandColor.DarkCoral, "coral", BrandColor.DarkCanvas, "canvas", nonText)
    }

    /**
     * #462: "Some buttons dont look like they are clickable in the settings
     * even though they are."
     *
     * Material draws a TextButton's label in `primary`, and this theme maps
     * primary to Ink — the same colour as body text — so every text button
     * rendered as a line of prose. `LinkButton` uses `secondary` instead
     * (MOBILE-DESIGN.md: olive is "counts, LINKS, emphasis"). This holds the
     * two apart: a tappable label must not be the colour of the paragraph
     * beside it.
     */
    @Test
    fun `a text button is not the colour of body text`() {
        for ((theme, s) in listOf("light" to LightColors, "dark" to DarkColors)) {
            assertTrue(
                "[$theme] primary equals onSurface, so a stock TextButton is " +
                    "indistinguishable from prose — LinkButton must not use it",
                s.primary == s.onSurface,
            )
            assertTrue(
                "[$theme] secondary must differ from body text, or LinkButton " +
                    "changes nothing",
                s.secondary != s.onSurface,
            )
            // And it still has to be readable on the card it sits on.
            assertReadable(theme, s.secondary, "secondary", s.surface, "surface", 4.5)
        }
    }

    @Test
    fun `the two schemes are genuinely different tables`() {
        // A test that read the same scheme twice would pass forever while
        // saying nothing about dark mode.
        assertTrue(
            "background did not change between schemes",
            luminance(LightColors.background) > luminance(DarkColors.background) + 0.5,
        )
    }

    @Test
    fun `the phone accents match iOS`() {
        // #320's third platform problem: a fix in one client is not a fix in the
        // others, which is why #218 and #219 each had to name both phones. These
        // are iOS BrandColor.swift's values for the same roles; a divergence
        // means one phone got a correction and the other silently did not.
        //
        // The olive is deliberately NOT the web's value, and the difference is
        // worth stating rather than hiding. Web splits the accent in two —
        // `--app-olive` #66801f carries decoration at the 3:1 bar and
        // `--app-olive-strong` #3a430f carries text at 4.5:1. Both phones use a
        // SINGLE `olive` for both jobs, so it has to satisfy the stricter one,
        // and 0xFF586E1B is the value that does while staying closest to the
        // design canvas. Giving the phones the same two-token split is the
        // follow-up recorded in docs/THEMING.md; until then this is one token
        // held to the higher bar, which is the safe direction to be wrong in.
        assertEquals("olive must match iOS", Color(0xFF586E1B), BrandColor.Olive)
        assertEquals("destructive must match iOS", Color(0xFFA94129), BrandColor.Destructive)
        assertEquals("amber must match iOS overdueAmber", Color(0xFF8C6113), BrandColor.Amber)
        assertEquals("dark secondary text must match iOS", Color(0xFF939683), BrandColor.DarkMuted500)
    }
}
