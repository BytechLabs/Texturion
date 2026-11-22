package com.loonext.android.features.settings

import android.content.Intent
import androidx.activity.ComponentActivity
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.mutableStateOf
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertTextContains
import androidx.compose.ui.test.hasSetTextAction
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performTextReplacement
import com.loonext.android.core.i18n.AppStrings
import com.loonext.android.core.i18n.LocalAppLocale
import com.loonext.android.core.model.MessageLocale
import com.loonext.android.core.model.ReferralRow
import com.loonext.android.core.model.ReferralsView
import com.loonext.android.core.referral.ReferralShare
import com.loonext.android.ui.theme.LoonextTheme
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class ReferralCardLocaleTest {
    @get:Rule
    val compose = createAndroidComposeRule<ComponentActivity>()

    @Test
    fun `the French referral card shares French copy and keeps a custom draft`() {
        val readerLocale = mutableStateOf(MessageLocale.FR_CA)
        val view = ReferralsView(
            code = "QA-CODE",
            referrals = listOf(ReferralRow(stage = "rewarded", created_at = "2026-11-21")),
        )
        compose.setContent {
            LoonextTheme {
                CompositionLocalProvider(LocalAppLocale provides readerLocale.value) {
                    ReferralCard(view)
                }
            }
        }
        val draft = compose.onNode(hasSetTextAction())
        val frenchNote = AppStrings.translate(MessageLocale.FR_CA, ReferralShare.NOTE_KEY)
        compose.onNodeWithText("Recommander une autre équipe").assertIsDisplayed()
        compose.onNodeWithText("Mois gratuit appliqué").assertExists()
        draft.assertTextContains(frenchNote)
        compose.onNodeWithText("Partager").performClick()

        compose.runOnIdle {
            val chooser = shadowOf(compose.activity).nextStartedActivity
            val send = chooser.getParcelableExtra(Intent.EXTRA_INTENT, Intent::class.java)
            val codeLine = "Utilisez mon code QA-CODE à votre inscription."
            assertEquals(Intent.ACTION_CHOOSER, chooser.action)
            assertEquals("Recommander une autre équipe", chooser.getCharSequenceExtra(Intent.EXTRA_TITLE))
            assertEquals("$frenchNote\n\n$codeLine", send?.getStringExtra(Intent.EXTRA_TEXT))
        }

        val customDraft = "J'ai pensé à votre équipe."
        draft.performTextReplacement(customDraft)
        compose.runOnIdle { readerLocale.value = MessageLocale.EN }
        compose.onNodeWithText("Refer another crew").assertIsDisplayed()
        compose.onNodeWithText("Share").assertExists()
        draft.assertTextContains(customDraft)
    }
}
