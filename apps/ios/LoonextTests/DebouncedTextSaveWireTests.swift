import Foundation
import XCTest
@testable import Loonext

private actor AutosaveTransport: HTTPClient {
    private(set) var requests: [URLRequest] = []

    func data(for request: URLRequest) async throws -> (Data, URLResponse) {
        requests.append(request)
        let body = #"{"id":"contact","phone_e164":"+14165550100","created_at":"2026-11-18","updated_at":"2026-11-18"}"#
        let response = HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!
        return (Data(body.utf8), response)
    }
}

final class DebouncedTextSaveWireTests: XCTestCase {
    @MainActor
    func testLeavingContactSendsOnlyTheLatestNotesPatch() async throws {
        let store = SessionStore(storage: InMemorySessionStorage())
        store.save(Session(
            accessToken: "test-token",
            refreshToken: "test-refresh",
            expiresAt: Date().timeIntervalSince1970 + 3600,
            userId: "member",
            email: "tester@loonext.test"
        ))
        let transport = AutosaveTransport()
        let api = ApiClient(sessionStore: store, auth: SupabaseAuth(), transport: transport)
        let mutations = ContactMutations(
            api: api,
            multipart: MultipartClient(api: api, sessionStore: store)
        )
        let didSave = XCTestExpectation(description: "saved notes")
        didSave.assertForOverFulfill = true
        let save: @MainActor (String) async -> Bool = { draft in
            do {
                _ = try await mutations.updateField(
                    companyId: "company", contactId: "contact", field: "notes", value: draft
                )
                didSave.fulfill()
                return true
            } catch {
                XCTFail("Saving the contact failed: \(error)")
                return false
            }
        }
        let autosave = DebouncedTextSave("old")

        autosave.schedule("old draft", save: save)
        autosave.schedule(" final notes ", save: save)
        let beforeLeaving = await transport.requests
        XCTAssertTrue(beforeLeaving.isEmpty)
        autosave.flush()
        autosave.flush()

        let result = await XCTWaiter.fulfillment(of: [didSave], timeout: 2)
        XCTAssertEqual(result, .completed)
        try await Task.sleep(for: .milliseconds(900))
        let requests = await transport.requests
        XCTAssertEqual(requests.count, 1)
        let request = try XCTUnwrap(requests.first)
        XCTAssertEqual(request.httpMethod, "PATCH")
        XCTAssertEqual(request.url?.path, "/v1/contacts/contact")
        XCTAssertEqual(request.value(forHTTPHeaderField: "X-Company-Id"), "company")
        let body = try XCTUnwrap(request.httpBody)
        XCTAssertEqual(try JSONDecoder().decode([String: String].self, from: body), ["notes": "final notes"])
    }
}