package com.loonext.android.ui.common

import android.graphics.Bitmap
import androidx.activity.ComponentActivity
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.material3.MaterialTheme
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.asAndroidBitmap
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.captureToImage
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.onRoot
import androidx.compose.ui.unit.dp
import com.loonext.android.core.model.LeadSourceCount
import com.loonext.android.core.model.PipelineReport
import com.loonext.android.core.model.PipelineReportResponse
import com.loonext.android.core.model.LeadSourceReport
import com.loonext.android.features.foryou.LeadSourcesCard
import com.loonext.android.features.foryou.PipelineCard
import com.loonext.android.ui.theme.LoonextTheme
import java.io.File
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

/**
 * #540 / #556 — a picture of the phone, on a machine with no phone.
 *
 * ## Why this exists
 *
 * Both issues are stuck on the same sentence: *"it needs eyes on the two phone
 * dashboards."* There is no emulator on this machine, no attached device and no
 * system image — checked, not assumed: `D:\Android\sdk` holds build-tools,
 * platforms and platform-tools, and no `emulator/` or `system-images/` at all.
 * So every visual claim about Android has been "it compiles", which is the
 * weaker claim, and #540 says so in its own words.
 *
 * Robolectric's NATIVE graphics mode draws with the real Skia pipeline rather
 * than the no-op canvas the default mode uses. That turns a compose test into
 * an actual bitmap: the same pixels the phone would draw, produced by `gradlew
 * testDebugUnitTest` with no device anywhere.
 *
 * ## What this is NOT
 *
 * It is not a golden-image test and deliberately does not compare against a
 * checked-in reference. A pixel-diff on a text-heavy surface fails on a font
 * hinting change and teaches everybody to regenerate goldens without looking,
 * which is worse than nothing.
 *
 * What it asserts is that the surface DREW — a non-blank bitmap of the expected
 * shape — and what it produces is a PNG somebody can open. The assertion stops
 * the harness rotting silently; the file is the actual deliverable.
 *
 * The blank check is the load-bearing half. A Compose surface that fails to
 * measure renders a uniform background and every other assertion in the suite
 * still passes, which is exactly the failure mode "it compiles" already misses.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
@GraphicsMode(GraphicsMode.Mode.NATIVE)
class DashboardScreenshotTest {

    @get:Rule
    val compose = createAndroidComposeRule<ComponentActivity>()

    @Test
    fun `the measures row draws something, and it is written to a png`() {
        compose.setContent {
            LoonextTheme {
                Column(
                    Modifier
                        .width(360.dp)
                        .background(MaterialTheme.colorScheme.background)
                        .padding(16.dp),
                ) {
                    ProportionRing(
                        value = 3f,
                        total = 4f,
                        label = "3 of 4 new customers answered",
                        color = MaterialTheme.colorScheme.primary,
                        size = 64.dp,
                    )
                }
            }
        }
        compose.waitForIdle()

        val bitmap = compose.onRoot().captureToImage().asAndroidBitmap()
        writePng(bitmap, "measures-row")

        assertTrue("the surface has no width", bitmap.width > 0)
        assertTrue("the surface has no height", bitmap.height > 0)
        assertTrue("nothing was drawn — the surface is one flat colour", drewSomething(bitmap))
    }

    @Test
    fun `the lead sources panel draws with data`() {
        val report = LeadSourceReport(
            days = 30,
            sources = listOf(
                LeadSourceCount("s1", "Google", by_number = 6, by_person = 2, total = 8),
                LeadSourceCount("s2", "Word of mouth", by_person = 5, total = 5),
                LeadSourceCount("s3", "Van sign", by_person = 2, total = 2),
            ),
            unknown = 3,
            total = 18,
            coverage = 0.83,
        )
        assertTrue("sources-with-data drew nothing", drawPanel("sources-with-data", report))
    }

    @Test
    fun `the lead sources panel draws when no sources are set up`() {
        // #540's own words: "both of the sources panel's states were changed
        // rather than only the one with data in it (the empty one is what a new
        // crew sees first)". One test each, because the compose rule takes
        // setContent once per test — looping both through one test throws.
        //
        // THE FIXTURE MATTERS AND MY FIRST ONE WAS WRONG. `LeadSourceReport()`
        // is total = 0, which the card returns early on by design ("Silence,
        // not a zero" — pinned below). The state this issue means is a month
        // that HAPPENED with no sources configured: every conversation lands in
        // unknown, and the card explains that rather than drawing an empty
        // chart.
        val nothingConfigured = LeadSourceReport(
            days = 30,
            sources = emptyList(),
            unknown = 12,
            total = 12,
        )
        assertTrue(
            "sources-none-configured drew nothing",
            drawPanel("sources-none-configured", nothingConfigured),
        )
    }

    @Test
    fun `a month with nothing in it draws no panel at all`() {
        // The card's own rule: "Loading, or a month in which nothing happened.
        // Silence, not a zero." Worth an assertion because it is invisible —
        // the screenshot harness found it by reporting a blank canvas, and a
        // future change that "fixed" the blank by drawing a zeroed chart would
        // be a regression nobody could see in a diff.
        assertFalse(
            "a zero-total month must draw nothing at all",
            drawPanel("sources-silent-month", LeadSourceReport()),
        )
    }

    @Test
    fun `the quotes panel draws`() {
        // #540: "quotes gets a bar, because that panel asks what the month is
        // MADE OF — won, still waiting on the customer, gone quiet". Rendered
        // so the three parts can be seen to be three parts.
        compose.setContent {
            LoonextTheme {
                Column(
                    Modifier
                        .width(360.dp)
                        .background(MaterialTheme.colorScheme.background)
                        .padding(16.dp),
                ) {
                    PipelineCard(
                        report = PipelineReportResponse(
                            days = 30,
                            current = PipelineReport(
                                quoted = 6,
                                won = 2,
                                lost = 0,
                                open = 4,
                                median_days_to_win = 3.0,
                            ),
                            previous = PipelineReport(quoted = 4, won = 1, lost = 1, open = 2),
                            win_rate = 33,
                            previous_win_rate = 25,
                        ),
                    )
                }
            }
        }
        compose.waitForIdle()
        val bitmap = compose.onRoot().captureToImage().asAndroidBitmap()
        writePng(bitmap, "quotes")
        assertTrue("quotes drew nothing", drewSomething(bitmap))
    }

    @Test
    fun `the quotes panel never prints a rate it has just called uncallable`() {
        // The defect the screenshot found: `pipelineInsight` withholds its
        // sentence below five decided jobs — "a 100% win rate off two quotes is
        // noise presented as an achievement" — and the card printed that very
        // rate at headline size beside the words "too early to call a win
        // rate". The panel contradicted itself, on all three clients.
        compose.setContent {
            LoonextTheme {
                PipelineCard(
                    report = PipelineReportResponse(
                        current = PipelineReport(quoted = 6, won = 2, lost = 0, open = 4),
                        previous = PipelineReport(quoted = 4, won = 1, lost = 1, open = 2),
                        win_rate = 33,
                        previous_win_rate = 25,
                        insight = null,
                    ),
                )
            }
        }

        compose.onNodeWithText("33%").assertDoesNotExist()
        compose.onNodeWithText("+8 pts").assertDoesNotExist()
        // The substance stays: the counts are facts, and only the CLAIM is
        // withheld. A card that hid everything would be a worse answer than
        // one that over-claimed.
        compose.onNodeWithText("6").assertIsDisplayed()
    }

    @Test
    fun `the quotes panel does print a rate it can stand behind`() {
        // The other half of the pairing, without which the test above passes
        // just as well on a card that never shows a rate at all.
        compose.setContent {
            LoonextTheme {
                PipelineCard(
                    report = PipelineReportResponse(
                        current = PipelineReport(quoted = 12, won = 4, lost = 2, open = 6),
                        previous = PipelineReport(quoted = 8, won = 2, lost = 2, open = 4),
                        win_rate = 67,
                        previous_win_rate = 50,
                        insight = "You win 67% of the quotes that get an answer.",
                    ),
                )
            }
        }

        compose.onNodeWithText("67%").assertIsDisplayed()
    }

    /** Compose the panel, write the picture, and report whether anything landed. */
    private fun drawPanel(name: String, report: LeadSourceReport): Boolean {
        compose.setContent {
            LoonextTheme {
                Column(
                    Modifier
                        .width(360.dp)
                        .background(MaterialTheme.colorScheme.background)
                        .padding(16.dp),
                ) {
                    LeadSourcesCard(report = report, onSetUpSources = {})
                }
            }
        }
        compose.waitForIdle()
        val bitmap = compose.onRoot().captureToImage().asAndroidBitmap()
        writePng(bitmap, name)
        return drewSomething(bitmap)
    }

    /**
     * Is there more than one colour on this canvas?
     *
     * A surface that failed to measure still fills its background, so "the
     * bitmap exists" proves nothing. Two distinct pixels is the cheapest honest
     * proof that a mark was actually painted.
     */
    private fun drewSomething(bitmap: Bitmap): Boolean {
        val first = bitmap.getPixel(0, 0)
        for (x in 0 until bitmap.width step 3) {
            for (y in 0 until bitmap.height step 3) {
                if (bitmap.getPixel(x, y) != first) return true
            }
        }
        return false
    }

    /**
     * Where the picture goes.
     *
     * Under `build/` rather than into the repository: this is an artifact to
     * LOOK at, not a fixture to diff, and a committed PNG would be a golden by
     * accident the first time somebody ran `git status` after a font bump.
     */
    private fun writePng(bitmap: Bitmap, name: String) {
        val dir = File("build/screenshots").apply { mkdirs() }
        File(dir, "$name.png").outputStream().use { out ->
            bitmap.compress(Bitmap.CompressFormat.PNG, 100, out)
        }
    }
}
