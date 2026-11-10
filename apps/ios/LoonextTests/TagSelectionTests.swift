import XCTest

@testable import Loonext

/// #713: the Swift port of `packages/shared/src/tag-selection.ts` against the
/// cases the TypeScript generates into `packages/shared/vectors/tag-selection.json`.
final class TagSelectionTests: XCTestCase {
    private struct Vector: Decodable {
        let items: [[String]]?
        let tagId: String
        let state: String
        let action: String
    }

    private func vectors() throws -> [Vector] {
        var dir = URL(fileURLWithPath: #filePath).deletingLastPathComponent()
        while dir.path != "/" {
            let candidate = dir
                .appendingPathComponent("packages/shared/vectors")
                .appendingPathComponent("tag-selection.json")
            if FileManager.default.fileExists(atPath: candidate.path) {
                return try JSONDecoder().decode([Vector].self, from: Data(contentsOf: candidate))
            }
            dir = dir.deletingLastPathComponent()
        }
        XCTFail("tag-selection.json not found; run node scripts/generate-parity-vectors.mjs")
        return []
    }

    func testStateAndActionMatchTheSharedVectors() throws {
        let cases = try vectors()
        XCTAssertFalse(cases.isEmpty, "no tag-selection vectors")
        for vector in cases {
            let label = "items=\(String(describing: vector.items)) tag=\(vector.tagId)"
            let state = tagSelectionState(itemTagIds: vector.items, tagId: vector.tagId)
            XCTAssertEqual(state.rawValue, vector.state, "state for \(label)")
            XCTAssertEqual(tagToggleAction(state), vector.action, "action for \(label)")
        }
    }
}
