package com.loonext.android.ui.common

import org.junit.Test

/**
 * #733: an empty list or page is [EmptyState], never a hand-rolled centred line of
 * muted text. Fails on a `Box(contentAlignment = Center) { Text(` or a centred
 * `Column { Text(` outside the component, unless the roster says why that one is
 * not an empty message. A roster entry that no longer matches fails too.
 */
class EmptyStateGuardTest {
    private val guard = PatternGuard(
        name = "EmptyStateGuardTest",
        home = setOf("ui/common/EmptyState.kt"),
        rules = listOf(
            regexRule("centred box of text", Regex("""contentAlignment\s*=\s*Alignment\.Center\s*,?\s*\)\s*\{\s*Text\(""")),
            regexRule("centred column of text", Regex("""horizontalAlignment\s*=\s*Alignment\.CenterHorizontally\s*,?\s*\)\s*\{\s*Text\(""")),
        ),
        roster = listOf(
            GuardException("features/calls/CallKit.kt", "centred box of text", 1, "The caller avatar's initials inside its ring, not a message."),
            GuardException("features/calls/InCallScreen.kt", "centred column of text", 1, "The dial pad's number readout and its caption."),
            GuardException("features/contacts/ContactDetailScreen.kt", "centred column of text", 1, "A footer action's label and caption, not an empty state."),
            GuardException("features/tasks/TaskCalendar.kt", "centred box of text", 1, "A day number inside the calendar grid."),
            GuardException("features/tasks/TaskMap.kt", "centred column of text", 1, "The floating note laid over the map when no task has a location; the map is behind it, so it is an overlay and not a page."),
            GuardException("features/tasks/TaskPlanningUi.kt", "centred box of text", 1, "A button label centred in its own box."),
            GuardException("MainActivity.kt", "centred column of text", 1, "The external-step interstitial: a headline, a body and three actions, not an empty state."),
        ),
    )

    @Test fun `G-0 the scan walked real source`() = guard.scansRealSource()
    @Test fun `G-1 no hand-rolled empty state outside the component`() = guard.noUnlistedCopies()
    @Test fun `G-2 every named exception still matches`() = guard.rosterIsClosed()
    @Test fun `G-3 every exception gives a reason`() = guard.everyExceptionGivesAReason()
}
