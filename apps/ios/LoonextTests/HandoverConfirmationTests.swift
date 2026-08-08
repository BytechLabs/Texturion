import XCTest
@testable import Loonext

/// #537 — the handover confirmation, and that this phone says what the laptop says.
///
/// A drift here means this app describes a security demand differently from web, for
/// the one action that hands a business to somebody else. It would not show up as a
/// crash, which is exactly why the port gets its own test — and why it matters that
/// iOS compiles only in CI.
final class HandoverConfirmationTests: XCTestCase {

    // MARK: - Which prompt to show

    func testSomebodyWithAnAuthenticatorIsSentToTheirApp() {
        XCTAssertEqual(
            HandoverConfirmation.kind(of: "mfa_challenge_required"),
            .authenticator
        )
    }

    func testSomebodyWithoutOneIsSentToTheirInbox() {
        XCTAssertEqual(
            HandoverConfirmation.kind(of: "confirmation_code_required"),
            .email
        )
    }

    func testNoCodeIsAskedForWhenTheRefusalWasAboutSomethingElse() {
        // THE CASE THAT MATTERS. A handover is also refused because a transfer is
        // already in flight, or because the caller is not the owner. Prompting for a
        // code there would hide the real reason behind a code that cannot help.
        for code in ["conflict", "forbidden", "validation_failed", "not_found"] {
            XCTAssertNil(HandoverConfirmation.kind(of: code), code)
        }
        XCTAssertNil(HandoverConfirmation.kind(of: nil))
    }

    // MARK: - The six digits

    func testSixDigitsAreACode() {
        XCTAssertTrue(HandoverConfirmation.isCode("123456"))
        // A code beginning zero is one in ten, and must not read as five digits.
        XCTAssertTrue(HandoverConfirmation.isCode("000000"))
    }

    func testAPastedCodeKeepsItsWhitespaceAndStillCounts() {
        XCTAssertTrue(HandoverConfirmation.isCode("  123456 "))
        XCTAssertTrue(HandoverConfirmation.isCode("123456\n"))
    }

    func testAnythingElseIsNot() {
        for bad in ["", "12345", "1234567", "12345a", "abcdef", "12 34 56"] {
            XCTAssertFalse(HandoverConfirmation.isCode(bad), bad)
        }
        // Digits from another script are not the digits the server hashed.
        XCTAssertFalse(HandoverConfirmation.isCode("١٢٣٤٥٦"))
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

    private func sharedSource() throws -> String {
        try String(
            contentsOf: try repoPath("packages/shared/src/handover-confirmation.ts"),
            encoding: .utf8
        )
    }

    /// Concatenation syntax and line wrapping removed, so what is left is the words.
    ///
    /// The TypeScript keeps each sentence on one long line; the Swift splits the
    /// longer one across a `+`. Comparing fragments would compare the formatting
    /// rather than the wording, which is the thing that must not drift.
    private func bare(_ text: String) -> String {
        let stripped = text
            .replacingOccurrences(of: "\"", with: "")
            .replacingOccurrences(of: "+", with: "")
            .replacingOccurrences(of: "\r", with: " ")
        return stripped
            .split(whereSeparator: { $0.isWhitespace })
            .joined(separator: " ")
    }

    func testBothSentencesMatchTheSharedModuleWhole() throws {
        let shared = bare(try sharedSource())
        for kind in HandoverConfirmation.Kind.allCases {
            let sentence = bare(HandoverConfirmation.whereToLook(kind))
            XCTAssertTrue(
                shared.contains(sentence),
                "this sentence has drifted from the shared module: \(sentence)"
            )
        }
    }

    func testTheTwoSentencesAreNotTheSameSentence() {
        // "Enter your code" is useless to somebody who does not know which code, and
        // the two codes live in completely different places.
        XCTAssertNotEqual(
            HandoverConfirmation.whereToLook(.authenticator),
            HandoverConfirmation.whereToLook(.email)
        )
    }

    func testTheEmailSentenceSaysHowLongTheCodeLasts() {
        // Ten minutes and one use turn "it didn't work" into "ask for another", which
        // is the next thing somebody needs to do.
        let email = HandoverConfirmation.whereToLook(.email)
        XCTAssertTrue(email.contains("once"))
        XCTAssertTrue(email.contains("ten minutes"))
    }

    func testNoClientPromisesToResendAnAuthenticatorCode() {
        // There is nothing to resend — the app generates them.
        XCTAssertTrue(HandoverConfirmation.resend.lowercased().contains("again"))
        XCTAssertFalse(
            HandoverConfirmation.whereToLook(.authenticator).contains("again")
        )
    }

    func testARefusedCodeInventsNoDistinctionTheServerRefusedToMake() {
        // The server answers the same way for wrong, expired, spent and out-of-
        // attempts, because saying which would tell an attacker whether they had the
        // right digits. A client must not undo that.
        for leak in ["expired", "already", "attempts", "wrong"] {
            XCTAssertFalse(
                HandoverConfirmation.rejected.lowercased().contains(leak),
                leak
            )
        }
    }

    func testTheLabelsMatchTheSharedModule() throws {
        let shared = try sharedSource()
        for label in [
            HandoverConfirmation.title,
            HandoverConfirmation.field,
            HandoverConfirmation.submit,
            HandoverConfirmation.resend,
            HandoverConfirmation.rejected,
        ] {
            XCTAssertTrue(
                shared.contains("\"\(label)\""),
                "this label has drifted: \(label)"
            )
        }
    }
}
