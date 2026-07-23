import Foundation

/// The one HTTP round-trip `ApiClient` performs. Production is a thin wrapper
/// over `URLSession.shared`; tests inject a canned-response stub so controller
/// behavior is verifiable without a live backend (the conformance lives on our
/// own `Sendable` type, never retroactively on Foundation's `URLSession`).
protocol HTTPClient: Sendable {
    func data(for request: URLRequest) async throws -> (Data, URLResponse)
}

struct URLSessionHTTPClient: HTTPClient {
    func data(for request: URLRequest) async throws -> (Data, URLResponse) {
        try await URLSession.shared.data(for: request)
    }
}

/// The /v1 API client: bearer injection from `SessionStore`, X-Company-Id
/// tenancy header, proactive token refresh, single-flight refresh on 401
/// (with stale-token force-refresh), SPEC §7 envelope decoding, and
/// Idempotency-Key passthrough for the send paths that require it.
actor ApiClient {
    private let sessionStore: SessionStore
    private let auth: SupabaseAuth
    private let baseURL: URL
    private let transport: HTTPClient
    private var refreshTask: Task<Session?, Error>?

    /// Set by the app shell; called when the refresh token itself is rejected.
    private var onSignedOut: (@Sendable () -> Void)?

    /// Fires with every fresh access token — realtime re-auths from this.
    private var onTokenRefreshed: (@Sendable (String) -> Void)?

    init(
        sessionStore: SessionStore,
        auth: SupabaseAuth,
        baseURL: URL = AppConfig.apiURL,
        transport: HTTPClient = URLSessionHTTPClient()
    ) {
        self.sessionStore = sessionStore
        self.auth = auth
        self.baseURL = baseURL
        self.transport = transport
    }

    func setSignedOutHandler(_ handler: @escaping @Sendable () -> Void) {
        onSignedOut = handler
    }

    func setTokenRefreshedHandler(_ handler: @escaping @Sendable (String) -> Void) {
        onTokenRefreshed = handler
    }

    // MARK: - Typed verbs

    func get<T: Decodable & Sendable>(
        _ path: String,
        query: [String: String?] = [:],
        companyId: String? = nil
    ) async throws -> T {
        try Self.decode(await raw("GET", path, query: query, companyId: companyId))
    }

    func post<T: Decodable & Sendable>(
        _ path: String,
        body: (some Encodable & Sendable)? = nil as JSONValue?,
        companyId: String? = nil,
        idempotencyKey: String? = nil
    ) async throws -> T {
        try Self.decode(
            await raw(
                "POST",
                path,
                body: Self.encode(body),
                companyId: companyId,
                idempotencyKey: idempotencyKey
            )
        )
    }

    func patch<T: Decodable & Sendable>(
        _ path: String,
        body: some Encodable & Sendable,
        companyId: String? = nil
    ) async throws -> T {
        try Self.decode(await raw("PATCH", path, body: Self.encode(body), companyId: companyId))
    }

    func put<T: Decodable & Sendable>(
        _ path: String,
        body: some Encodable & Sendable,
        companyId: String? = nil
    ) async throws -> T {
        try Self.decode(await raw("PUT", path, body: Self.encode(body), companyId: companyId))
    }

    func delete(_ path: String, companyId: String? = nil) async throws {
        _ = try await raw("DELETE", path, companyId: companyId)
    }

    // MARK: - Core

    /// Execute a request and return the response body. 401 triggers ONE
    /// single-flight refresh + retry; a second 401 (or a failed refresh) signs
    /// the user out.
    func raw(
        _ method: String,
        _ path: String,
        query: [String: String?] = [:],
        body: Data? = nil,
        companyId: String? = nil,
        idempotencyKey: String? = nil
    ) async throws -> Data {
        guard let session = try await freshSession() else {
            throw ApiError(code: ApiErrorCode.unauthorized, message: "You're signed out.", httpStatus: 401)
        }
        let first = try await execute(
            method, path,
            query: query, body: body, token: session.accessToken,
            companyId: companyId, idempotencyKey: idempotencyKey
        )
        if first.status != 401 {
            return try first.expectSuccess()
        }
        // Access token rejected — refresh once (single-flight) and retry.
        // Force past the expiry check: the server just told us it's dead.
        guard let refreshed = try await refreshNow(staleToken: session.accessToken) else {
            onSignedOut?()
            throw ApiError(code: ApiErrorCode.unauthorized, message: "Session expired.", httpStatus: 401)
        }
        let second = try await execute(
            method, path,
            query: query, body: body, token: refreshed.accessToken,
            companyId: companyId, idempotencyKey: idempotencyKey
        )
        if second.status == 401 {
            onSignedOut?()
        }
        return try second.expectSuccess()
    }

    /// Returns a session whose access token is not (about to be) expired.
    private func freshSession() async throws -> Session? {
        guard let session = sessionStore.current() else { return nil }
        if !session.isExpired { return session }
        return try await refreshNow()
    }

    /// Single-flight refresh. `staleToken` is the access token the server just
    /// rejected — when the stored token still equals it, refresh even if the
    /// clock says it's fine; when it differs, someone already refreshed.
    ///
    /// A network failure THROWS (the session is kept — the request fails as
    /// network); a rejected refresh token clears the store and returns nil.
    private func refreshNow(staleToken: String? = nil) async throws -> Session? {
        if let inFlight = refreshTask {
            // Single-flight: wait out the in-flight refresh, then re-evaluate
            // against the (possibly replaced) stored session.
            _ = try? await inFlight.value
            return try await refreshNow(staleToken: staleToken)
        }
        guard let current = sessionStore.current() else { return nil }
        let alreadyReplaced = staleToken != nil && current.accessToken != staleToken
        if (staleToken == nil || alreadyReplaced) && !current.isExpired {
            return current
        }
        let task = Task<Session?, Error> { [sessionStore, auth] in
            do {
                let next = try await auth.refresh(refreshToken: current.refreshToken).session
                sessionStore.save(next)
                return next
            } catch let error as ApiError where error.code == ApiErrorCode.network {
                throw error // Transient — keep the session.
            } catch {
                sessionStore.clear() // Refresh token rejected — the session is dead.
                return nil
            }
        }
        refreshTask = task
        defer { refreshTask = nil }
        let next = try await task.value
        if let next {
            onTokenRefreshed?(next.accessToken)
        }
        return next
    }

    private struct RawResponse {
        let status: Int
        let data: Data

        func expectSuccess() throws -> Data {
            if (200 ..< 300).contains(status) { return data }
            let parsed = try? JSONDecoder().decode(ErrorEnvelope.self, from: data)
            throw ApiError(
                code: parsed?.error.code ?? ApiErrorCode.internalError,
                message: parsed?.error.message ?? "Something went wrong (\(status)).",
                httpStatus: status
            )
        }
    }

    private func execute(
        _ method: String,
        _ path: String,
        query: [String: String?],
        body: Data?,
        token: String,
        companyId: String?,
        idempotencyKey: String?
    ) async throws -> RawResponse {
        guard var components = URLComponents(
            url: baseURL.appending(path: path),
            resolvingAgainstBaseURL: false
        ) else {
            throw ApiError(code: ApiErrorCode.network, message: "Bad request URL.", httpStatus: 0)
        }
        let items = query.compactMap { key, value in value.map { URLQueryItem(name: key, value: $0) } }
        if !items.isEmpty {
            components.queryItems = items
        }
        guard let url = components.url else {
            throw ApiError(code: ApiErrorCode.network, message: "Bad request URL.", httpStatus: 0)
        }
        var request = URLRequest(url: url)
        request.httpMethod = method
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        if let companyId {
            request.setValue(companyId, forHTTPHeaderField: "X-Company-Id")
        }
        if let idempotencyKey {
            request.setValue(idempotencyKey, forHTTPHeaderField: "Idempotency-Key")
        }
        if body != nil {
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        }
        request.httpBody = body

        do {
            let (data, response) = try await transport.data(for: request)
            return RawResponse(status: (response as? HTTPURLResponse)?.statusCode ?? 0, data: data)
        } catch {
            throw ApiError(
                code: ApiErrorCode.network,
                message: "Can't reach Loonext. Check your connection.",
                httpStatus: 0
            )
        }
    }

    private static func decode<T: Decodable>(_ data: Data) throws -> T {
        try JSONDecoder().decode(T.self, from: data)
    }

    private static func encode(_ body: (some Encodable)?) -> Data? {
        guard let body else { return Data("{}".utf8) }
        return try? JSONEncoder().encode(body)
    }
}
