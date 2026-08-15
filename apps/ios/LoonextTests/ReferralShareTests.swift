import XCTest
@testable import Loonext

/// #288 — the share draft, and that this phone offers the same words the laptop does.
///
/// Two halves. The behaviour tests assert the one rule that matters — an edited
/// message keeps its link — and the parity tests read
/// `packages/shared/src/referral-share.ts`, because this is a hand-port and nothing
/// about Swift says the original stayed put.
///
/// This is the one message in the product a customer sends to somebody who has
/// never heard of us. A version of it that reads differently on the phone than on
/// the laptop is a version an owner stops trusting to say what they meant.
final class ReferralShareTests: XCTestCase {

    func testTheLinkGoesOnTheEndSoAnEditedMessageKeepsIt() {
        XCTAssertEqual(
            ReferralShare.shareText(
                note: "Come try this",
                link: "https://loonext.com/?ref=ABCD2345",
                code: "ABCD2345"
            ),
            "Come try this\n\nhttps://loonext.com/?ref=ABCD2345"
        )
    }

    func testAnOwnerWhoDeletesEveryWordStillSendsSomethingUsable() {
        // The whole reason the link is not inside the editable field.
        XCTAssertEqual(
            ReferralShare.shareText(
                note: "   ",
                link: "https://loonext.com/?ref=ABCD2345",
                code: "ABCD2345"
            ),
            "https://loonext.com/?ref=ABCD2345"
        )
    }

    func testWithNoLinkConfiguredTheCodeCarriesTheReferral() {
        XCTAssertEqual(
            ReferralShare.shareText(note: "Have a look", link: nil, code: "ABCD2345"),
            "Have a look\n\nUse my code ABCD2345 when you sign up."
        )
    }

    func testTheDraftTrimsRatherThanSendingTrailingWhitespace() {
        XCTAssertEqual(
            ReferralShare.shareText(note: "Look  \n\n", link: "https://x.test/?ref=A", code: "A"),
            "Look\n\nhttps://x.test/?ref=A"
        )
    }

    func testTheHeadlineDoesNotSayOneCustomers() {
        XCTAssertEqual(ReferralShare.askHeadline(1), "You replied to 1 customer this month.")
        XCTAssertEqual(ReferralShare.askHeadline(37), "You replied to 37 customers this month.")
    }

    func testAStageThisBuildDoesNotKnowReadsAsItself() {
        // A server ahead of this app. One unfamiliar row on a settings card is
        // recoverable; a blank card is not.
        XCTAssertEqual(ReferralShare.stageLabel("signed_up"), "Up and running")
        XCTAssertEqual(ReferralShare.stageLabel("kaleidoscope"), "kaleidoscope")
    }

    func testTheDefaultDraftPromisesNothingTheProductDoesNotDo() {
        // A crew can run several numbers, so "one number" is not ours to claim.
        XCTAssertFalse(ReferralShare.note.lowercased().contains("one number"))
        // And it carries no link of its own: shareText appends it, and a URL in
        // here would be a second place for the link to come from.
        XCTAssertFalse(ReferralShare.note.contains("http"))
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

    /// The TypeScript source with its multi-line string concatenations joined.
    ///
    /// `"a " +\n  "b"` in the file is the single string `"a b"` at runtime, and a
    /// literal `contains` against the raw text would fail on every sentence long
    /// enough to wrap — which is most of them here.
    private func sharedSource() throws -> String {
        let raw = try String(
            contentsOf: try repoPath("packages/shared/src/referral-share.ts"),
            encoding: .utf8
        )
        return raw.replacingOccurrences(
            of: "\"\\s*\\+\\s*\\n\\s*\"",
            with: "",
            options: .regularExpression
        )
    }

    /// The web catalogue's ENGLISH half, which is where the sentences went.
    ///
    /// #228 moved `referral-share.ts` from holding sentences to naming keys,
    /// so a `contains` against that file asks whether it holds a paragraph it
    /// no longer holds. The guard's job is unchanged — this client must not
    /// drift from the shared vocabulary — so it follows the words.
    ///
    /// Sliced to the English half: the French holds the same keys, and a
    /// `contains` over the whole file would ask whether a sentence appears in
    /// EITHER language.
    private func catalogueSource() throws -> String {
        let raw = try String(
            contentsOf: try repoPath("apps/web/src/i18n/sections/domain.ts"),
            encoding: .utf8
        )
        guard let start = raw.range(of: "export const domainEn"),
              let end = raw.range(of: "export const domainFr")
        else {
            XCTFail("domain.ts no longer has both language blocks")
            return ""
        }
        let english = String(raw[start.upperBound ..< end.lowerBound])
        return english.replacingOccurrences(
            of: "\"\\s*\\+\\s*\\n\\s*\"",
            with: "",
            options: .regularExpression
        )
    }

    func testEverySentenceACrewMightSendMatchesTheSharedModule() throws {
        let shared = try catalogueSource()
        for copy in [
            ReferralShare.note,
            ReferralShare.title,
            ReferralShare.action,
            ReferralShare.copy,
            ReferralShare.copied,
            ReferralShare.draftLabel,
            ReferralShare.linkNote,
            ReferralShare.rewardLine,
            ReferralShare.askBody,
            ReferralShare.askAction,
            ReferralShare.askDismiss,
        ] {
            XCTAssertTrue(
                shared.contains(copy),
                "this copy has drifted from the shared module: \(copy)"
            )
        }
    }

    func testTheStageLabelsMatchTheSharedModule() throws {
        let shared = try sharedSource()
        let words = try catalogueSource()
        guard let start = shared.range(of: "REFERRAL_STAGE_LABELS"),
              let open = shared[start.upperBound...].firstIndex(of: "{"),
              let close = shared[open...].firstIndex(of: "}")
        else {
            return XCTFail("REFERRAL_STAGE_LABELS is no longer an object literal")
        }
        let body = String(shared[shared.index(after: open) ..< close])
        var found = 0
        for line in body.split(separator: "\n") {
            let parts = line.split(separator: ":", maxSplits: 1)
            guard parts.count == 2 else { continue }
            let stage = parts[0].trimmingCharacters(in: .whitespaces)
            guard !stage.hasPrefix("//"), !stage.isEmpty else { continue }
            let label = parts[1]
                .trimmingCharacters(in: CharacterSet(charactersIn: " ,\"\r\t"))
            guard !label.isEmpty else { continue }
            found += 1
            // #228: the shared module maps each stage to a KEY and the
            // catalogue says what it means, so both halves of the chain are
            // pinned — a stage pointed at the wrong key and a key with the
            // wrong words are different bugs.
            XCTAssertTrue(
                label.hasPrefix("domain."),
                "'\(stage)' should name a catalogue key, found '\(label)'"
            )
            XCTAssertTrue(
                words.contains(ReferralShare.stageLabel(stage)),
                "the label for '\(stage)' has drifted from the catalogue: "
                    + ReferralShare.stageLabel(stage)
            )
        }
        XCTAssertEqual(found, 5, "expected five stages in the shared module")
    }

    func testTheFallbackSentenceForAMissingLinkMatchesToo() throws {
        // Built by interpolation on both sides, so it is compared as its shape
        // rather than as a whole string.
        XCTAssertTrue(
            try sharedSource().contains("Use my code ${code} when you sign up.")
        )
    }
}
