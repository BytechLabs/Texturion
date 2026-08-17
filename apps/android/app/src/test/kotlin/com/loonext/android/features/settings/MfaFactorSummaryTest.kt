package com.loonext.android.features.settings

import com.loonext.android.core.i18n.AppStrings
import com.loonext.android.core.model.MessageLocale
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/**
 * #473 — the passkey/authenticator summary, pinned against the TypeScript it was
 * ported from.
 *
 * Three clients render this sentence from the same `GET /v1/mfa` payload, and it
 * is not decorative: it answers "what happens if I lose this phone". Telling
 * somebody who enrolled a passkey that an *authenticator app* is on sends them
 * looking for six digits that exist nowhere.
 *
 * The rule lives in `packages/shared/src/mfa-factors.ts` and web calls it
 * directly. Kotlin cannot, so [mfaSummaryKey] is a hand-port — and a hand-port
 * with nothing holding it to its original is a copy that drifts. What follows
 * holds it to the original in both directions: every key the port can return
 * must be one the shared module declares, and every key the shared module
 * declares must be one the port can return.
 */
class MfaFactorSummaryTest {

    @Test
    fun `names a passkey as a passkey, and an app as an app`() {
        assertEquals("settingsMore.tfaPasskeyOn", mfaSummaryKey(listOf(FACTOR_PASSKEY)))
        assertEquals(
            "settingsMore.tfaAuthenticatorOn",
            mfaSummaryKey(listOf(FACTOR_AUTHENTICATOR)),
        )
    }

    @Test
    fun `names both when both are held, in either order`() {
        val expected = "settingsMore.tfaBothOn"
        assertEquals(expected, mfaSummaryKey(listOf(FACTOR_PASSKEY, FACTOR_AUTHENTICATOR)))
        assertEquals(expected, mfaSummaryKey(listOf(FACTOR_AUTHENTICATOR, FACTOR_PASSKEY)))
    }

    @Test
    fun `a factor type it cannot name still reads as protected`() {
        // `phone` is a type the platform supports and this product does not
        // enrol. The dangerous failure is not vagueness — it is rendering
        // "off" to somebody who is protected, which invites them to enrol
        // again or to believe the account is open.
        assertEquals("settingsMore.tfaOn", mfaSummaryKey(listOf("phone")))
        assertNotEquals("settingsMore.tfaOn", mfaSummaryKey(listOf(FACTOR_PASSKEY)))
    }

    @Test
    fun `offers the kind that is missing, and nothing to somebody holding both`() {
        assertEquals(listOf(FACTOR_PASSKEY), missingFactorTypes(listOf(FACTOR_AUTHENTICATOR)))
        assertEquals(listOf(FACTOR_AUTHENTICATOR), missingFactorTypes(listOf(FACTOR_PASSKEY)))
        assertEquals(
            emptyList<String>(),
            missingFactorTypes(listOf(FACTOR_PASSKEY, FACTOR_AUTHENTICATOR)),
        )
        // Nobody with zero factors gets an "add another" affordance: they get
        // the first-time pitch, which explains what setup involves.
        assertEquals(emptyList<String>(), missingFactorTypes(emptyList()))
    }

    @Test
    fun `returns exactly the keys the shared module declares`() {
        val shared = sharedSource()
        val declared = Regex("\"(settingsMore\\.tfa[A-Za-z]+)\"")
            .findAll(shared.substringAfter("MFA_SUMMARY_KEYS").substringBefore("] as const"))
            .map { it.groupValues[1] }
            .toSet()

        // A guard that reads nothing passes for the wrong reason. This one has
        // regressed to zero before in this repo, so the sample size is asserted
        // rather than assumed.
        assertEquals(
            "expected four summary keys in mfa-factors.ts, found $declared",
            4,
            declared.size,
        )

        val ported = setOf(
            mfaSummaryKey(listOf(FACTOR_PASSKEY)),
            mfaSummaryKey(listOf(FACTOR_AUTHENTICATOR)),
            mfaSummaryKey(listOf(FACTOR_PASSKEY, FACTOR_AUTHENTICATOR)),
            mfaSummaryKey(listOf("something-new")),
        )

        // SET EQUALITY, BOTH DIRECTIONS. A key added to the shared rule and not
        // here means this client renders the old sentence for a new state; a key
        // here and not there means it renders one nobody else does.
        assertEquals(declared, ported)
    }

    @Test
    fun `every key it can return has words in both languages`() {
        // The resolver fails open: a missing key renders as the key. That is how
        // 225 of them once shipped rendering their own names, so this asserts
        // words rather than presence.
        val keys = listOf(
            "settingsMore.tfaPasskeyOn",
            "settingsMore.tfaAuthenticatorOn",
            "settingsMore.tfaBothOn",
            "settingsMore.tfaOn",
            "settingsMore.tfaAddPasskey",
            "settingsMore.tfaAddAuthenticator",
            "settingsMore.tfaUsePasskey",
            "settingsMore.tfaPasskeyPitch",
            "settingsMore.tfaPasskeyFactorName",
            "settingsMore.tfaPasskeyFailed",
        )
        for (locale in MessageLocale.ALL) {
            for (key in keys) {
                val words = AppStrings.translate(locale, key)
                assertNotEquals("$key has no words in $locale", key, words)
                assertTrue("$key is empty in $locale", words.isNotBlank())
            }
        }
    }

    /**
     * Walk UP to the repo root: Gradle runs unit tests from `apps/android/app`,
     * but that is a property of the runner, not a promise.
     */
    private fun sharedSource(): String {
        var dir: File? = File("").absoluteFile
        while (dir != null) {
            val candidate = File(dir, "packages/shared/src/mfa-factors.ts")
            if (candidate.exists()) return candidate.readText()
            dir = dir.parentFile
        }
        throw AssertionError(
            "packages/shared/src/mfa-factors.ts not found walking up from " +
                File("").absolutePath,
        )
    }
}
