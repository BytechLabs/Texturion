package com.loonext.android.core.dashboard

import com.loonext.android.core.i18n.AppStrings
import kotlinx.serialization.Serializable

/**
 * #736: the For you page as panels a member arranges: which ones, in what order,
 * and how wide.
 *
 * The hand-port of `packages/shared/src/dashboard-layout.ts`, minus `placePanels`:
 * a phone is one column, so the stored width is kept and sent back but does not
 * change what is drawn.
 *
 * The ids and sizes are STORED and sent to the Worker, so a drift is a phone
 * writing a layout the Worker drops, or dropping one the laptop saved.
 */
object DashboardLayouts {

    /** Stable ids, in catalogue order: what "Add a panel" offers. */
    val PANEL_IDS: List<String> = listOf(
        "follow_ups",
        "unassigned",
        "waiting",
        "tasks",
        "unread",
        "outstanding_quotes",
        "recent_calls",
        "response_time",
        "pipeline",
        "satisfaction",
        "lead_sources",
    )

    /** Work owed to a customer. Off the page, it still leaves a line saying what waits. */
    val QUEUE_IDS: List<String> = listOf("follow_ups", "unassigned", "waiting", "tasks", "unread")

    val SIZES: List<String> = listOf("third", "two_thirds", "full")

    private val MEASURES = listOf("response_time", "pipeline", "satisfaction", "lead_sources")

    private val QUEUE_FOR_TILE = mapOf(
        DashboardTiles.Tile.UNASSIGNED to "unassigned",
        DashboardTiles.Tile.WAITING to "waiting",
        DashboardTiles.Tile.TASKS to "tasks",
        DashboardTiles.Tile.UNREAD to "unread",
    )

    /**
     * The page nobody has arranged: the measures, then "Chase these", then the
     * queues in urgency order with the first one wide, then quotes and calls.
     */
    fun default(queueOrder: List<DashboardTiles.Tile>): DashboardLayout = DashboardLayout(
        MEASURES.map { LayoutEntry(it, "third") } +
            LayoutEntry("follow_ups", "two_thirds") +
            queueOrder.mapIndexed { index, tile ->
                LayoutEntry(QUEUE_FOR_TILE.getValue(tile), if (index == 0) "two_thirds" else "third")
            } +
            LayoutEntry("outstanding_quotes", "two_thirds") +
            LayoutEntry("recent_calls", "third"),
    )

    /**
     * A stored layout made safe to render. Unknown panels, repeats and bad sizes
     * are dropped rather than refused, so a layout from a newer client still
     * draws.
     */
    fun normalise(raw: DashboardLayout?): DashboardLayout? {
        if (raw == null) return null
        val seen = HashSet<String>()
        val clean = ArrayList<LayoutEntry>()
        for (entry in raw.panels) {
            if (entry.id !in PANEL_IDS || !seen.add(entry.id)) continue
            clean += LayoutEntry(entry.id, if (entry.size in SIZES) entry.size else "third")
        }
        return DashboardLayout(clean)
    }

    /** The panels a layout leaves off, in catalogue order. */
    fun notInLayout(layout: DashboardLayout): List<String> {
        val on = layout.panels.map { it.id }.toSet()
        return PANEL_IDS.filter { it !in on }
    }

    /** Third, then two thirds, then full, then back. */
    fun nextSize(size: String): String = SIZES[(SIZES.indexOf(size) + 1) % SIZES.size]

    /** Moves a panel `delta` places, stopping at either end. */
    fun move(layout: DashboardLayout, id: String, delta: Int): DashboardLayout {
        val from = layout.panels.indexOfFirst { it.id == id }
        if (from == -1) return layout
        val to = (from + delta).coerceIn(0, layout.panels.size - 1)
        if (to == from) return layout
        val panels = layout.panels.toMutableList()
        val entry = panels.removeAt(from)
        panels.add(to, entry)
        return DashboardLayout(panels)
    }

    /** Puts a panel where the target stood. */
    fun moveTo(layout: DashboardLayout, id: String, target: String): DashboardLayout {
        val to = layout.panels.indexOfFirst { it.id == target }
        val from = layout.panels.indexOfFirst { it.id == id }
        if (to == -1 || from == -1) return layout
        return move(layout, id, to - from)
    }

    fun resize(layout: DashboardLayout, id: String, size: String): DashboardLayout =
        DashboardLayout(layout.panels.map { if (it.id == id) it.copy(size = size) else it })

    fun remove(layout: DashboardLayout, id: String): DashboardLayout =
        DashboardLayout(layout.panels.filter { it.id != id })

    /** Adds at the end, a third wide; a panel already on the page stays where it is. */
    fun add(layout: DashboardLayout, id: String): DashboardLayout =
        if (layout.panels.any { it.id == id }) layout
        else DashboardLayout(layout.panels + LayoutEntry(id, "third"))

    /**
     * The five panels the #540 hidden set can name. A hideable panel in that set
     * is not shown even when the layout lists it, and the phones and the laptop
     * keep the two in step.
     */
    fun isHideable(id: String): Boolean = DashboardPanels.Panel.entries.any { it.id == id }

    fun isHidden(hidden: List<String>, id: String): Boolean =
        isHideable(id) && hidden.contains(id)

    fun label(id: String, locale: String? = null): String =
        AppStrings.translate(locale, LABEL_KEYS[id] ?: "inbox.forYouTitle")

    fun note(id: String, locale: String? = null): String =
        AppStrings.translate(locale, NOTE_KEYS[id] ?: "inbox.forYouTitle")

    fun sizeLabel(size: String, locale: String? = null): String = AppStrings.translate(
        locale,
        when (size) {
            "full" -> "inbox.forYouSizeFull"
            "two_thirds" -> "inbox.forYouSizeTwoThirds"
            else -> "inbox.forYouSizeThird"
        },
    )

    val LABEL_KEYS: Map<String, String> = mapOf(
        "follow_ups" to "inbox.forYouSectionChaseThese",
        "unassigned" to "inbox.forYouSectionUnassigned",
        "waiting" to "inbox.forYouSectionWaiting",
        "tasks" to "inbox.forYouSectionTasks",
        "unread" to "inbox.forYouSectionUnread",
        "outstanding_quotes" to "quotes.outstandingTitle",
        "recent_calls" to "domain.panelRecentCalls",
        "response_time" to "domain.panelResponseTime",
        "pipeline" to "domain.panelPipeline",
        "satisfaction" to "domain.panelSatisfaction",
        "lead_sources" to "domain.panelLeadSources",
    )

    val NOTE_KEYS: Map<String, String> = mapOf(
        "follow_ups" to "inbox.forYouPanelNoteFollowUps",
        "unassigned" to "inbox.forYouPanelNoteUnassigned",
        "waiting" to "inbox.forYouPanelNoteWaiting",
        "tasks" to "inbox.forYouPanelNoteTasks",
        "unread" to "inbox.forYouPanelNoteUnread",
        "outstanding_quotes" to "inbox.forYouPanelNoteQuotes",
        "recent_calls" to "domain.panelRecentCallsNote",
        "response_time" to "domain.panelResponseTimeNote",
        "pipeline" to "domain.panelPipelineNote",
        "satisfaction" to "domain.panelSatisfactionNote",
        "lead_sources" to "domain.panelLeadSourcesNote",
    )
}

@Serializable
data class LayoutEntry(val id: String, val size: String = "third")

@Serializable
data class DashboardLayout(val panels: List<LayoutEntry> = emptyList())

@Serializable
data class DashboardLayoutReply(val layout: DashboardLayout? = null)
