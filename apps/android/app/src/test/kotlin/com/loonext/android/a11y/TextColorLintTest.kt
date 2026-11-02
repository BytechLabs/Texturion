package com.loonext.android.a11y

import java.io.File
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * `outline` is the theme's border grey (about 2:1). Text must not use it:
 * 23 call sites did, for blurbs, hints and the legal line. This reads every
 * source file, so screens [AccessibilityAuditTest] does not draw are covered too.
 */
class TextColorLintTest {

    /** `color = MaterialTheme.colorScheme.outline` on its own, which only text takes. */
    private val textColoredOutline = Regex("""\bcolor\s*=\s*MaterialTheme\.colorScheme\.outline\b(?!Variant)""")

    @Test
    fun `no text is coloured with the border grey`() {
        val offenders = mainSources().flatMap { (relative, source) ->
            source.lines().withIndex()
                .filter { (_, line) -> textColoredOutline.containsMatchIn(line) }
                .map { (index, _) -> "$relative:${index + 1}" }
        }
        assertEquals(
            "These colour text with colorScheme.outline (about 2:1). Use onSurfaceVariant:\n" +
                offenders.joinToString("\n"),
            emptyList<String>(),
            offenders,
        )
    }

    private fun mainSources(): List<Pair<String, String>> {
        val root = listOf(
            "src/main/kotlin/com/loonext/android",
            "app/src/main/kotlin/com/loonext/android",
            "apps/android/app/src/main/kotlin/com/loonext/android",
        ).map(::File).firstOrNull { it.exists() }
            ?: error("main source root not found (cwd=${File(".").absolutePath})")
        val files = root.walkTopDown().filter { it.isFile && it.extension == "kt" }.toList()
        // An empty scan would pass for the wrong reason.
        assertTrue("the scan found no sources", files.size > 100)
        return files.map { it.relativeTo(root).invariantSeparatorsPath to it.readText() }
    }
}
