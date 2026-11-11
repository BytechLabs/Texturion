package com.loonext.android.ui.common

import org.junit.Test

/**
 * #733: a record screen draws its header through [RecordHeader] (the web's
 * `record-header.tsx`): a leading avatar or done circle, the title, quiet meta
 * lines, the icon toggles and overflow menu, then the action row.
 *
 * Two things fail. A record screen that never calls it, and a composable that
 * names itself a record or identity header outside the component.
 */
class RecordHeaderGuardTest {
    private val missing = "a record screen that does not draw its header through RecordHeader"
    private val copy = "a hand-rolled record header composable"

    private val recordScreens = setOf(
        "features/contacts/ContactDetailScreen.kt",
        "features/tasks/TaskDetailScreen.kt",
        "features/calls/CallDetailScreen.kt",
        "features/thread/ContactPanelSheet.kt",
        "features/thread/ThreadScreen.kt",
    )

    private val guard = PatternGuard(
        name = "RecordHeaderGuardTest",
        home = setOf("ui/common/RecordHeader.kt"),
        rules = listOf(
            GuardRule(missing) { s ->
                if (s.path in recordScreens && !s.text.contains("RecordHeader(")) 1 else 0
            },
            regexRule(copy, Regex("""\bfun\s+\w*(?:Record|Identity)Header\(""")),
        ),
        roster = listOf(
            GuardException(
                "features/thread/ThreadScreen.kt", missing, 1,
                "the thread's header is the screen's pill app bar (back, avatar, name and status, call, overflow), " +
                    "not a record panel; the contact's record header is ContactPanelSheet, one tap away",
            ),
        ),
    )

    @Test fun `G-0 the scan walked real source`() {
        guard.scansRealSource()
        val known = MainSourceScan.files.map { it.path }.toSet()
        val gone = recordScreens.filter { it !in known }
        org.junit.Assert.assertEquals("record screens that moved or were renamed", emptyList<String>(), gone)
    }
    @Test fun `G-1 no record screen outside the component draws its own header`() = guard.noUnlistedCopies()
    @Test fun `G-2 every named exception still matches`() = guard.rosterIsClosed()
    @Test fun `G-3 every exception gives a reason`() = guard.everyExceptionGivesAReason()
}
