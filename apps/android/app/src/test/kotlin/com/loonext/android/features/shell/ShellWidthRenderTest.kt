package com.loonext.android.features.shell

import android.graphics.Bitmap
import androidx.activity.ComponentActivity
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.asAndroidBitmap
import androidx.compose.ui.test.captureToImage
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onRoot
import com.loonext.android.core.model.Me
import com.loonext.android.core.model.Membership
import com.loonext.android.core.model.SubscriptionStatus
import com.loonext.android.ui.theme.LoonextTheme
import java.io.File
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
    fun `the shell draws on a phone`() {
        renderShell("shell-phone-411dp")
    }

    @Test
    @Config(sdk = [34], qualifiers = "w840dp-h1000dp")
    fun `the shell draws on an unfolded foldable`() {
        // 840dp is the widest window this app realistically meets on Android:
        // a Pixel Fold opened out. Web switches to a sidebar at 1000px, so if
        // any Android window earned a rail it would be this one.
        renderShell("shell-foldable-840dp")
    }

    private fun renderShell(name: String) {
        compose.setContent {
            LoonextTheme {
                MainShell(
                    me = ME,
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
        compose.waitForIdle()

        val bitmap = compose.onRoot().captureToImage().asAndroidBitmap()
        writePng(bitmap, name)
        assertTrue("$name drew nothing", bitmap.width > 0 && bitmap.height > 0)
    }

    private fun writePng(bitmap: Bitmap, name: String) {
        val dir = File("build/screenshots").apply { mkdirs() }
        File(dir, "$name.png").outputStream().use { out ->
            bitmap.compress(Bitmap.CompressFormat.PNG, 100, out)
        }
    }

    private companion object {
        val ME = Me(
            user_id = "user-1",
            display_name = "Sam Rivera",
            memberships = listOf(
                Membership(
                    company_id = "c1",
                    name = "Northside Plumbing",
                    role = "owner",
                    subscription_status = SubscriptionStatus.ACTIVE,
                ),
            ),
        )
    }
}
