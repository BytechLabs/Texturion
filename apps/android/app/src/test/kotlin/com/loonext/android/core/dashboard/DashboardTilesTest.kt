package com.loonext.android.core.dashboard

import java.io.File
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * #540 — the landing screen leads with the queue that needs doing first.
 *
 * Two halves. The behaviour tests below assert the rules; the parity test reads
 * the shared TypeScript, because this is a hand-port and nothing about Kotlin says
 * the original moved.
 */
class DashboardTilesTest {

    private val minute = 60_000L
    private val hour = 60 * minute

    private val empty = DashboardTiles.Input(
        unassignedAges = emptyList(),
        waiting = emptyList(),
        tasks = emptyList(),
        unreadAges = emptyList(),
    )

    private fun order(input: DashboardTiles.Input) =
        DashboardTiles.order(input).map { it.tile }

    @Test
    fun `an overdue task leads, whatever the reading order says`() {
        // The complaint this fixes: the order never changed, so the most urgent
        // thing sat wherever its section happened to be written.
        val result = order(
            empty.copy(
                unreadAges = listOf(5 * minute),
                tasks = listOf(DashboardTiles.Row(2 * hour, overdue = true)),
            ),
        )
        assertEquals(DashboardTiles.Tile.TASKS, result.first())
    }

    @Test
    fun `a stale queue beats a busier fresh one`() {
        // Count is not urgency. Twelve unread from five minutes ago is an ordinary
        // morning; one thread waiting since yesterday is a customer wondering
        // whether anybody read it.
        val result = order(
            empty.copy(
                unreadAges = List(12) { 5 * minute },
                waiting = listOf(DashboardTiles.Row(26 * hour, overdue = false)),
            ),
        )
        assertEquals(DashboardTiles.Tile.WAITING, result.first())
    }

    @Test
    fun `two fresh queues do not shuffle`() {
        // A minute between them must not swap them, or the screen has rearranged
        // every time somebody looked at it.
        val a = order(
            empty.copy(
                waiting = listOf(DashboardTiles.Row(30 * minute, overdue = false)),
                unreadAges = listOf(31 * minute),
            ),
        )
        val b = order(
            empty.copy(
                waiting = listOf(DashboardTiles.Row(32 * minute, overdue = false)),
                unreadAges = listOf(31 * minute),
            ),
        )
        assertEquals(listOf(DashboardTiles.Tile.WAITING, DashboardTiles.Tile.UNREAD), a.take(2))
        assertEquals(listOf(DashboardTiles.Tile.WAITING, DashboardTiles.Tile.UNREAD), b.take(2))
    }

    @Test
    fun `empty queues keep their place at the end`() {
        val result = order(empty.copy(unreadAges = listOf(10 * minute)))
        assertEquals(4, result.size)
        assertEquals(DashboardTiles.Tile.UNREAD, result.first())
    }

    @Test
    fun `nothing happening leaves the declared order alone`() {
        assertEquals(
            listOf(
                DashboardTiles.Tile.UNASSIGNED,
                DashboardTiles.Tile.WAITING,
                DashboardTiles.Tile.TASKS,
                DashboardTiles.Tile.UNREAD,
            ),
            order(empty),
        )
    }

    @Test
    fun `unassigned work is never called overdue`() {
        // Nobody owns it, so it cannot be late to a person.
        val entry = DashboardTiles.order(empty.copy(unassignedAges = listOf(40 * hour)))
            .first { it.tile == DashboardTiles.Tile.UNASSIGNED }
        assertEquals(DashboardTiles.Signal.Oldest(40 * hour), entry.signal)
    }

    @Test
    fun `a task with no due date cannot be overdue`() {
        val entry = DashboardTiles.order(
            empty.copy(
                tasks = listOf(
                    DashboardTiles.Row(null, overdue = false),
                    DashboardTiles.Row(2 * hour, overdue = false),
                ),
            ),
        ).first { it.tile == DashboardTiles.Tile.TASKS }
        assertEquals(2, entry.count)
        assertEquals(DashboardTiles.Signal.Oldest(2 * hour), entry.signal)
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
     * The four-hour line is the same number on both clients.
     *
     * It is the one value a crew would notice differing — the point at which the
     * screen decides a queue has gone stale — so it is read out of the shared
     * module rather than pinned twice and left to drift.
     */
    @Test
    fun `the aged threshold matches the shared module`() {
        val shared = repoFile("packages/shared/src/dashboard-tiles.ts")
        assertTrue(
            "AGED_MILLIS has drifted from packages/shared/src/dashboard-tiles.ts",
            shared.contains("export const AGED_MILLIS = 4 * 60 * 60 * 1000"),
        )
        assertEquals(4L * 60L * 60L * 1000L, DashboardTiles.AGED_MILLIS)
    }

    /** And the four queues are the same four, in the same declared order. */
    @Test
    fun `the tile ids match the shared module, in order`() {
        val shared = repoFile("packages/shared/src/dashboard-tiles.ts")
        val declared = Regex("""export type DashboardTileId =([^;]+);""")
            .find(shared)
            ?.groupValues
            ?.get(1)
            ?: throw AssertionError("DashboardTileId is no longer a union in the shared module")
        val ids = Regex(""""([a-z]+)"""").findAll(declared).map { it.groupValues[1] }.toList()
        assertEquals(listOf("unassigned", "waiting", "tasks", "unread"), ids)
        assertEquals(
            ids.map { it.uppercase() },
            order(empty).map { it.name },
        )
    }
}
