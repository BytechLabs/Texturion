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

/// #248 — the guidance that can lose a business its number says the same thing
/// here as in `packages/shared/src/porting.ts`.
///
/// A port is managed from whatever device is to hand, and the mistake the first
/// line prevents — cancelling the old service before the transfer completes, which
/// can release the number back to the carrier pool — is available on all of them.
/// The shared module has always said these four strings exist as data so they can
/// be asserted across the three clients, "and it drifts silently if hand-kept".
/// Nothing checked until now, and two of the three kept them by hand.
final class PortPreCutoverParityTests: XCTestCase {
    private func repoPath(_ relative: String) throws -> URL {
        var dir = URL(fileURLWithPath: #filePath).deletingLastPathComponent()
        while true {
            let candidate = dir.appendingPathComponent(relative)
            if FileManager.default.fileExists(atPath: candidate.path) { return candidate }
            let parent = dir.deletingLastPathComponent()
            if parent.path == dir.path { break }
            dir = parent
        }
        XCTFail("packages/shared is not reachable from \(#filePath)")
        throw CocoaError(.fileNoSuchFile)
    }

    private func sharedPorting() throws -> String {
        try String(contentsOf: try repoPath("packages/shared/src/porting.ts"), encoding: .utf8)
    }

    /// And it is shown at the same four points in the transfer.
    ///
    /// Drift here is worse than drift in the words, because it is invisible — the
    /// list simply does not appear.
    func testTheStatusesThatShowItMatchTheSharedModule() throws {
        let source = try sharedPorting()
        // AFTER the opening bracket: the declaration is `: readonly string[] = [`,
        // so cutting at the first `]` stops inside the TYPE and reads nothing.
        guard let listStart = source.range(of: "PORT_PRE_CUTOVER_STATUSES"),
            let open = source.range(of: "= [", range: listStart.upperBound ..< source.endIndex),
            let close = source.range(of: "]", range: open.upperBound ..< source.endIndex)
        else {
            return XCTFail("PORT_PRE_CUTOVER_STATUSES is no longer a list in the shared module")
        }
        let body = source[open.upperBound ..< close.lowerBound]
        let shared = Set(
            body
                .split(separator: ",")
                .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
                .filter { !$0.isEmpty }
                .map { $0.trimmingCharacters(in: CharacterSet(charactersIn: "\"")) }
        )
        XCTAssertEqual(
            shared,
            ["submitted", "in-process", "foc-date-confirmed", "activation-in-progress"]
        )
        XCTAssertEqual(
            shared,
            preCutoverStatuses,
            "the statuses this card shows the pre-cutover list for have drifted from "
                + "packages/shared/src/porting.ts"
        )
    }
}
