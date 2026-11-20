package com.loonext.android.features.thread

import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.net.Uri
import androidx.activity.ComponentActivity
import androidx.compose.material3.Surface
import androidx.compose.ui.graphics.asAndroidBitmap
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.captureToImage
import androidx.compose.ui.test.isDialog
import androidx.compose.ui.test.longClick
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performTouchInput
import com.loonext.android.core.model.AttachmentSummary
import com.loonext.android.ui.theme.LoonextTheme
import java.io.File
import java.util.concurrent.atomic.AtomicInteger
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], qualifiers = "w390dp-h844dp-xhdpi")
@GraphicsMode(GraphicsMode.Mode.NATIVE)
class AttachmentViewerTest {
    @get:Rule
    val compose = createAndroidComposeRule<ComponentActivity>()

    @Test
    fun opensPhotoInLightTheme() = openAndZoom(dark = false)

    @Test
    fun opensPhotoInDarkTheme() = openAndZoom(dark = true)

    private fun openAndZoom(dark: Boolean) {
        val source = photoFixture()
        val originalMints = AtomicInteger()
        val longPresses = AtomicInteger()
        compose.setContent {
            LoonextTheme(darkTheme = dark) {
                Surface {
                    SignedAttachmentImage(
                        attachment = AttachmentSummary("photo", "image/jpeg", null),
                        mintUrl = { source },
                        mintOriginal = {
                            originalMints.incrementAndGet()
                            source
                        },
                        onLongPress = { longPresses.incrementAndGet() },
                    )
                }
            }
        }

        assertEquals(0, originalMints.get())
        compose.onNodeWithContentDescription("Photo").performClick()
        compose.onNodeWithText("Save").assertIsDisplayed()
        compose.waitUntil { originalMints.get() == 1 }
        compose.onNodeWithContentDescription("Zoom in").performClick()
        compose.onNodeWithText("150%").assertIsDisplayed()

        val mode = if (dark) "dark" else "light"
        val directory = File("build/screenshots/evidence").apply { mkdirs() }
        File(directory, "attachment-viewer-$mode.png").outputStream().use { output ->
            compose.onNode(isDialog()).captureToImage().asAndroidBitmap()
                .compress(Bitmap.CompressFormat.PNG, 100, output)
        }

        compose.onNodeWithContentDescription("Reset zoom").performClick()
        compose.onNodeWithText("100%").assertIsDisplayed()
        compose.onNodeWithContentDescription("Close").performClick()
        compose.onNode(isDialog()).assertDoesNotExist()
        compose.onNodeWithContentDescription("Photo").performTouchInput { longClick() }
        assertEquals(1, longPresses.get())
    }

    private fun photoFixture(): String {
        val evidencePhoto = System.getenv("LOONEXT_MEDIA_EVIDENCE_PHOTO")?.let(::File)
        if (evidencePhoto?.isFile == true) return Uri.fromFile(evidencePhoto).toString()

        val file = File(compose.activity.cacheDir, "attachment-test.jpg")
        val bitmap = Bitmap.createBitmap(400, 300, Bitmap.Config.ARGB_8888)
        val canvas = Canvas(bitmap)
        val paint = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = Color.BLUE }
        canvas.drawColor(Color.GREEN)
        canvas.drawCircle(200f, 150f, 120f, paint)
        file.outputStream().use { bitmap.compress(Bitmap.CompressFormat.JPEG, 90, it) }
        return Uri.fromFile(file).toString()
    }
}
