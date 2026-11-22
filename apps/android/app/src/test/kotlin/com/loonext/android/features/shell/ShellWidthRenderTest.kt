package com.loonext.android.features.shell

import android.content.ClipboardManager
import android.graphics.Bitmap
import androidx.activity.ComponentActivity
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.asAndroidBitmap
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.unit.Density
import androidx.compose.ui.test.captureToImage
import androidx.compose.ui.test.assertIsSelected
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.longClick
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.onRoot
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performTouchInput
import com.loonext.android.core.model.PhoneNumberSummary
import com.loonext.android.ui.theme.LoonextTheme
import java.io.File
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

/**
 * #556 — the nav bar at a width that is not a phone, actually drawn.
 *
 * This issue asks "does a bottom bar make sense? what about a side bar?" and
 * every previous answer on it has been an argument. This renders the REAL
 * `MainShell` — not a reproduction of it — at a phone width and at an unfolded
 * foldable's, so the question can be settled by looking.
 *
 * Why the real shell rather than an extracted bar: an earlier pass on this
 * issue reported a tablet-stretch defect that did not exist, because the
 * harness composed a card with no shell above it and the picture looked exactly
 * like a layout bug. The correction is recorded on the issue. The lesson is
 * that WIDTH is the shell's business, so a width question has to render the
 * shell — and `MainShell` takes only data and callbacks, so nothing had to be
 * pulled apart to do it.
 *
 * The assertions are weak on purpose. What is worth asserting mechanically is
 * that the surface drew at all; whether 640dp of nav pill looks like a control
 * or like a lozenge is a judgement, and the PNG is what it is judged from.
 */
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
class ShellWidthRenderTest {

    @get:Rule
    val compose = createAndroidComposeRule<ComponentActivity>()

    @Test
    @Config(sdk = [34], qualifiers = "w411dp-h891dp")
    fun `Conversations keeps its view when the line changes or More opens`() {
        val lines = listOf(
            PhoneNumberSummary("service", "active", "CA", "+14165550101", created_at = "", label = "Service"),
            PhoneNumberSummary("sales", "active", "CA", "+14165550102", created_at = "", label = "Sales"),
        )
        compose.setContent {
            LoonextTheme {
                var active by remember { mutableStateOf(ShellTab.Calls) }
                var lineId by remember { mutableStateOf<String?>("service") }
                var more by remember { mutableStateOf(false) }
                MainShell(
                    counts = ShellCounts(forYou = 2),
                    unreadNotifications = 0,
                    tab = active,
                    onTabChange = { active = it },
                    onCompose = {},
                    onOpenAccountSheet = { more = true },
                ) { tab, modifier ->
                    if (tab == ShellTab.Inbox || tab == ShellTab.Calls) {
                        Column(modifier) {
                            ConversationsHeader(lines, selectedPhoneLine(lines, lineId), { lineId = it }, tab, { active = it })
                        }
                    }
                }
                if (more) Text("Account sheet opened")
            }
        }
        compose.onNodeWithContentDescription("Conversations").assertIsSelected()
        compose.onNodeWithText("Service", substring = true).performTouchInput { longClick() }
        compose.runOnIdle {
            val clipboard = compose.activity.getSystemService(ClipboardManager::class.java)
            assertEquals("+14165550101", clipboard?.primaryClip?.getItemAt(0)?.text?.toString())
        }
        compose.onNodeWithText("Service", substring = true).performClick()
        compose.onNodeWithText("Sales", substring = true).performClick()
        compose.onNodeWithText("Calls").assertIsSelected()
        compose.onNodeWithText("Sales", substring = true).assertExists()
        writePng(compose.onRoot().captureToImage().asAndroidBitmap(), "issue-877-conversations")
        compose.onNodeWithContentDescription("More").performClick()
        compose.onNodeWithText("Account sheet opened").assertExists()
        compose.onNodeWithContentDescription("Conversations").assertIsSelected()
    }

    @Test
    @Config(sdk = [34], qualifiers = "w411dp-h891dp")
    fun `the shell draws on a phone`() {
        renderShell("shell-phone-411dp")
    }

    @Test
    @Config(sdk = [34], qualifiers = "w411dp-h891dp-night")
    fun `the shell draws on a phone in dark`() {
        // The pill is an INK capsule on a paper canvas. In dark the canvas goes
        // ink too, and a dark control on a dark ground is exactly the pairing
        // that disappears — this repo has already lost overlay contrast that way
        // once. Worth a picture, not an assumption.
        renderShell("shell-phone-411dp-dark")
    }

    @Test
    @Config(sdk = [34], qualifiers = "w411dp-h891dp")
    fun `the shell survives 200 percent font scale`() {
        // The pill is a FIXED 66dp tall and its avatar draws initials in a 34dp
        // circle. Icons do not scale with font size but text does, so the one
        // thing in there that can overflow its container is the two letters —
        // and an accessibility font scale is the setting most likely to be on
        // for the people who need the nav most.
        renderShell("shell-phone-411dp-fontscale2", fontScale = 2f)
    }

