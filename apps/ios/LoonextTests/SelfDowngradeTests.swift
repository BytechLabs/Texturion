import XCTest

@testable import Loonext

/// #538 — the warning before somebody takes powers off themselves.
///
/// Two halves. The behaviour tests assert the sentence; the parity tests read
/// `packages/shared/src/capabilities.ts` and fail if any role's capability set has
/// drifted from the source.
///
/// That second half is the one that earns its keep. This file carries its own copy
/// of the table because iOS has no capability model, and the Kotlin twin's copy of
/// the same table was wrong in two places on its first run — it gave the bookkeeper
/// the history log and invented two owner capabilities. A repeated table nobody
/// checks is one that eventually tells somebody they are keeping access they have
/// just lost.
final class SelfDowngradeTests: XCTestCase {

    func testNamesWhatAnAdminGivesUpByBecomingAMember() {
        let lost = SelfDowngrade.capabilitiesLost(from: "admin", to: "member")
        XCTAssertTrue(lost.contains("team.manage"))
        XCTAssertTrue(lost.contains("billing.manage"))
        XCTAssertFalse(lost.contains("conversations.read"))
    }

    func testTakesNothingAwayOnAPromotionOrSidewaysMove() {
        XCTAssertFalse(SelfDowngrade.isDowngrade(from: "member", to: "admin"))
        XCTAssertNil(SelfDowngrade.warning(from: "member", to: "admin"))
        XCTAssertNil(SelfDowngrade.warning(from: "admin", to: "admin"))
    }

    func testSinglesOutLosingTheAbilityToChangeItBack() {
        // THE POINT OF THE ISSUE. "You will have less access" is accepted easily and
        // correctly; "you cannot put this back yourself" is the part somebody would
        // want to know before tapping.
        XCTAssertTrue(SelfDowngrade.losesRoleControl(from: "admin", to: "member"))
        let warning = SelfDowngrade.warning(from: "admin", to: "member")!
        XCTAssertTrue(warning.contains("change it back"), warning)
        XCTAssertTrue(warning.contains("only an owner can"), warning)
    }

    func testSaysWhatThingsAreNotWhatTheyAreCalledInTheCode() {
        let warning = SelfDowngrade.warning(from: "admin", to: "member")!
        XCTAssertFalse(warning.contains("team.manage"), warning)
        XCTAssertFalse(warning.contains("_"), warning)
    }

    func testNamesThreeThingsAtMostAndCountsTheRest() {
        let warning = SelfDowngrade.warning(from: "admin", to: "member")!
        XCTAssertNotNil(
            warning.range(of: "and [0-9]+ more", options: .regularExpression),
            warning
        )
    }

    func testHandlesTheRolesThatAreNotOnALine() {
        // #315: read_only and bookkeeper are capability SETS, not rungs, so this
        // cannot be a rank comparison — a bookkeeper has billing a member does not.
        XCTAssertTrue(SelfDowngrade.isDowngrade(from: "member", to: "read_only"))
        XCTAssertTrue(SelfDowngrade.isDowngrade(from: "member", to: "bookkeeper"))
        XCTAssertFalse(SelfDowngrade.losesRoleControl(from: "member", to: "read_only"))
        XCTAssertTrue(SelfDowngrade.losesRoleControl(from: "admin", to: "bookkeeper"))
    }

    func testAnOwnerLosesSomethingByBecomingAnythingElse() {
        for to in ["admin", "member", "read_only", "bookkeeper"] {
            XCTAssertTrue(SelfDowngrade.isDowngrade(from: "owner", to: to), to)
        }
    }

    // ------------------------------------------------ against the original

    /// The shared source, with carriage returns stripped.
    ///
    /// This tree is checked out with Windows line endings, and a multi-line pattern
    /// written against Unix ones matches nothing — which fails as "the declaration
    /// has changed shape" rather than as "your needle has the wrong newline". The
    /// Kotlin twin's parity tests failed that way first.
    private func sharedSource() throws -> String {
        var dir = URL(fileURLWithPath: #filePath).deletingLastPathComponent()
        var found: URL?
        while true {
            let candidate = dir.appendingPathComponent("packages/shared/src/capabilities.ts")
            if FileManager.default.fileExists(atPath: candidate.path) {
                found = candidate
                break
            }
            let parent = dir.deletingLastPathComponent()
            if parent.path == dir.path { break }
            dir = parent
        }
        let text = try String(contentsOf: try XCTUnwrap(found), encoding: .utf8)
        return text.replacingOccurrences(of: "\r", with: "")
    }

    /// The capability ids inside one role's entry in ROLE_CAPABILITIES.
    private func sharedSet(_ role: String, in source: String) throws -> [String] {
        let start = try XCTUnwrap(
            source.range(of: "\n  \(role): ["),
            "no \(role) entry in ROLE_CAPABILITIES"
        )
        let rest = source[start.upperBound...]
        let end = try XCTUnwrap(rest.range(of: "]"), "\(role) entry never closes")
        let body = String(rest[..<end.lowerBound])
        return matches(#""([a-z.]+)""#, in: body)
    }

    private func matches(_ pattern: String, in text: String) -> [String] {
        guard let re = try? NSRegularExpression(pattern: pattern) else { return [] }
        let ns = text as NSString
        return re.matches(in: text, range: NSRange(location: 0, length: ns.length))
            .map { ns.substring(with: $0.range(at: 1)) }
    }

    /// Every role's capability set matches the shared module, exactly.
    func testEveryRolesCapabilitiesMatchTheSharedModule() throws {
        let shared = try sharedSource()
        for (role, expected) in SelfDowngrade.capabilities {
            XCTAssertEqual(
                try sharedSet(role, in: shared),
                expected,
                "\(role) has drifted from the shared module"
            )
        }
    }

    /// And the owner-only capabilities are still exactly what is left over.
    ///
    /// The owner's set is derived rather than listed, so a new capability the owner
    /// alone holds would silently fall out of it — and an owner never gets a refusal
    /// that would reveal the gap.
    func testTheOwnerOnlyCapabilitiesMatchTheSharedModule() throws {
        let shared = try sharedSource()
        let start = try XCTUnwrap(shared.range(of: "export const CAPABILITIES = ["))
        let rest = shared[start.upperBound...]
        let end = try XCTUnwrap(rest.range(of: "\n] as const"))
        let all = matches(#""([a-z.]+)""#, in: String(rest[..<end.lowerBound]))
        var nonOwner: [String] = []
        for set in SelfDowngrade.capabilities.values {
            for cap in set where !nonOwner.contains(cap) { nonOwner.append(cap) }
        }
        XCTAssertEqual(
            all.filter { !nonOwner.contains($0) }.sorted(),
            SelfDowngrade.ownerOnly.sorted(),
            "the owner-only capabilities have drifted from the shared module"
        )
    }
}
