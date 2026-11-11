package com.loonext.android.ui.common

import org.junit.Test

/**
 * #733: a single-choice pill track is [SegmentedControl]. Fails on Material's
 * `SegmentedButton` rows, a `ToggleButton`, or a hand-built tab or toggle role
 * (`asTab`, `asToggleButton`) outside the component, unless the roster names it.
 * The `asToggleButton` entries are one-off toggles and multi-select filter chips,
 * which are not a track of exclusive choices.
 */
class SegmentedControlGuardTest {
    private val material = "Material segmented row"
    private val toggle = "ToggleButton"
    private val tab = "asTab"
    private val toggleRole = "asToggleButton"

    private val guard = PatternGuard(
        name = "SegmentedControlGuardTest",
        home = setOf("ui/common/SegmentedControl.kt", "ui/common/A11y.kt"),
        rules = listOf(
            regexRule(material, Regex("""\bSegmentedButton\(|\bSingleChoiceSegmentedButtonRow\b|\bMultiChoiceSegmentedButtonRow\b""")),
            regexRule(toggle, Regex("""\bToggleButton\(""")),
            regexRule(tab, Regex("""\.asTab\(""")),
            regexRule(toggleRole, Regex("""\.asToggleButton\(""")),
        ),
        roster = listOf(
            GuardException("features/shell/Shell.kt", tab, 1, "The bottom tab bar: app navigation with a badge and a label, not a segmented control."),
            GuardException("features/calls/CallKit.kt", toggleRole, 1, "The mute and speaker toggles in a call: independent on/off buttons."),
            GuardException("features/compose/Composer.kt", toggleRole, 1, "The text/note mode pill, which recolours per mode (amber for a note)."),
            GuardException("features/inbox/InboxTab.kt", toggleRole, 1, "The filter sheet's chips: multi-select filters, not exclusive choices."),
            GuardException("features/tasks/TasksUi.kt", toggleRole, 1, "The task filter chips and the sort pill: multi-select filters, not exclusive choices."),
            GuardException("features/thread/MessageActions.kt", toggleRole, 3, "The new-task sheet's assignee, nobody and due chips: a person can be one of several assignees and a due is cleared by tapping it again, so neither is an exclusive track."),
        ),
    )

    @Test fun `G-0 the scan walked real source`() = guard.scansRealSource()
    @Test fun `G-1 no hand-rolled segmented control outside the component`() = guard.noUnlistedCopies()
    @Test fun `G-2 every named exception still matches`() = guard.rosterIsClosed()
    @Test fun `G-3 every exception gives a reason`() = guard.everyExceptionGivesAReason()
}
