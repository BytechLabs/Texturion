package com.loonext.android.core.dashboard

/**
 * #540 — which queue the landing screen leads with.
 *
 * The hand-port of `packages/shared/src/dashboard-tiles.ts`, rule for rule. An
 * owner who learns that the most urgent queue is at the top on their laptop has
 * to find the same thing in the van; a phone that ordered its sections
 * differently would mean they had learned nothing.
 *
 * ## What this is expressed as here, and why it differs from web
 *
 * On web the order drives a strip of four tiles ACROSS the top, because
 * horizontal space is free there. On a 375dp screen four tiles are two rows of
 * chrome above the actual work, so the same decision orders the SECTIONS
 * instead — which is the thing the strip was only ever an index of.
 *
 * Same rule, same first answer to "what needs me first", expressed in the layout
 * each platform can afford. That is a deliberate asymmetry, not a gap.
 */
object DashboardTiles {

    /** The four queues a member can be behind on. Stable ids, not display order. */
    enum class Tile { UNASSIGNED, WAITING, TASKS, UNREAD }

    /**
     * When "waiting" becomes "waiting too long" — four hours.
     *
     * Not five minutes, which is #388's reply window and what the inbox itself
     * shouts about. This is the landing screen, answering the morning triage
     * question: anything from earlier today is ordinary, anything from before
     * lunch is a customer wondering whether they were heard.
     */
    const val AGED_MILLIS: Long = 4L * 60L * 60L * 1000L

    /** What makes a count worth looking at. */
    sealed interface Signal {
        /** Some are past their due date. The strongest signal there is. */
        data class Overdue(val count: Int) : Signal

        /** Nothing overdue, but the oldest has been waiting this long. */
        data class Oldest(val ageMillis: Long) : Signal
    }

    data class Row(val ageMillis: Long?, val overdue: Boolean)

    data class Input(
        val unassignedAges: List<Long>,
        val waiting: List<Row>,
        val tasks: List<Row>,
        val unreadAges: List<Long>,
    )

    data class Ordered(val tile: Tile, val count: Int, val signal: Signal?)

    private fun signalFor(ages: List<Long?>, overdueCount: Int): Signal? {
        if (overdueCount > 0) return Signal.Overdue(overdueCount)
        val oldest = ages.filterNotNull().maxOrNull() ?: return null
        return Signal.Oldest(oldest)
    }

    /**
     * How much attention a tile has earned, lower first.
     *
     * Coarse on purpose — overdue, then aged, then merely present, then empty —
     * because a queue order that reshuffles on a five-minute difference has moved
     * every time somebody looks at it, and then nobody can learn where anything
     * is.
     */
    private fun rank(entry: Ordered): Int = when {
        entry.count == 0 -> 3
        entry.signal is Signal.Overdue -> 0
        entry.signal is Signal.Oldest && entry.signal.ageMillis >= AGED_MILLIS -> 1
        else -> 2
    }

    /**
     * The four queues, in the order they should be read.
     *
     * The fallback is the declaration order below, which is the order the sections
     * have always appeared in — so with nothing to separate two queues, nothing
     * moves.
     */
    fun order(input: Input): List<Ordered> {
        val entries = listOf(
            // Nobody owns these, so nothing about them can be overdue TO a person.
            // Age is the whole signal: unclaimed work going stale is the failure,
            // and calling it overdue would imply somebody had already been asked.
            Ordered(
                Tile.UNASSIGNED,
                input.unassignedAges.size,
                signalFor(input.unassignedAges.map { it as Long? }, 0),
            ),
            Ordered(
                Tile.WAITING,
                input.waiting.size,
                signalFor(input.waiting.map { it.ageMillis }, input.waiting.count { it.overdue }),
            ),
            Ordered(
                Tile.TASKS,
                input.tasks.size,
                signalFor(input.tasks.map { it.ageMillis }, input.tasks.count { it.overdue }),
            ),
            Ordered(
                Tile.UNREAD,
                input.unreadAges.size,
                signalFor(input.unreadAges.map { it as Long? }, 0),
            ),
        )
        return entries
            .withIndex()
            .sortedWith(
                compareBy(
                    { rank(it.value) },
                    // AGE BREAKS A TIE ONLY AMONG TILES ALREADY AGED. Within rank 1
                    // everything is past four hours, so a swap means hours and is
                    // worth showing. Below it, "today, fine" is the same answer for
                    // all of them and the declaration order wins — sorting every
                    // rank by age is the reshuffling the paragraph above refuses.
                    {
                        if (rank(it.value) == 1) {
                            -((it.value.signal as? Signal.Oldest)?.ageMillis ?: 0L)
                        } else {
                            0L
                        }
                    },
                    { it.index },
                ),
            )
            .map { it.value }
    }
}
