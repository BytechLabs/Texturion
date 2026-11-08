package com.loonext.android.a11y

import android.graphics.Bitmap
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.asAndroidBitmap
import androidx.compose.ui.graphics.compositeOver
import androidx.compose.ui.graphics.luminance
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.SemanticsActions
import androidx.compose.ui.semantics.SemanticsNode
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.semantics.getOrNull
import androidx.compose.ui.test.captureToImage
import androidx.compose.ui.test.junit4.ComposeTestRule
import androidx.compose.ui.test.onRoot
import androidx.compose.ui.text.TextLayoutResult
import androidx.compose.ui.text.font.FontWeight

/** One thing a screen reader user would trip on. */
internal data class A11yFinding(val check: String, val where: String, val detail: String) {
    override fun toString() = "[$check] $where: $detail"
}

/** What one pass over a screen found; every finding fails the build. */
internal class A11yReport(val failures: List<A11yFinding>)

/**
 * ATF's questions, asked of Compose's semantics tree instead of the View tree.
 *
 * ATF's own `enableAccessibilityChecks()` ships in this Compose but is a no-op
 * under Robolectric: it sees five Views, runs no check (all NOT_RUN) and reports
 * green (Compose logs b/332778271). [AtfRobolectricCanaryTest] fails when that
 * changes, which is the day to drop this.
 *
 * Checks, on the merged tree TalkBack reads: every actionable node has a name,
 * room to be drawn, and a box of at least [MIN_TARGET_DP] inside the screen;
 * text meets WCAG 1.4.3 against the pixels drawn behind it and is not cut off.
 * It does not speak anything: the TalkBack pass stays manual
 * (docs/ACCESSIBILITY.md).
 */
internal object SemanticsAudit {

    /**
     * The product's control size, and WCAG 2.5.5 (AAA). 2.5.8 (AA) asks only 24dp,
     * which the web gate keeps; here every control already has 44dp, so less fails.
     */
    const val MIN_TARGET_DP = 44f

    private const val NORMAL_TEXT_RATIO = 4.5
    private const val LARGE_TEXT_RATIO = 3.0

    /** WCAG large text: 18pt regular or 14pt bold, which is 24dp and 18.66dp. */
    private const val LARGE_TEXT_DP = 24f
    private const val LARGE_BOLD_TEXT_DP = 18.66f

    /** Layout rounding: a 44dp box can measure 43.99. */
    private const val EPSILON = 0.5f

    fun audit(compose: ComposeTestRule): A11yReport {
        val merged = compose.onRoot(useUnmergedTree = false).fetchSemanticsNode()
        val unmerged = compose.onRoot(useUnmergedTree = true).fetchSemanticsNode()
        val screenshot = compose.onRoot(useUnmergedTree = false).captureToImage().asAndroidBitmap()

        val failures = mutableListOf<A11yFinding>()
        val root = merged.boundsInRoot
        merged.walk { node ->
            if (node.config.contains(SemanticsProperties.InvisibleToUser) || !node.isActionable()) return@walk
            if (node.size.width == 0 || node.size.height == 0) {
                failures += A11yFinding("Squeezed", node.describe(), "laid out with no room, so it cannot be seen or pressed")
                return@walk
            }
            if (node.isHidden()) return@walk
            checkName(node)?.let(failures::add)
            checkOnScreen(node, root)?.let(failures::add)
            val size = shortSide(node)
            if (size < MIN_TARGET_DP - EPSILON) failures += tooSmall(node, size, "needs $MIN_TARGET_DP")
        }
        unmerged.walk(disabled = false) { node, inactive ->
            if (node.isHidden() || inactive) return@walk
            checkContrast(node, screenshot)?.let(failures::add)
            checkClipped(node)?.let(failures::add)
        }
        return A11yReport(failures)
    }

    // --- SpeakableTextPresent ------------------------------------------------

    private fun checkName(node: SemanticsNode): A11yFinding? {
        if (node.spokenName().isNotBlank()) return null
        return A11yFinding("SpeakableTextPresent", node.describe(), "actionable with no name a screen reader can say")
    }

