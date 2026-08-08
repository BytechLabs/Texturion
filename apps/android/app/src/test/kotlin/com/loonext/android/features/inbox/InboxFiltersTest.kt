package com.loonext.android.features.inbox

import java.io.File
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * #548 — which dimensions the inbox is arranged by, and that this phone agrees
 * with the laptop about it.
 *
 * Two halves. The behaviour tests assert the rule; the parity test reads
 * `packages/shared/src/inbox-filters.ts`, because this is a hand-port and nothing
 * about Kotlin says the original stayed put.
 *
 * The bug this file exists for: the predicate used to live here as
 * `hasFilterChips` and it excluded the status segment, so the sheet's Reset — drawn
 * directly above a Status section — was a control that gave a haptic and did
 * nothing.
 */
class InboxFiltersTest {

    private fun home(
        segment: String? = null,
        assignedToMe: Boolean = false,
        assigneeUserId: String? = null,
        tagId: String? = null,
        unreadOnly: Boolean = false,
        spamOnly: Boolean = false,
        snoozedOnly: Boolean = false,
        awaitingOnly: Boolean = false,
    ) = InboxFilterState(
        segment = segment,
        assignedToMe = assignedToMe,
        assigneeUserId = assigneeUserId,
        tagId = tagId,
        unreadOnly = unreadOnly,
        spamOnly = spamOnly,
        snoozedOnly = snoozedOnly,
        awaitingOnly = awaitingOnly,
    )

    @Test
    fun `nothing is filtered on the home view`() {
        assertFalse(isInboxFiltered(home()))
        assertEquals(emptyList<InboxFilterDimension>(), activeInboxFilters(home()))
    }

    @Test
    fun `the status segment counts, which is the whole bug`() {
        // Select Closed, press Reset, get a haptic and nothing else. That was #548.
        assertTrue(isInboxFiltered(home(segment = "closed")))
        assertEquals(
            listOf(InboxFilterDimension.SEGMENT),
            activeInboxFilters(home(segment = "closed")),
        )
    }

    @Test
    fun `Mine counts as the segment moving, with no separate assignee`() {
        val mine = home(assignedToMe = true)
        assertTrue(isInboxFiltered(mine))
        assertEquals(listOf(InboxFilterDimension.SEGMENT), activeInboxFilters(mine))
    }

    @Test
    fun `Mine subsumes a named assignee rather than counting both`() {
        // The request sends the viewer's own id and drops the named one, and the
        // sheet hides the assignee section while Mine is lit — so counting it is
        // how an empty Mine tab blamed a filter with nothing to un-set.
        assertEquals(
            listOf(InboxFilterDimension.SEGMENT),
            activeInboxFilters(home(assignedToMe = true, assigneeUserId = "u-2")),
        )
    }

    @Test
    fun `each chip counts on its own`() {
        assertEquals(
            listOf(InboxFilterDimension.ASSIGNEE),
            activeInboxFilters(home(assigneeUserId = "u-2")),
        )
        assertEquals(listOf(InboxFilterDimension.TAG), activeInboxFilters(home(tagId = "t-1")))
        assertEquals(
            listOf(InboxFilterDimension.UNREAD),
            activeInboxFilters(home(unreadOnly = true)),
        )
        assertEquals(listOf(InboxFilterDimension.SPAM), activeInboxFilters(home(spamOnly = true)))
        assertEquals(
            listOf(InboxFilterDimension.SNOOZED),
            activeInboxFilters(home(snoozedOnly = true)),
        )
        assertEquals(
            listOf(InboxFilterDimension.AWAITING),
            activeInboxFilters(home(awaitingOnly = true)),
        )
    }

    @Test
    fun `everything at once, in the declared order`() {
        assertEquals(
            listOf(
                InboxFilterDimension.SEGMENT,
                InboxFilterDimension.ASSIGNEE,
                InboxFilterDimension.TAG,
                InboxFilterDimension.UNREAD,
                InboxFilterDimension.SPAM,
                InboxFilterDimension.SNOOZED,
                InboxFilterDimension.AWAITING,
            ),
            activeInboxFilters(
                home(
                    segment = "all",
                    assigneeUserId = "u-2",
                    tagId = "t-1",
                    unreadOnly = true,
                    spamOnly = true,
                    snoozedOnly = true,
                    awaitingOnly = true,
                ),
            ),
        )
    }

    @Test
    fun `the segment alone is not a SECONDARY filter`() {
        // So the empty state keeps its better per-tab sentence: "No closed
        // conversations" beats "Nothing matches these filters" for somebody who
        // selected one tab and nothing else.
        assertFalse(hasSecondaryInboxFilters(home(segment = "closed")))
        assertFalse(hasSecondaryInboxFilters(home(assignedToMe = true)))
        assertTrue(hasSecondaryInboxFilters(home(segment = "closed", tagId = "t-1")))
    }

    @Test
    fun `secondary filters always imply something is filtered`() {
        // The property that makes one list better than two predicates.
        val states = listOf(
            home(),
            home(segment = "closed"),
            home(unreadOnly = true),
            home(assignedToMe = true, assigneeUserId = "u-2"),
            home(segment = "all", tagId = "t-1", spamOnly = true),
        )
        for (state in states) {
            if (hasSecondaryInboxFilters(state)) assertTrue(isInboxFiltered(state))
        }
    }

    // ---------------------------------------------------- against the original

    private fun repoFile(relative: String): String {
        var dir: File? = File("").absoluteFile
        while (dir != null) {
            val candidate = File(dir, relative)
            if (candidate.exists()) return candidate.readText()
            dir = dir.parentFile
        }
        throw AssertionError("$relative not found from ${File("").absolutePath}")
    }

    /**
     * The same seven dimensions, in the same order, as the shared module.
     *
     * Order is asserted rather than membership alone: [activeInboxFilters] returns
     * a list, and a client rendering "arranged by" chips from it would show them in
     * a different order from the laptop if the two drifted.
     */
    @Test
    fun `the dimensions match the shared module, in order`() {
        val shared = repoFile("packages/shared/src/inbox-filters.ts")
        val declared = Regex("""INBOX_FILTER_DIMENSIONS = \[([^\]]+)\]""")
            .find(shared)
            ?.groupValues
            ?.get(1)
            ?: throw AssertionError("INBOX_FILTER_DIMENSIONS is no longer an array literal")
        val names = Regex(""""([a-z_]+)"""").findAll(declared)
            .map { it.groupValues[1].uppercase() }
            .toList()
        assertEquals(names, InboxFilterDimension.entries.map { it.name })
    }

    /**
     * And that the shared module still masks the assignee under Mine.
     *
     * A grep rather than a second implementation: this is the one rule in the file
     * whose absence would be invisible in a boolean, because both answers are
     * "filtered" — only the LIST differs, and only the empty-state copy reads it.
     */
    @Test
    fun `the shared module still subsumes a named assignee under Mine`() {
        val shared = repoFile("packages/shared/src/inbox-filters.ts")
        assertTrue(
            "the Mine-subsumes-assignee guard has gone from the shared module",
            shared.contains("!state.assignedToMe && state.assigneeUserId !== null"),
        )
    }
}
