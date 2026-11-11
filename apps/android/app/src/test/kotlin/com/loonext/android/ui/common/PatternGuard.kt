package com.loonext.android.ui.common

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue

/** One thing a shared component replaces, found by counting matches per file. */
internal class GuardRule(val name: String, val count: (MainSourceScan.Source) -> Int)

/** A file allowed to keep [count] matches of [rule], and why. */
internal class GuardException(val file: String, val rule: String, val count: Int, val reason: String)

/**
 * The shape every #733 pattern guard takes.
 *
 * G-0  the scan walked real source (a guard that sampled nothing reports clean).
 * G-1  no file outside [home] has a match the roster does not name, and none has
 *      more than the roster allows.
 * G-2  the roster is closed: an entry whose file no longer has exactly that many
 *      matches fails, so a fixed exception cannot linger as permission.
 * G-3  every entry gives a reason.
 */
internal class PatternGuard(
    private val name: String,
    private val home: Set<String>,
    private val rules: List<GuardRule>,
    private val roster: List<GuardException>,
) {
    private val hits: Map<Pair<String, String>, Int> by lazy {
        val out = mutableMapOf<Pair<String, String>, Int>()
        for (source in MainSourceScan.files) {
            if (source.path in home) continue
            for (rule in rules) {
                val n = rule.count(source)
                if (n > 0) out[source.path to rule.name] = n
            }
        }
        out
    }

    fun scansRealSource() {
        assertTrue(
            "$name walked ${MainSourceScan.files.size} Kotlin files; the source tree moved",
            MainSourceScan.files.size > 200,
        )
        for (file in home) {
            assertTrue("$name: its own home $file is not in the tree", MainSourceScan.files.any { it.path == file })
        }
    }

    fun noUnlistedCopies() {
        val allowed = roster.associate { (it.file to it.rule) to it.count }
        val extra = hits.filter { (key, n) -> n > (allowed[key] ?: 0) }
            .map { (key, n) -> "${key.first}: ${key.second} x$n (allowed ${allowed[key] ?: 0})" }
        assertEquals(
            "$name: hand-rolled copies outside ${home.joinToString()}; use the shared component or name an exception",
            emptyList<String>(),
            extra,
        )
    }

    fun rosterIsClosed() {
        val stale = roster.filter { hits[it.file to it.rule] != it.count }
            .map { "${it.file}: ${it.rule} expected ${it.count}, found ${hits[it.file to it.rule] ?: 0}" }
        assertEquals("$name: exceptions that no longer match anything", emptyList<String>(), stale)
    }

    fun everyExceptionGivesAReason() {
        assertEquals(
            "$name: exceptions without a reason",
            emptyList<String>(),
            roster.filter { it.reason.isBlank() }.map { "${it.file}: ${it.rule}" },
        )
    }
}

internal fun regexRule(name: String, pattern: Regex) =
    GuardRule(name) { pattern.findAll(it.text).count() }

/** Counts calls to [call] whose text matches [pattern]. */
internal fun callRule(name: String, call: String, pattern: Regex) =
    GuardRule(name) { s -> MainSourceScan.calls(s.text, call).count { pattern.containsMatchIn(it) } }
