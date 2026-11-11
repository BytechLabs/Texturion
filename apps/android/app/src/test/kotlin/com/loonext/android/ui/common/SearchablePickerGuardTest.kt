package com.loonext.android.ui.common

import org.junit.Test

/**
 * #746: a long list found by typing (time zones, teammates) is
 * [SearchablePicker]. Fails on a second sheet or dialog with a search field over
 * a list, or on a typable dropdown, outside the component, unless the roster
 * names it.
 */
class SearchablePickerGuardTest {
    private val typable = "ExposedDropdownMenuBox"
    private val sheet = "AppSheet with a search field"
    private val dialog = "AlertDialog with a search field"

    /**
     * The text of each `Name(...) { ... }`: parameters and trailing lambda.
     * [MainSourceScan.calls] stops at the closing paren, which is before the
     * lambda a picker's search field sits in.
     */
    private fun withBody(source: MainSourceScan.Source, name: String): List<String> {
        val text = source.text
        val out = mutableListOf<String>()
        for (m in Regex("""\b$name\(""").findAll(text)) {
            var i = m.range.last + 1
            var depth = 1
            while (i < text.length && depth > 0) {
                when (text[i]) {
                    '(' -> depth++
                    ')' -> depth--
                }
                i++
            }
            var j = i
            while (j < text.length && text[j].isWhitespace()) j++
            if (j < text.length && text[j] == '{') {
                depth = 0
                while (j < text.length) {
                    when (text[j]) {
                        '{' -> depth++
                        '}' -> depth--
                    }
                    j++
                    if (depth == 0) break
                }
                i = j
            }
            out += text.substring(m.range.first, i)
        }
        return out
    }

    private val guard = PatternGuard(
        name = "SearchablePickerGuardTest",
        home = setOf("ui/common/SearchablePicker.kt"),
        rules = listOf(
            regexRule(typable, Regex("""\bExposedDropdownMenuBox\(""")),
            GuardRule(sheet) { source -> withBody(source, "AppSheet").count { it.contains("SearchField(") } },
            GuardRule(dialog) { source -> withBody(source, "AlertDialog").count { it.contains("SearchField(") } },
        ),
        roster = listOf(
            GuardException("ui/common/CountryField.kt", typable, 1, "The country field: free text that also suggests, so an off-list value such as an enrichment's CA is still accepted as typed."),
            GuardException("features/compose/Composer.kt", sheet, 1, "The composer's inserters, saved replies and mentions: they put text in the message and choose no setting."),
            GuardException("features/tasks/TaskFiltersUi.kt", sheet, 1, "The task filter sheet: several filters at once, one of which searches customers."),
            GuardException("features/tasks/TaskLinksUi.kt", sheet, 1, "Linking a customer to a task: the results are searched on the server per keystroke, not a fixed list."),
            GuardException("features/tasks/MemberPickerSheet.kt", sheet, 1, "The multi-select assignee sheet: several people ticked and one Apply, which a single-choice picker does not do."),
        ),
    )

    @Test fun `G-0 the scan walked real source`() = guard.scansRealSource()
    @Test fun `G-1 no hand-built searchable picker outside the component`() = guard.noUnlistedCopies()
    @Test fun `G-2 every named exception still matches`() = guard.rosterIsClosed()
    @Test fun `G-3 every exception gives a reason`() = guard.everyExceptionGivesAReason()
}
