package com.loonext.android.ui.common

import java.io.File

/**
 * The source scan every #733 pattern guard shares: the main Kotlin tree, comments
 * stripped (so a KDoc that quotes a pattern is not a hit), relative paths with
 * forward slashes.
 *
 * Each guard owns its own rules and roster. What is shared is only the walk, and
 * the rule that a guard which sampled nothing reports so out loud.
 */
internal object MainSourceScan {
    class Source(val path: String, val text: String)

    private val roots = listOf(
        "src/main/kotlin/com/loonext/android",
        "app/src/main/kotlin/com/loonext/android",
        "apps/android/app/src/main/kotlin/com/loonext/android",
    )

    val files: List<Source> by lazy {
        val root = roots.map(::File).firstOrNull { it.exists() }
            ?: error("main source root not found (cwd=${File(".").absolutePath})")
        root.walkTopDown()
            .filter { it.isFile && it.extension == "kt" }
            .map { Source(it.relativeTo(root).invariantSeparatorsPath, stripComments(it.readText())) }
            .toList()
    }

    /** A line-preserving comment strip: block comments keep their newlines, line comments go. */
    fun stripComments(text: String): String =
        text.replace("\r\n", "\n")
            .replace(Regex("""/\*[\s\S]*?\*/""")) { m -> "\n".repeat(m.value.count { it == '\n' }) }
            .lines()
            // An import names a thing without using it.
            .map { if (it.startsWith("import ")) "" else it }
            .joinToString("\n") { it.replace(Regex("""(^|\s)//.*$"""), "") }

    /** The text of each call to [name], from its opening paren to the matching close. */
    fun calls(text: String, name: String): List<String> {
        val out = mutableListOf<String>()
        val start = Regex("""\b${Regex.escape(name)}\(""")
        for (m in start.findAll(text)) {
            var i = m.range.last + 1
            var depth = 1
            while (i < text.length && depth > 0) {
                when (text[i]) {
                    '"' -> {
                        i++
                        while (i < text.length && text[i] != '"') {
                            if (text[i] == '\\') i++
                            i++
                        }
                    }
                    '(' -> depth++
                    ')' -> depth--
                }
                i++
            }
            out += text.substring(m.range.first, i)
        }
        return out
    }
}
