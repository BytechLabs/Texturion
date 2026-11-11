import XCTest
@testable import Loonext

/// #749: the decode-time defaults of the settings models, held to
/// `packages/shared/vectors/setting-defaults.json`, which is generated from
/// `packages/shared/src/setting-defaults.ts`.
///
/// A payload from a Worker that omits a setting decodes to the model's default.
/// If that default disagrees with the server's, the app shows a value the
/// account is not in. Each model is decoded from JSON holding only its required
/// fields, then re-encoded, and every vector row whose key the model decodes is
/// compared with what came back.
final class SettingDefaultsVectorsTests: XCTestCase {
    private struct Row {
        let table: String
        let key: String
        let value: Any
    }

    /// Keys the model decodes but cannot be held to the vector, with the reason.
    private static let knownExceptions: [String: String] = [
        // null on the wire means "no cap", which this client clamps to its 10x
        // ceiling (#42), so an absent key cannot also mean the server's 3.
        "companies.overage_cap_multiplier": "null means no cap",
    ]

    private func vectorRows() throws -> [Row] {
        var dir = URL(fileURLWithPath: #filePath).deletingLastPathComponent()
        while dir.path != "/" {
            let candidate = dir.appendingPathComponent("packages/shared/vectors/setting-defaults.json")
            if FileManager.default.fileExists(atPath: candidate.path) {
                let raw = try JSONSerialization.jsonObject(with: Data(contentsOf: candidate))
                let list = try XCTUnwrap(raw as? [[String: Any]])
                return try list.map { entry in
                    Row(
                        table: try XCTUnwrap(entry["table"] as? String),
                        key: try XCTUnwrap(entry["key"] as? String),
                        value: try XCTUnwrap(entry["value"])
                    )
                }
            }
            dir = dir.deletingLastPathComponent()
        }
        XCTFail("setting-defaults.json not found; run node scripts/generate-parity-vectors.mjs")
        return []
    }

    /// The wire names a decoded model carries. `@Default` properties are stored
    /// as `_name`.
    private func decodedKeys<T>(_ model: T) -> Set<String> {
        Set(Mirror(reflecting: model).children.compactMap { child -> String? in
            guard let label = child.label else { return nil }
            return label.hasPrefix("_") ? String(label.dropFirst()) : label
        })
    }

    private func sameValue(_ expected: Any, _ actual: Any?) -> Bool {
        if expected is NSNull { return actual == nil || actual is NSNull }
        guard let actual else {
            // An absent key is the empty collection: the model omits nil.
            if let dict = expected as? [String: Any] { return dict.isEmpty }
            if let list = expected as? [Any] { return list.isEmpty }
            return false
        }
        guard let left = expected as? NSObject, let right = actual as? NSObject else { return false }
        return left.isEqual(right)
    }

    /// Returns how many vector keys were compared.
    private func compare<T: Codable>(
        table: String,
        requiredJson: String,
        suppliedKeys: Set<String>,
        as type: T.Type
    ) throws -> Int {
        let model = try JSONDecoder().decode(type, from: Data(requiredJson.utf8))
        let encoded = try JSONEncoder().encode(model)
        let object = try XCTUnwrap(JSONSerialization.jsonObject(with: encoded) as? [String: Any])
        let keys = decodedKeys(model)
        var compared = 0
        for row in try vectorRows() where row.table == table {
            guard keys.contains(row.key), !suppliedKeys.contains(row.key) else { continue }
            if let reason = Self.knownExceptions["\(table).\(row.key)"] {
                XCTAssertNil(object[row.key], "\(row.key): the exception (\(reason)) no longer holds")
                continue
            }
            compared += 1
            XCTAssertTrue(
                sameValue(row.value, object[row.key]),
                "\(table).\(row.key): vector \(row.value), decoded \(String(describing: object[row.key]))"
            )
        }
        return compared
    }

    func testCompanyDecodeDefaultsAgreeWithTheVectors() throws {
        let compared = try compare(
            table: "companies",
            requiredJson: """
            {"id":"c1","name":"Acme","country":"CA","us_texting_enabled":true,
             "requested_area_code":"416","timezone":"America/Toronto",
             "subscription_status":"active","created_at":"2026-01-01T00:00:00Z",
             "updated_at":"2026-01-01T00:00:00Z"}
            """,
            suppliedKeys: ["us_texting_enabled", "timezone"],
            as: CompanyView.self
        )
        XCTAssertGreaterThan(compared, 0)
        XCTAssertGreaterThanOrEqual(compared, 25, "compared \(compared) company keys; the sample shrank")
    }

    func testNotificationPrefsDecodeDefaultsAgreeWithTheVectors() throws {
        let compared = try compare(
            table: "notification_prefs",
            requiredJson: #"{"email_enabled":true,"push_enabled":true}"#,
            suppliedKeys: ["email_enabled", "push_enabled"],
            as: NotificationPrefs.self
        )
        XCTAssertGreaterThan(compared, 0)
        XCTAssertGreaterThanOrEqual(compared, 5, "compared \(compared) notification keys; the sample shrank")
    }
}
