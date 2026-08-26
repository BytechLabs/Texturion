import XCTest

@testable import Loonext

/// #330 — the lock's rules, which are the whole feature.
///
/// `LAContext` is a platform call. What decides whether a customer's
/// conversations are on screen while somebody else holds the phone is the
/// arithmetic in `AppLock`, and that is what these pin — the same set the Kotlin
/// twin asserts, because a lock that behaves differently on the two phones a crew
/// carries is one nobody can describe to their staff.
final class AppLockTests: XCTestCase {
    private let now: TimeInterval = 1_700_000_000

    func testOffMeansNeverLocked() {
        // A sole operator must not meet a lock they never asked for. The promise
        // is answering inside five minutes; friction nobody chose is the fastest
        // route to this being switched off by everyone.
        XCTAssertNil(AppLock.reasonToLock(enabled: false, unlockedAt: nil, now: now))
        XCTAssertNil(AppLock.reasonToLock(enabled: false, unlockedAt: 0, now: now))
    }

    func testAFreshProcessLocksHoweverRecentlyItWasUsed() {
        // `unlockedAt` is per-PROCESS and never persisted, so a cold start arrives
        // with nil. This is the case that matters most: the phone was handed over,
        // the app was killed, and the recipient taps the icon.
        XCTAssertEqual(
            AppLock.reasonToLock(enabled: true, unlockedAt: nil, now: now),
            .neverUnlocked
        )
    }

    func testAGlanceAtAnotherAppDoesNotAskAgain() {
        XCTAssertNil(
            AppLock.reasonToLock(enabled: true, unlockedAt: now - 5, now: now)
        )
    }

    func testTheGraceWindowIsABoundaryNotASuggestion() {
        // Exactly at the window is still unlocked; a second past is not. An
        // off-by-one here is either a lock that never fires or one that fires a
        // minute early, and both read as "it is broken".
        XCTAssertNil(
            AppLock.reasonToLock(
                enabled: true,
                unlockedAt: now - AppLock.graceSeconds,
                now: now
            )
        )
        XCTAssertEqual(
            AppLock.reasonToLock(
                enabled: true,
                unlockedAt: now - AppLock.graceSeconds - 1,
                now: now
            ),
            .awayTooLong
        )
    }

    func testAClockThatWentBackwardsLocks() {
        // Moving the phone's clock back would otherwise make every unlock look
        // like it happened moments ago — a way past the lock needing no Face ID.
        XCTAssertEqual(
            AppLock.reasonToLock(enabled: true, unlockedAt: now + 60, now: now),
            .awayTooLong
        )
    }

    func testItRefusesToTurnOnWhereThePhoneCannotEnforceIt() {
        XCTAssertFalse(AppLock.canEnable(hasBiometric: false, hasPasscode: false))
        XCTAssertTrue(AppLock.canEnable(hasBiometric: true, hasPasscode: false))
        XCTAssertTrue(AppLock.canEnable(hasBiometric: false, hasPasscode: true))
        XCTAssertTrue(AppLock.cannotEnableNote().contains("passcode"))
    }

    func testTheLockScreenNeverReadsAsAFault() {
        // Nothing has gone wrong when this shows: the person asked for it, and the
        // phone is theirs. "Session expired" lies about whose doing it is.
        for reason in AppLock.Reason.allCases {
            let headline = AppLock.headline(reason)
            XCTAssertTrue(headline.hasPrefix("Unlock"), headline)
            for word in ["expired", "error", "failed", "invalid", "denied"] {
                XCTAssertFalse(headline.lowercased().contains(word), "\(reason): \(headline)")
            }
        }
    }

    /// The two phones agree, checked against the Kotlin rather than assumed.
    ///
    /// The rules are hand-ported, and nothing about Swift says the Kotlin moved.
    /// The grace window is the one value a crew would notice differing, so it is
    /// read out of the other client's source rather than pinned twice.
    func testTheGraceWindowMatchesTheAndroidTwin() throws {
        var dir = URL(fileURLWithPath: #filePath).deletingLastPathComponent()
        let relative = "apps/android/app/src/main/kotlin/com/loonext/android/core/security/AppLock.kt"
        var found: URL?
        while true {
            let candidate = dir.appendingPathComponent(relative)
            if FileManager.default.fileExists(atPath: candidate.path) {
                found = candidate
                break
            }
            let parent = dir.deletingLastPathComponent()
            if parent.path == dir.path { break }
            dir = parent
        }
        let kotlin = try String(contentsOf: try XCTUnwrap(found), encoding: .utf8)
        // `const val GRACE_MILLIS: Long = 60_000L`
        XCTAssertTrue(
            kotlin.contains("GRACE_MILLIS: Long = \(Int(AppLock.graceSeconds))_000L"),
            "the grace window has drifted from the Android app's AppLock.kt"
        )
    }
}
