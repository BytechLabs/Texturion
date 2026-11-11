package com.loonext.android.ui.common

import androidx.compose.ui.text.font.FontWeight
import com.loonext.android.core.i18n.AppStrings
import com.loonext.android.core.model.MessageLocale
import com.loonext.android.features.settings.SETTINGS_ROW_TITLE_SIZE
import com.loonext.android.features.settings.SettingsGroup
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * #731: a settings group heading must not look like the rows under it. Web
 * pins this with `GROUP_HEADING_CLASS` (10.5px, semibold, upper case, tracked,
 * muted) against `NAV_LINK_CLASS` (14px, medium, ink); this pins the phone's
 * heading against a row's title.
 */
class SectionHeadingStyleTest {
    @Test
    fun `a heading is smaller than a row title`() {
        assertTrue(SectionHeadingStyle.fontSize.value < SETTINGS_ROW_TITLE_SIZE.value)
        assertEquals(10.5f, SectionHeadingStyle.fontSize.value, 0.001f)
    }

    @Test
    fun `a heading is bolder than a row title and tracked out`() {
        // A row's title is the theme's titleSmall, a Medium.
        assertTrue(SectionHeadingStyle.weight.weight > FontWeight.Medium.weight)
        assertTrue(SectionHeadingStyle.tracking.value > 0f)
    }

    @Test
    fun `a heading is upper case in both languages, a row is not`() {
        SettingsGroup.entries.forEach { group ->
            listOf(null, MessageLocale.FR_CA).forEach { locale ->
                val label = AppStrings.translate(locale, group.titleKey)
                val heading = SectionHeadingStyle.text(label)
                assertEquals(label.uppercase(), heading)
                assertNotEquals(label, heading)
            }
        }
    }
}
