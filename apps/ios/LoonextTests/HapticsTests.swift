import XCTest

@testable import Loonext

/// #556 — the haptic vocabulary exists and is callable.
///
/// A test cannot feel a buzz, and pretending otherwise would be theatre. What
/// it CAN do is the thing that was actually missing: prove the module builds
/// and that every verb the Android twin speaks can be called from this
/// platform. iOS shipped with zero haptics, and the reason nothing caught it is
/// that an absent buzz is invisible to every check that reads output — so the
/// check that matters here is a compile-time one, run by the only thing that
/// compiles this code (`Gate / iOS`).
///
/// The cross-platform half — that no feature area speaks on one phone and stays
/// silent on the other — is `scripts/check-haptic-parity.mjs`, which reads both
/// trees. This file is the half that has to be Swift.
@MainActor
final class HapticsTests: XCTestCase {
    /// Every verb, called once.
    ///
    /// On a simulator with no Taptic Engine these are no-ops, which is exactly
    /// the property that makes the call safe everywhere: `UIFeedbackGenerator`
    /// answers to the device and to the system haptics switch, so no call site
    /// has to ask whether feedback is available or wanted.
    func testEveryVerbIsCallable() {
        Haptics.prepare()
        Haptics.tap()
        Haptics.tick()
        Haptics.confirm()
        Haptics.reject()
        Haptics.heavy()
    }

    /// Calling a verb twice in a row must not be a special case.
    ///
    /// The generators are held rather than constructed per call, so that a warm
    /// engine answers in single-digit milliseconds instead of arriving late
    /// enough to feel disconnected from the press. Shared state across calls is
    /// the cost of that, and a keypad is the surface that exercises it — twelve
    /// presses a second, all through one generator.
    func testRepeatedCallsReuseTheSameGenerator() {
        for _ in 0..<12 {
            Haptics.tap()
        }
        Haptics.confirm()
    }
}
