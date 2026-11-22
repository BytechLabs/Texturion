package com.loonext.android.features.thread

import androidx.activity.ComponentActivity
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.test.SemanticsMatcher
import androidx.compose.ui.test.assertHeightIsAtLeast
import androidx.compose.ui.test.click
import androidx.compose.ui.test.hasClickAction
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.performTouchInput
import androidx.compose.ui.unit.dp
import com.loonext.android.core.i18n.LocalAppLocale
import com.loonext.android.core.model.MessageLocale
import com.loonext.android.core.model.ScheduledMessage
import com.loonext.android.features.compose.ScheduleOutcome
import com.loonext.android.ui.theme.LoonextTheme
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], qualifiers = "w320dp-h640dp-mdpi")
@GraphicsMode(GraphicsMode.Mode.NATIVE)
class ScheduledStripTouchTargetTest {
    @get:Rule
    val compose = createAndroidComposeRule<ComponentActivity>()

    @Test
    fun scheduledPreviewExpandsFromThePaddedTouchTarget() {
        val body = "Voici le rappel.\n".repeat(10).trimEnd()
        val scheduled = ScheduledMessage(
            id = "scheduled",
            conversation_id = "thread",
            body = body,
            send_at = "2027-01-15T16:00:00Z",
            clock_timezone = "America/Toronto",
            status = "pending",
        )
        compose.setContent {
            CompositionLocalProvider(LocalAppLocale provides MessageLocale.FR_CA) {
                LoonextTheme {
                    ScheduledStrip(
                        rows = listOf(scheduled),
                        clock = null,
                        onUpdate = { _, _, _, _ -> ScheduleOutcome.Failed },
                        onCancel = {},
                    )
                }
            }
        }

        val buttonRole = SemanticsMatcher.expectValue(SemanticsProperties.Role, Role.Button)
        val preview = compose.onNode(hasText(body, substring = true) and hasClickAction() and buttonRole)
        preview.assertHeightIsAtLeast(48.dp)
        val collapsed = preview.fetchSemanticsNode().boundsInRoot.height

        preview.performTouchInput { click(Offset(center.x, 2f)) }
        val expanded = preview.fetchSemanticsNode().boundsInRoot.height
        assertTrue("Preview height should grow from $collapsed after tapping, got $expanded", expanded > collapsed)
        preview.performTouchInput { click(Offset(center.x, 2f)) }
        assertEquals(collapsed, preview.fetchSemanticsNode().boundsInRoot.height, 0.01f)
    }
}
