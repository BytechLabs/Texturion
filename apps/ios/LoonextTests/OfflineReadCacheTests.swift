import CryptoKit
import Foundation
import XCTest
@testable import Loonext

final class OfflineReadCacheTests: XCTestCase {
    private struct WireValue: Decodable, Sendable {
        let value: String
    }

    private actor ReadTransport: HTTPClient {
        private let payload: Data
        private var status: Int? = 200

        init(payload: Data = Data(#"{"value":"saved"}"#.utf8)) {
            self.payload = payload
        }

        func setStatus(_ status: Int?) { self.status = status }

        func data(for request: URLRequest) async throws -> (Data, URLResponse) {
            guard let status else { throw URLError(.notConnectedToInternet) }
            let url = try XCTUnwrap(request.url)
            let response = try XCTUnwrap(HTTPURLResponse(url: url, statusCode: status, httpVersion: nil, headerFields: nil))
            let data = status == 200
                ? payload
                : Data(#"{"error":{"code":"forbidden","message":"Forbidden"}}"#.utf8)
            return (data, response)
        }
    }

    private actor InboxTransport: HTTPClient {
        private var reconnecting = false
        private var offline = false

        func failPinnedRefresh() { reconnecting = true }
        func goOffline() { offline = true }

        func data(for request: URLRequest) async throws -> (Data, URLResponse) {
            if offline { throw URLError(.notConnectedToInternet) }
            let url = try XCTUnwrap(request.url)
            let pinned = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems?
                .contains(URLQueryItem(name: "pinned", value: "only")) == true
            if pinned && reconnecting { throw URLError(.networkConnectionLost) }
            let id = pinned ? "pin" : (reconnecting ? "new" : "original")
            let response = try XCTUnwrap(HTTPURLResponse(url: url, statusCode: 200, httpVersion: nil, headerFields: nil))
            let body = """
            {"data":[{"id":"\(id)","company_id":"workspace","contact_id":"contact","phone_number_id":"line",
            "status":"open","is_spam":false,"last_message_at":"2026-11-18","created_at":"2026-11-18",
            "updated_at":"2026-11-18","contact":{"id":"contact","phone_e164":"+15555550100"}}],
            "next_cursor":"\(id)-next"}
            """
            return (Data(body.utf8), response)
        }
    }

    func testOnlyDefaultListsAndFirstPagesOfRecordsAreEligible() {
        let thread = "/v1/conversations/aaaa0000-0000-4000-8000-000000000001"
        XCTAssertTrue(isOfflineRead(path: "/v1/for-you", query: [:], userId: "member"))
        XCTAssertTrue(isOfflineRead(
            path: "/v1/conversations",
            query: ["phone_number_id": "aaaa0000-0000-4000-8000-000000000002", "pinned": "exclude"],
            userId: "member"
        ))
        XCTAssertTrue(isOfflineRead(path: thread + "/messages", query: ["limit": "50"], userId: "member"))
        XCTAssertTrue(isOfflineRead(path: "/v1/tasks", query: ["assigned_user_id": "member"], userId: "member"))
        XCTAssertFalse(isOfflineRead(path: thread + "/messages", query: ["cursor": "older"], userId: "member"))
        XCTAssertFalse(isOfflineRead(path: "/v1/conversations", query: ["is_spam": "true"], userId: "member"))
        XCTAssertFalse(isOfflineRead(path: "/v1/tasks", query: ["assigned_user_id": "other"], userId: "member"))
        XCTAssertFalse(isOfflineRead(path: "/v1/attachments/private/url", query: [:], userId: "member"))
    }

    func testCacheRejectsAnInFlightResponseAfterSignOutAndClearsWarmData() async {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        let cache = StoreCache(directory: directory, diskKey: SymmetricKey(size: .bits256))
        let response = Data("cached".utf8)

        await cache.write(response, for: "old-account") { false }
        let rejected = await cache.read("old-account")
        XCTAssertNil(rejected)

        await cache.write(response, for: "current-account") { true }
        let cached = await cache.read("current-account")
        XCTAssertEqual(cached, response)
        await cache.clear()
        let cleared = await cache.read("current-account")
        XCTAssertNil(cleared)
    }

    func testADifferentCacheInstanceRestoresTheEncryptedFile() async throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let key = SymmetricKey(size: .bits256)
        let writer = StoreCache(directory: directory, diskKey: key)
        let response = Data("offline thread".utf8)
        await writer.write(response, for: "member/workspace/thread") { true }

        let files = try FileManager.default.contentsOfDirectory(at: directory, includingPropertiesForKeys: nil)
        let file = try XCTUnwrap(files.first)
        XCTAssertNil(try Data(contentsOf: file).range(of: response))

        let reader = StoreCache(directory: directory, diskKey: key)
        let restored = await reader.read("member/workspace/thread")
        XCTAssertEqual(restored, response)
        let differentMember = await reader.read("other/workspace/thread")
        XCTAssertNil(differentMember)
    }

    func testTransportFailureCanRestoreButAnAccessRefusalClearsTheResponse() async throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let cache = StoreCache(directory: directory, diskKey: SymmetricKey(size: .bits256))
        let sessions = SessionStore(storage: InMemorySessionStorage())
        sessions.save(Session(
            accessToken: "offline-fixture", refreshToken: "offline-refresh",
            expiresAt: Date().timeIntervalSince1970 + 3600, userId: "member", email: "viewer@example.com"
        ))
        let transport = ReadTransport()
        let api = ApiClient(sessionStore: sessions, auth: SupabaseAuth(), transport: transport, offlineReads: cache)
        let path = "/v1/for-you"
        let live: WireValue = try await api.get(path, companyId: "workspace")
        XCTAssertEqual(live.value, "saved")

        await transport.setStatus(nil)
        let stored: WireValue = try await api.get(path, companyId: "workspace")
        XCTAssertEqual(stored.value, "saved")
        let otherCompany: WireValue? = await api.cachedGet(path, companyId: "other-workspace")
        XCTAssertNil(otherCompany)

        await transport.setStatus(403)
        do {
            let _: WireValue = try await api.get(path, companyId: "workspace")
            XCTFail("An access refusal must reach the caller")
        } catch let error as ApiError {
            XCTAssertEqual(error.httpStatus, 403)
        }
        let refused: WireValue? = await api.cachedGet(path, companyId: "workspace")
        XCTAssertNil(refused)
    }

