import XCTest
@testable import Loonext

/// #286 — "An invited member sees a short, skippable, member-specific
/// orientation on first sign-in."
///
/// Vectors shared with packages/shared/src/member-orientation.test.ts and the
/// Kotlin port. A phone that disagrees with the web about whether somebody is
/// new shows them the flow twice, or never.
final class MemberOrientationTests: XCTestCase {

    func testShowsItToThePersonItWasWrittenFor() {
        XCTAssertTrue(shouldShowOrientation(MemberRole.member, false))
    }

    func testNeverShowsItToSomebodyWhoHasAlreadyBeenThroughIt() {
        // The server's answer for THIS membership, so a skip on a phone is a
        // skip on the laptop too. That is the whole reason it is not a device
        // flag.
        for role in [
            MemberRole.owner, MemberRole.admin, MemberRole.member,
            MemberRole.readOnly, MemberRole.bookkeeper,
        ] {
            XCTAssertFalse(shouldShowOrientation(role, true), role)
        }
    }

    func testShowsNothingWhileTheAnswerIsStillInFlight() {
        // nil is "we have not asked yet". Flashing four screens at somebody who
        // has been here for months, then taking them away, is worse than the
        // wait.
        XCTAssertFalse(shouldShowOrientation(MemberRole.member, nil))
    }

    func testDoesNotOrientThePersonWhoBuiltTheWorkspace() {
        XCTAssertFalse(shouldShowOrientation(MemberRole.owner, false))
        XCTAssertFalse(shouldShowOrientation(MemberRole.admin, false))
    }

    func testDoesNotOrientARoleThatDoesNotAnswerCustomers() {
        // #315: a read-only observer and a bookkeeper are not lesser members —
        // they are different sets. Every screen of this flow is about answering
        // customers.
        XCTAssertFalse(shouldShowOrientation(MemberRole.readOnly, false))
        XCTAssertFalse(shouldShowOrientation(MemberRole.bookkeeper, false))
    }

    func testShowsNothingToARoleThisBuildHasNeverHeardOf() {
        XCTAssertFalse(shouldShowOrientation("superuser", false))
        XCTAssertFalse(shouldShowOrientation(nil, false))
        XCTAssertFalse(shouldShowOrientation("", false))
    }

    func testTheBarNeverStartsAtZero() {
        // Somebody on screen one accepted an invite, signed in and opened the
        // app. *Applying: Goal Gradient Effect.*
        XCTAssertGreaterThan(orientationProgress(0), 0)
        XCTAssertEqual(orientationProgress(0), 0.25, accuracy: 0.0001)
    }

    func testTheBarFillsAsTheyGoAndIsFullOnTheLastScreen() {
        let values = (0..<orientationScreenCount).map { orientationProgress($0) }
        XCTAssertEqual(values, values.sorted())
        XCTAssertEqual(values.last ?? 0, 1, accuracy: 0.0001)
    }

    func testTheBarHoldsForAnIndexOutsideTheFlow() {
        XCTAssertEqual(orientationProgress(-3), 0.25, accuracy: 0.0001)
        XCTAssertEqual(orientationProgress(99), 1, accuracy: 0.0001)
    }

    func testTheFlowStaysShort() {
        // "Short" is the Acceptance word, and four is the number the issue
        // scoped. A flow that grows past that is a tutorial, which is the thing
        // being replaced.
        XCTAssertEqual(orientationScreenCount, 4)
        XCTAssertEqual(orientationScreens.count, 4)
    }

    /// #286: `oriented` defaults to TRUE when the key is missing, unlike every
    /// other field on this payload.
    ///
    /// The harmless answer for a checklist row is "not done yet"; the harmless
    /// answer for a FLOW is "already seen". A server one release behind must
    /// not walk somebody through four screens they have been past for a month.
    func testAMissingOrientedKeyMeansAlreadySeen() throws {
        let json = Data(#"{"replied":true,"noted":false,"marked_done":false}"#.utf8)
        let firsts = try JSONDecoder().decode(MemberFirsts.self, from: json)
        XCTAssertTrue(firsts.oriented)
        XCTAssertTrue(firsts.replied)
        XCTAssertFalse(shouldShowOrientation(MemberRole.member, firsts.oriented))
    }

    func testAnExplicitFalseIsHonoured() {
        let json = Data(
            #"{"replied":false,"noted":false,"marked_done":false,"oriented":false}"#.utf8
        )
        let firsts = try? JSONDecoder().decode(MemberFirsts.self, from: json)
        XCTAssertEqual(firsts?.oriented, false)
        XCTAssertTrue(shouldShowOrientation(MemberRole.member, firsts?.oriented))
    }

    // MARK: - The joining note (#521)

    func testNothingToSayLeavesTheFlowExactlyAsItWas() throws {
        // `{ note: null, from: null }` is the ORDINARY answer, not a failure:
        // every membership predating the field, every owner who made their own
        // workspace, every invite sent without a note. It must produce no
        // screen, no placeholder and no empty quotation.
        let json = Data(#"{"note":null,"from":null}"#.utf8)
        let answer = try JSONDecoder().decode(JoiningNote.self, from: json)
        XCTAssertNil(joiningNoteText(answer))
        // And the read that never landed at all.
        XCTAssertNil(joiningNoteText(nil))
    }

    func testANameWithNoNoteIsStillNothingToShow() {
        // The route resolves the attribution separately from the note, so this
        // shape is reachable. A signature with nothing above it is not a note.
        XCTAssertNil(joiningNoteText(JoiningNote(note: nil, from: "Dave")))
    }

    func testAWhitespaceNoteIsNothingToShow() {
        // The server normalises blank to null, so this is the braces to that
        // belt: a quotation mark around three spaces is worse than no
        // quotation at all.
        XCTAssertNil(joiningNoteText(JoiningNote(note: "   \n ", from: "Dave")))
    }

    func testTheNoteIsShownAsTheyWroteIt() throws {
        let json = Data(
            #"{"note":"You're covering weekend texts with Dave.","from":"Sam"}"#.utf8
        )
        let answer = try JSONDecoder().decode(JoiningNote.self, from: json)
        XCTAssertEqual(
            joiningNoteText(answer),
            "You're covering weekend texts with Dave."
        )
    }

    func testSurroundingWhitespaceDoesNotBecomeIndentation() {
        XCTAssertEqual(
            joiningNoteText(JoiningNote(note: "  Ask Dave for the keys.\n", from: nil)),
            "Ask Dave for the keys."
        )
    }

    func testAnAttributedNoteIsSignedTheWayTheInviteEmailSignedIt() {
        // Word for word what the email put above the same sentence, so the
        // words a new teammate read in their mail are signed the same way when
        // they meet them again in the app.
        XCTAssertEqual(joiningNoteAttribution("Dave"), "Dave says")
    }

    func testAnUnattributedNoteStillReadsAsAPersonsWords() {
        // `from` can be null while the note is not: the name lookup is best
        // effort. The fallback still names a person, because "Your workspace
        // says" would turn a colleague's sentence into product copy.
        for missing in [nil, "", "   "] as [String?] {
            XCTAssertEqual(joiningNoteAttribution(missing), "They said")
        }
    }

    func testANoteDoesNotAddAScreen() {
        // It rides on the first screen, before the product's copy, rather than
        // becoming a fifth one. Four is the number the flow was scoped to, and
        // a note is not a step somebody completes.
        XCTAssertEqual(orientationScreenCount, 4)
        XCTAssertEqual(orientationProgress(0), 0.25, accuracy: 0.0001)
    }
}
