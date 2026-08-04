import XCTest
@testable import Loonext

/// #289 — the socket a backgrounded phone should not be holding.
///
/// Vectors shared with packages/shared/src/realtime-lifecycle.test.ts and the
/// Kotlin port. Two platforms disagreeing about when to drop a socket is how one
/// of them ends up holding it forever, and the symptom of that is a name on the
/// battery screen rather than a bug report.
final class RealtimeLifecycleTests: XCTestCase {

    func testHoldsItWhileSomebodyIsLookingAtTheApp() {
        XCTAssertTrue(
            RealtimeLifecycle.shouldHold(foreground: true, backgroundedForMs: 0, callActive: false)
        )
        XCTAssertNil(
            RealtimeLifecycle.dropDelayMs(foreground: true, backgroundedForMs: 0, callActive: false)
        )
    }

    func testHoldsItThroughAQuickAppSwitch() {
        // Photographing a job, checking an address in Maps, answering a text on
        // a personal line. Tearing the socket down and rebuilding it for each
        // of those costs MORE radio than staying up: a fresh connection is a
        // DNS lookup, a TCP handshake, a TLS handshake and a channel join,
        // against one 300-byte heartbeat.
        XCTAssertTrue(
            RealtimeLifecycle.shouldHold(
                foreground: false, backgroundedForMs: 5_000, callActive: false
            )
        )
    }

    func testDropsItOnceThePhoneIsGenuinelyInAPocket() {
        XCTAssertFalse(
            RealtimeLifecycle.shouldHold(
                foreground: false,
                backgroundedForMs: RealtimeLifecycle.backgroundGraceMs,
                callActive: false
            )
        )
    }

    func testNeverDropsItUnderALiveCall() {
        // Call state rides realtime — hold, transfer, the far end hanging up.
        // A call is also exactly when the phone is out of the pocket and often
        // plugged in.
        for backgrounded in [0, RealtimeLifecycle.backgroundGraceMs, 3_600_000] {
            XCTAssertTrue(
                RealtimeLifecycle.shouldHold(
                    foreground: false, backgroundedForMs: backgrounded, callActive: true
                ),
                "\(backgrounded)"
            )
            XCTAssertNil(
                RealtimeLifecycle.dropDelayMs(
                    foreground: false, backgroundedForMs: backgrounded, callActive: true
                )
            )
        }
    }

    func testCountsDownTheRemainingGrace() {
        XCTAssertEqual(
            RealtimeLifecycle.dropDelayMs(
                foreground: false, backgroundedForMs: 10_000, callActive: false
            ),
            RealtimeLifecycle.backgroundGraceMs - 10_000
        )
    }

    func testNeverReturnsANegativeDelay() {
        // A phone backgrounded overnight comes back with a huge elapsed figure,
        // and Task.sleep on a negative duration is not what anyone intended.
        XCTAssertEqual(
            RealtimeLifecycle.dropDelayMs(
                foreground: false, backgroundedForMs: 86_400_000, callActive: false
            ),
            0
        )
    }

    func testAgreesWithShouldHoldAtEveryBoundary() {
        // The two answer the same question — "is the socket wanted" and "when
        // does that change" — and the view model wires both. If they can
        // disagree, the app schedules a drop it then refuses to perform and the
        // socket stays up forever.
        for backgrounded in [
            0,
            1,
            RealtimeLifecycle.backgroundGraceMs - 1,
            RealtimeLifecycle.backgroundGraceMs,
            RealtimeLifecycle.backgroundGraceMs + 1,
        ] {
            let held = RealtimeLifecycle.shouldHold(
                foreground: false, backgroundedForMs: backgrounded, callActive: false
            )
            let delay = RealtimeLifecycle.dropDelayMs(
                foreground: false, backgroundedForMs: backgrounded, callActive: false
            )
            XCTAssertEqual(delay == 0, !held, "\(backgrounded)")
        }
    }

    func testHoldsTheSharedGraceWindow() {
        // Pinned against packages/shared/src/realtime-lifecycle.ts. A phone
        // that waited a different amount of time from the other would be a
        // silent divergence in the one behaviour this issue is about.
        XCTAssertEqual(RealtimeLifecycle.backgroundGraceMs, 30_000)
    }
}
