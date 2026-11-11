package com.loonext.android.ui.common

import org.junit.Test

/**
 * #746: a few options that each have a consequence are [ChoiceCards]. Fails on a
 * hand-built radio row (a Material `RadioButton`) outside the component, unless
 * the roster names it.
 */
class ChoiceCardsGuardTest {
    private val radio = "RadioButton"

    private val guard = PatternGuard(
        name = "ChoiceCardsGuardTest",
        home = setOf("ui/common/ChoiceCards.kt"),
        rules = listOf(
            regexRule(radio, Regex("""\bRadioButton\(""")),
        ),
        roster = listOf(
            GuardException("features/settings/BillingSection.kt", radio, 1, "The plan cards: a price and a feature list on each card, not a label and a line."),
            GuardException("features/contacts/DuplicateContactsCard.kt", radio, 1, "Which record survives a merge: one radio per row of a comparison, not a stack of options."),
        ),
    )

    @Test fun `G-0 the scan walked real source`() = guard.scansRealSource()
    @Test fun `G-1 no hand-built radio row outside the component`() = guard.noUnlistedCopies()
    @Test fun `G-2 every named exception still matches`() = guard.rosterIsClosed()
    @Test fun `G-3 every exception gives a reason`() = guard.everyExceptionGivesAReason()
}
