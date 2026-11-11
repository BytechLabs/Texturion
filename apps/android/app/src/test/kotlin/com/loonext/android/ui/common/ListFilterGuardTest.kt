package com.loonext.android.ui.common

import org.junit.Test

/**
 * #733: a list's Filter button and Views menu are [ListFilterRow] (its pieces
 * [ListFilterButton] and [ListViewsMenu]). Fails on a file outside
 * `ListFilterHeader.kt` that draws either by hand: it uses the Tune or Bookmarks
 * icon the pair is built on, or reads the label keys only they carry (the Filter
 * button's "N on" name, the Views menu's name, "Save these filters" and "Manage
 * views"). A segmented control is not this pattern.
 */
class ListFilterGuardTest {
    private val icon = "a filter or views icon"
    private val label = "a filter or views label"

    private val guard = PatternGuard(
        name = "ListFilterGuardTest",
        home = setOf("ui/common/ListFilterHeader.kt"),
        rules = listOf(
            regexRule(icon, Regex("""\bIcons\.\w+\.(?:Tune|Bookmarks?|FilterList|FilterAlt)\b""")),
            regexRule(
                label,
                Regex("""\bt\(\s*"inbox\.(?:filterActionCount|viewsMenuAria|viewsSaveCurrent|viewsManage)""""),
            ),
        ),
        roster = listOf(
            GuardException("features/foryou/ForYouTab.kt", icon, 1, "The For you edit-layout button: it arranges cards, it filters nothing."),
        ),
    )

    @Test fun `G-0 the scan walked real source`() = guard.scansRealSource()
    @Test fun `G-1 no hand-built filter button or views menu outside the component`() = guard.noUnlistedCopies()
    @Test fun `G-2 every named exception still matches`() = guard.rosterIsClosed()
    @Test fun `G-3 every exception gives a reason`() = guard.everyExceptionGivesAReason()
}
