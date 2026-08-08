import XCTest

@testable import Loonext

/// #540 — which parts of the landing screen a member may put away.
///
/// The same set the Kotlin twin asserts, plus a read of the shared TypeScript,
/// because this is the third hand-port of one list and nothing about Swift says
/// the original moved. The ids here are STORED and sent to the server, so a drift
/// is not cosmetic — it is a phone writing a preference the Worker rejects, or
/// silently dropping one the laptop saved.
final class DashboardPanelsTests: XCTestCase {

    func testNothingIsHiddenByDefault() {
        // The other direction — an opt-in dashboard — means a new card is
        // invisible to every existing member forever, which is how a feature ships
        // to nobody.
        XCTAssertEqual(DashboardPanels.normalise([]), [])
        for panel in DashboardPanels.Panel.allCases {
            XCTAssertTrue(DashboardPanels.isVisible([], panel))
        }
    }

    func testAnIdThisBuildDoesNotKnowIsDroppedRatherThanFatal() {
        // A server ahead of this app, or a card we withdrew. The member gets a
        // working dashboard showing one panel they had put away — recoverable in a
        // tap — rather than a crash where their screen used to be.
        XCTAssertEqual(
            DashboardPanels.normalise(["pipeline", "crystal_ball"]),
            [.pipeline]
        )
    }

    func testDuplicatesCollapse() {
        XCTAssertEqual(DashboardPanels.normalise(["pipeline", "pipeline"]), [.pipeline])
    }

    func testTheOrderIsTheDeclaredOneNotTheTappingOrder() {
        XCTAssertEqual(
            DashboardPanels.normalise(["recent_calls", "response_time"]),
            [.responseTime, .recentCalls]
        )
    }

    func testAHiddenPanelIsNotVisibleAndItsNeighboursStillAre() {
        XCTAssertFalse(DashboardPanels.isVisible(["pipeline"], .pipeline))
        XCTAssertTrue(DashboardPanels.isVisible(["pipeline"], .satisfaction))
    }

    func testEveryPanelHasANameAndAReason() {
        for panel in DashboardPanels.Panel.allCases {
            XCTAssertGreaterThan(DashboardPanels.label(panel).count, 2)
            XCTAssertTrue(
                DashboardPanels.note(panel).hasSuffix("."),
                "the note for \(panel.rawValue) is not a sentence"
            )
        }
    }

    func testNoQueueSectionIsOfferedAsHideable() {
        // THE LINE. Hiding unclaimed work is not a preference — it is a way to stop
        // seeing leads nobody has answered.
        let panelIds = DashboardPanels.Panel.allCases.map(\.rawValue)
        for tile in DashboardTiles.Tile.allCases {
            XCTAssertFalse(panelIds.contains("\(tile)"), "\(tile) must never be hideable")
        }
    }

    /// A membership that predates the column still decodes, and reads as nothing
    /// hidden.
    func testAMembershipWithoutThePreferenceDecodes() throws {
        let json = """
        {"company_id":"c1","name":"Acme","role":"owner","subscription_status":"active"}
        """
        let membership = try JSONDecoder().decode(
            Membership.self,
            from: Data(json.utf8)
        )
        XCTAssertNil(membership.dashboard_hidden)
        XCTAssertEqual(DashboardPanels.normalise(membership.dashboard_hidden ?? []), [])
    }

    func testAMembershipCarryingThePreferenceDecodes() throws {
        let json = """
        {"company_id":"c1","name":"Acme","role":"owner","subscription_status":"active",
         "dashboard_hidden":["pipeline","recent_calls"]}
        """
        let membership = try JSONDecoder().decode(
            Membership.self,
            from: Data(json.utf8)
        )
        XCTAssertEqual(
            DashboardPanels.normalise(membership.dashboard_hidden ?? []),
            [.pipeline, .recentCalls]
        )
    }

    // ------------------------------------------------ against the original

    private func sharedSource() throws -> String {
        var dir = URL(fileURLWithPath: #filePath).deletingLastPathComponent()
        var found: URL?
        while true {
            let candidate = dir.appendingPathComponent(
                "packages/shared/src/dashboard-panels.ts"
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

    /// The same five ids, in the same order, as the shared module.
    func testThePanelIdsMatchTheSharedModule() throws {
        let shared = try sharedSource()
        for panel in DashboardPanels.Panel.allCases {
            XCTAssertTrue(
                shared.contains("\"\(panel.rawValue)\""),
                "\(panel.rawValue) is not in packages/shared/src/dashboard-panels.ts"
            )
        }
        // And the declared order, read out of the array literal rather than
        // trusted: the stored value's order comes from this list.
        guard let start = shared.range(of: "export const DASHBOARD_PANEL_IDS = ["),
              let end = shared.range(of: "] as const", range: start.upperBound..<shared.endIndex)
        else {
            return XCTFail("DASHBOARD_PANEL_IDS is no longer an array literal")
        }
        let body = shared[start.upperBound..<end.lowerBound]
        let ids = body
            .split(separator: ",")
            .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { $0.hasPrefix("\"") }
            .map { $0.replacingOccurrences(of: "\"", with: "") }
        XCTAssertEqual(ids, DashboardPanels.Panel.allCases.map(\.rawValue))
    }

    /// And the labels match, because they are what a member reads.
    ///
    /// A crew comparing a laptop and a phone over a van bonnet is comparing these
    /// exact words; "Lead sources" here against "Where customers came from" there
    /// reads as two different settings.
    func testThePanelLabelsMatchTheSharedModule() throws {
        let shared = try sharedSource()
        for panel in DashboardPanels.Panel.allCases {
            let label = DashboardPanels.label(panel)
            XCTAssertTrue(
                shared.contains("\(panel.rawValue): \"\(label)\""),
                "the label for \(panel.rawValue) has drifted: \(label)"
            )
        }
    }
}
