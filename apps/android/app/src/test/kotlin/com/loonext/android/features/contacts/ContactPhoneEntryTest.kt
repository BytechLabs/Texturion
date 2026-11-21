package com.loonext.android.features.contacts

import androidx.activity.ComponentActivity
import androidx.compose.material3.MaterialTheme
import androidx.compose.ui.text.TextRange
import androidx.compose.ui.test.assertIsEnabled
import androidx.compose.ui.test.assertTextContains
import androidx.compose.ui.test.hasSetTextAction
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performTextInput
import androidx.compose.ui.test.performTextInputSelection
import androidx.test.core.app.ApplicationProvider
import com.loonext.android.AppGraph
import kotlinx.coroutines.cancel
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class ContactPhoneEntryTest {
    @get:Rule
    val compose = createAndroidComposeRule<ComponentActivity>()

    @Test
    fun `typing and correcting a phone number keeps digits in order`() {
        val apiUrl = "http://localhost:8787"
        val graph = AppGraph(ApplicationProvider.getApplicationContext(), apiUrl = apiUrl)
        try {
            compose.setContent {
                MaterialTheme {
                    CreateContactSheet(
                        mutations = ContactMutations(graph.api, apiUrl),
                        companyId = "company",
                        onCreated = {},
                        onDismiss = {},
                    )
                }
            }

            val fields = compose.onAllNodes(hasSetTextAction())
            val phone = fields[0]
            phone.performClick()
            for (digit in "4165550142") {
                phone.performTextInput(digit.toString())
            }
            phone.assertTextContains("4165550142")
            compose.onNodeWithText("Add contact").assertIsEnabled()

            phone.performTextInputSelection(TextRange(0, 3))
            phone.performTextInput("647")
            phone.assertTextContains("6475550142")
            fields[1].performClick()
            phone.assertTextContains("(647) 555-0142")
            compose.onNodeWithText("Add contact").assertIsEnabled()
        } finally {
            graph.appScope.cancel()
        }
    }
}
