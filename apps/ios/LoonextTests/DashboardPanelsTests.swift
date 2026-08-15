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
    /// Where the panel WORDS live since #228: the web catalogue.
    ///
    /// Only the label assertion follows them. The other two read panel IDS and
    /// their order — wire values that never moved — and pointing those here
    /// would have them find no ids at all and pass on an empty comparison.
    ///
    /// Sliced to the English half: the French holds the same keys, and a
    /// `contains` over the whole file would ask whether a label appears in
    /// EITHER language.
    private func repoPath(_ relative: String) throws -> URL {
        var dir = URL(fileURLWithPath: #filePath).deletingLastPathComponent()
        while true {
            let candidate = dir.appendingPathComponent(relative)
            if FileManager.default.fileExists(atPath: candidate.path) { return candidate }
            let parent = dir.deletingLastPathComponent()
            if parent.path == dir.path { break }
            dir = parent
        }
        XCTFail("\(relative) is not reachable from \(#filePath)")
        throw CocoaError(.fileNoSuchFile)
    }

    private func panelCopy() throws -> String {
        let raw = try String(
            contentsOf: try repoPath("apps/web/src/i18n/sections/domain.ts"),
            encoding: .utf8
        )
        guard let start = raw.range(of: "export const domainEn"),
              let end = raw.range(of: "export const domainFr")
        else {
            XCTFail("domain.ts no longer has both language blocks")
            return ""
        }
        return String(raw[start.upperBound ..< end.lowerBound])
    }

    func testThePanelLabelsMatchTheSharedModule() throws {
        let shared = try panelCopy()
        for panel in DashboardPanels.Panel.allCases {
            let label = DashboardPanels.label(panel)
            XCTAssertTrue(
                shared.contains("\"\(label)\""),
                "the label for \(panel.rawValue) has drifted from the catalogue: \(label)"
            )
        }
    }
}
