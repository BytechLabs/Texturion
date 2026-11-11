import Foundation

/// #736: the For you page as panels a member arranges: which ones, in what
/// order, and how wide.
///
/// The hand-port of `packages/shared/src/dashboard-layout.ts`, minus
/// `placePanels`: a phone is one column, so the stored width is kept and sent
/// back but does not change what is drawn.
///
/// The ids and sizes are STORED and sent to the Worker, so a drift is a phone
/// writing a layout the Worker drops, or dropping one the laptop saved.
struct DashboardLayoutEntry: Codable, Sendable, Equatable, Identifiable {
    let id: String
    var size: String
}

struct DashboardLayout: Codable, Sendable, Equatable {
    var panels: [DashboardLayoutEntry]
}

enum DashboardLayouts {

    /// Stable ids, in catalogue order: what "Add a panel" offers.
    static let panelIds: [String] = [
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
    ]

    /// Work owed to a customer. Off the page, it still leaves a line saying
    /// what waits.
    static let queueIds: [String] = ["follow_ups", "unassigned", "waiting", "tasks", "unread"]

    static let sizes: [String] = ["third", "two_thirds", "full"]

    private static let measures: [String] = [
        "response_time", "pipeline", "satisfaction", "lead_sources",
    ]

    private static func queueId(for tile: DashboardTiles.Tile) -> String {
        switch tile {
        case .unassigned: return "unassigned"
        case .waiting: return "waiting"
        case .tasks: return "tasks"
        case .unread: return "unread"
        }
    }

    /// The page nobody has arranged: the measures, then "Chase these", then the
    /// queues in urgency order with the first one wide, then quotes and calls.
    static func defaultLayout(queueOrder: [DashboardTiles.Tile]) -> DashboardLayout {
        var panels: [DashboardLayoutEntry] = measures.map {
            DashboardLayoutEntry(id: $0, size: "third")
        }
        panels.append(DashboardLayoutEntry(id: "follow_ups", size: "two_thirds"))
        for (index, tile) in queueOrder.enumerated() {
            panels.append(
                DashboardLayoutEntry(
                    id: queueId(for: tile),
                    size: index == 0 ? "two_thirds" : "third"
                )
            )
        }
        panels.append(DashboardLayoutEntry(id: "outstanding_quotes", size: "two_thirds"))
        panels.append(DashboardLayoutEntry(id: "recent_calls", size: "third"))
        return DashboardLayout(panels: panels)
    }

    /// A stored layout made safe to render. Unknown panels, repeats and bad
    /// sizes are dropped rather than refused, so a layout from a newer client
    /// still draws.
    static func normalise(_ raw: DashboardLayout?) -> DashboardLayout? {
        guard let raw else { return nil }
        var seen = Set<String>()
        var clean: [DashboardLayoutEntry] = []
        for entry in raw.panels {
            guard panelIds.contains(entry.id), !seen.contains(entry.id) else { continue }
            seen.insert(entry.id)
            clean.append(
                DashboardLayoutEntry(
                    id: entry.id,
                    size: sizes.contains(entry.size) ? entry.size : "third"
                )
            )
        }
        return DashboardLayout(panels: clean)
    }

    /// The panels a layout leaves off, in catalogue order.
    static func notInLayout(_ layout: DashboardLayout) -> [String] {
        let on = Set(layout.panels.map(\.id))
        return panelIds.filter { !on.contains($0) }
    }

    /// Third, then two thirds, then full, then back.
    static func nextSize(_ size: String) -> String {
        let index = sizes.firstIndex(of: size) ?? -1
        return sizes[(index + 1) % sizes.count]
    }

    /// Moves a panel `delta` places, stopping at either end.
    static func move(_ layout: DashboardLayout, id: String, delta: Int) -> DashboardLayout {
        guard let from = layout.panels.firstIndex(where: { $0.id == id }) else { return layout }
        let to = min(layout.panels.count - 1, max(0, from + delta))
        if to == from { return layout }
        var panels = layout.panels
        let entry = panels.remove(at: from)
        panels.insert(entry, at: to)
        return DashboardLayout(panels: panels)
    }

    /// Puts a panel where the target stood.
    static func moveTo(_ layout: DashboardLayout, id: String, target: String) -> DashboardLayout {
        guard let to = layout.panels.firstIndex(where: { $0.id == target }),
              let from = layout.panels.firstIndex(where: { $0.id == id })
        else { return layout }
        return move(layout, id: id, delta: to - from)
    }

    static func resize(_ layout: DashboardLayout, id: String, size: String) -> DashboardLayout {
        DashboardLayout(
            panels: layout.panels.map {
                $0.id == id ? DashboardLayoutEntry(id: $0.id, size: size) : $0
            }
        )
    }

    static func remove(_ layout: DashboardLayout, id: String) -> DashboardLayout {
        DashboardLayout(panels: layout.panels.filter { $0.id != id })
    }

    /// Adds at the end, a third wide; a panel already on the page stays where
    /// it is.
    static func add(_ layout: DashboardLayout, id: String) -> DashboardLayout {
        if layout.panels.contains(where: { $0.id == id }) { return layout }
        return DashboardLayout(panels: layout.panels + [DashboardLayoutEntry(id: id, size: "third")])
    }

    /// The five panels the #540 hidden set can name. A hideable panel in that
    /// set is not shown even when the layout lists it.
    static func isHideable(_ id: String) -> Bool {
        DashboardPanels.Panel(rawValue: id) != nil
    }

    static func isHidden(_ hidden: [String], _ id: String) -> Bool {
        isHideable(id) && hidden.contains(id)
    }

    static func label(_ id: String, locale: String? = nil) -> String {
        AppStrings.translate(locale, labelKeys[id] ?? "inbox.forYouTitle")
    }

    static func note(_ id: String, locale: String? = nil) -> String {
        AppStrings.translate(locale, noteKeys[id] ?? "inbox.forYouTitle")
    }

    static func sizeLabel(_ size: String, locale: String? = nil) -> String {
        let key: String
        switch size {
        case "full": key = "inbox.forYouSizeFull"
        case "two_thirds": key = "inbox.forYouSizeTwoThirds"
        default: key = "inbox.forYouSizeThird"
        }
        return AppStrings.translate(locale, key)
    }

    static let labelKeys: [String: String] = [
        "follow_ups": "inbox.forYouSectionChaseThese",
        "unassigned": "inbox.forYouSectionUnassigned",
        "waiting": "inbox.forYouSectionWaiting",
        "tasks": "inbox.forYouSectionTasks",
        "unread": "inbox.forYouSectionUnread",
        "outstanding_quotes": "quotes.outstandingTitle",
        "recent_calls": "domain.panelRecentCalls",
        "response_time": "domain.panelResponseTime",
        "pipeline": "domain.panelPipeline",
        "satisfaction": "domain.panelSatisfaction",
        "lead_sources": "domain.panelLeadSources",
    ]

    static let noteKeys: [String: String] = [
        "follow_ups": "inbox.forYouPanelNoteFollowUps",
        "unassigned": "inbox.forYouPanelNoteUnassigned",
        "waiting": "inbox.forYouPanelNoteWaiting",
        "tasks": "inbox.forYouPanelNoteTasks",
        "unread": "inbox.forYouPanelNoteUnread",
        "outstanding_quotes": "inbox.forYouPanelNoteQuotes",
        "recent_calls": "domain.panelRecentCallsNote",
        "response_time": "domain.panelResponseTimeNote",
        "pipeline": "domain.panelPipelineNote",
        "satisfaction": "domain.panelSatisfactionNote",
        "lead_sources": "domain.panelLeadSourcesNote",
    ]
}
