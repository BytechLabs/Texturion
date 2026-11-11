package com.loonext.android.ui.common

import org.junit.Test

/**
 * #733: a failed load is [LoadError], with the one shared Retry. Fails on a screen
 * that draws its own retry (the shared `common.retry` / `auth.tryAgain` labels or
 * any `*.retry` label) or that still names the old `CenteredError`.
 */
class LoadErrorGuardTest {
    private val guard = PatternGuard(
        name = "LoadErrorGuardTest",
        home = setOf("ui/common/LoadError.kt"),
        rules = listOf(
            regexRule("shared retry label", Regex("""\bt\("(?:common\.retry|auth\.tryAgain)"\)""")),
            regexRule("other retry label", Regex("""\bt\("[a-zA-Z]+\.(?:retry|tryAgain|retryConnections)"\)""")),
            regexRule("the old CenteredError", Regex("""\bCenteredError\b""")),
        ),
        roster = listOf(
            GuardException("features/thread/MessageBubbles.kt", "other retry label", 1, "Retry on one message that failed to send: an action on a bubble, not a failed load."),
        ),
    )

    @Test fun `G-0 the scan walked real source`() = guard.scansRealSource()
    @Test fun `G-1 no hand-rolled retry outside the component`() = guard.noUnlistedCopies()
    @Test fun `G-2 every named exception still matches`() = guard.rosterIsClosed()
    @Test fun `G-3 every exception gives a reason`() = guard.everyExceptionGivesAReason()
}
