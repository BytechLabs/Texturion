package com.loonext.android.core.dashboard

import java.io.File
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertSame
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * #736: the For you layout model, against `packages/shared/src/dashboard-layout.ts`
 * and its test. The ids and sizes are stored and sent to the Worker, so the
 * parity tests read the shared module rather than trusting a copy.
 */
class DashboardLayoutsTest {

    private fun layout(vararg entries: Pair<String, String>) =
        DashboardLayout(entries.map { LayoutEntry(it.first, it.second) })

    private val base = layout(
        "unassigned" to "two_thirds",
        "waiting" to "third",
        "recent_calls" to "third",
    )

    private fun ids(l: DashboardLayout) = l.panels.map { it.id }

    @Test
    fun `drops unknown panels, repeats and bad sizes rather than refusing the layout`() {
        val clean = DashboardLayouts.normalise(
            layout(
                "recent_calls" to "full",
                "recent_calls" to "third",
                "a_panel_from_the_future" to "third",
                "pipeline" to "enormous",
            ),
        )
        assertEquals(layout("recent_calls" to "full", "pipeline" to "third"), clean)
        assertNull(DashboardLayouts.normalise(null))
    }

    @Test
    fun `starts with every panel on the page, the most urgent queue wide`() {
        val l = DashboardLayouts.default(
            listOf(
                DashboardTiles.Tile.WAITING,
                DashboardTiles.Tile.UNASSIGNED,
                DashboardTiles.Tile.TASKS,
                DashboardTiles.Tile.UNREAD,
            ),
        )
        assertEquals(emptyList<String>(), DashboardLayouts.notInLayout(l))
        assertEquals(DashboardLayouts.PANEL_IDS.sorted(), ids(l).sorted())
        assertEquals("two_thirds", l.panels.first { it.id == "waiting" }.size)
        assertEquals("third", l.panels.first { it.id == "unassigned" }.size)
        // Measures first, then chase, then queues, then quotes and calls.
        assertEquals(
            listOf(
                "response_time", "pipeline", "satisfaction", "lead_sources", "follow_ups",
                "waiting", "unassigned", "tasks", "unread", "outstanding_quotes", "recent_calls",
            ),
            ids(l),
        )
    }

    @Test
    fun `moves a panel through the order and stops at the ends`() {
        assertEquals(
            listOf("unassigned", "recent_calls", "waiting"),
            ids(DashboardLayouts.move(base, "recent_calls", -1)),
        )
        assertSame(base, DashboardLayouts.move(base, "unassigned", -1))
        assertEquals(
            listOf("waiting", "recent_calls", "unassigned"),
            ids(DashboardLayouts.move(base, "unassigned", 9)),
        )
        assertSame(base, DashboardLayouts.move(base, "pipeline", 1))
    }

    @Test
    fun `drops a panel where the target stood`() {
        assertEquals(
            listOf("recent_calls", "unassigned", "waiting"),
            ids(DashboardLayouts.moveTo(base, "recent_calls", "unassigned")),
        )
    }

    @Test
    fun `cycles width, removes, and adds at the end without doubling`() {
        assertEquals("two_thirds", DashboardLayouts.nextSize("third"))
        assertEquals("third", DashboardLayouts.nextSize("full"))
        assertEquals(
            LayoutEntry("waiting", "full"),
            DashboardLayouts.resize(base, "waiting", "full").panels[1],
        )
        val without = DashboardLayouts.remove(base, "waiting")
        assertEquals(listOf("unassigned", "recent_calls"), ids(without))
        assertEquals(
            listOf("unassigned", "recent_calls", "waiting"),
            ids(DashboardLayouts.add(without, "waiting")),
        )
        assertEquals(LayoutEntry("waiting", "third"), DashboardLayouts.add(without, "waiting").panels.last())
        assertSame(base, DashboardLayouts.add(base, "waiting"))
    }

    @Test
    fun `a hideable panel in the hidden set is hidden, a queue never is`() {
        assertTrue(DashboardLayouts.isHidden(listOf("pipeline"), "pipeline"))
        assertTrue(!DashboardLayouts.isHidden(listOf("waiting"), "waiting"))
        for (queue in DashboardLayouts.QUEUE_IDS) {
            assertTrue(!DashboardLayouts.isHideable(queue))
        }
    }

    @Test
    fun `every panel has a name and a note in both languages`() {
        for (id in DashboardLayouts.PANEL_IDS) {
            for (locale in listOf(null, "fr")) {
                assertTrue(DashboardLayouts.label(id, locale).length > 2)
                assertTrue(DashboardLayouts.note(id, locale).endsWith("."))
            }
        }
        for (size in DashboardLayouts.SIZES) {
            assertTrue(DashboardLayouts.sizeLabel(size).length > 2)
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

    private fun sharedList(name: String): List<String> {
        val shared = repoFile("packages/shared/src/dashboard-layout.ts")
        val body = Regex("""export const $name\s*(?::[^=]+)?=\s*\[([^\]]+)\]""")
            .find(shared)
            ?.groupValues
            ?.get(1)
            ?: throw AssertionError("$name is no longer an array literal")
        return Regex(""""([a-z_]+)"""").findAll(body).map { it.groupValues[1] }.toList()
    }

    @Test
    fun `the panel ids match the shared module, in order`() {
        assertEquals(sharedList("LAYOUT_PANEL_IDS"), DashboardLayouts.PANEL_IDS)
    }

    @Test
    fun `the sizes match the shared module, in order`() {
        assertEquals(sharedList("PANEL_SIZES"), DashboardLayouts.SIZES)
    }

    @Test
    fun `the queue panels match the shared module`() {
        assertEquals(sharedList("QUEUE_PANEL_IDS"), DashboardLayouts.QUEUE_IDS)
    }

    @Test
    fun `every hideable panel is a layout panel`() {
        for (panel in DashboardPanels.Panel.entries) {
            assertTrue(panel.id in DashboardLayouts.PANEL_IDS)
        }
    }
}
