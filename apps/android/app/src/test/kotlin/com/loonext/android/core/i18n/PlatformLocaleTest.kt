package com.loonext.android.core.i18n

import android.app.Application
import android.app.LocaleManager
import android.os.LocaleList
import org.junit.Assert.assertEquals
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], application = Application::class)
class PlatformLocaleTest {
    private val app = RuntimeEnvironment.getApplication()
    private val manager = app.getSystemService(LocaleManager::class.java)!!

    @Test
    fun `member choice supplies the app locale and restores the previous Android choice`() {
        manager.applicationLocales = LocaleList.forLanguageTags("en-CA")

        UiLocale.applyPlatformPreference(app, "fr-CA")
        assertEquals("fr-CA", manager.applicationLocales.toLanguageTags())
        assertEquals("en-CA", UiLocale.deviceTag(app))

        UiLocale.applyPlatformPreference(app, "en")
        assertEquals("en", manager.applicationLocales.toLanguageTags())

        UiLocale.applyPlatformPreference(app, null)
        assertEquals("en-CA", manager.applicationLocales.toLanguageTags())
    }

    @Test
    fun `reset preserves a later Android language selection`() {
        UiLocale.applyPlatformPreference(app, "fr-CA")
        manager.applicationLocales = LocaleList.forLanguageTags("en-GB")

        UiLocale.applyPlatformPreference(app, null)
        assertEquals("en-GB", manager.applicationLocales.toLanguageTags())
        assertEquals("en-GB", UiLocale.deviceTag(app))
    }
}
