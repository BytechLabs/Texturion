package com.loonext.android.core.dashboard

import java.io.File
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * #540 — which parts of the landing screen a member may put away.
 *
 * Two halves. The behaviour tests assert the rules; the parity tests read the
 * shared TypeScript, because this is a hand-port and nothing about Kotlin says
 * the original moved.
 */
class DashboardPanelsTest {

    @Test
    fun `nothing is hidden by default`() {
        // The other direction — an opt-in dashboard — means a new card is
        // invisible to every existing member forever, which is how a feature
        // ships to nobody.
        assertEquals(emptyList<DashboardPanels.Panel>(), DashboardPanels.normalise(emptyList()))
        for (panel in DashboardPanels.Panel.entries) {
            assertTrue(DashboardPanels.isVisible(emptyList(), panel))
        }
    }

    @Test
    fun `an id this build does not know is dropped, not an error`() {
        // A server ahead of this app, or a card we withdrew. The member gets a
        // working dashboard showing one panel they had put away — recoverable in
        // a tap — rather than a crash where their screen used to be.
        assertEquals(
            listOf(DashboardPanels.Panel.PIPELINE),
            DashboardPanels.normalise(listOf("pipeline", "crystal_ball")),
        )
    }

    @Test
    fun `duplicates collapse`() {
        assertEquals(
            listOf(DashboardPanels.Panel.PIPELINE),
            DashboardPanels.normalise(listOf("pipeline", "pipeline")),
        )
    }

    @Test
    fun `the order is the declared one, not the tapping order`() {
        assertEquals(
            listOf(DashboardPanels.Panel.RESPONSE_TIME, DashboardPanels.Panel.RECENT_CALLS),
            DashboardPanels.normalise(listOf("recent_calls", "response_time")),
        )
    }

    @Test
    fun `a hidden panel is not visible and its neighbours still are`() {
        val hidden = listOf("pipeline")
        assertFalse(DashboardPanels.isVisible(hidden, DashboardPanels.Panel.PIPELINE))
        assertTrue(DashboardPanels.isVisible(hidden, DashboardPanels.Panel.SATISFACTION))
    }

    @Test
    fun `every panel has a name and a reason`() {
        // A switch with no label is a switch nobody touches, and a name with no
        // reason is a guess for anybody who has not read both cards it could mean.
        for (panel in DashboardPanels.Panel.entries) {
            assertTrue(DashboardPanels.label(panel).length > 2)
            assertTrue(DashboardPanels.note(panel).endsWith("."))
        }
    }

    @Test
    fun `no queue section is offered as hideable`() {
        // THE LINE. Hiding unclaimed work is not a preference — it is a way to
        // stop seeing leads nobody has answered.
        val panelIds = DashboardPanels.Panel.entries.map { it.id }
        for (tile in DashboardTiles.Tile.entries) {
            assertFalse(
                "${tile.name} must never be hideable",
                panelIds.contains(tile.name.lowercase()),
            )
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
     * The same five ids, in the same order, as the shared module.
     *
     * These are STORED and sent to the server, so a drift here is not a cosmetic
     * difference — it is a phone writing a preference the Worker rejects, or
     * silently dropping one the laptop saved.
     */
    @Test
    fun `the panel ids match the shared module, in order`() {
        val shared = repoFile("packages/shared/src/dashboard-panels.ts")
        val declared = Regex("""export const DASHBOARD_PANEL_IDS = \[([^\]]+)\]""")
            .find(shared)
            ?.groupValues
            ?.get(1)
            ?: throw AssertionError("DASHBOARD_PANEL_IDS is no longer an array literal")
        val ids = Regex(""""([a-z_]+)"""").findAll(declared).map { it.groupValues[1] }.toList()
        assertEquals(ids, DashboardPanels.Panel.entries.map { it.id })
    }

    /**
     * And the labels match, because they are what a member reads.
     *
     * A crew comparing a laptop and a phone over a van bonnet is comparing these
     * exact words; "Lead sources" here against "Where customers came from" there
     * reads as two different settings.
     */
    @Test
    fun `the panel labels match the shared module`() {
        val shared = repoFile("packages/shared/src/dashboard-panels.ts")
        for (panel in DashboardPanels.Panel.entries) {
            val label = DashboardPanels.label(panel)
            assertTrue(
                "the label for ${panel.id} has drifted from the shared module: $label",
                shared.contains("${panel.id}: \"$label\""),
            )
        }
    }
}
