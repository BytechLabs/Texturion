import XCTest
@testable import Loonext

// MARK: - Canned transport + fixtures (file-scope, nonisolated)
//
// These are referenced from the `@Sendable` transport closure, which runs off
// the MainActor (on the `ApiClient` actor), so they must NOT be MainActor
// members — hence file scope rather than nesting inside the @MainActor case.

/// A canned HTTP transport: routes by URL path to fixed JSON, always 200.
private struct StubTransport: HTTPClient {
    let route: @Sendable (String) -> String

    func data(for request: URLRequest) async throws -> (Data, URLResponse) {
        let path = request.url?.path ?? ""
        let body = Data(route(path).utf8)
        let url = request.url ?? URL(string: "https://api.loonext.com/v1")!
        let response = HTTPURLResponse(
            url: url,
            statusCode: 200,
            httpVersion: nil,
            headerFields: nil
        )!
        return (body, response)
    }
}

private let emptyPageJSON = #"{"data":[],"next_cursor":null}"#

private let contactJSON = #"""
{"id":"ct1","phone_e164":"+14155550134","name":"Ray","address":null,
 "notes":null,"consent_source":null,"consent_at":null,
 "consent_attested_by":null,"deleted_at":null,
 "created_at":"2026-07-01T00:00:00Z","updated_at":"2026-07-10T12:00:00Z"}
