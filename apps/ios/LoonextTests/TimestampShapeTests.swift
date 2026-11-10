import XCTest

@testable import Loonext

/// #720: the Swift port of `packages/shared/src/timestamp-shape.ts` against the cases the
/// TypeScript generates into `packages/shared/vectors/timestamp-shape.json`.
final class TimestampShapeTests: XCTestCase {
    private struct Vector: Decodable {
        let at: String
        let now: String
        let zone: String
        let bucket: String
        let minutes: Int
    }

    private func vectors() throws -> [Vector] {
        var dir = URL(fileURLWithPath: #filePath).deletingLastPathComponent()
        while dir.path != "/" {
            let candidate = dir
                .appendingPathComponent("packages/shared/vectors")
                .appendingPathComponent("timestamp-shape.json")
            if FileManager.default.fileExists(atPath: candidate.path) {
                return try JSONDecoder().decode([Vector].self, from: Data(contentsOf: candidate))
            }
            dir = dir.deletingLastPathComponent()
        }
        XCTFail("timestamp-shape.json not found; run node scripts/generate-parity-vectors.mjs")
        return []
    }

    private func millis(_ iso: String) throws -> Int64 {
        let date = try XCTUnwrap(ISO8601DateFormatter().date(from: iso), iso)
        return Int64((date.timeIntervalSince1970 * 1000).rounded())
    }

    func testBucketAndMinutesMatchTheSharedVectors() throws {
        let cases = try vectors()
        XCTAssertFalse(cases.isEmpty, "no timestamp-shape vectors")
        for vector in cases {
            let label = "at=\(vector.at) now=\(vector.now) zone=\(vector.zone)"
            let zone = try XCTUnwrap(TimeZone(identifier: vector.zone), label)
            let shape = timestampShape(
                atMs: try millis(vector.at), nowMs: try millis(vector.now), timeZone: zone)
            XCTAssertEqual(shape.bucket.rawValue, vector.bucket, "bucket for \(label)")
            XCTAssertEqual(shape.minutes, vector.minutes, "minutes for \(label)")
        }
    }
}
