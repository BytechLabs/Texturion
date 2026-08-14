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
    fun `a key that travels as DATA still names something the catalogue has`() {
        /*
         * The hole the test above cannot see.
         *
         * Not every key reaches `t()` at the place it is written. A ViewModel
         * runs outside composition, so it names a failure with a key and hands
         * it to the screen to resolve — `AuthError.Ours("auth.googleFailed")`,
         * `PendingAuthAction.fallbackKey`, `OAuthReturn.Failed(messageKey)`.
         * Those literals never appear inside a `t(` and a typo in one renders
         * `auth.googleFaild` on a person's screen, because `translate` fails
         * open. This is the mechanism that let 225 keys render their own names.
         *
         * Anything SHAPED like a key — `prefix.name`, where the prefix is one
         * the catalogue actually uses — has to be a key.
         */
        val prefixes = AppStrings.en.keys.mapNotNull { it.substringBefore('.').ifBlank { null } }
            .toSet()
        assertTrue("no section prefixes — the catalogue moved", prefixes.size >= 5)

        val sources = kotlinSources()
        /*
         * CAPABILITIES look exactly like keys and are not.
         *
         * `settings.manage`, `billing.manage`, `team.manage` are the capability
         * names from #315, and `settings.` is also a catalogue section — so the
         * shape alone cannot tell them apart, and two of the three appear
         * inline rather than as a constant.
         *
         * The reserved vocabulary is read from its own DECLARATION rather than
         * listed here, so a capability added next year is excluded without
         * anybody remembering this file exists. A hand-written list is the
         * version that goes stale and starts failing on somebody else's change.
         */
        val capabilities = sources
            .flatMap { capabilityValues(it.readText()) }
            .toSet()
        assertTrue("no capability constants found — the declaration moved", capabilities.size >= 4)
        /*
         * The exemption has to stay SMALL, and it did not.
         *
         * This first read every `const val UPPER = "a.b"` in the tree as a
         * capability. That was true when four existed. #228 then introduced
         * dozens of `const val TITLE = "contactsTasks.importBeforeTitle"` —
         * catalogue keys hoisted to constants — and every one of them became
         * exempt from the missing-key check below. The guard would have gone on
         * passing while a typo in any of them rendered its own name on screen,
         * which is the exact failure it was written to catch.
         *
         * So the exemption is scoped to the OBJECT that declares capabilities
         * rather than to a syntax anybody may reuse, and it is asserted small.
         */
        assertTrue(
            "the capability exemption has grown to ${capabilities.size} — it should " +
                "cover only `object Capability`. Something else is being read as a " +
                "capability and is therefore exempt from the check below",
            capabilities.size <= 12,
        )

        val missing = mutableListOf<String>()
        var checked = 0
        for (file in sources) {
            for (match in KEY_SHAPED.findAll(file.readText())) {
                val key = match.groupValues[1]
                if (key.substringBefore('.') !in prefixes) continue
                if (key in capabilities) continue
                checked += 1
                if (key !in AppStrings.en) missing += "${file.name}: $key"
            }
        }

        assertTrue("checked $checked key-shaped literals — the pattern broke", checked > 200)
        assertEquals("key-shaped literals with no entry", emptyList<String>(), missing)
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

    /** `"section.name"` — one dot, both halves identifier-shaped. */
    private val KEY_SHAPED = Regex(""""([a-z][A-Za-z0-9]*\.[a-zA-Z][A-Za-z0-9]*)"""")

    /** `const val SETTINGS_MANAGE = "settings.manage"` — a capability's declaration. */
    private val CONSTANT =
        Regex("""\bconst\s+val\s+[A-Z][A-Z0-9_]*\s*=\s*"([a-z][A-Za-z0-9]*\.[a-zA-Z][A-Za-z0-9]*)"""")

    /**
     * The capability names, read from `object Capability` and nowhere else.
     *
     * Scoped to that declaration because the SYNTAX is not distinctive: a
     * catalogue key hoisted to `const val TITLE = "contactsTasks.importTitle"`
     * looks identical, and reading those as capabilities exempts them from the
     * very check this file exists to run.
     */
    private fun capabilityValues(source: String): List<String> {
        val start = source.indexOf("object Capability {")
        if (start == -1) return emptyList()
        val end = source.indexOf("\n}", start)
        val body = if (end == -1) source.substring(start) else source.substring(start, end)
        return CONSTANT.findAll(body).map { it.groupValues[1] }.toList()
    }

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
