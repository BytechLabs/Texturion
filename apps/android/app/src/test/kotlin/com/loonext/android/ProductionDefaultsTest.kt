package com.loonext.android

import com.loonext.android.features.settings.WEBAUTHN_RP_ID
import com.loonext.android.features.settings.inviteLink
import com.loonext.android.push.APP_HOST
import com.loonext.android.push.APP_ORIGIN
import com.loonext.android.push.FALLBACK_DEEP_LINK
import com.loonext.android.push.normalizeDeepLink
import org.junit.Assert.assertEquals
import org.junit.Assume.assumeFalse
import org.junit.Before
import org.junit.Test

/**
 * Every store build must carry production's hosts; only the rig's nonprod build
 * overrides them. Unit tests run the debug variant, which shares release's
 * defaults. A wrong default is a phone that opens the wrong web app, enrols
 * passkeys nobody can use, or drops every push link as foreign.
 */
class ProductionDefaultsTest {

    // On the rig `./gradlew test` also runs the nonprod variants, whose values
    // are the rig's on purpose.
    @Before
    fun storeBuildsOnly() {
        assumeFalse(BuildConfig.BUILD_TYPE.startsWith("nonprod"))
    }

    @Test
    fun `store builds point at production's web app and API`() {
        assertEquals("https://app.loonext.com", BuildConfig.APP_ORIGIN)
        assertEquals("app.loonext.com", BuildConfig.APP_HOST)
        assertEquals("https://api.loonext.com", BuildConfig.API_URL)
    }

    @Test
    fun `push links, invites and passkeys use the build's host`() {
        assertEquals("https://app.loonext.com", APP_ORIGIN)
        assertEquals("app.loonext.com", APP_HOST)
        assertEquals("app.loonext.com", WEBAUTHN_RP_ID)
        assertEquals("https://app.loonext.com/inbox", FALLBACK_DEEP_LINK)
        assertEquals("https://app.loonext.com/invite/abc", inviteLink("abc"))
    }

    @Test
    fun `a push link is accepted only on the build's own host`() {
        assertEquals(
            "https://app.loonext.com/calls?call=v3%3As",
            normalizeDeepLink("https://app.loonext.com/calls?call=v3%3As"),
        )
        assertEquals(FALLBACK_DEEP_LINK, normalizeDeepLink("https://app.rig.internal/calls?call=x"))
    }
}
