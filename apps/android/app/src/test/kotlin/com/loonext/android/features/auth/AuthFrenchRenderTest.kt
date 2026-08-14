package com.loonext.android.features.auth

import android.graphics.Bitmap
import androidx.activity.ComponentActivity
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.width
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.asAndroidBitmap
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.captureToImage
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.onRoot
import androidx.compose.ui.unit.dp
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
 * #228 — the front door in French, actually drawn.
 *
 * French runs long. "Send reset link" is 15 characters; "Envoyer le lien de
 * réinitialisation" is 34, and it sits inside a pill button on a 360dp phone.
 * "Se connecter" is fine; the legal line under the sign-up button is not
 * obviously so. None of that is visible to a compiler, to the key-set test, or
 * to anybody reading the diff — the catalogue can be perfect and the screen
 * still broken.
 *
 * Robolectric with NATIVE graphics composes the real screen and hands back a
 * PNG, which on a machine with no emulator is the difference between checking
 * and hoping. The pictures land in `build/screenshots/` for somebody to LOOK at;
 * the assertions below are the part that runs unattended.
 *
 * What these assertions are worth, precisely: `onNodeWithText` finds a node by
 * the string it was GIVEN, so a French assertion proves the locale reached the
 * screen and the sentence was laid out and displayed. It does not prove the
 * glyphs were not clipped at the edge — the picture is for that. Both are here
 * because neither alone is honest.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], qualifiers = "w360dp-h1400dp")
@GraphicsMode(GraphicsMode.Mode.NATIVE)
class AuthFrenchRenderTest {

    @get:Rule
    val compose = createAndroidComposeRule<ComponentActivity>()

    @Test
    fun `the sign-in screen renders in French`() {
        render(MessageLocale.FR_CA, AuthScreen.Login, "auth-login-fr")

        // The tagline, and the claim inside it: one INBOX, never one number.
        compose.onNodeWithText("Votre numéro. Une boîte de réception.\nToute l'équipe.")
            .assertIsDisplayed()
        compose.onNodeWithText("Se connecter").assertIsDisplayed()
        compose.onNodeWithText("Mot de passe oublié ?").assertIsDisplayed()
        compose.onNodeWithText("Continuer avec Google").assertIsDisplayed()
        // Field labels are drawn uppercased by `AuthField`, so this is asserted
        // as the screen actually says it — and it is the longest of them, at 22
        // characters of tracked capitals over a 360dp field.
        compose.onNodeWithText("COURRIEL PROFESSIONNEL").assertIsDisplayed()
    }

    @Test
    fun `the sign-in screen still renders in English`() {
        // The other half of the same guarantee. A locale switch that quietly
        // broke English would pass every French assertion above it.
        render(MessageLocale.EN, AuthScreen.Login, "auth-login-en")

        compose.onNodeWithText("Your number. One inbox.\nThe whole crew.").assertIsDisplayed()
        compose.onNodeWithText("Sign in").assertIsDisplayed()
        compose.onNodeWithText("Forgot password?").assertIsDisplayed()
    }

    @Test
    fun `the sign-up screen renders in French, legal line and all`() {
        render(MessageLocale.FR_CA, AuthScreen.SignUp, "auth-signup-fr")

        compose.onNodeWithText("Créez votre compte").assertIsDisplayed()
        compose.onNodeWithText("Créer le compte").assertIsDisplayed()
        compose.onNodeWithText("Au moins 8 caractères.").assertIsDisplayed()
        // The longest sentence on the screen, and the one with a legal reason
        // to be legible rather than merely present.
        compose.onNodeWithText(
            "En continuant, vous acceptez les Conditions et la Politique " +
                "d'utilisation acceptable.",
        ).assertIsDisplayed()
    }

    @Test
    fun `the reset screen renders in French, including the long button`() {
        render(MessageLocale.FR_CA, AuthScreen.Forgot, "auth-reset-fr")

        compose.onNodeWithText("Réinitialisez votre mot de passe").assertIsDisplayed()
        // 34 characters in a pill. The reason this file exists.
        compose.onNodeWithText("Envoyer le lien de réinitialisation").assertIsDisplayed()
        compose.onNodeWithText("Retour à la connexion").assertIsDisplayed()
    }

    /**
     * Compose one screen in one language at phone width, and write the picture.
     *
     * 360dp because that is the narrow end of what this app runs on, and a
     * translation that fits a tablet and not a phone has not been checked.
     *
     * The window is 1400dp TALL (see the `qualifiers` above) while the width
     * stays honest. The real screen scrolls, so on a phone-height window the
     * primary button sits below the fold and `assertIsDisplayed` fails on
     * layout rather than on translation — which would make this file a test of
     * the viewport. A tall window renders the whole column at the width that
     * matters, and the picture shows all of it at once.
     */
    private fun render(locale: String, screen: AuthScreen, name: String) {
        compose.setContent {
            CompositionLocalProvider(LocalAppLocale provides locale) {
                LoonextTheme {
                    Box(
                        Modifier
                            .width(360.dp)
                            .background(MaterialTheme.colorScheme.background),
                    ) {
                        AuthFrontDoorPreviewBody(screen)
                    }
                }
            }
        }
        compose.waitForIdle()

        val bitmap = compose.onRoot().captureToImage().asAndroidBitmap()
        writePng(bitmap, name)
        assertTrue("$name drew nothing at all", bitmap.width > 0 && bitmap.height > 0)
    }

    /** Under `build/`, for the same reason the dashboard's shots are: to look at. */
    private fun writePng(bitmap: Bitmap, name: String) {
        val dir = File("build/screenshots").apply { mkdirs() }
        File(dir, "$name.png").outputStream().use { out ->
            bitmap.compress(Bitmap.CompressFormat.PNG, 100, out)
        }
    }
}
