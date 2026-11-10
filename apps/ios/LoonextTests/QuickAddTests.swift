import XCTest

@testable import Loonext

/// #689 A: the quick-add line.
///
/// A hand port of `packages/shared/src/quick-add.ts`, run against the cases the
/// TypeScript generates into `packages/shared/vectors/quick-add.json`. The cases
/// cover the member's zone (Toronto, Vancouver, Regina and UTC), the two sides of
/// a daylight-saving change, every date and time shape, and the words that must
/// be left alone.
final class QuickAddTests: XCTestCase {
    private struct Vector: Decodable {
        struct Member: Decodable {
            let userId: String
            let name: String
        }

        struct Label: Decodable {
            let id: String
            let name: String
        }

        let line: String
        let now: String
        let timeZone: String
        let selfUserId: String
        let members: [Member]
        let labels: [Label]
        let title: String
        let assignee_user_id: String?
        let due_at: String?
        let due_has_time: Bool
        let priority: String?
        let label_ids: [String]
        let understood: [[String]]
        let ignored: [String]
    }

    private func vectors() throws -> [Vector] {
        var dir = URL(fileURLWithPath: #filePath).deletingLastPathComponent()
        while dir.path != "/" {
            let candidate = dir
                .appendingPathComponent("packages/shared/vectors")
                .appendingPathComponent("quick-add.json")
            if FileManager.default.fileExists(atPath: candidate.path) {
                return try JSONDecoder().decode([Vector].self, from: Data(contentsOf: candidate))
            }
            dir = dir.deletingLastPathComponent()
        }
        XCTFail("quick-add.json not found; run node scripts/generate-parity-vectors.mjs")
        return []
    }

    private func context(_ vector: Vector) throws -> QuickAddContext {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime]
        let now = try XCTUnwrap(formatter.date(from: vector.now), "now: \(vector.now)")
        let zone = try XCTUnwrap(TimeZone(identifier: vector.timeZone), vector.timeZone)
        return QuickAddContext(
            now: now,
            timeZone: zone,
            selfUserId: vector.selfUserId,
            members: vector.members.map { QuickAddMember(userId: $0.userId, name: $0.name) },
            labels: vector.labels.map { QuickAddLabel(id: $0.id, name: $0.name) }
        )
    }

    func testEveryVectorAgrees() throws {
        let cases = try vectors()
        XCTAssertGreaterThan(cases.count, 50, "the vector file shrank or did not load")
        for vector in cases {
            let ctx = try context(vector)
            let result = parseQuickAdd(vector.line, ctx)
            let label = "line: \(vector.line)"
            XCTAssertEqual(result.title, vector.title, label)
            XCTAssertEqual(result.assignee?.userId, vector.assignee_user_id, label)
            XCTAssertEqual(result.dueAt, vector.due_at, label)
            XCTAssertEqual(result.dueHasTime, vector.due_has_time, label)
            XCTAssertEqual(result.priority?.rawValue, vector.priority, label)
            XCTAssertEqual(result.labels.map(\.id), vector.label_ids, label)
            XCTAssertEqual(result.understood.map { [$0.kind, $0.text] }, vector.understood, label)
            XCTAssertEqual(result.ignored, vector.ignored, label)
        }
    }

    // MARK: The example in the issue, spelled out

    func testTheExampleLine() throws {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime]
        // Wednesday 11 November 2026, 10:30 in Toronto.
        let now = try XCTUnwrap(formatter.date(from: "2026-11-11T15:30:00Z"))
        let context = QuickAddContext(
            now: now,
            timeZone: try XCTUnwrap(TimeZone(identifier: "America/Toronto")),
            selfUserId: "u-me",
            members: [
                QuickAddMember(userId: "u-me", name: "Rehman Ahmad"),
                QuickAddMember(userId: "u-sam", name: "Sam Rivera"),
            ],
            labels: [QuickAddLabel(id: "l1", name: "warranty")]
        )
        let result = parseQuickAdd("Fix furnace @rehman tomorrow 9am #urgent", context)
        XCTAssertEqual(result.title, "Fix furnace")
        XCTAssertEqual(result.assignee?.userId, "u-me")
        XCTAssertEqual(result.priority, .urgent)
        XCTAssertEqual(result.dueAt, "2026-11-12T14:00:00.000Z")
        XCTAssertTrue(result.dueHasTime)
        XCTAssertEqual(result.labels, [])
    }

    func testAWordItIsNotSureOfStaysInTheTitle() throws {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime]
        let now = try XCTUnwrap(formatter.date(from: "2026-11-11T15:30:00Z"))
        let context = QuickAddContext(
            now: now,
            timeZone: try XCTUnwrap(TimeZone(identifier: "UTC")),
            selfUserId: "u-me",
            members: [QuickAddMember(userId: "u-me", name: "Rehman Ahmad")],
            labels: []
        )
        let result = parseQuickAdd("Call @nobody about #mystery", context)
        XCTAssertEqual(result.title, "Call @nobody about #mystery")
        XCTAssertNil(result.assignee)
        XCTAssertNil(result.dueAt)
        XCTAssertEqual(result.ignored, ["@nobody", "#mystery"])
        XCTAssertTrue(result.understood.isEmpty)
    }

    func testReferencesAreNeverLabelsAndStayInTheTitle() throws {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime]
        let now = try XCTUnwrap(formatter.date(from: "2026-11-11T15:30:00Z"))
        let context = QuickAddContext(
            now: now,
            timeZone: try XCTUnwrap(TimeZone(identifier: "UTC")),
            selfUserId: "u-me",
            members: [],
            labels: [QuickAddLabel(id: "l1", name: "T-142")]
        )
        let result = parseQuickAdd("Follow up #T-142", context)
        XCTAssertEqual(result.title, "Follow up #T-142")
        XCTAssertTrue(result.labels.isEmpty)
        XCTAssertTrue(result.ignored.isEmpty)
    }
}
