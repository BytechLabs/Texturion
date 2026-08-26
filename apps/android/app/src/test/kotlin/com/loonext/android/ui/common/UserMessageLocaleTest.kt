package com.loonext.android.ui.common

import com.loonext.android.core.i18n.ApiErrorStrings
import com.loonext.android.core.model.MessageLocale
import com.loonext.android.core.net.ApiDecodeException
import com.loonext.android.core.net.ApiException
import java.io.File
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * #228 — a refusal in the language the reader chose.
 *
 * The API composes its refusals in English, one per call site, 370 of them, and
 * this client rendered every one exactly as it arrived. Right for an English
 * crew; useless for the French one this issue exists for.
 *
 * These assertions are about the ASYMMETRY, because that is the part somebody
 * would reasonably undo. Replacing a specific sentence with a generic one is a
 * loss, and it is only worth taking when the specific one could not be read at
 * all. Twin of `apps/web/src/lib/api/reader-facing-errors.test.ts`.
 */
class UserMessageLocaleTest {
    private fun serverError(
        code: String,
        message: String,
        status: Int = 400,
        requestId: String? = null,
    ) = ApiException(code = code, message = message, httpStatus = status, requestId = requestId)

    @Test
    fun `an English reader keeps the server's specific sentence`() {
        val error = serverError("not_found", "No such API key.")
        // Not the catalogue's "We couldn't find that." — the server knew it was
        // a key, and that is the whole value of the sentence.
        assertEquals("No such API key.", error.userMessage(MessageLocale.EN))
    }

    @Test
    fun `a French reader gets the code's own sentence instead`() {
        val error = serverError("not_found", "No such API key.")
        val shown = error.userMessage(MessageLocale.FR_CA)
        assertEquals(ApiErrorStrings.frCA["apiErrors.not_found"], shown)
        assertFalse(shown.contains("No such"))
    }

    @Test
    fun `copy this app wrote still wins in both languages`() {
        // A key WE set names our own sentence. It must not be replaced by the
        // code's generic one just because the reader is French.
        val error = ApiException(
            code = "network",
            message = "Network unreachable.",
            httpStatus = 0,
            messageKey = "common.loadFailed",
        )
        for (locale in listOf(MessageLocale.EN, MessageLocale.FR_CA)) {
            assertEquals(
                com.loonext.android.core.i18n.AppStrings.translate(locale, "common.loadFailed"),
                error.userMessage(locale),
            )
        }
    }

    @Test
    fun `an unknown code never puts a raw key on screen`() {
        // `translate` fails open, so a code this build has never heard of would
        // otherwise render `apiErrors.teapot_error` — worse than the English it
        // replaced.
        val shown = serverError("teapot_error", "Short and stout.").userMessage(MessageLocale.FR_CA)
        assertFalse(shown.contains("apiErrors."))
        assertEquals(ApiErrorStrings.frCA["apiErrors.internal_error"], shown)
    }

    @Test
    fun `every code has a sentence that is neither English nor a key`() {
        for (key in ApiErrorStrings.en.keys) {
            if (key == "apiErrors.withReference") continue
            val code = key.removePrefix("apiErrors.")
            val shown = serverError(code, "English.").userMessage(MessageLocale.FR_CA)
            assertFalse("$code left a raw key showing", shown.contains("apiErrors."))
            assertFalse("$code was left in English", shown == "English.")
        }
    }

    @Test
    fun `the server's reference is said in the reader's language`() {
        val error = serverError(
            "internal_error",
            "Something went wrong.",
            status = 500,
            requestId = "8f2a1c9db4e60007",
        )
        assertEquals(
            "Something went wrong. Reference 8f2a1c9db4e60007.",
            error.userMessage(MessageLocale.EN),
        )
        val french = error.userMessage(MessageLocale.FR_CA)
        assertTrue(french.contains("Référence 8f2a1c9db4e60007."))
        assertFalse(french.contains("Reference "))
    }

    @Test
    fun `a refusal that already names what is wrong carries no reference`() {
        // A 422 explaining which field is wrong needs no reference, and
        // appending one to every refusal would be noise on copy doing its job.
        val error = serverError("validation_failed", "country is required.", status = 422)
        assertEquals("country is required.", error.userMessage(MessageLocale.EN))
    }

    @Test
    fun `the two sentences that were always ours still come from the catalogue`() {
        // A decode failure and an unrecognised throwable were already keyed, and
        // this change rewrote the `when` around them. A raw `common.` prefix on
        // screen would mean the branch now misses its key.
        val decode = ApiDecodeException("/v1/conversations", RuntimeException("boom"))
        for (thrown in listOf<Throwable>(decode, RuntimeException("x"))) {
            val shown = thrown.userMessage(MessageLocale.FR_CA)
            assertFalse("$thrown left a raw key showing", shown.contains("common."))
            assertTrue("$thrown said nothing", shown.length > 10)
        }
    }

    @Test
    fun `a caller cannot silently fall back to English`() {
        val source = repoFile(
            "apps/android/app/src/main/kotlin/com/loonext/android/ui/common/Ui.kt",
        )
        assertTrue(
            "userMessage must require the reader locale",
            source.contains("fun Throwable.userMessage(locale: String): String"),
        )
        assertFalse(
            "a default locale would let a future call compile in English",
            Regex("""fun Throwable\.userMessage\(locale: String\s*=""")
                .containsMatchIn(source),
        )
    }

    @Test
    fun `auth captures the resolved composition locale for its catch blocks`() {
        val source = repoFile(
            "apps/android/app/src/main/kotlin/com/loonext/android/features/auth/AuthScreens.kt",
        )
        assertTrue(source.contains("val locale = LocalAppLocale.current"))
        assertTrue(source.contains("cause.userMessage(locale)"))
        assertFalse(
            "auth must not regain an English-only error path",
            Regex("""cause\.userMessage\(\s*\)""").containsMatchIn(source),
        )
    }

    private fun repoFile(relative: String): String {
        var directory: File? = File("").absoluteFile
        while (directory != null) {
            val candidate = File(directory, relative)
            if (candidate.isFile) return candidate.readText()
            directory = directory.parentFile
        }
        throw AssertionError("$relative not found from ${File("").absolutePath}")
    }
}
