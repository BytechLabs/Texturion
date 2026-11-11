package com.loonext.android.ui.common

import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * #733: a count shown as a token is [CountPill]. Fails on a `Text` whose content is
 * a bare count (`count.toString()`, `"$count"`, a `*Count` value) outside the
 * component. A count inside a sentence goes through `t(...)` and is not this.
 */
class CountPillGuardTest {
    private val rule = "a bare count drawn as text"

    private val guard = PatternGuard(
        name = "CountPillGuardTest",
        home = setOf("ui/common/CountPill.kt"),
        rules = listOf(
            regexRule(
                rule,
                Regex("""\bText\(\s*(?:[\w.]*[cC]ount\b(?:\(\))?\.toString\(\)|"\s*\$\{?[\w.]*[cC]ount\b\}?\s*"|[\w.]*[cC]ount\b\s*,)"""),
            ),
        ),
        roster = emptyList(),
    )

    @Test fun `G-0 the scan walked real source`() = guard.scansRealSource()
    @Test fun `G-1 no bare count outside the component`() = guard.noUnlistedCopies()
    @Test fun `G-2 every named exception still matches`() = guard.rosterIsClosed()
    @Test fun `G-3 every exception gives a reason`() = guard.everyExceptionGivesAReason()

    @Test
    fun `the pill caps a large count rather than growing`() {
        assertEquals(99, COUNT_PILL_CEILING)
    }
}
