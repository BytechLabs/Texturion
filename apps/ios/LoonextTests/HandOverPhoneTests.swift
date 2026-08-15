import XCTest
@testable import Loonext

/// #330 — the handover copy, and that this phone says what the shared module says.
///
/// A drift here means one app tells somebody their unsent messages are safe and
/// another tells them they are not. It would not show up as a crash, which is why the
/// port gets its own test — and why it matters that iOS compiles only in CI.
final class HandOverPhoneTests: XCTestCase {

    func testItNamesWhatLeavesThePhoneRatherThanSayingYourData() {
        // The person handing it over is deciding whether it is safe to. "Some data
        // will be removed" does not answer that; the list does.
        let body = HandOverPhone.body(unsent: 0)
        XCTAssertTrue(body.contains("conversations"))
        XCTAssertTrue(body.contains("customers"))
        XCTAssertTrue(body.contains("signed out"))
    }

    func testItSaysTheNextPersonSignsInAsThemselves() {
        XCTAssertTrue(HandOverPhone.body(unsent: 0).contains("signs in as themselves"))
    }

    func testUnsentMessagesAreCountedNotGesturedAt() {
        XCTAssertTrue(HandOverPhone.body(unsent: 1).contains("One message"))
        XCTAssertTrue(HandOverPhone.body(unsent: 1).contains("discarded"))
        XCTAssertTrue(HandOverPhone.body(unsent: 3).contains("3 messages"))
    }

    func testItSaysWhatToDoInsteadNotJustWhatIsLost() {
        XCTAssertTrue(HandOverPhone.body(unsent: 2).contains("signal"))
    }

    func testACleanHandoverCarriesNoWarning() {
        // A warning that fires every time is a warning nobody reads on the day it
        // matters.
        let body = HandOverPhone.body(unsent: 0)
        XCTAssertFalse(body.contains("discarded"))
        XCTAssertFalse(body.contains("signal"))
    }

    func testTheWarningIsOneSentenceLongerNotADifferentScreen() {
        XCTAssertTrue(
            HandOverPhone.body(unsent: 1).hasPrefix(HandOverPhone.body(unsent: 0))
        )
    }

    func testCostsIsTrueOnlyWhenSomethingWouldBeLost() {
        XCTAssertFalse(HandOverPhone.costs(unsent: 0))
        XCTAssertTrue(HandOverPhone.costs(unsent: 1))
        // A negative count is a bug upstream, not a reason to warn about nothing.
        XCTAssertFalse(HandOverPhone.costs(unsent: -1))
        XCTAssertEqual(HandOverPhone.body(unsent: -1), HandOverPhone.body(unsent: 0))
    }

    // MARK: - Against the original

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

    /// The web catalogue's ENGLISH half, which is where the sentences went.
    ///
    /// #228 moved `hand-over-phone.ts` from holding these sentences to naming
    /// keys, so a `contains` against that file asks whether it holds a
    /// paragraph it no longer holds. The guard's job is unchanged — this client
    /// must not drift from the shared vocabulary — so it follows the words.
    ///
    /// Sliced to the English half: the French holds the same keys, and a
    /// `contains` over the whole file would ask whether a sentence appears in
    /// EITHER language.
    private func sharedSource() throws -> String {
        let raw = try String(
            contentsOf: try repoPath("apps/web/src/i18n/sections/shell.ts"),
            encoding: .utf8
        )
        guard let start = raw.range(of: "export const shellEn"),
              let end = raw.range(of: "export const shellFr")
        else {
            XCTFail("shell.ts no longer has both language blocks")
            return ""
        }
        return String(raw[start.upperBound ..< end.lowerBound])
    }

    /// Concatenation syntax and line wrapping removed, so what is left is the words.
    private func bare(_ text: String) -> String {
        text
            .replacingOccurrences(of: "\"", with: "")
            .replacingOccurrences(of: "+", with: "")
            .replacingOccurrences(of: "\r", with: " ")
            .split(whereSeparator: { $0.isWhitespace })
            .joined(separator: " ")
    }

    func testTheSentenceACleanHandoverShowsMatchesTheSharedModule() throws {
        let shared = bare(try sharedSource())
        XCTAssertTrue(
            shared.contains(bare(HandOverPhone.body(unsent: 0))),
            "the handover copy has drifted from the shared module"
        )
    }

    func testTheLabelsMatchTheSharedModule() throws {
        let shared = try sharedSource()
        for label in [
            HandOverPhone.action,
            HandOverPhone.title,
            HandOverPhone.confirm,
            HandOverPhone.cancel,
        ] {
            XCTAssertTrue(
                shared.contains("\"\(label)\""),
                "this label has drifted: \(label)"
            )
        }
    }
}
