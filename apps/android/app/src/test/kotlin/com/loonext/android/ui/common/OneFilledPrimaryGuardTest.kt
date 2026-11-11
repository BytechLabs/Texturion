package com.loonext.android.ui.common

import org.junit.Test

/**
 * #733: a view has one filled primary. On the phones a "view" is one composable
 * function: a screen, a card, a dialog or a sheet each own a single filled
 * button (or the [MainActionButton] circle), and an empty state's action is an
 * outline button, never a filled one. A material3 `Button(` is filled;
 * `OutlinedButton`, `TextButton` and [LinkButton] are not.
 *
 * Fails on a function that draws a second filled button, or an [EmptyState]
 * whose action is filled, unless the roster says why the two never show at the
 * same time. A roster entry that no longer matches fails too. The web twin is
 * `page-header.test.ts`.
 */
class OneFilledPrimaryGuardTest {
    private val perFunction = "second filled button in one function"
    private val emptyAction = "filled button in an empty state's action"

    private val filled = Regex("""(?<![A-Za-z])(?:Button|FilledTonalButton|ElevatedButton|MainActionButton)\(""")
    private val functionStart = Regex("""^(?:@\w+\s+)*(?:private |internal |public )?(?:inline )?fun\s""", RegexOption.MULTILINE)

    private val guard = PatternGuard(
        name = "OneFilledPrimaryGuardTest",
        home = setOf("ui/common/MainAction.kt"),
        rules = listOf(
            GuardRule(perFunction) { source ->
                val starts = functionStart.findAll(source.text).map { it.range.first }.toList() + source.text.length
                starts.zipWithNext().sumOf { (from, to) ->
                    (filled.findAll(source.text.substring(from, to)).count() - 1).coerceAtLeast(0)
                }
            },
            GuardRule(emptyAction) { source ->
                MainSourceScan.calls(source.text, "EmptyState").count { Regex("""(?<![A-Za-z])Button\(""").containsMatchIn(it) }
            },
        ),
        roster = listOf(
            GuardException("features/settings/CallingSection.kt", perFunction, 1, "Review and Confirm are two steps of one change; the editor hides while the confirmation shows."),
            GuardException("features/settings/PortCards.kt", perFunction, 2, "Submit and Fix-and-resubmit belong to different port statuses, and the dialog's Check and Start are two steps of one dialog."),
            GuardException("features/settings/RegistrationFixForm.kt", perFunction, 1, "Edit details is what shows before the form opens; Save is what shows after. They never share the screen."),
            GuardException("features/settings/ReminderRulesCard.kt", perFunction, 1, "Set up the usual is the empty card's only action and returns before the rule list and its Save are drawn."),
            GuardException("features/settings/TwoFactorCard.kt", perFunction, 1, "The passkey branch and the authenticator-only branch are alternatives; the other action is outline."),
            GuardException("features/settings/VoiceGreetingCard.kt", perFunction, 2, "Save, Stop and Record are the three states of one recorder; one shows at a time."),
            GuardException("features/settings/WebsiteWidgetCard.kt", perFunction, 1, "Copy stays while the inline confirmation to rotate the snippet shows; the confirmation is the step the person is on."),
        ),
    )

    @Test fun `G-0 the scan walked real source`() = guard.scansRealSource()
    @Test fun `G-1 no second filled primary and no filled empty-state action`() = guard.noUnlistedCopies()
    @Test fun `G-2 every named exception still matches`() = guard.rosterIsClosed()
    @Test fun `G-3 every exception gives a reason`() = guard.everyExceptionGivesAReason()
}
