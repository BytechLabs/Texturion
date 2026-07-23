package com.loonext.android.ui.common

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * #199: the pure bounds-vs-ime decision behind Modifier.assertAboveIme. The
 * geometry convention matches Compose roots: y grows downward, the viewport
 * with the keyboard up is [0, visibleBottomPx] where
 * visibleBottomPx = rootHeight - imeInset.
 *
 * Scenario space: root height 2000px, ime 800px -> visibleBottom 1200px,
 * minVisible 60px unless a case says otherwise.
 */
class ImeCoverageTest {

    private val visibleBottom = 1200f
    private val minVisible = 60f

    private fun violation(top: Float, bottom: Float): Boolean =
        imeCoverageViolation(
            fieldTopPx = top,
            fieldBottomPx = bottom,
            visibleBottomPx = visibleBottom,
            minVisiblePx = minVisible,
        )

    @Test
    fun `field fully above the keyboard passes`() {
        assertFalse(violation(top = 900f, bottom = 960f))
    }

    @Test
    fun `field fully under the keyboard fails`() {
        assertTrue(violation(top = 1300f, bottom = 1360f))
    }

    @Test
    fun `field ending exactly at the visible bottom passes`() {
        assertFalse(violation(top = 1140f, bottom = 1200f))
    }

    @Test
    fun `only a sliver visible fails`() {
        // 20px of a 60px field peeks above the ime: covered for any practical
        // purpose (the cursor line is below the fold).
        assertTrue(violation(top = 1180f, bottom = 1240f))
    }

    @Test
    fun `exactly minVisible showing passes - the threshold is strict`() {
        // visible = 1200 - 1140 = 60 = minVisible; 60 < 60 is false.
        assertFalse(violation(top = 1140f, bottom = 1260f))
    }

    @Test
    fun `tall multiline field with its top half visible passes`() {
        // A 1000px composer growing under the keyboard is fine as long as a
        // usable band stays visible: visible = 1200 - 400 = 800 >= minVisible.
        assertFalse(violation(top = 400f, bottom = 1400f))
    }

    @Test
    fun `tall field fully scrolled under the keyboard fails`() {
        assertTrue(violation(top = 1250f, bottom = 2250f))
    }

    @Test
    fun `field taller than the whole visible viewport passes when it fills it`() {
        // Field spans the entire remaining viewport and beyond both edges:
        // visible = 1200 - 0 = 1200 >= minVisible.
        assertFalse(violation(top = -200f, bottom = 1500f))
    }

    @Test
    fun `zero and negative height fields never fail`() {
        assertFalse(violation(top = 1300f, bottom = 1300f))
        assertFalse(violation(top = 1300f, bottom = 1250f))
    }

    @Test
    fun `field smaller than minVisible must be fully visible`() {
        // 30px field, 10px hidden: visible 20 < min(30, 60) = 30 -> fails.
        assertTrue(
            imeCoverageViolation(
                fieldTopPx = 1180f,
                fieldBottomPx = 1210f,
                visibleBottomPx = visibleBottom,
                minVisiblePx = minVisible,
            ),
        )
        // Fully visible 30px field passes: visible 30 < 30 is false.
        assertFalse(
            imeCoverageViolation(
                fieldTopPx = 1170f,
                fieldBottomPx = 1200f,
                visibleBottomPx = visibleBottom,
                minVisiblePx = minVisible,
            ),
        )
    }

    @Test
    fun `keyboard taller than the screen leaves no viewport - always fails`() {
        assertTrue(
            imeCoverageViolation(
                fieldTopPx = 100f,
                fieldBottomPx = 160f,
                visibleBottomPx = 0f,
                minVisiblePx = minVisible,
            ),
        )
    }
}
