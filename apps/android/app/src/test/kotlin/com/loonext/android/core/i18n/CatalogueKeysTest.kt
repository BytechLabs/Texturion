package com.loonext.android.core.i18n

import java.io.File
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * #228 — every `t("…")` on this phone names a key that exists.
 *
 * `AppStrings.translate` FAILS OPEN: an unknown key falls back to English and
 * then to the key itself, so a typo does not crash, does not log, and does not
 * fail any other test. It renders `auth.signIn` on the button. This repo has
 * already shipped a tree where 225 keys rendered their own names, and nothing
 * caught it, because every individual piece was working exactly as designed.
 *
 * iOS has had `scripts/check-ios-catalogue-keys.mjs` guarding the same thing
 * since its catalogue existed. Android had nothing, and Android is the client
 * whose catalogue is a plain `Map` — the one where a typo is cheapest to make.
 *
 * A Kotlin test rather than another `check-*.mjs` for one reason: it can read
 * the REAL merged map instead of re-parsing Kotlin to guess at it, so it cannot
 * disagree with the thing it is checking.
 */
class CatalogueKeysTest {
    @Test
    fun `every t() call names a key the catalogue has`() {
        val sources = kotlinSources()

        // A guard that samples nothing reports clean. Say the size out loud and
        // fail on an empty walk — this repo has lost a whole accessibility
        // audit to a walk that visited zero controls and passed.
        // 284 files at the time of writing; the floor is a tripwire for a moved
        // tree, not a target, so it sits well below the real number.
        assertTrue(
            "walked ${sources.size} Kotlin files — the source tree moved",
            sources.size > 200,
        )

        val missing = mutableListOf<String>()
        var calls = 0
        for (file in sources) {
            for (match in CALL.findAll(file.readText())) {
                calls += 1
                val key = match.groupValues[1]
                if (key !in AppStrings.en) missing += "${file.name}: $key"
            }
        }

        // 2,098 calls at the time of writing. A floor rather than an equality:
        // a test pinning a literal count becomes a ceiling somebody has to
        // raise to translate one more sentence.
        assertTrue("found $calls t() calls — the pattern stopped matching", calls > 1500)
        assertEquals("keys used on screen that no section defines", emptyList<String>(), missing)
    }

    @Test
    fun `the pattern really matches a call, which a broken escape would not`() {
        // The proof that the regex above is not quietly matching nothing. Two
        // guards in this repo have been lost to an escape that became a
        // backspace, and both reported "none found" as if the work were done.
        val found = CALL.findAll("""Text(t("auth.signIn"), style = x)""").toList()
        assertEquals(1, found.size)
        assertEquals("auth.signIn", found[0].groupValues[1])
        // And that it does NOT match a bare string that merely ends in `t`.
        assertEquals(0, CALL.findAll("""format("auth.signIn")""").toList().size)
    }

    /**
     * `t("some.key"` — the opening quote through the closing one.
     *
     * The leading boundary is a character class rather than a word boundary
     * because `\b` inside a Kotlin string literal is a BACKSPACE. Written as
     * `[^A-Za-z0-9_.]` so `format(` and `insert(` cannot match, while a bare
     * `t(` at the start of an expression still can.
     */
    private val CALL = Regex("""(?:^|[^A-Za-z0-9_.])t\(\s*"([A-Za-z0-9_.]+)"""")

    /** Every Kotlin file the app ships, tests excluded. */
    private fun kotlinSources(): List<File> {
        var dir: File? = File("").absoluteFile
        while (dir != null) {
            val main = File(dir, "apps/android/app/src/main/kotlin")
            if (main.isDirectory) {
                return main.walkTopDown().filter { it.isFile && it.extension == "kt" }.toList()
            }
            dir = dir.parentFile
        }
        throw AssertionError("main sources not found from ${File("").absolutePath}")
    }
}
