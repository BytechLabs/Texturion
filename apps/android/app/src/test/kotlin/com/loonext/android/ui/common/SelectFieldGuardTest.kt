package com.loonext.android.ui.common

import org.junit.Test

/**
 * #746: a single choice from a short list is [SelectField]. Fails on a
 * hand-built dropdown (a `DropdownMenu` under an outline button) outside the
 * component, unless the roster names it. Every file below keeps a `DropdownMenu`
 * for a menu of ACTIONS on a record, a row or a toolbar: those run something
 * and choose no value, so they are not a select.
 */
class SelectFieldGuardTest {
    private val menu = "DropdownMenu"

    private val guard = PatternGuard(
        name = "SelectFieldGuardTest",
        home = setOf("ui/common/SelectField.kt"),
        rules = listOf(
            regexRule(menu, Regex("""\bDropdownMenu\(""")),
        ),
        roster = listOf(
            GuardException("ui/common/RecordMenu.kt", menu, 1, "The record menu itself: a list of actions on a record."),
            GuardException("ui/common/ListFilterHeader.kt", menu, 1, "The saved views menu: opens a view, saves one, deletes one."),
            GuardException("features/compose/Composer.kt", menu, 1, "The composer's add menu: attach a file or a photo."),
            GuardException("features/contacts/ContactsTab.kt", menu, 1, "The import menu: CSV or vCard, each starts a flow."),
            GuardException("features/inbox/InboxTab.kt", menu, 1, "The bulk bar's assign list: runs an action on the selected conversations."),
            GuardException("features/tasks/TasksTab.kt", menu, 1, "The bulk bar's overflow: actions on the selected tasks."),
            GuardException("features/tasks/TaskDetailScreen.kt", menu, 1, "A comment's edit and delete: actions."),
            GuardException("features/thread/AttachmentsGalleryScreen.kt", menu, 1, "A file's report action."),
        ),
    )

    @Test fun `G-0 the scan walked real source`() = guard.scansRealSource()
    @Test fun `G-1 no hand-built dropdown outside the component`() = guard.noUnlistedCopies()
    @Test fun `G-2 every named exception still matches`() = guard.rosterIsClosed()
    @Test fun `G-3 every exception gives a reason`() = guard.everyExceptionGivesAReason()
}
