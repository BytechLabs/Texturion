package com.loonext.android.ui.common

import org.junit.Test

/**
 * #733: a yes/no question is [ConfirmDialog]. Fails on a hand-built `AlertDialog`
 * outside the component unless the roster names it. Every entry is a dialog that is
 * a form, a picker, a wizard or a read-only sheet, and says which. The count per
 * file is exact, so a second hand-built dialog added beside a named one fails.
 */
class ConfirmDialogGuardTest {
    private val rule = "AlertDialog"
    private val guard = PatternGuard(
        name = "ConfirmDialogGuardTest",
        home = setOf("ui/common/ConfirmDialog.kt"),
        rules = listOf(regexRule(rule, Regex("""\bAlertDialog\("""))),
        roster = listOf(
            GuardException("features/compose/PhotoMarkupSheet.kt", rule, 1, "Photo markup: a tool and colour picker."),
            GuardException("features/compose/SendLater.kt", rule, 1, "Schedule a send: date and time pickers with a clock switch."),
            GuardException("features/contacts/ContactTags.kt", rule, 1, "A tag name field."),
            GuardException("features/contacts/DuplicateContactsCard.kt", rule, 1, "Merge: a radio choice of which record to keep."),
            GuardException("features/inbox/InboxTab.kt", rule, 1, "Save a view: a name field and a share checkbox."),
            GuardException("features/onboarding/MemberOrientation.kt", rule, 1, "First-run orientation with three actions."),
            GuardException("features/onboarding/NotificationPrimer.kt", rule, 1, "The notification permission primer: carries an icon and asks for a permission, not a yes/no."),
            GuardException("features/settings/NumberHoursDialog.kt", rule, 1, "A number's hours: a form."),
            GuardException("features/settings/NumberIdentityDialog.kt", rule, 1, "A number's identity: a form with ten controls."),
            GuardException("features/settings/NumberPicker.kt", rule, 1, "Choosing a number: search and a result list."),
            GuardException("features/settings/NumbersSection.kt", rule, 1, "Who may use a number: a checkbox and radio picker."),
            GuardException("features/settings/PortCards.kt", rule, 2, "Start a transfer, and fix and resubmit one: forms."),
            GuardException("features/settings/TagsCard.kt", rule, 1, "Merge a tag: a radio choice of the target."),
            GuardException("features/settings/TeamSection.kt", rule, 1, "A member's numbers: read-only with one Done button."),
            GuardException("features/settings/TemplatesSection.kt", rule, 1, "A template: a form."),
            GuardException("features/settings/VoiceGreetingCard.kt", rule, 2, "Calling-now steps with one Close button, and record-on-phone: a form."),
            GuardException("features/tasks/TaskDetailScreen.kt", rule, 1, "The due time: a time picker."),
            GuardException("features/tasks/TaskFiltersUi.kt", rule, 1, "Save a task view: a name field and a share switch."),
            GuardException("features/tasks/TaskLinksUi.kt", rule, 1, "Add a link: a choice of relation."),
            GuardException("features/tasks/TaskPlanningUi.kt", rule, 1, "A three-way choice with three buttons."),
            GuardException("ui/common/ListFilterHeader.kt", rule, 1, "Rename a view: a name field."),
        ),
    )

    @Test fun `G-0 the scan walked real source`() = guard.scansRealSource()
    @Test fun `G-1 no hand-built confirm dialog outside the component`() = guard.noUnlistedCopies()
    @Test fun `G-2 every named exception still matches`() = guard.rosterIsClosed()
    @Test fun `G-3 every exception gives a reason`() = guard.everyExceptionGivesAReason()
}
