package com.loonext.android.features.settings

import android.graphics.Bitmap
import androidx.activity.ComponentActivity
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.width
import androidx.compose.material3.MaterialTheme
import androidx.compose.ui.Modifier
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.captureToImage
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.onRoot
import androidx.compose.ui.unit.dp
import androidx.compose.ui.graphics.asAndroidBitmap
import com.loonext.android.core.i18n.LocalAppLocale
import com.loonext.android.core.model.MessageLocale
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
 * #245 — the longest confirm label in the app, rendered rather than assumed.
 *
 * ## Why this test exists
 *
 * `calendarFeed.revokeConfirm` says what BREAKS rather than asking "are you
 * sure", which is the whole point of it — turning the feed off announces
 * nothing to the member afterwards, their calendar simply stops updating. That
 * makes it 39 characters in English and 52 in French, inside an AlertDialog
 * button row that also carries Cancel. Every other destructive confirmation in
 * Settings passes a short verb: "Release it", "Sign them out", "Deactivate".
 *
 * Material3's Button grows rather than clips, so it should be fine — but "should
 * be fine" is reasoning, and this repo has already shipped a label that was paid
 * for out of the space beside it. So it is drawn, in the longer language, and
 * looked at.
 *
 * NATIVE graphics: Robolectric composes the real thing and hands back a bitmap.
 * Trustworthy about glyphs and wrapping; NOT about device width, which is why
 * the box below is pinned to 360dp — the narrow end of the phones this ships to.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
@GraphicsMode(GraphicsMode.Mode.NATIVE)
class CalendarFeedFrenchRenderTest {

    @get:Rule
    val compose = createAndroidComposeRule<ComponentActivity>()

    @Test
    fun `the turn-it-off confirmation renders in French`() {
        render(MessageLocale.FR_CA, "calendar-feed-revoke-fr")

        // The consequence, whole. If the button clipped it, the assertion on
        // the full string is what fails — a truncated label is a different node
        // text, not a smaller one.
        compose.onNodeWithText("Désactiver — mon calendrier cesse de se mettre à jour")
            .assertIsDisplayed()
        compose.onNodeWithText("Annuler").assertIsDisplayed()
    }

    @Test
    fun `it still renders in English`() {
        // The other half of the same guarantee: a French fix that broke English
        // would pass every assertion above it.
        render(MessageLocale.EN, "calendar-feed-revoke-en")

        compose.onNodeWithText("Turn it off — my calendar stops updating")
            .assertIsDisplayed()
        compose.onNodeWithText("Cancel").assertIsDisplayed()
    }

    private fun render(locale: String, name: String) {
        compose.setContent {
            CompositionLocalProvider(LocalAppLocale provides locale) {
                LoonextTheme {
                    Box(
                        Modifier
                            .width(360.dp)
                            .background(MaterialTheme.colorScheme.background),
                    ) {
                        ConfirmDialog(
                            title = if (locale == MessageLocale.FR_CA) {
                                "Désactiver"
                            } else {
                                "Turn it off"
                            },
                            body = if (locale == MessageLocale.FR_CA) {
                                "Votre calendrier a vérifié pour la dernière fois il y a 6 minutes"
                            } else {
                                "Your calendar last checked 6 minutes ago"
                            },
                            confirmLabel = if (locale == MessageLocale.FR_CA) {
                                "Désactiver — mon calendrier cesse de se mettre à jour"
                            } else {
                                "Turn it off — my calendar stops updating"
                            },
                            destructive = true,
                            pending = false,
                            error = null,
                            onDismiss = {},
                            onConfirm = {},
                        )
                    }
                }
            }
        }
        compose.waitForIdle()

        val bitmap = compose.onRoot().captureToImage().asAndroidBitmap()
        writePng(bitmap, name)
        assertTrue("$name drew nothing at all", bitmap.width > 0 && bitmap.height > 0)
    }

    /** Under `build/`, for the same reason the others are: to look at. */
    private fun writePng(bitmap: Bitmap, name: String) {
        val dir = File("build/screenshots").apply { mkdirs() }
        File(dir, "$name.png").outputStream().use { out ->
            bitmap.compress(Bitmap.CompressFormat.PNG, 100, out)
        }
    }
}
