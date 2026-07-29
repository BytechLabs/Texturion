import XCTest
@testable import Loonext

/// #339 — the same table of cases `packages/shared/src/app-version.test.ts`
/// asserts, against the Swift hand-port.
///
/// The reason this file exists rather than trusting the port: shared logic
/// that is hand-copied drifts silently, and a drift HERE means an iOS build
/// that exempts itself from a floor, or one that blocks itself against a floor
/// nobody set. Neither would show up as a crash — and iOS cannot be compiled
/// on the box this was written on, so CI is where it is checked at all.
final class AppVersionTests: XCTestCase {
    func testPadsToFourSegmentsSoTwoAndTwoZeroZeroZeroAreOneBuild() {
        XCTAssertEqual(versionKey("2"), [2, 0, 0, 0])
        XCTAssertEqual(versionKey("2.0.0.0"), [2, 0, 0, 0])
    }

    func testRefusesAnythingThatIsNotAVersion() {
        // Never a number, never a zero: a garbage version that compared as
        // newer would exempt that build from every floor.
        for bad in ["1.4.0-beta", "v1", "", "latest", "1..2", "1.2.3.4.5", "99999"] {
            XCTAssertNil(versionKey(bad), bad)
        }
        XCTAssertNil(versionKey(nil))
    }

    func testOrdersBySegmentNotByString() {
        // "1.10.0" < "1.9.0" as strings, which would tell somebody on the
        // newest build that they are behind.
        XCTAssertTrue(isOlderThan("1.9.0", "1.10.0"))
        XCTAssertFalse(isOlderThan("1.10.0", "1.9.0"))
    }

    func testEqualVersionsAreNotOlderHoweverTheyAreWritten() {
        XCTAssertFalse(isOlderThan("2.0.0", "2"))
        XCTAssertFalse(isOlderThan("2", "2.0.0"))
    }

    func testAnUnreadableVersionOnEitherSideIsNeverOlder() {
        XCTAssertFalse(isOlderThan("garbage", "1.0.0"))
        XCTAssertFalse(isOlderThan("1.0.0", "garbage"))
        XCTAssertFalse(isOlderThan(nil, "1.0.0"))
        XCTAssertFalse(isOlderThan("1.0.0", nil))
    }

    private func policy(
        recommended: String? = nil,
        minimum: String? = nil
    ) -> AppReleasePolicy {
        AppReleasePolicy(
            platform: "ios",
            recommended_version: recommended,
            minimum_version: minimum,
            message: nil,
            update_url: nil
        )
    }

    func testSaysNothingWhenThereIsNoPolicy() {
        XCTAssertEqual(updateRequirement("1.0.0", nil), .none)
        XCTAssertEqual(updateRequirement("1.0.0", policy()), .none)
    }

    func testPromptsBelowTheRecommendedVersionAndStaysQuietAtOrAboveIt() {
        XCTAssertEqual(updateRequirement("1.0.0", policy(recommended: "1.1.0")), .soft)
        XCTAssertEqual(updateRequirement("1.1.0", policy(recommended: "1.1.0")), .none)
        XCTAssertEqual(updateRequirement("1.2.0", policy(recommended: "1.1.0")), .none)
    }

    func testBlocksBelowTheFloorAndTheFloorOutranksThePrompt() {
        XCTAssertEqual(
            updateRequirement("1.0.0", policy(recommended: "1.2.0", minimum: "1.1.0")),
            .block
        )
        XCTAssertEqual(
            updateRequirement("1.1.0", policy(recommended: "1.2.0", minimum: "1.1.0")),
            .soft
        )
    }

    func testNeverBlocksABuildThatDoesNotKnowItsOwnVersion() {
        // A misconfigured build is our mistake; blocking it makes it theirs.
        XCTAssertEqual(updateRequirement(nil, policy(minimum: "9.0.0")), .none)
        XCTAssertEqual(updateRequirement("", policy(minimum: "9.0.0")), .none)
        XCTAssertEqual(updateRequirement("nightly", policy(minimum: "9.0.0")), .none)
    }

    func testNeverBlocksAgainstAnUnreadableFloor() {
        XCTAssertEqual(updateRequirement("1.0.0", policy(minimum: "not-a-version")), .none)
    }

    func testDecodesAPolicyThatOmitsEveryOptionalField() throws {
        // The server's "no demands" answer, which is what a fresh install and
        // every failure path both receive.
        let json = #"{"platform":"ios"}"#
        let decoded = try JSONDecoder().decode(AppReleasePolicy.self, from: Data(json.utf8))
        XCTAssertNil(decoded.minimum_version)
        XCTAssertEqual(updateRequirement("1.0.0", decoded), .none)
    }
}
