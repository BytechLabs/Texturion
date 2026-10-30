import XCTest
@testable import Loonext

/// Answers every request with a refusal that names `requestId`, or fails to
/// connect at all, so a test can look for that id in DiagnosticsLog.
private struct RefusingTransport: HTTPClient {
    let requestId: String
    let unreachable: Bool

    func data(for request: URLRequest) async throws -> (Data, URLResponse) {
        if unreachable { throw URLError(.notConnectedToInternet) }
        let body = "{\"error\":{\"code\":\"not_found\",\"message\":\"Not found.\",\"request_id\":\""
            + requestId + "\"}}"
        let url = request.url ?? URL(string: "https://api.loonext.com/v1")!
        let response = HTTPURLResponse(url: url, statusCode: 404, httpVersion: nil, headerFields: nil)!
        return (Data(body.utf8), response)
    }
}

/// Ring beacons on the wire. apps/api's ring-beacons.test.ts checks the stage
/// words RingBeacons.swift spells; this checks what a beacon carries, and that
/// a stage is sent once per session.
@MainActor
final class RingBeaconsTests: XCTestCase {
    private func call(
        _ direction: CallDirection,
        _ phase: CallPhase,
        sessionId: String? = nil
    ) -> CallSnapshot {
        CallSnapshot(
            id: "in-1",
            direction: direction,
            peerName: "Dana",
            peerNumber: "+16135550100",
            phase: phase,
            sessionId: sessionId
        )
    }

    func testAnAnswerOrDeclineIsAboutARingOnlyWhileItRings() {
        // The session the INVITE named, which a ringing call's snapshot always
        // lacks: without it a decline has no session to report under.
        XCTAssertEqual(
            "v3:ring-1",
            RingBeacons.ringingSession(call(.inbound, .ringing), ringSession: "v3:ring-1")
        )
        XCTAssertEqual(
            "v3:resolved",
            RingBeacons.ringingSession(call(.inbound, .ringing, sessionId: "v3:resolved"), ringSession: nil)
        )
        XCTAssertNil(RingBeacons.ringingSession(call(.inbound, .ringing), ringSession: nil))
        XCTAssertNil(RingBeacons.ringingSession(call(.inbound, .active), ringSession: "v3:ring-1"))
        XCTAssertNil(RingBeacons.ringingSession(call(.outbound, .connecting), ringSession: "v3:ring-1"))
        XCTAssertNil(RingBeacons.ringingSession(nil, ringSession: "v3:ring-1"))
    }

    private func signedInStore() -> SessionStore {
        let store = SessionStore(storage: InMemorySessionStorage())
        store.save(Session(
            accessToken: "test-token",
            refreshToken: "test-refresh",
            expiresAt: Date().timeIntervalSince1970 + 3600,
            userId: "u1",
            email: "tester@loonext.test"
        ))
        return store
    }

    private func logged(_ marker: String) -> Bool {
        DiagnosticsLog.entries().contains { ($0.detail ?? "").contains(marker) }
    }

    func testABeaconTheServerRefusesLeavesNothingInTheSupportLog() async {
        let refused = ApiClient(
            sessionStore: signedInStore(),
            auth: SupabaseAuth(),
            transport: RefusingTransport(requestId: "req-beacon-quiet", unreachable: false)
        )
        await refused.sendQuietly("POST", "/v1/ring-beacons", body: Data("{}".utf8), companyId: "c1")
        XCTAssertFalse(logged("req-beacon-quiet"))

        // The control: the same refusal through the ordinary path is logged, so
        // the absence above is the quiet path's doing and not the check's.
        let ordinary = ApiClient(
            sessionStore: signedInStore(),
            auth: SupabaseAuth(),
            transport: RefusingTransport(requestId: "req-beacon-loud", unreachable: false)
        )
        _ = try? await ordinary.raw("POST", "/v1/ring-beacons", body: Data("{}".utf8), companyId: "c1")
        XCTAssertTrue(logged("req-beacon-loud"))
    }

    func testABeaconThatCannotConnectLeavesNothingInTheSupportLog() async {
        DiagnosticsLog.clear()
        let offline = ApiClient(
            sessionStore: signedInStore(),
            auth: SupabaseAuth(),
            transport: RefusingTransport(requestId: "unused", unreachable: true)
        )
        await offline.sendQuietly("POST", "/v1/ring-beacons", body: Data("{}".utf8), companyId: "c1")
        XCTAssertFalse(DiagnosticsLog.entries().contains { $0.event == "unreachable" })
    }
    func testTheBodyIsTheSessionTheStageAndDeviceStateAndNothingElse() throws {
        let body = RingBeaconBody(
            call_session_id: "v3:sess-1",
            stage: RingBeaconStage.answered.rawValue,
            occurred_at: "2026-10-30T12:00:00.123Z",
            os: "ios-26.1",
            permissions: ["notifications": "granted", "microphone": "denied"],
            power_save: true
        )
        let data = try JSONEncoder().encode(body)
        let object = try XCTUnwrap(
            try JSONSerialization.jsonObject(with: data) as? [String: Any]
        )
        XCTAssertEqual(
            Set(object.keys),
            ["call_session_id", "stage", "occurred_at", "os", "permissions", "power_save"]
        )
        XCTAssertEqual(object["stage"] as? String, "answered")
        XCTAssertEqual(object["power_save"] as? Bool, true)
    }

    func testAFactThePhoneCouldNotReadIsLeftOut() throws {
        let body = RingBeaconBody(
            call_session_id: "v3:sess-1",
            stage: RingBeaconStage.pushReceived.rawValue,
            occurred_at: "2026-10-30T12:00:00.123Z",
            os: "ios-26.1",
            permissions: [:],
            power_save: nil
        )
        let data = try JSONEncoder().encode(body)
        let object = try XCTUnwrap(
            try JSONSerialization.jsonObject(with: data) as? [String: Any]
        )
        XCTAssertNil(object["power_save"])
    }

    func testEachStageIsSentOncePerSessionAndTheMemoryStaysBounded() {
        var ledger = RingBeaconLedger(capacity: 2)
        XCTAssertTrue(ledger.firstTime("s1", .answered))
        XCTAssertFalse(ledger.firstTime("s1", .answered))
        XCTAssertTrue(ledger.firstTime("s1", .declined))
        XCTAssertTrue(ledger.firstTime("s2", .answered))
        // s1/answered was the oldest of three and has been forgotten.
        XCTAssertTrue(ledger.firstTime("s1", .answered))
    }

    func testTheTimestampIsOneTheServerAccepts() {
        let stamp = RingBeacons.timestamp(Date(timeIntervalSince1970: 1_793_448_000.25))
        XCTAssertTrue(stamp.hasSuffix("Z"), stamp)
        XCTAssertTrue(stamp.contains("."), stamp)
        XCTAssertNotNil(ISO8601DateFormatter().date(from: stamp.replacingOccurrences(
            of: #"\.\d+"#,
            with: "",
            options: .regularExpression
        )))
    }

    func testTheStageWordsAreTheServers() {
        let words: [RingBeaconStage] = [
            .pushReceived, .osReported, .ringMeSent, .ringingShown, .answered, .declined,
        ]
        XCTAssertEqual(
            words.map(\.rawValue),
            ["push_received", "os_reported", "ring_me_sent", "ringing_shown", "answered", "declined"]
        )
    }
}
