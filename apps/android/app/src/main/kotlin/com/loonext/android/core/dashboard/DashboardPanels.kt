package com.loonext.android.core.dashboard

/**
 * #540 — which parts of the landing screen a member is allowed to put away.
 *
 * The hand-port of `packages/shared/src/dashboard-panels.ts`. The set is stored
 * per membership on the server, so a member who takes the referral card off their
 * laptop finds it gone in the van too — a preference that only applied to one
 * device would be a preference somebody has to set twice and remembers as a bug.
 *
 * ## The line
 *
 * The measures come off. The QUEUE does not. Hiding "Unassigned" is not a
 * preference — it is a way to stop seeing leads nobody has claimed, and the first
 * time it matters the cost is a customer who texted and got nothing back. Work is
 * not decoration: you can finish it, but you cannot switch it off.
 *
 * ## And no manual reordering
 *
 * [DashboardTiles] now orders the queue by what has actually gone wrong. A
 * member-defined order would sit on top of that and put an overdue task
 * underneath "Unread", which is the exact defect the ordering was added to fix.
 */
object DashboardPanels {

    /** Stable ids — they are stored. Declaration order is the list's order. */
    enum class Panel(val id: String) {
        RESPONSE_TIME("response_time"),
        PIPELINE("pipeline"),
        SATISFACTION("satisfaction"),
        LEAD_SOURCES("lead_sources"),
        RECENT_CALLS("recent_calls"),
    }

    /**
     * What each panel is called where it can be turned off.
     *
     * The label has to be the heading shown on the screen, or the switch is a
     * guess.
     */
    fun label(panel: Panel): String = when (panel) {
        Panel.RESPONSE_TIME -> "Response time"
        Panel.PIPELINE -> "Pipeline"
        Panel.SATISFACTION -> "Satisfaction"
        Panel.LEAD_SOURCES -> "Where customers came from"
        Panel.RECENT_CALLS -> "Recent calls"
    }

    /**
     * One line saying what the panel is for.
     *
     * Somebody deciding whether to keep a panel is deciding about the QUESTION it
     * answers, and four headings alone do not distinguish "Pipeline" from
     * "Response time" for anybody who has not read both cards.
     */
    fun note(panel: Panel): String = when (panel) {
        Panel.RESPONSE_TIME -> "How fast new customers got an answer this week."
        Panel.PIPELINE -> "What is quoted, booked, and waiting on a decision."
        Panel.SATISFACTION -> "Whether the people you answered were happy."
        Panel.LEAD_SOURCES -> "Which channels are actually bringing work in."
        Panel.RECENT_CALLS -> "The last few calls, in and out."
    }

    /**
     * Clean a stored set into something safe to render from.
     *
     * Unknown ids are DROPPED rather than treated as an error, and that direction
     * is deliberate: an id this build has never heard of — a renamed card, a
     * server ahead of this app — should give the member a working dashboard, not a
     * broken one. Dropping an id shows them a panel they had put away, which they
     * can put away again.
     *
     * Duplicates collapse, and the result is in declaration order so the value
     * does not depend on which order somebody happened to tap.
     */
    fun normalise(hidden: List<String>): List<Panel> {
        val byId = Panel.entries.associateBy { it.id }
        val set = hidden.mapNotNull { byId[it] }.toSet()
        return Panel.entries.filter { it in set }
    }

    /** Is this panel on the screen? The question every call site actually asks. */
    fun isVisible(hidden: List<String>, panel: Panel): Boolean =
        !normalise(hidden).contains(panel)
}