    @Test
    @Config(sdk = [34], qualifiers = "w840dp-h1000dp")
    fun `the shell draws on an unfolded foldable`() {
        // 840dp is the widest window this app realistically meets on Android:
        // a Pixel Fold opened out. Web switches to a sidebar at 1000px, so if
        // any Android window earned a rail it would be this one.
        renderShell("shell-foldable-840dp")
    }

    /**
     * How far the pill's fill stands off the ground beside it, 0..1.
     *
     * FINDS the pill rather than computing where it should be. The first version
     * of this sampled a fixed height — 14dp inset plus half of 66dp — and that
     * arithmetic is only right when the system navigation inset is what you
     * assumed. At the foldable qualifier it was not, so the probe read a row
     * BELOW the capsule, compared canvas against canvas, and reported 0.039 as
     * though it had measured the control. It would have gone on reporting a
     * number for a thing it never looked at.
     *
     * So: walk every row of the bottom third, compare a column that is inside
     * the capsule horizontally (between two slots, clear of the icons and the
     * active paper circle) against the canvas at the very edge of the same row,
     * and keep the largest difference. If the capsule has an edge anywhere, this
     * finds it; if it has none, there is nothing to find and the answer is ~0.
     */
    private fun pillStandoff(bitmap: Bitmap): Double {
        val width = bitmap.width
        val height = bitmap.height
        val insideX = (width * 0.42).toInt()
        var widest = 0.0
        for (y in (height * 2 / 3) until height) {
            val gap = luminanceGap(bitmap.getPixel(insideX, y), bitmap.getPixel(4, y))
            if (gap > widest) widest = gap
        }
        return widest
    }

    /** Plain relative-luminance difference; enough to say "these differ". */
    private fun luminanceGap(a: Int, b: Int): Double {
        fun luminance(color: Int): Double {
            val r = (color shr 16 and 0xFF) / 255.0
            val g = (color shr 8 and 0xFF) / 255.0
            val bl = (color and 0xFF) / 255.0
            return 0.2126 * r + 0.7152 * g + 0.0722 * bl
        }
        return kotlin.math.abs(luminance(a) - luminance(b))
    }

    private fun renderShell(name: String, fontScale: Float = 1f) {
        compose.setContent {
            CompositionLocalProvider(
                LocalDensity provides Density(
                    density = LocalDensity.current.density,
                    fontScale = fontScale,
                ),
            ) {
            LoonextTheme {
                MainShell(
                    counts = ShellCounts(forYou = 2, unreadConversations = 5, openTasks = 3),
                    unreadNotifications = 2,
                    tab = ShellTab.Inbox,
                    onTabChange = {},
                    onCompose = {},
                    onOpenAccountSheet = {},
                ) { _, modifier ->
                    // Something with a visible EDGE, so the picture shows where
                    // the content column ends and whether the bar agrees with it.
                    Box(
                        modifier
                            .fillMaxSize()
                            .background(MaterialTheme.colorScheme.surface),
                    ) { Text("content column") }
                }
            }
            }
        }
        compose.waitForIdle()

        val bitmap = compose.onRoot().captureToImage().asAndroidBitmap()
        writePng(bitmap, name)
        assertTrue("$name drew nothing", bitmap.width > 0 && bitmap.height > 0)

        /*
         * #556 — the pill must have an EDGE, in whichever theme.
         *
         * Found by looking: in dark the ink capsule sits on an ink canvas and
         * its boundary disappears, so the app's most-used control stops being a
         * control and becomes five icons loose at the bottom of the screen. The
         * drop shadow does not save it — a shadow whose spot colour is Ink casts
         * nothing onto a near-black ground.
         *
         * Asserted rather than merely looked at, because this is the failure
         * mode that comes back the next time either palette is touched, and it
         * is invisible to every check that reads text or structure.
         */
        val standoff = pillStandoff(bitmap)
        /*
         * 0.10 is read off the measurements, not chosen:
         *
         *   broken dark   0.024   ink capsule on the ink canvas
         *   fixed dark    0.216   raised surface + hairline
         *   light         0.851   ink capsule on paper
         *
         * The floor sits 4x above the failure and 2x below the worst passing
         * case, so it catches this defect returning without going off the next
         * time somebody nudges a grey. Deliberately NOT a WCAG ratio: 1.4.11
         * asks 3:1 for a component boundary and the dark capsule reaches 1.35:1
         * on fill alone, which the hairline is there to answer. Reaching 3:1 on
         * the fill would need a mid-grey capsule and would abandon the ink
         * language the design is built on — that tradeoff is written up in D134
         * rather than silently decided by a threshold in a test.
         */
        assertTrue(
            "$name: the nav pill is indistinguishable from the ground beside it " +
                "(luminance gap ${"%.3f".format(standoff)}) — a dark capsule on a " +
                "dark canvas is not a control",
            standoff >= 0.10,
        )
    }

    private fun writePng(bitmap: Bitmap, name: String) {
        val dir = File("build/screenshots").apply { mkdirs() }
        File(dir, "$name.png").outputStream().use { out ->
            bitmap.compress(Bitmap.CompressFormat.PNG, 100, out)
        }
    }
}