    /** Everything TalkBack would read to name this node, the typed value excluded. */
    fun SemanticsNode.spokenName(): String {
        val config = config
        val description = config.getOrNull(SemanticsProperties.ContentDescription).orEmpty()
        val editable = config.getOrNull(SemanticsProperties.EditableText)?.text
        val text = config.getOrNull(SemanticsProperties.Text).orEmpty()
            .map { it.text }
            .filter { it != editable }
        return (description + text).joinToString(" ").trim()
    }

    // --- TouchTargetSize -----------------------------------------------------

    /**
     * The laid-out box, not touchBoundsInRoot: Compose pads every pointer target
     * out to 48dp on its own, which would pass anything and measure nothing.
     * Padded areas also overlap their neighbours, and the neighbour that wins is
     * whichever was placed last.
     */
    private fun shortSide(node: SemanticsNode): Float {
        val density = node.layoutInfo.density.density
        // Its own size, not the part the screen's edge leaves visible.
        return minOf(node.size.width, node.size.height) / density
    }

    private fun tooSmall(node: SemanticsNode, size: Float, why: String) = A11yFinding(
        "TouchTargetSize",
        node.describe(),
        "short side is ${size.fmt()}dp; $why",
    )

    // --- OffScreen and TextClipped (large text) ---------------------------------

    /** A control the layout pushed past the screen's edge cannot be reached by touch. */
    private fun checkOnScreen(node: SemanticsNode, root: Rect): A11yFinding? {
        val box = node.boundsInRoot
        val slack = EPSILON * node.layoutInfo.density.density
        if (box.left >= root.left - slack && box.right <= root.right + slack) return null
        return A11yFinding("OffScreen", node.describe(), "runs past the screen's edge")
    }

    /**
     * Text cut off without an ellipsis: it needed more lines than it may show,
     * or its box is shorter than its lines. A preview that ends in an ellipsis is
     * shortened on purpose and passes. Width says nothing: a paragraph is laid out
     * at its constraint's width, so a short label "overflows" by the slack.
     */
    private fun checkClipped(node: SemanticsNode): A11yFinding? {
        val config = node.config
        if (!config.contains(SemanticsActions.GetTextLayoutResult)) return null
        val text = config.getOrNull(SemanticsProperties.Text)?.joinToString(" ") { it.text }.orEmpty()
        if (text.isBlank()) return null
        val results = mutableListOf<TextLayoutResult>()
        config[SemanticsActions.GetTextLayoutResult].action?.invoke(results) ?: return null
        val layout = results.firstOrNull() ?: return null
        if (layout.isLineEllipsized(layout.lineCount - 1)) return null
        val shortBy = (layout.multiParagraph.height - layout.size.height) / node.layoutInfo.density.density
        if (!layout.multiParagraph.didExceedMaxLines && shortBy <= EPSILON) return null
        return A11yFinding("TextClipped", node.describe(), "\"${text.take(40)}\" is cut off with no ellipsis")
    }

    // --- TextContrast --------------------------------------------------------

    private fun checkContrast(node: SemanticsNode, screenshot: Bitmap): A11yFinding? {
        val config = node.config
        if (!config.contains(SemanticsActions.GetTextLayoutResult)) return null
        val text = config.getOrNull(SemanticsProperties.Text)?.joinToString(" ") { it.text }.orEmpty()
        if (text.isBlank()) return null

        val results = mutableListOf<TextLayoutResult>()
        config[SemanticsActions.GetTextLayoutResult].action?.invoke(results) ?: return null
        val style = results.firstOrNull()?.layoutInput?.style ?: return null
        if (style.color == Color.Unspecified || style.brush != null) return null

        val region = node.boundsInRoot.clippedTo(screenshot) ?: return null
        val background = backgroundOf(screenshot, region)
        val shown = style.color.compositeOver(background)
        val ratio = contrastRatio(shown, background)

        val density = node.layoutInfo.density
        val sizeDp = with(density) { if (style.fontSize.isSp) style.fontSize.toDp().value else 14f }
        val bold = (style.fontWeight ?: FontWeight.Normal) >= FontWeight.Bold
        val large = sizeDp >= LARGE_TEXT_DP || (bold && sizeDp >= LARGE_BOLD_TEXT_DP)
        val needed = if (large) LARGE_TEXT_RATIO else NORMAL_TEXT_RATIO
        if (ratio >= needed) return null

        return A11yFinding(
            "TextContrast",
            node.describe(),
            "\"${text.take(40)}\" is ${ratio.fmt()}:1, needs $needed:1 at ${sizeDp.fmt()}dp" +
                (if (bold) " bold" else "") + " (text ${shown.hex()} on ${background.hex()})",
        )
    }

