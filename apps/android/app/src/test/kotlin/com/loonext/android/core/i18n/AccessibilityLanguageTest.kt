package com.loonext.android.core.i18n

import android.os.Bundle
import android.text.Spannable
import android.text.SpannableString
import android.text.Spanned
import android.text.style.LocaleSpan
import android.text.style.URLSpan
import androidx.activity.ComponentActivity
import androidx.compose.material3.Button
import androidx.compose.material3.Text
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.test.assertHasClickAction
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.core.view.ViewCompat
import androidx.core.view.accessibility.AccessibilityNodeInfoCompat
import androidx.core.view.accessibility.AccessibilityNodeProviderCompat
import com.loonext.android.ui.theme.LoonextTheme
import java.util.Locale
import org.junit.Assert.assertEquals
import org.junit.Assert.assertSame
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/**
 * #238: the app's chosen language reaches Android's accessibility text.
 *
 * These are deliberately metadata tests. LocaleSpan is the platform contract
 * for multilingual TTS; whether a particular TalkBack build pronounces a whole
 * flow correctly remains a physical-device test, not something Robolectric can
 * turn into evidence.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class AccessibilityLanguageTest {

    @get:Rule
    val compose = createAndroidComposeRule<ComponentActivity>()

    @Test
    fun `French app text carries a fr-CA locale span`() {
        val spoken = "Repondre".withAccessibilityLanguage(Locale.CANADA_FRENCH)
            as Spanned

        val span = spoken.getSpans(0, spoken.length, LocaleSpan::class.java).single()
        assertEquals("fr-CA", span.locale?.toLanguageTag())
        assertEquals(0, spoken.getSpanStart(span))
        assertEquals(spoken.length, spoken.getSpanEnd(span))
    }

    @Test
    fun `an explicit content language and other spans survive the app default`() {
        val original = SpannableString("Acme repond")
        val english = LocaleSpan(Locale.CANADA)
        val link = URLSpan("https://example.invalid")
        original.setSpan(english, 0, 4, Spannable.SPAN_EXCLUSIVE_EXCLUSIVE)
        original.setSpan(link, 0, 4, Spannable.SPAN_EXCLUSIVE_EXCLUSIVE)

        val spoken = original.withAccessibilityLanguage(Locale.CANADA_FRENCH) as Spanned
        val localeSpans = spoken.getSpans(0, spoken.length, LocaleSpan::class.java)
        val french = localeSpans.single { it.locale?.toLanguageTag() == "fr-CA" }

        assertSame(english, localeSpans.single { it.locale?.toLanguageTag() == "en-CA" })
        assertEquals(0, spoken.getSpanStart(english))
        assertEquals(4, spoken.getSpanEnd(english))
        assertEquals(4, spoken.getSpanStart(french))
        assertEquals(spoken.length, spoken.getSpanEnd(french))
        assertSame(link, spoken.getSpans(0, spoken.length, URLSpan::class.java).single())
    }

    @Test
    fun `provider adds language without changing role state or action routing`() {
        var performed: Triple<Int, Int, Bundle?>? = null
        val source = object : AccessibilityNodeProviderCompat() {
            override fun createAccessibilityNodeInfo(
                virtualViewId: Int,
            ): AccessibilityNodeInfoCompat = AccessibilityNodeInfoCompat.obtain().apply {
                text = "Repondre"
                contentDescription = "Repondre au client"
                className = "android.widget.Button"
                isClickable = true
                isEnabled = false
                addAction(AccessibilityNodeInfoCompat.AccessibilityActionCompat.ACTION_CLICK)
            }

            override fun performAction(
                virtualViewId: Int,
                action: Int,
                arguments: Bundle?,
            ): Boolean {
                performed = Triple(virtualViewId, action, arguments)
                return true
            }
        }
        val provider = LanguageAccessibilityNodeProvider(source, Locale.CANADA_FRENCH)

        val node = provider.createAccessibilityNodeInfo(42)!!
        assertEquals("android.widget.Button", node.className)
        assertTrue(node.isClickable)
        assertTrue(!node.isEnabled)
        assertTrue(
            node.actionList.any {
                it.id == AccessibilityNodeInfoCompat.AccessibilityActionCompat.ACTION_CLICK.id
            },
        )
        assertEquals(
            "fr-CA",
            (node.text as Spanned)
                .getSpans(0, node.text.length, LocaleSpan::class.java)
                .single()
                .locale
                ?.toLanguageTag(),
        )
        assertEquals(
            "fr-CA",
            (node.contentDescription as Spanned)
                .getSpans(0, node.contentDescription.length, LocaleSpan::class.java)
                .single()
                .locale
                ?.toLanguageTag(),
        )

        val args = Bundle().apply { putString("kept", "yes") }
        assertTrue(provider.performAction(42, AccessibilityNodeInfoCompat.ACTION_CLICK, args))
        assertEquals(42, performed?.first)
        assertEquals(AccessibilityNodeInfoCompat.ACTION_CLICK, performed?.second)
        assertSame(args, performed?.third)
    }

    @Test
    fun `root wrapper leaves Compose button semantics and click intact`() {
        var clicked = false
        lateinit var host: android.view.View
        compose.setContent {
            host = LocalView.current
            AppAccessibilityLanguage("fr-CA") {
                LoonextTheme {
                    Button(onClick = { clicked = true }) { Text("Repondre") }
                }
            }
        }
        compose.waitForIdle()

        assertTrue(ViewCompat.getAccessibilityDelegate(host) is LanguageAccessibilityDelegate)
        val button = compose.onNodeWithText("Repondre")
        button
            .assertHasClickAction()
            .performClick()
        compose.runOnIdle { assertTrue(clicked) }
    }
}
