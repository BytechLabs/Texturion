package com.loonext.android.ui.common

import org.junit.Test

/**
 * #733: a list's loading skeleton is [SkeletonList]. Fails on a file outside
 * `Motion.kt` that draws a row of its own (`SkeletonListRow`) or maps `repeat(n)`
 * over rows of `SkeletonBlock`, unless the roster says the shape is not a list.
 * Page skeletons that stack headers and cards around a [SkeletonList] are fine.
 */
class ListSkeletonGuardTest {
    private val guard = PatternGuard(
        name = "ListSkeletonGuardTest",
        home = setOf("ui/common/Motion.kt"),
        rules = listOf(
            regexRule("a row of its own", Regex("""\bSkeletonListRow\(""")),
            regexRule("repeat over skeleton blocks", Regex("""\brepeat\([^)]*\)\s*\{[\s\S]{0,700}?\bSkeletonBlock\(""")),
        ),
        roster = listOf(
            GuardException("features/settings/SettingsHome.kt", "repeat over skeleton blocks", 1, "SettingsSectionSkeleton: hairline cards of text lines, not a list of rows."),
            GuardException("features/tasks/TaskBoard.kt", "repeat over skeleton blocks", 1, "Board columns, not a list."),
            GuardException("features/tasks/TaskCalendar.kt", "repeat over skeleton blocks", 1, "A calendar grid of day cells, not a list."),
        ),
    )

    @Test fun `G-0 the scan walked real source`() = guard.scansRealSource()
    @Test fun `G-1 no hand-rolled list skeleton outside the component`() = guard.noUnlistedCopies()
    @Test fun `G-2 every named exception still matches`() = guard.rosterIsClosed()
    @Test fun `G-3 every exception gives a reason`() = guard.everyExceptionGivesAReason()
}
