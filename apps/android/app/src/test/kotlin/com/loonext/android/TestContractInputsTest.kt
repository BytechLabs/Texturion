package com.loonext.android

import java.io.File
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * #607 A4 — the guard on the guards.
 *
 * A dozen suites here read the SOURCE OF TRUTH from outside this Gradle build:
 * the shared TypeScript they are hand-ports of, the migrations that publish the
 * wire names they pin, the API's union types. That is the whole reason they
 * exist — a rule written twice drifts, so the copy is checked against the
 * original.
 *
 * None of them was an input of the test task. So the strongest guard in the
 * payment feature could be defeated by editing the migration it reads: nothing
 * under `app/` changed, `:app:testDebugUnitTest` went UP-TO-DATE, and
 * `BUILD SUCCESSFUL` was a cached verdict about the previous contents of a file
 * that no longer said that. Proved by doing it.
 *
 * `app/test-contract-inputs.txt` fixes that by naming the trees, and
 * `app/build.gradle.kts` declares them. This test is why that fix does not rot:
 * the next guard somebody writes against a path nobody declared fails HERE,
 * loudly, instead of passing forever without running.
 *
 * ## Why it scans the source text
 *
 * Because there is no other signal. A test that reads a file leaves no trace a
 * build system can see, and the only durable evidence that it did is the path
 * literal in its own source. The scan is deliberately blunt for the reason this
 * repo has learned twice: a rule that decides from CONTENT is a vocabulary, it
 * is never complete, and the last two written here were deleted. This one asks
 * one structural question — does this string start with a repo top-level
 * directory — and covers everything it finds.
 */
class TestContractInputsTest {

    @Test
    fun `every repo path a test reads is a declared input of the test task`() {
        val declared = declaredRoots()
        assertTrue(
            "$MANIFEST is empty. Every cross-language guard in this suite is " +
                "then unpinned, and the suite reports the previous run's answer " +
                "for all of them.",
            declared.isNotEmpty(),
        )

        val undeclared = sortedSetOf<String>()
        testSources().forEach { file ->
            val text = file.readText()
            PATH_LITERAL.findAll(text).forEach { match ->
                // Everything up to the first interpolation, then up to the
                // first space. `"apps/api/src/$rel"` is a read of
                // `apps/api/src` and the suffix is not knowable from here;
                // `"supabase/migrations not found walking up from "` is an
                // ERROR MESSAGE that happens to open with a path, and a path
                // with a space in it is prose in this repo either way.
                val path = match.groupValues[1].substringBefore('$').substringBefore(' ').trim()
                if (path.count { it == '/' } < 1) return@forEach
                // A declared root covers a path INSIDE it, and is also covered
                // by a path that names one of its own parents.
                val covered = declared.any { root ->
                    path.startsWith("$root/") || path == root || root.startsWith(path)
                }
                if (!covered) undeclared += "${file.name}: $path"
            }
        }

        assertTrue(
            "these tests read repo paths that no line of $MANIFEST covers, so " +
                "editing them leaves :app:testDebugUnitTest UP-TO-DATE and the " +
                "assertions about them report the previous run's answer — add " +
                "the narrowest root that covers each:\n  " +
                undeclared.joinToString("\n  "),
            undeclared.isEmpty(),
        )
    }

    @Test
    fun `every declared input still exists`() {
        // The build refuses to configure when one of these is missing, which
        // makes this redundant there — and not here: this is the assertion that
        // names the file, so a reader who hits it in a test report is told
        // where the list is rather than only that a path was wrong.
        declaredRoots().forEach { root ->
            assertTrue(
                "$MANIFEST declares '$root', which does not exist. An input " +
                    "that resolves to nothing hashes to the empty set and puts " +
                    "the suite back to reporting its last answer.",
                repoRoot().resolve(root).exists(),
            )
        }
    }

    // --- Reading the repo -------------------------------------------------------

    private fun repoRoot(): File {
        var dir: File? = File("").absoluteFile
        while (dir != null) {
            if (File(dir, MANIFEST).isFile) return dir
            dir = dir.parentFile
        }
        throw AssertionError("$MANIFEST not found walking up from ${File("").absolutePath}")
    }

    private fun declaredRoots(): List<String> =
        repoRoot().resolve(MANIFEST).readLines()
            .map { it.substringBefore('#').trim() }
            .filter { it.isNotEmpty() }

    private fun testSources(): List<File> =
        repoRoot().resolve(TEST_SOURCES).walkTopDown()
            .filter { it.isFile && it.extension == "kt" }
            .toList()
            .also {
                assertTrue(
                    "no Kotlin test sources found under $TEST_SOURCES — this " +
                        "test would pass by finding nothing, which is the exact " +
                        "shape of failure it exists to prevent",
                    it.isNotEmpty(),
                )
            }

    private companion object {
        private const val MANIFEST = "apps/android/app/test-contract-inputs.txt"
        private const val TEST_SOURCES = "apps/android/app/src/test/kotlin"

        /**
         * A string literal beginning with one of the repo's top-level
         * directories. Anchored on the opening quote so a path inside a comment
         * — of which these files have many — is not mistaken for a read.
         */
        private val PATH_LITERAL =
            Regex(""""((?:packages|supabase|apps|scripts|docs)/[^"\n]*)"""")
    }
}
