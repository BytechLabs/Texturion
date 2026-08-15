package com.loonext.android.core.net

import com.loonext.android.core.i18n.AppStrings
import com.loonext.android.core.model.MessageLocale
import com.loonext.android.ui.common.userMessage
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/**
 * #228 — whose sentence is it, and does a French reader get French?
 *
 * `userMessage` used to render `ApiException.message` verbatim, always. That is
 * right for the server's own refusals — they arrive worded and translated by
 * the API, and a client-side copy would go stale the moment the API rewords one
 * — and wrong for the sentences THIS APP writes. Those are the most-seen copy in
 * the product: a lost connection puts one on every screen at once, and every
 * one of them was English on a French phone.
 */
class ApiExceptionLocaleTest {

    @Test
    fun `our own sentence is translated`() {
        val cause = ApiException(
            ApiErrorCode.NETWORK,
            "Can't reach Loonext. Check your connection.",
            0,
            messageKey = "common.errNetwork",
        )
        val french = cause.userMessage(MessageLocale.FR_CA)
        assertEquals(
            AppStrings.frCA["common.errNetwork"],
            french,
        )
        // And it is actually different from the English, so this cannot pass on
        // a catalogue that never got a translation.
        assertFalse(
            "the French reads the same as the English",
            french == cause.message,
        )
    }

    @Test
    fun `the server's sentence is rendered as it arrived`() {
        // THE OTHER HALF, and it matters as much. The API wrote this one, in the
        // reader's language, having resolved their locale server-side. A client
        // that translated it again would need its own copy of every refusal the
        // API can produce.
        val serverWorded = "Ce numéro s'est désabonné."
        val cause = ApiException("recipient_opted_out", serverWorded, 403)
        assertEquals(serverWorded, cause.userMessage(MessageLocale.FR_CA))
    }

    @Test
    fun `an interpolated sentence gets its value`() {
        val cause = ApiException(
            ApiErrorCode.INTERNAL_ERROR,
            "Something went wrong (503).",
            503,
            messageKey = "common.errServer",
            messageVars = mapOf("status" to "503"),
        )
        val french = cause.userMessage(MessageLocale.FR_CA)
        assertTrue("the status is missing: $french", french.contains("503"))
        // The placeholder itself must never reach a person.
        assertFalse("the placeholder leaked: $french", french.contains("{status}"))
    }

    @Test
    fun `every key a throw site names exists in both languages`() {
        /*
         * The half that keeps this true as the app grows. A new
         * `messageKey = "common.errWhatever"` at a throw site compiles whether
         * or not the catalogue has it, and `translate` falls back to the key
         * itself — so the failure is a customer reading `common.errWhatever`
         * rather than a build that stops. That is exactly the shape that put
         * 225 bare keys on screen once already.
         */
        val keys = mutableSetOf<String>()
        val pattern = Regex("""messageKey\s*=\s*"([^"]+)"""")
        var scanned = 0
        for (file in sourceDir().walkTopDown()) {
            if (!file.isFile || file.extension != "kt") continue
            scanned++
            for (match in pattern.findAll(file.readText())) {
                keys.add(match.groupValues[1])
            }
        }

        // A walk that visited nothing would report success on an empty set,
        // which is the failure mode this repo has already paid for twice.
        assertTrue("scanned no sources at all", scanned > 100)
        assertTrue("found no messageKey at any throw site", keys.isNotEmpty())

        for (key in keys) {
            assertTrue("$key is missing from the English catalogue", AppStrings.en.containsKey(key))
            assertTrue("$key is missing from the French catalogue", AppStrings.frCA.containsKey(key))
        }
    }

    private fun sourceDir(): File {
        val bases = listOf(
            "src/main/kotlin/com/loonext/android",
            "app/src/main/kotlin/com/loonext/android",
            "apps/android/app/src/main/kotlin/com/loonext/android",
        )
        for (base in bases) {
            val dir = File(base)
            if (dir.exists()) return dir
        }
        error("source dir not found (cwd=${File(".").absolutePath})")
    }
}
