package com.loonext.android.ui.common

import org.junit.Test

/**
 * #733: the small uppercase label over a group, a field or a list is
 * [SectionLabel] (or [SectionHeader] around it). Fails on a `Text(` that upper-cases
 * its string or sets positive letter spacing outside `Ds.kt`, unless the roster
 * says why that one is not a section label. A roster entry that no longer
 * matches fails too.
 */
class SectionLabelGuardTest {
    private val label = "hand-built section label"
    private val upper = Regex("""(?<!\bit)\.uppercase\(\)""")
    private val tracked = Regex("""letterSpacing\s*=\s*0?\.(?:[1-9]|0[5-9])""")

    private val guard = PatternGuard(
        name = "SectionLabelGuardTest",
        home = setOf("ui/common/Ds.kt"),
        rules = listOf(
            GuardRule(label) { source ->
                MainSourceScan.calls(source.text, "Text").count { upper.containsMatchIn(it) || tracked.containsMatchIn(it) }
            },
        ),
        roster = listOf(
            GuardException("features/calls/CallActivity.kt", label, 1, "The incoming-call eyebrow inside its own pill over the hero, not a label over a group."),
            GuardException("features/calls/CallKit.kt", label, 1, "The letters under a dial pad key (ABC, DEF), part of the key."),
            GuardException("features/calls/InCallScreen.kt", label, 1, "The note card's eyebrow, tinted with the card's accent."),
            GuardException("features/tasks/TaskCalendar.kt", label, 1, "A weekday initial over a calendar column, centred, not a group heading."),
            GuardException("features/tasks/TaskDetailScreen.kt", label, 1, "A note's author and time byline, the caption of one note."),
            GuardException("features/thread/MessageBubbles.kt", label, 1, "The centred day divider (TODAY) between messages, which heads no group of fields."),
            GuardException("ui/common/UrgentBadge.kt", label, 1, "The urgent badge's own word inside its filled pill."),
        ),
    )

    @Test fun `G-0 the scan walked real source`() = guard.scansRealSource()
    @Test fun `G-1 no hand-built section label outside the component`() = guard.noUnlistedCopies()
    @Test fun `G-2 every named exception still matches`() = guard.rosterIsClosed()
    @Test fun `G-3 every exception gives a reason`() = guard.everyExceptionGivesAReason()
}
