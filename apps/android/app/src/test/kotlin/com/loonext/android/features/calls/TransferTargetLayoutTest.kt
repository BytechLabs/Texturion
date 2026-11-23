package com.loonext.android.features.calls

import androidx.activity.ComponentActivity
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.width
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.unit.Density
import androidx.compose.ui.unit.dp
import com.loonext.android.core.i18n.AppStrings
import com.loonext.android.core.i18n.LocalAppLocale
import com.loonext.android.core.model.MessageLocale
import com.loonext.android.ui.theme.LoonextTheme
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class TransferTargetLayoutTest {
    @get:Rule
    val compose = createAndroidComposeRule<ComponentActivity>()

    @Test
    fun `French teammate details stay above both actions at narrow width`() {
        val locale = MessageLocale.FR_CA
        val selected = mutableListOf<String>()
        fun label(key: String) = AppStrings.translate(locale, "contactsTasks.$key")

        compose.setContent {
            val density = Density(LocalDensity.current.density, fontScale = 1.3f)
            CompositionLocalProvider(LocalAppLocale provides locale, LocalDensity provides density) {
                LoonextTheme {
                    Column(Modifier.width(280.dp)) {
                        TransferTargetRow(
                            row = TransferRow("tech", "QA-A Technician", busy = false, hasPushChannel = true),
                            enabled = true,
                            onTransfer = { selected.add("transfer") },
                            onConsult = { selected.add("consult") },
                        )
                    }
                }
            }
        }

        compose.onNodeWithText("QA-A Technician").assertIsDisplayed()
        val alerts = compose.onNodeWithText(label("transferAlertsAvailable")).assertIsDisplayed()
        val transfer = compose.onNodeWithText(label("transfer")).assertIsDisplayed()
        val consult = compose.onNodeWithText(label("talkFirst")).assertIsDisplayed()
        val alertsBottom = alerts.fetchSemanticsNode().boundsInRoot.bottom
        assertTrue(alertsBottom <= transfer.fetchSemanticsNode().boundsInRoot.top)
        assertTrue(alertsBottom <= consult.fetchSemanticsNode().boundsInRoot.top)
        transfer.performClick()
        consult.performClick()
        assertEquals(listOf("transfer", "consult"), selected)
    }
}
