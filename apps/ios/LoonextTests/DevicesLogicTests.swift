import XCTest
@testable import Loonext

/// #236 — the three pieces of the signed-in-devices screen that are logic
/// rather than layout. Ported 1:1 from the Android twin's DevicesLogicTest so
/// the two clients promise the same words and the same order; this file is
/// where a silent hand-port divergence would be caught, since neither app can
/// see the other's copy.
final class DevicesLogicTests: XCTestCase {
    private func session(
        _ id: String,
        client: String = SessionClient.ios,
        current: Bool = false,
        lastActive: String = "2026-07-28T10:00:00Z"
    ) -> DeviceSession {
        DeviceSession(
            id: id,
            client: client,
            user_agent: nil,
            location: nil,
            signed_in_at: "2026-07-01T10:00:00Z",
            last_active_at: lastActive,
            current: current
        )
    }

    func testNamesEachAppAndSaysSoPlainlyWhenItDoesNotKnow() {
        XCTAssertEqual(deviceClientLabel(SessionClient.web), "Web browser")
        XCTAssertEqual(deviceClientLabel(SessionClient.android), "Android app")
        XCTAssertEqual(deviceClientLabel(SessionClient.ios), "iPhone or iPad")
        // A client that predates the X-Client header. "Unrecognised device" is
        // the row somebody SHOULD look twice at, so it must not read as a bug.
        XCTAssertEqual(deviceClientLabel(SessionClient.unknown), "Unrecognised device")
        XCTAssertEqual(deviceClientLabel("something-new"), "Unrecognised device")
    }

    func testCountsDevicesInASentenceAPersonWouldSay() {
        XCTAssertEqual(deviceCountLabel(1), "1 device")
        XCTAssertEqual(deviceCountLabel(3), "3 devices")
        XCTAssertEqual(deviceCountLabel(0), "0 devices")
    }

    func testPutsThePhoneInYourHandFirstWhateverItsActivitySays() {
        let ordered = orderMyDevices([
            session("busy-laptop", lastActive: "2026-07-28T18:00:00Z"),
            session("this-phone", current: true, lastActive: "2026-07-20T09:00:00Z"),
            session("old-tablet", lastActive: "2026-07-25T09:00:00Z"),
        ])
        // The device being read on comes first even though it is the LEAST
        // recently active — the reader has to identify and dismiss it before
        // any other row means anything.
        XCTAssertEqual(ordered.first?.id, "this-phone")
        // Everything else falls back to most recently active.
        XCTAssertEqual(ordered.dropFirst().map(\.id), ["busy-laptop", "old-tablet"])
    }

    func testLeavesAnEmptyListEmptyRatherThanInventingARow() {
        XCTAssertTrue(orderMyDevices([]).isEmpty)
    }

    func testEveryClientKindHasASymbol() {
        // A missing SF Symbol renders as a blank box, which in a security list
        // reads as a broken row rather than an unknown device.
        for kind in [
            SessionClient.web, SessionClient.android, SessionClient.ios,
            SessionClient.unknown, "future-client",
        ] {
            XCTAssertFalse(deviceClientSymbol(kind).isEmpty)
        }
    }

    func testAbsentServerFieldsDecodeToTheSafeAnswer() throws {
        // An older server, or a row written before X-Client existed: `client`
        // and `current` absent must mean "unknown device, not this one" rather
        // than failing the whole list to decode.
        let json = """
        {"id":"s1","signed_in_at":"2026-07-01T10:00:00Z","last_active_at":"2026-07-02T10:00:00Z"}
        """
        let decoded = try JSONDecoder().decode(DeviceSession.self, from: Data(json.utf8))
        XCTAssertEqual(decoded.clientKind, SessionClient.unknown)
        XCTAssertFalse(decoded.isCurrent)
    }
}
