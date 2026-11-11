package com.loonext.android.ui.common

import org.junit.Test

/**
 * #733: a search box is [SearchField]. Fails on a text field whose label or
 * placeholder is a search string, or a search glyph, outside the component, unless
 * the roster names it. The two entries are the buttons that open a search, which
 * are not fields.
 */
class SearchFieldGuardTest {
    private val fieldCalls = listOf("OutlinedTextField", "TextField", "BasicTextField")
    private val glyph = "search glyph"
    private val field = "text field labelled as a search"

    private val guard = PatternGuard(
        name = "SearchFieldGuardTest",
        home = setOf("ui/common/SearchField.kt"),
        rules = listOf(
            regexRule(glyph, Regex("""Icons\.(?:Outlined|Filled|Rounded|AutoMirrored\.\w+)\.Search\b""")),
            GuardRule(field) { source ->
                fieldCalls.sumOf { call ->
                    MainSourceScan.calls(source.text, call).count { Regex("""t\("[^"]*[sS]earch""").containsMatchIn(it) }
                }
            },
        ),
        roster = listOf(
            GuardException("features/inbox/InboxTab.kt", glyph, 2, "The header button that opens the search, and the icon of the search page's idle prompt."),
            GuardException("features/tasks/TasksTab.kt", glyph, 1, "The header button that shows the task search field."),
        ),
    )

    @Test fun `G-0 the scan walked real source`() = guard.scansRealSource()
    @Test fun `G-1 no hand-rolled search field outside the component`() = guard.noUnlistedCopies()
    @Test fun `G-2 every named exception still matches`() = guard.rosterIsClosed()
    @Test fun `G-3 every exception gives a reason`() = guard.everyExceptionGivesAReason()
}
