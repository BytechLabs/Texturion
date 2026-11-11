import XCTest
@testable import Loonext

/// #748: the line an owner pastes into their website, as iOS builds it, held to
/// `packages/shared/vectors/widget-snippet.json`, which the web app's own
/// builder writes. The three clients must hand an owner byte-identical markup.
final class WidgetSnippetTests: XCTestCase {
    private struct SnippetVector: Decodable {
        let key: String
        let locale: String?
        let snippet: String
    }

    func testBuildsEveryLineTheSharedVectorsHold() throws {
        // The vectors name production; a build pointed at another host builds another line.
        try XCTSkipUnless(PushLink.appOrigin == "https://app.loonext.com")
        var dir = URL(fileURLWithPath: #filePath).deletingLastPathComponent()
        var cases: [SnippetVector] = []
        while dir.path != "/" {
            let candidate = dir.appendingPathComponent("packages/shared/vectors/widget-snippet.json")
            if FileManager.default.fileExists(atPath: candidate.path) {
                cases = try JSONDecoder().decode([SnippetVector].self, from: Data(contentsOf: candidate))
                break
            }
            dir = dir.deletingLastPathComponent()
        }
        XCTAssertFalse(cases.isEmpty, "widget-snippet.json not found; run node scripts/generate-parity-vectors.mjs")
        for vector in cases {
            XCTAssertEqual(
                widgetSnippet(key: vector.key, locale: vector.locale),
                vector.snippet,
                "locale \(vector.locale ?? "nil")"
            )
        }
    }
}
