import Foundation

/// #540 — which parts of the landing screen a member is allowed to put away.
///
/// The hand-port of `packages/shared/src/dashboard-panels.ts`, and the third copy
/// after `core/dashboard/DashboardPanels.kt`. The set is stored per membership on
/// the server, so a member who takes the referral card off their laptop finds it
/// gone in the van too — a preference that applied to one device only would be a
/// preference somebody has to set twice and remembers as a bug.
///
/// ## The line
///
/// The measures come off. The QUEUE does not. Hiding "Unassigned" is not a
/// preference — it is a way to stop seeing leads nobody has claimed, and the first
/// time it matters the cost is a customer who texted and got nothing back. Work is
/// not decoration: you can finish it, but you cannot switch it off.
///
/// ## And no manual reordering
///
/// `DashboardTiles` orders the queue by what has actually gone wrong. A
/// member-defined order would sit on top of that and put an overdue task
/// underneath "Unread", which is the exact defect the ordering was added to fix.
enum DashboardPanels {

    /// Stable ids — they are stored. Declaration order is the list's order.
    enum Panel: String, CaseIterable, Identifiable {
        case responseTime = "response_time"
        case pipeline
        case satisfaction
        case leadSources = "lead_sources"
        case recentCalls = "recent_calls"

        var id: String { rawValue }
    }

    /// What each panel is called where it can be turned off.
    ///
    /// The label has to be the heading shown on the screen, or the switch is a
    /// guess.
    static func label(_ panel: Panel) -> String {
        switch panel {
        case .responseTime: return "Response time"
        case .pipeline: return "Pipeline"
        case .satisfaction: return "Satisfaction"
        case .leadSources: return "Where customers came from"
        case .recentCalls: return "Recent calls"
        }
    }

    /// One line saying what the panel is for.
    ///
    /// Somebody deciding whether to keep a panel is deciding about the QUESTION it
    /// answers, and four headings alone do not distinguish "Pipeline" from
    /// "Response time" for anybody who has not read both cards.
    static func note(_ panel: Panel) -> String {
        switch panel {
        case .responseTime: return "How fast new customers got an answer this week."
        case .pipeline: return "What is quoted, booked, and waiting on a decision."
        case .satisfaction: return "Whether the people you answered were happy."
        case .leadSources: return "Which channels are actually bringing work in."
        case .recentCalls: return "The last few calls, in and out."
        }
    }

    /// Clean a stored set into something safe to render from.
    ///
    /// Unknown ids are DROPPED rather than treated as an error, and that direction
    /// is deliberate: an id this build has never heard of — a renamed card, a
    /// server ahead of this app — should give the member a working dashboard, not a
    /// broken one. Dropping an id shows them a panel they had put away, which they
    /// can put away again.
    ///
    /// Duplicates collapse, and the result is in declaration order so the value
    /// does not depend on which order somebody happened to tap.
    static func normalise(_ hidden: [String]) -> [Panel] {
        let set = Set(hidden.compactMap(Panel.init(rawValue:)))
        return Panel.allCases.filter { set.contains($0) }
    }

    /// Is this panel on the screen? The question every call site actually asks.
    static func isVisible(_ hidden: [String], _ panel: Panel) -> Bool {
        !normalise(hidden).contains(panel)
    }
}
