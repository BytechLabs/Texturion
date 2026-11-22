package com.loonext.android.features.thread

import androidx.activity.ComponentActivity
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.click
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performScrollTo
import androidx.compose.ui.test.performTouchInput
import com.loonext.android.core.model.ScheduledMessage
import com.loonext.android.features.compose.ScheduleOutcome
import com.loonext.android.ui.theme.LoonextTheme
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], qualifiers = "w320dp-h640dp-mdpi")
@GraphicsMode(GraphicsMode.Mode.NATIVE)
class ThreadActionCardsTest {
    @get:Rule
    val compose = createAndroidComposeRule<ComponentActivity>()

    @Test
    fun denseScheduleCanScrollWithoutMovingTheComposerOffscreen() {
        val lastBody = "Last pending text"
        val rowCount = 24
        val rows = List(rowCount) { index ->
            ScheduledMessage(
                id = "pending-$index",
                conversation_id = "thread",
                body = if (index == rowCount - 1) lastBody else "Pending text $index",
                send_at = "2027-01-15T16:00:00Z",
                clock_timezone = "America/Toronto",
                status = "pending",
            )
        }
        var taps = 0

        compose.setContent {
            LoonextTheme {
                Column(Modifier.fillMaxSize()) {
                    Spacer(Modifier.weight(1f))
                    ThreadActionCards {
                        ScheduledStrip(
                            rows = rows,
                            clock = null,
                            onUpdate = { _, _, _, _ -> ScheduleOutcome.Failed },
                            onCancel = {},
                        )
                    }
                    TextButton(onClick = { taps++ }) { Text("Send") }
                }
            }
        }

        val send = compose.onNodeWithText("Send")
        send.assertIsDisplayed()
        compose.onNodeWithText(lastBody, substring = true).performScrollTo().assertIsDisplayed()
        send.assertIsDisplayed().performTouchInput { click() }
        compose.runOnIdle { assertEquals(1, taps) }
    }
}
