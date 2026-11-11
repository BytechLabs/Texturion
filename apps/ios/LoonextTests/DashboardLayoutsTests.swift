import XCTest

@testable import Loonext

/// #736: the For you layout model, against `packages/shared/src/dashboard-layout.ts`
/// and its test. The ids and sizes are STORED and sent to the Worker, so the
/// parity tests read the shared module rather than trusting a copy.
final class DashboardLayoutsTests: XCTestCase {

    private func layout(_ entries: [(String, String)]) -> DashboardLayout {
        DashboardLayout(panels: entries.map { DashboardLayoutEntry(id: $0.0, size: $0.1) })
    }

    private var base: DashboardLayout {
        layout([
            ("unassigned", "two_thirds"),
            ("waiting", "third"),
            ("recent_calls", "third"),
        ])
    }

    private func ids(_ layout: DashboardLayout) -> [String] {
        layout.panels.map(\.id)
    }

    func testUnknownPanelsRepeatsAndBadSizesAreDroppedRatherThanRefused() {
        let clean = DashboardLayouts.normalise(
            layout([
                ("recent_calls", "full"),
                ("recent_calls", "third"),
                ("a_panel_from_the_future", "third"),
                ("pipeline", "enormous"),
            ])
        )
        XCTAssertEqual(clean, layout([("recent_calls", "full"), ("pipeline", "third")]))
        XCTAssertNil(DashboardLayouts.normalise(nil))
    }

    func testTheDefaultHasEveryPanelAndTheMostUrgentQueueWide() {
        let page = DashboardLayouts.defaultLayout(
            queueOrder: [.waiting, .unassigned, .tasks, .unread]
        )
        XCTAssertEqual(DashboardLayouts.notInLayout(page), [])
        XCTAssertEqual(ids(page).sorted(), DashboardLayouts.panelIds.sorted())
        XCTAssertEqual(page.panels.first { $0.id == "waiting" }?.size, "two_thirds")
        XCTAssertEqual(page.panels.first { $0.id == "unassigned" }?.size, "third")
        XCTAssertEqual(
            ids(page),
            [
                "response_time", "pipeline", "satisfaction", "lead_sources", "follow_ups",
                "waiting", "unassigned", "tasks", "unread", "outstanding_quotes", "recent_calls",
            ]
        )
    }

    func testMovingStopsAtTheEnds() {
        XCTAssertEqual(
            ids(DashboardLayouts.move(base, id: "recent_calls", delta: -1)),
            ["unassigned", "recent_calls", "waiting"]
        )
        XCTAssertEqual(DashboardLayouts.move(base, id: "unassigned", delta: -1), base)
        XCTAssertEqual(
            ids(DashboardLayouts.move(base, id: "unassigned", delta: 9)),
            ["waiting", "recent_calls", "unassigned"]
        )
        XCTAssertEqual(DashboardLayouts.move(base, id: "pipeline", delta: 1), base)
    }

    func testADroppedPanelLandsWhereTheTargetStood() {
        XCTAssertEqual(
            ids(DashboardLayouts.moveTo(base, id: "recent_calls", target: "unassigned")),
            ["recent_calls", "unassigned", "waiting"]
        )
    }

    func testSizeCyclesRemoveAndAddWithoutDoubling() {
        XCTAssertEqual(DashboardLayouts.nextSize("third"), "two_thirds")
        XCTAssertEqual(DashboardLayouts.nextSize("full"), "third")
        XCTAssertEqual(
            DashboardLayouts.resize(base, id: "waiting", size: "full").panels[1],
            DashboardLayoutEntry(id: "waiting", size: "full")
        )
        let without = DashboardLayouts.remove(base, id: "waiting")
        XCTAssertEqual(ids(without), ["unassigned", "recent_calls"])
        let readded = DashboardLayouts.add(without, id: "waiting")
        XCTAssertEqual(ids(readded), ["unassigned", "recent_calls", "waiting"])
        XCTAssertEqual(readded.panels.last?.size, "third")
        XCTAssertEqual(DashboardLayouts.add(base, id: "waiting"), base)
    }

    func testAHideablePanelInTheHiddenSetIsHiddenAndAQueueNeverIs() {
        XCTAssertTrue(DashboardLayouts.isHidden(["pipeline"], "pipeline"))
        XCTAssertFalse(DashboardLayouts.isHidden(["waiting"], "waiting"))
        for queue in DashboardLayouts.queueIds {
            XCTAssertFalse(DashboardLayouts.isHideable(queue))
        }
    }

    func testEveryPanelHasANameAndANoteInBothLanguages() {
        for id in DashboardLayouts.panelIds {
            for locale in [nil, "fr"] as [String?] {
                XCTAssertGreaterThan(DashboardLayouts.label(id, locale: locale).count, 2)
                XCTAssertTrue(
                    DashboardLayouts.note(id, locale: locale).hasSuffix("."),
                    "the note for \(id) is not a sentence"
                )
            }
        }
    }

    func testAMembershipCarryingALayoutDecodes() throws {
        let json = """
        {"company_id":"c1","name":"Acme","role":"owner","subscription_status":"active",
         "dashboard_layout":{"panels":[{"id":"pipeline","size":"full"}]}}
        """
        let membership = try JSONDecoder().decode(Membership.self, from: Data(json.utf8))
        XCTAssertEqual(
            membership.dashboard_layout,
            layout([("pipeline", "full")])
        )
        let bare = """
        {"company_id":"c1","name":"Acme","role":"owner","subscription_status":"active",
         "dashboard_layout":null}
        """
        let none = try JSONDecoder().decode(Membership.self, from: Data(bare.utf8))
        XCTAssertNil(none.dashboard_layout)
    }

    // ------------------------------------------------ against the original

    private func sharedSource() throws -> String {
        var dir = URL(fileURLWithPath: #filePath).deletingLastPathComponent()
        var found: URL?
        while true {
            let candidate = dir.appendingPathComponent(
                "packages/shared/src/dashboard-layout.ts"
            )
            if FileManager.default.fileExists(atPath: candidate.path) {
                found = candidate
                break
            }
            let parent = dir.deletingLastPathComponent()
            if parent.path == dir.path { break }
            dir = parent
        }
        return try String(contentsOf: try XCTUnwrap(found), encoding: .utf8)
    }

    private func sharedList(_ name: String) throws -> [String] {
        let shared = try sharedSource()
        guard let start = shared.range(of: "export const \(name)"),
              let open = shared.range(of: "[", range: start.upperBound..<shared.endIndex),
              let close = shared.range(of: "]", range: open.upperBound..<shared.endIndex)
        else {
            XCTFail("\(name) is no longer an array literal")
            return []
        }
        return shared[open.upperBound..<close.lowerBound]
            .split(separator: ",")
            .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { $0.hasPrefix("\"") }
            .map { $0.replacingOccurrences(of: "\"", with: "") }
    }

    func testThePanelIdsMatchTheSharedModuleInOrder() throws {
        XCTAssertEqual(try sharedList("LAYOUT_PANEL_IDS"), DashboardLayouts.panelIds)
    }

    func testTheSizesMatchTheSharedModuleInOrder() throws {
        XCTAssertEqual(try sharedList("PANEL_SIZES"), DashboardLayouts.sizes)
    }
}
