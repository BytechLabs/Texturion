import XCTest
@testable import Loonext

/// #348 — the Swift half of `packages/shared/src/number-access-explained.ts`.
///
/// The pair that matters most is `unruled` vs `no-match`. Both leave the member
/// un-named by any rule and read alike at a glance; one means nobody restricted
/// the number and the other means somebody did and left this person out.
/// Confusing them is how an owner concludes the rules are broken.
final class NumberAccessExplainedTests: XCTestCase {
    func testSaysWhatTheyCanDoAsACapability() {
        XCTAssertEqual(numberAccessLevelLabel("text"), "Can text")
        XCTAssertEqual(numberAccessLevelLabel("note"), "Read and notes only")
        XCTAssertEqual(numberAccessLevelLabel("none"), "Hidden")
    }

    func testNamesTheRuleAnOwnerWouldEdit() {
        XCTAssertEqual(numberAccessReason("user", nil), "A rule naming them")
        XCTAssertEqual(numberAccessReason("role", "member"), "A rule for members")
        XCTAssertEqual(numberAccessReason("all", nil), "A rule for everyone")
    }

    func testTellsTheTwoDefaultLookingCasesApart() {
        XCTAssertNotEqual(
            numberAccessReason("unruled", nil),
            numberAccessReason("no-match", nil)
        )
        XCTAssertEqual(numberAccessReason("unruled", nil), "Nobody has restricted this number")
        XCTAssertEqual(
            numberAccessReason("no-match", nil),
            "This number has rules, and none of them include them"
        )
    }

    func testExplainsBlanketAccess() {
        XCTAssertEqual(numberAccessReason("role-override", "owner"), "Owners reach every number")
        XCTAssertEqual(numberAccessReason("role-override", "admin"), "Admins reach every number")
    }

    func testSurvivesARoleRuleWithNoPrincipal() {
        XCTAssertEqual(numberAccessReason("role", nil), "A rule for their role")
    }

    func testPutsWhatTheyCannotDoFirst() {
        let rows: [NumberAccessExplanation] = [
            .init(phone_number_id: "3", number_e164: "+15550003", level: "text", decided_by: "unruled"),
            .init(phone_number_id: "1", number_e164: "+15550001", level: "none", decided_by: "no-match"),
            .init(
                phone_number_id: "2",
                number_e164: "+15550002",
                level: "note",
                decided_by: "role",
                principal: "member"
            ),
        ].sortedForOwner()
        XCTAssertEqual(rows.map(\.number_e164), ["+15550001", "+15550002", "+15550003"])
    }

    func testKnowsWhichLevelsAreARestriction() {
        XCTAssertFalse(numberAccessIsRestricted("text"))
        XCTAssertTrue(numberAccessIsRestricted("note"))
        XCTAssertTrue(numberAccessIsRestricted("none"))
    }

    func testDecodesAResponseWithNoNumbers() {
        // A workspace with no numbers yet: the array key can be absent, and the
        // team screen must not fail to open because of it.
        let json = #"{"user_id":"u1"}"#
        let decoded = try? JSONDecoder().decode(MemberNumberAccess.self, from: Data(json.utf8))
        XCTAssertEqual(decoded?.numbers.count, 0)
    }
}
