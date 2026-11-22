package com.loonext.android

import androidx.activity.ComponentActivity
import androidx.compose.material3.MaterialTheme
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onRoot
import androidx.compose.ui.test.performTouchInput
import androidx.compose.ui.test.swipeDown
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], qualifiers = "w320dp-h640dp")
class SetupRefreshTest {
    @get:Rule
    val compose = createAndroidComposeRule<ComponentActivity>()

    @Test
    fun pullingDownRefreshesTheSetupScreen() {
        var refreshes = 0
        compose.setContent {
            MaterialTheme {
                RegistrationSetup(onRefresh = { refreshes++ }, onSignOut = {})
            }
        }

        compose.onRoot().performTouchInput {
            swipeDown(startY = height * 0.25f, endY = height * 0.8f)
        }

        compose.runOnIdle { assertEquals(1, refreshes) }
    }
}