"""#

private func detailJSON(messageId: String) -> String {
    #"""
    {"id":"conv1","company_id":"c1","contact_id":"ct1","phone_number_id":"pn1",
     "status":"open","is_spam":false,
     "last_message_at":"2026-07-10T12:00:00Z",
     "created_at":"2026-07-01T00:00:00Z","updated_at":"2026-07-10T12:00:00Z",
     "contact":{"id":"ct1","name":"Ray","phone_e164":"+14155550134",
       "address":null,"notes":null,"consent_source":"inbound_sms",
       "consent_at":"2026-07-01T00:00:00Z","deleted_at":null},
     "messages":{"data":[
       {"id":"\#(messageId)","conversation_id":"conv1","direction":"inbound",
        "body":"Are you free Tuesday?","status":"received",
        "created_at":"2026-07-10T12:00:00Z"}
     ],"next_cursor":null}}
    """#
}

/// Routes the four reads `refreshAfterReconnect` performs: detail (carries the
/// message), events, pinned, contact. Path suffixes disambiguate the `/pinned`
/// and `/events` sub-resources from the bare conversation detail.
private func makeRoute(detailMessageId: String) -> @Sendable (String) -> String {
    { path in
        if path.hasSuffix("/events") || path.hasSuffix("/pinned") {
            return emptyPageJSON
        }
        if path.contains("/contacts/") {
            return contactJSON
        }
        return detailJSON(messageId: detailMessageId)
    }
}

// MARK: - Merge (scrollback-preservation) fixtures

/// Toggles whether page 1 carries the "missed" message yet — flipped by the
/// test between the initial load and the resync. Lock-guarded because the route
/// closure reads it from the `ApiClient` actor while the test writes it.
private final class RouteState: @unchecked Sendable {
    private let lock = NSLock()
    private var landed = false
    var missedLanded: Bool {
        get { lock.lock(); defer { lock.unlock() }; return landed }
        set { lock.lock(); landed = newValue; lock.unlock() }
    }
}

private func message(id: String, at: String, body: String) -> String {
    #"""
    {"id":"\#(id)","conversation_id":"conv1","direction":"inbound",
     "body":"\#(body)","status":"received","created_at":"\#(at)"}
    """#
}

/// Conversation detail with page 1 = [m-page1] (or [m-new, m-page1] once the
/// message has "landed"), and `next_cursor` set so older pages exist.
private func detailPageOneJSON(includeMissed: Bool) -> String {
    let newer = includeMissed
        ? message(id: "m-new", at: "2026-07-10T13:00:00Z", body: "Just landed") + ","
        : ""
    let pageOne = message(id: "m-page1", at: "2026-07-10T12:00:00Z", body: "Page one")
    return #"""
    {"id":"conv1","company_id":"c1","contact_id":"ct1","phone_number_id":"pn1",
     "status":"open","is_spam":false,
     "last_message_at":"2026-07-10T13:00:00Z",
     "created_at":"2026-07-01T00:00:00Z","updated_at":"2026-07-10T13:00:00Z",
     "contact":{"id":"ct1","name":"Ray","phone_e164":"+14155550134",
       "address":null,"notes":null,"consent_source":"inbound_sms",
       "consent_at":"2026-07-01T00:00:00Z","deleted_at":null},
     "messages":{"data":[\#(newer)\#(pageOne)],"next_cursor":"cursor1"}}
    """#
}

/// The older page `loadOlderMessages` fetches (end of history).
private func olderMessagesPageJSON() -> String {
    #"{"data":[\#(message(id: "m-older", at: "2026-07-09T12:00:00Z", body: "Older page"))],"next_cursor":null}"#
}

private func mergeRoute(_ state: RouteState) -> @Sendable (String) -> String {
    { path in
        if path.hasSuffix("/events") || path.hasSuffix("/pinned") {
            return emptyPageJSON
        }
        if path.contains("/contacts/") {
            return contactJSON
        }
        if path.hasSuffix("/messages") {
            return olderMessagesPageJSON()
        }
        return detailPageOneJSON(includeMissed: state.missedLanded)
    }
}

// MARK: - Tests

/// #215 Part A — the resync safety net. `refreshAfterReconnect` is the method
/// the scenePhase-`.active` foreground trigger (and the socket re-JOIN) calls;
/// it must pull fresh server state so a realtime frame that never reached the
/// controller (dropped/late/missed while blurred) is recovered without the user
/// navigating away. Driven through a canned transport — no live socket, no live
/// backend (JSON shapes mirror ModelDecodingTests).
@MainActor
final class ThreadControllerResyncTests: XCTestCase {
    private let companyId = "c1"
    private let conversationId = "conv1"

    private func seededStore() -> SessionStore {
        let store = SessionStore()
        // A far-future access token so `ApiClient` uses it directly — the auth
        // refresh path (a real network call) is never taken.
        store.save(Session(
            accessToken: "test-token",
            refreshToken: "test-refresh",
            expiresAt: Date().timeIntervalSince1970 + 3600,
            userId: "u1",
            email: "tester@loonext.test"
        ))
        return store
    }

    private func makeController(
        store: SessionStore,
        route: @escaping @Sendable (String) -> String
    ) -> ThreadController {
        let api = ApiClient(
            sessionStore: store,
            auth: SupabaseAuth(),
            transport: StubTransport(route: route)
        )
        let meApi = MeApi(api: api)
        return ThreadController(
            repo: MessagingRepository(api: api),
            meApi: meApi,
            uploader: NoteFileUploader(sessionStore: store, meApi: meApi),
            contacts: ContactMutations(
                api: api,
                multipart: MultipartClient(api: api, sessionStore: store)
            ),
            companyId: companyId,
            conversationId: conversationId,
            meUserId: "u1"
        )
    }

    /// `refreshAfterReconnect` spawns an internal Task; poll its @Observable
    /// state until the effect lands (or a timeout).
    private func waitUntil(
        timeout: TimeInterval = 5,
        _ predicate: () -> Bool
    ) async -> Bool {
        let deadline = Date().addingTimeInterval(timeout)
        while Date() < deadline {
            if predicate() { return true }
            try? await Task.sleep(for: .milliseconds(20))
        }
        return predicate()
    }

    /// The core #215 Part A contract: a message the backend has, that NO
    /// realtime event delivered to the controller, is recovered by
    /// `refreshAfterReconnect`.
    func testRefreshAfterReconnectRecoversAMessageNoEventDelivered() async throws {
        let store = seededStore()
        defer { store.clear() }
        // The harness authorizes reads with a keychain-seeded session; if the
        // test host has no keychain (rare), skip rather than red — the CI
        // "Mobile" simulator job has one.
        try XCTSkipIf(
            store.current() == nil,
            "keychain unavailable in this test host — cannot seed a session"
        )
        let recoveredId = "m-missed"
        let controller = makeController(
            store: store,
            route: makeRoute(detailMessageId: recoveredId)
        )

        // No realtime event is ever delivered — the frame was "dropped".
        XCTAssertFalse(
            controller.messages.contains { $0.id == recoveredId },
            "precondition: the missed message is absent before any resync"
        )

        controller.refreshAfterReconnect()

        let recovered = await waitUntil {
            controller.messages.contains { $0.id == recoveredId }
        }
        XCTAssertTrue(
            recovered,
            "refreshAfterReconnect must surface the message no realtime event delivered"
        )
        XCTAssertEqual(controller.conversation?.id, conversationId)
    }

    /// The scrollback-preservation contract: `refreshAfterReconnect` is the
    /// frequent foreground-resync target, so it must MERGE a fresh page 1 (still
    /// healing a missed message) WITHOUT discarding the older pages the user
    /// scrolled back to. A page-1 *replace* would drop them on every foreground.
    func testRefreshAfterReconnectMergesKeepingScrolledBackPages() async throws {
        let store = seededStore()
        defer { store.clear() }
        try XCTSkipIf(
            store.current() == nil,
            "keychain unavailable in this test host — cannot seed a session"
        )
        let state = RouteState()
        let controller = makeController(store: store, route: mergeRoute(state))

        // Initial load: page 1 = [m-page1], older pages available.
        controller.start()
        let loadedPageOne = await waitUntil { controller.messages.contains { $0.id == "m-page1" } }
        XCTAssertTrue(loadedPageOne, "precondition: page 1 loaded")

        // The user scrolls back — an older page loads and stays.
        controller.loadOlderMessages()
        let loadedOlder = await waitUntil { controller.messages.contains { $0.id == "m-older" } }
        XCTAssertTrue(loadedOlder, "precondition: the scrolled-back page loaded")

        // A message lands that NO realtime event delivered, then the app
        // foregrounds → the resync fires.
        state.missedLanded = true
        controller.refreshAfterReconnect()

        // The resync heals the missed page-1 message...
        let healed = await waitUntil { controller.messages.contains { $0.id == "m-new" } }
        XCTAssertTrue(healed, "resync must surface the missed page-1 message")

        // ...WITHOUT dropping the scrolled-back page (merge, not replace). The
        // merge is one atomic assignment, so m-older is present the instant
        // m-new is.
        XCTAssertTrue(
            controller.messages.contains { $0.id == "m-older" },
            "merge must keep the scrolled-back page — a page-1 replace would drop it"
        )
        XCTAssertTrue(
            controller.messages.contains { $0.id == "m-page1" },
            "page 1 stays too"
        )
    }
}
