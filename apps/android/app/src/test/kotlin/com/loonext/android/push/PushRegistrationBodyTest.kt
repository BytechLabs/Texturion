package com.loonext.android.push

import kotlinx.serialization.json.Json
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * #228 — what this phone tells the server when it registers for push.
 *
 * The server composes a notification in the reader's language: their own
 * setting, then the DEVICE's, then the workspace's. That middle rung is only
 * ever as good as this body — with no `locale` on the row it is silence, and a
 * tech whose phone is in French reads their employer's language in the tray.
 *
 * Both properties pinned here are ones a well-meaning edit breaks QUIETLY,
 * because the wrong version still produces a body the server accepts:
 * normalising the tag on this side would be a fourth opinion about what `fr`
 * means, and sending an explicit `null` would erase a locale an earlier
 * registration had already reported.
 */
class PushRegistrationBodyTest {
    /**
     * The encoder the app actually uses (`ApiClient.json`). `explicitNulls` is
     * the flag that decides the second test: it turns an unreported locale into
     * an ABSENT key rather than a null one, which is the whole difference
     * between leaving the stored value alone and clobbering it.
     */
    private val json = Json {
        ignoreUnknownKeys = true
        explicitNulls = false
        encodeDefaults = true
        coerceInputValues = true
    }

    @Test
    fun `the device's language goes out exactly as the platform reported it`() {
        val body = json.encodeToString(
            DeviceTokenBody(platform = "android", token = "fcm-1", locale = "fr_CA"),
        )

        // Underscore and all. The server owns the fr* -> fr-CA rule so that the
        // three clients reporting a tag cannot drift apart about one.
        assertTrue(body, body.contains(""""locale":"fr_CA""""))
    }

    @Test
    fun `an unreported locale is omitted rather than sent as null`() {
        val body = json.encodeToString(DeviceTokenBody(platform = "android", token = "fcm-1"))

        assertFalse(body, body.contains("locale"))
    }

    @Test
    fun `the rest of the registration contract is undisturbed`() {
        val body = json.encodeToString(
            DeviceTokenBody(platform = "android", token = "fcm-1", locale = "en-US"),
        )

        assertTrue(body, body.contains(""""platform":"android""""))
        assertTrue(body, body.contains(""""token":"fcm-1""""))
        // Still declaring call_end, or this build stops receiving the
        // ring-revocation push and a finished call rings on (calls-v3 §8.5).
        assertTrue(body, body.contains(""""caps":["call_end"]"""))
    }

    @Test
    fun `the registrar actually fills the field it added`() {
        // Everything above is a property of the TYPE, and a nullable field with
        // a default is exactly the kind that compiles, serialises and is never
        // passed. The one call site is read here so that "the body can carry a
        // locale" is not mistaken for "this phone reports one".
        val source = repoText(
            "apps/android/app/src/main/kotlin/com/loonext/android/push/PushRegistrar.kt",
        )

        assertTrue(
            "PushRegistrar must send the device language on POST " +
                "/v1/device-push-tokens, or the device rung of the reader's " +
                "language stays empty for every Android phone.",
            source.contains("locale = UiLocale.deviceTag()"),
        )
    }

    private fun repoText(relative: String): String {
        var dir: java.io.File? = java.io.File("").absoluteFile
        while (dir != null) {
            val candidate = java.io.File(dir, relative)
            if (candidate.exists()) return candidate.readText()
            dir = dir.parentFile
        }
        throw AssertionError("$relative not found from ${java.io.File("").absolutePath}")
    }
}
