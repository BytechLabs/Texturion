import XCTest
@testable import Loonext

/// #186 item 6 — the transient-SDK-error suppression gate. "Calling is
/// temporarily unavailable" is reserved for a PERSISTENT outage (3+ consecutive
/// errors without a `.ready` between) or an error while a call is live; a
/// single socket blip is routine mobile churn and stays silent. The Android
/// `worthTelling` twin.
final class SoftphoneErrorGateTests: XCTestCase {
    func testSingleTransientErrorIsSuppressed() {
        XCTAssertFalse(SoftphoneErrorGate.shouldSurface(hasLiveCall: false, consecutiveErrors: 1))
        XCTAssertFalse(SoftphoneErrorGate.shouldSurface(hasLiveCall: false, consecutiveErrors: 2))
    }

    func testPersistentOutageSurfaces() {
        XCTAssertTrue(SoftphoneErrorGate.shouldSurface(hasLiveCall: false, consecutiveErrors: 3))
        XCTAssertTrue(SoftphoneErrorGate.shouldSurface(hasLiveCall: false, consecutiveErrors: 9))
    }

    func testErrorDuringLiveCallSurfacesImmediately() {
        // Even the first error is worth telling when a call is actually up.
        XCTAssertTrue(SoftphoneErrorGate.shouldSurface(hasLiveCall: true, consecutiveErrors: 0))
        XCTAssertTrue(SoftphoneErrorGate.shouldSurface(hasLiveCall: true, consecutiveErrors: 1))
    }

    func testThresholdConstant() {
        XCTAssertEqual(SoftphoneErrorGate.persistentThreshold, 3)
    }
}
