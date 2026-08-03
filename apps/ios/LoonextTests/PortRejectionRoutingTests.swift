import XCTest
@testable import Loonext

/// #319 — a rejected transfer explains itself, and the jump lands on a real
/// field.
///
/// The plain-language catalogue shipped with #352 and was wired into
/// registration only; the transfer card kept printing the carrier's own token
/// (`LOA_SIGNATURE_INVALID`) at somebody who has no idea what it means. Wiring
/// the existing notice in is a few lines of view code — what can rot afterwards
/// is the ROUTING, because `explainRejection` returns a field NAME as a string
/// and nothing in the compiler connects it to a TextField.
///
/// The cases come from the same generated vectors `ParityVectorsTests` reads,
/// so a catalogue entry added later is checked here without anyone remembering
/// this file exists.
final class PortRejectionRoutingTests: XCTestCase {
    private struct RejectionVector: Decodable {
        let domain: String
        let reason: String
        let recognised: Bool
        let field: String?
    }

    /// Walk UP to the repo root from this source file. Copying the vectors into
    /// the test bundle would make them a second copy of the cases, which is the
    /// problem the vectors exist to solve.
    private func portVectors() throws -> [RejectionVector] {
        var dir = URL(fileURLWithPath: #filePath).deletingLastPathComponent()
        while dir.path != "/" {
            let candidate = dir
                .appendingPathComponent("packages/shared/vectors")
                .appendingPathComponent("rejections.json")
            if FileManager.default.fileExists(atPath: candidate.path) {
                let all = try JSONDecoder().decode(
                    [RejectionVector].self,
                    from: Data(contentsOf: candidate)
                )
                return all.filter { $0.domain == "port" }
            }
            dir = dir.deletingLastPathComponent()
        }
        XCTFail("rejections.json not found; run node scripts/generate-parity-vectors.mjs")
        return []
    }

    /// A field name the fix form does not carry is a "Take me to it" button that
    /// does nothing — the worst version of this feature, because it reads as
    /// help right up until it is tapped.
    func testEveryFieldAPortRejectionNamesIsOneTheFixFormCarries() throws {
        let cases = try portVectors()
        XCTAssertFalse(cases.isEmpty, "no port rejection vectors")
        for testCase in cases {
            guard let field = explainRejection(.port, testCase.reason)?.field else { continue }
            XCTAssertTrue(
                PortFixField.all.contains(field),
                "\(testCase.reason) routes to \(field), which no field in PortCards.swift carries"
            )
        }
    }

    /// And the field somebody is sent to has to be one the resubmit sends, or
    /// they correct it and the PUT drops the correction.
    func testEveryRoutedFieldIsSentByTheResubmitBody() {
        let body = PortForm().fieldsJson(wireless: true)
        for field in PortFixField.all {
            XCTAssertNotNil(body[field], "\(field) is routed to but never sent")
        }
    }

    /// The notice falls through to the carrier's own words only when the
    /// catalogue returns nil, so nil has to keep being the answer for a reason
    /// nobody has taught it. A rejection we cannot translate must still reach
    /// the customer.
    func testAnUnreadableReasonStaysUntranslated() {
        XCTAssertNil(explainRejection(.port, nil))
        XCTAssertNil(explainRejection(.port, "   "))
        XCTAssertNil(explainRejection(.port, "### ###"))
    }
}
