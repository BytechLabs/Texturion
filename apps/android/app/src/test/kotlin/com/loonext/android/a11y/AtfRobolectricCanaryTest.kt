package com.loonext.android.a11y

import androidx.activity.ComponentActivity
import androidx.compose.material3.Button
import androidx.compose.material3.Text
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import com.google.android.apps.common.testing.accessibility.framework.AccessibilityCheckResult.AccessibilityCheckResultType
import com.google.android.apps.common.testing.accessibility.framework.integrations.espresso.AccessibilityValidator
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/**
 * Fails when ATF starts running checks inside Compose under Robolectric. Until
 * then `enableAccessibilityChecks()` would pass over a nameless button, so
 * [SemanticsAudit] stands in. If this fails, move [AccessibilityAuditTest] to ATF
 * and delete the stand-in.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class AtfRobolectricCanaryTest {

    @get:Rule
    val compose = createAndroidComposeRule<ComponentActivity>()

    @Test
    fun `ATF still cannot run a single check inside a Compose screen`() {
        compose.setContent {
            // A button with no name at all: the plainest defect ATF exists to find.
            Button(onClick = {}) {}
            Text("something to look at")
        }
        compose.waitForIdle()

        val results = AccessibilityValidator()
            .setRunChecksFromRootView(true)
            .checkAndReturnResults(compose.activity.window.decorView)

        val ran = results.filter { it.type != AccessibilityCheckResultType.NOT_RUN }
        assertEquals(
            "ATF ran checks under Robolectric; see this test's header. Ran: $ran",
            emptyList<Any>(),
            ran,
        )
    }
}
