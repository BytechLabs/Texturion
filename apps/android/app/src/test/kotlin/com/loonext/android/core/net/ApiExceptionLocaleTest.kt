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
 * `userMessage` used to render `ApiException.message` verbatim, always. It is
 * still verbatim for an English reader — the API's refusals are specific in a
 * way no per-code sentence can be — but the sentences THIS APP writes are
 * translated, and so now is the API's own text when the reader cannot use it.
 * See `ui/common/Ui.kt` and `apps/web/src/i18n/sections/apiErrors.ts`.
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
    fun `the server's sentence reaches an English reader as it arrived`() {
        // THE OTHER HALF, and it matters as much. "No such API key" is specific
        // in a way no per-code sentence can be, and an English crew keeps it.
        val serverWorded = "No such API key."
        val cause = ApiException("not_found", serverWorded, 404)
        assertEquals(serverWorded, cause.userMessage(MessageLocale.EN))
    }

    @Test
    fun `a French reader gets the code's sentence, because the server writes only English`() {
        /*
         * THE PREMISE THIS FILE USED TO CARRY WAS NEVER TRUE.
         *
         * It asserted the server's text was already "in the reader's language,
         * having resolved their locale server-side", and its fixture was a
         * French sentence — `Ce numéro s'est désabonné.` — that the API has
         * never sent. Every one of its 370 refusal sites composes an English
         * literal; there is no locale anywhere on that path.
         *
         * So the old assertion was a guard standing over a fact that did not
         * exist, and what it actually protected was a French reader receiving
         * English. Recorded here rather than quietly deleted, because the same
         * belief could be re-derived from the same envelope.
         */
        val cause = ApiException("recipient_opted_out", "This person asked us to stop.", 403)
        assertEquals(
            AppStrings.frCA["apiErrors.recipient_opted_out"],
            cause.userMessage(MessageLocale.FR_CA),
        )
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
    fun `a specific server key stays actionable in both languages`() {
        val cause = ApiException(
            ApiErrorCode.VALIDATION_FAILED,
            "Legacy English refusal.",
            422,
            messageKey = "apiErrors.contactImportUnreadableFlag",
            messageVars = mapOf(
                "header" to "Do not text",
                "values" to "“maybe”",
            ),
        )
        val english = cause.userMessage(MessageLocale.EN)
        val french = cause.userMessage(MessageLocale.FR_CA)
        assertTrue(english.contains("Do not text"))
        assertTrue(english.contains("true/false"))
        assertTrue(french.contains("Do not text"))
        assertTrue(french.contains("interpréter comme oui ou non"))
        assertFalse(french.contains("Legacy English refusal"))
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