    /**
     * The colour most of the node's box is painted. Text covers a minority of
     * its own bounds, so the commonest pixel is what sits behind it.
     */
    private fun backgroundOf(shot: Bitmap, region: android.graphics.Rect): Color {
        val votes = HashMap<Int, Int>()
        val stepX = maxOf(1, region.width() / 40)
        val stepY = maxOf(1, region.height() / 20)
        var y = region.top
        while (y < region.bottom) {
            var x = region.left
            while (x < region.right) {
                votes.merge(shot.getPixel(x, y), 1, Int::plus)
                x += stepX
            }
            y += stepY
        }
        val best = votes.maxByOrNull { it.value }?.key ?: 0
        return Color(0xFF000000.toInt() or (best and 0xFFFFFF))
    }

    fun contrastRatio(a: Color, b: Color): Double {
        val la = a.luminance().toDouble()
        val lb = b.luminance().toDouble()
        return (maxOf(la, lb) + 0.05) / (minOf(la, lb) + 0.05)
    }

    // --- shared ----------------------------------------------------------------

    private fun SemanticsNode.walk(visit: (SemanticsNode) -> Unit) {
        visit(this)
        children.forEach { it.walk(visit) }
    }

    /**
     * Carries "an ancestor is disabled" down the tree: the text inside a
     * disabled button is a leaf with no Disabled flag of its own, and WCAG
     * exempts inactive controls from the contrast minimum.
     */
    private fun SemanticsNode.walk(disabled: Boolean, visit: (SemanticsNode, Boolean) -> Unit) {
        val inactive = disabled || config.contains(SemanticsProperties.Disabled)
        visit(this, inactive)
        children.forEach { it.walk(inactive, visit) }
    }

    /** Also anything scrolled wholly out of view: it is audited where it is drawn, not here. */
    private fun SemanticsNode.isHidden(): Boolean =
        config.contains(SemanticsProperties.InvisibleToUser) || size.width == 0 || size.height == 0 ||
            boundsInRoot.isEmpty

    private fun SemanticsNode.isActionable(): Boolean {
        val config = config
        return config.contains(SemanticsActions.OnClick) ||
            config.contains(SemanticsActions.OnLongClick) ||
            config.contains(SemanticsActions.SetText) ||
            config.contains(SemanticsProperties.ToggleableState) ||
            config.contains(SemanticsProperties.Selected) ||
            config.getOrNull(SemanticsProperties.Role) in ACTION_ROLES
    }

    private val ACTION_ROLES = setOf<Role?>(
        Role.Button, Role.Checkbox, Role.Switch, Role.RadioButton, Role.Tab, Role.DropdownList,
    )

    private fun SemanticsNode.describe(): String {
        val density = layoutInfo.density.density
        val name = spokenName().ifBlank { "<no name>" }.take(48)
        val box = boundsInRoot
        val role = config.getOrNull(SemanticsProperties.Role)?.let { " role=$it" }.orEmpty()
        return "\"$name\"$role @(${(box.left / density).toInt()},${(box.top / density).toInt()}) " +
            "${(box.width / density).fmt()}x${(box.height / density).fmt()}dp"
    }

    private fun Rect.clippedTo(shot: Bitmap): android.graphics.Rect? {
        val r = android.graphics.Rect(
            left.toInt().coerceIn(0, shot.width),
            top.toInt().coerceIn(0, shot.height),
            right.toInt().coerceIn(0, shot.width),
            bottom.toInt().coerceIn(0, shot.height),
        )
        return if (r.width() > 0 && r.height() > 0) r else null
    }

    private fun Color.hex(): String = "#%06X".format(toArgb() and 0xFFFFFF)

    private fun Float.fmt() = "%.1f".format(this)

    private fun Double.fmt() = "%.2f".format(this)
}