    func testScreenMemoryDoesNotCreateADiskEntryOrReplaceALiveAPIRead() async throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let cache = StoreCache(directory: directory, diskKey: SymmetricKey(size: .bits256))
        let sessions = SessionStore(storage: InMemorySessionStorage())
        sessions.save(Session(
            accessToken: "memory-fixture", refreshToken: "memory-refresh",
            expiresAt: Date().timeIntervalSince1970 + 3600, userId: "member", email: "viewer@example.com"
        ))
        let transport = ReadTransport()
        let api = ApiClient(sessionStore: sessions, auth: SupabaseAuth(), transport: transport, offlineReads: cache)
        let path = "/v1/company"

        let _: WireValue = try await api.get(path, companyId: "workspace", cacheInMemory: true)
        let cached: WireValue? = await api.cachedGet(path, companyId: "workspace")
        XCTAssertEqual(cached?.value, "saved")
        XCTAssertFalse(FileManager.default.fileExists(atPath: directory.path))

        await transport.setStatus(nil)
        do {
            let _: WireValue = try await api.get(path, companyId: "workspace", cacheInMemory: true)
            XCTFail("Company settings reads must reach the server")
        } catch let error as ApiError {
            XCTAssertEqual(error.code, ApiErrorCode.network)
        }
        let otherCompany: WireValue? = await api.cachedGet(path, companyId: "other-workspace")
        XCTAssertNil(otherCompany)
    }

    func testScreenCacheKeepsTheDefaultContactOrderAndRequestedUsageLocale() async throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let cache = StoreCache(directory: directory, diskKey: SymmetricKey(size: .bits256))
        let sessions = SessionStore(storage: InMemorySessionStorage())
        sessions.save(Session(
            accessToken: "memory-fixture", refreshToken: "memory-refresh",
            expiresAt: Date().timeIntervalSince1970 + 3600, userId: "member", email: "viewer@example.com"
        ))
        let transport = ReadTransport(payload: Data(#"{"data":[],"used_segments":4}"#.utf8))
        let api = ApiClient(sessionStore: sessions, auth: SupabaseAuth(), transport: transport, offlineReads: cache)
        let contacts = ContactsApi(api: api)
        let settings = SettingsRepository(api: api, sessionStore: sessions)
        let workspace = "workspace"

        _ = try await contacts.contacts(companyId: workspace, limit: 50, sort: ContactsApi.defaultSort)
        _ = try await contacts.contacts(companyId: workspace, limit: 50, sort: "recent")
        _ = try await settings.usage(workspace, locale: "fr-CA")

        let defaultContacts: Page<Contact>? = await api.cachedGet(
            "/v1/contacts", query: ["limit": "50", "sort": ContactsApi.defaultSort], companyId: workspace
        )
        let recentContacts: Page<Contact>? = await api.cachedGet(
            "/v1/contacts", query: ["limit": "50", "sort": "recent"], companyId: workspace
        )
        let frenchUsage: Usage? = await api.cachedGet("/v1/usage", query: ["lang": "fr-CA"], companyId: workspace)
        let englishUsage: Usage? = await api.cachedGet("/v1/usage", query: ["lang": "en"], companyId: workspace)
        XCTAssertNotNil(defaultContacts)
        XCTAssertNil(recentContacts)
        XCTAssertEqual(frenchUsage?.used_segments, 4)
        XCTAssertNil(englishUsage)
        XCTAssertFalse(FileManager.default.fileExists(atPath: directory.path))
    }

    @MainActor
    func testInboxKeepsRowsPinsAndCursorWhenPinnedReconnectReadFails() async {
        let sessions = SessionStore(storage: InMemorySessionStorage())
        sessions.save(Session(
            accessToken: "offline-fixture", refreshToken: "offline-refresh",
            expiresAt: Date().timeIntervalSince1970 + 3600, userId: "member", email: "viewer@example.com"
        ))
        let transport = InboxTransport()
        let api = ApiClient(sessionStore: sessions, auth: SupabaseAuth(), transport: transport)
        let controller = InboxController(api: api, companyId: "workspace", meUserId: "member")
        await controller.reload(showLoading: true).value
        XCTAssertEqual(controller.rows.map(\.id), ["original"])
        XCTAssertEqual(controller.pinnedRows.map(\.id), ["pin"])
        XCTAssertEqual(controller.cursor, "original-next")

        await transport.failPinnedRefresh()
        await controller.refreshAfterReconnect().value
        guard case .ready = controller.state else { return XCTFail("The inbox should remain ready") }
        XCTAssertEqual(controller.rows.map(\.id), ["original"])
        XCTAssertEqual(controller.pinnedRows.map(\.id), ["pin"])
        XCTAssertEqual(controller.cursor, "original-next")
        XCTAssertNil(controller.notice)
    }

    @MainActor
    func testInboxFiltersDoNotPreloadTheUnfilteredOfflineInbox() async {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let cache = StoreCache(directory: directory, diskKey: SymmetricKey(size: .bits256))
        let sessions = SessionStore(storage: InMemorySessionStorage())
        sessions.save(Session(
            accessToken: "offline-fixture", refreshToken: "offline-refresh",
            expiresAt: Date().timeIntervalSince1970 + 3600, userId: "member", email: "viewer@example.com"
        ))
        let transport = InboxTransport()
        let api = ApiClient(sessionStore: sessions, auth: SupabaseAuth(), transport: transport, offlineReads: cache)
        let home = InboxController(api: api, companyId: "workspace", meUserId: "member")
        await home.reload(showLoading: true).value
        let cached: Page<ConversationListItem>? = await api.cachedGet(
            "/v1/conversations", query: ["status": "open", "pinned": "exclude", "limit": "25"],
            companyId: "workspace"
        )
        XCTAssertEqual(cached?.data.map(\.id), ["original"])
        await transport.goOffline()

        let filters: [(name: String, apply: @MainActor (InboxController) -> Void)] = [
            ("Unassigned", { $0.setUnassignedFilter() }),
            ("Line", { $0.setLineFilter("another-line") }),
        ]
        for filter in filters {
            let controller = InboxController(api: api, companyId: "workspace", meUserId: "member")
            filter.apply(controller)
            await controller.reload(showLoading: true).value
            guard case .failed = controller.state else {
                XCTFail("\(filter.name) must show a load failure when offline")
                continue
            }
            XCTAssertTrue(controller.rows.isEmpty, filter.name)
            XCTAssertTrue(controller.pinnedRows.isEmpty, filter.name)
        }
    }
}
