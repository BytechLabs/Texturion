import XCTest
@testable import Loonext

/// #274 — how a template list stops collapsing at thirty.
///
/// The same vectors as apps/web settings/templates/grouping.test.ts and the
/// Android TemplateGroupingTest. What is pinned is the rule that makes grouping
/// worth having in a workspace that has not adopted it: an ungrouped template
/// must not acquire an invented group.
final class TemplateGroupingTests: XCTestCase {
    private func template(_ name: String, _ category: String? = nil) -> Template {
        Template(
            id: name,
            name: name,
            body: "…",
            category: category,
            created_by: nil,
            updated_by: nil,
            updated_by_name: nil,
            created_at: "2026-08-01T00:00:00.000Z",
            updated_at: "2026-08-01T00:00:00.000Z"
        )
    }

    func testGathersACategoryTogetherUnderItsOwnName() {
        let groups = groupTemplates([
            template("Quote sent", "Quoting"),
            template("On my way", "Dispatch"),
            template("Quote reminder", "Quoting"),
        ])
        XCTAssertEqual(groups.map(\.label), ["Dispatch", "Quoting"])
        XCTAssertEqual(groups[1].rows.map(\.name), ["Quote sent", "Quote reminder"])
    }

    func testPutsUngroupedTemplatesLastUnderNoHeading() {
        // Not a category called "Other". A heading invents a group the crew did
        // not make, and it would sit over every row in a shop that never uses
        // categories.
        let groups = groupTemplates([
            template("On my way"),
            template("Quote sent", "Quoting"),
        ])
        XCTAssertEqual(groups.map(\.label), ["Quoting", nil])
        XCTAssertEqual(groups[1].rows.map(\.name), ["On my way"])
    }

    func testReturnsOneUnlabelledGroupWhenNothingIsCategorised() {
        // The common shop. It must look exactly like the flat list it was.
        let groups = groupTemplates([template("A"), template("B")])
        XCTAssertEqual(groups.count, 1)
        XCTAssertNil(groups[0].label)
        XCTAssertEqual(groups[0].rows.count, 2)
    }

    func testTreatsABlankCategoryAsNoCategory() {
        // The API normalises "" to null, but a row that slipped through with
        // whitespace must not open a group headed by nothing.
        let groups = groupTemplates([template("A", "   "), template("B", "")])
        XCTAssertEqual(groups.map(\.label), [nil])
        XCTAssertEqual(groups[0].rows.count, 2)
    }

    func testLosesNoTemplateWhateverTheMix() {
        let rows = [
            template("A", "Quoting"),
            template("B"),
            template("C", "Dispatch"),
            template("D", "Quoting"),
        ]
        let total = groupTemplates(rows).reduce(0) { $0 + $1.rows.count }
        XCTAssertEqual(total, rows.count)
    }
}
