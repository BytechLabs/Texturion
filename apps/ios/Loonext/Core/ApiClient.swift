import Foundation

/// The /v1 API client: bearer injection from `SessionStore`, proactive token
/// refresh, single-flight refresh on 401, SPEC §7 envelope decoding.
actor ApiClient {
    static let shared = ApiClient(sessionStore: SessionStore(), auth: SupabaseAuth())

    private let sessionStore: SessionStore
    private let auth: SupabaseAuth
    private var refreshTask: Task<Session?, Never>?

    /// Set by the app shell; called when the refresh token itself is rejected.
    private var onSignedOut: (@Sendable () -> Void)?

    init(sessionStore: SessionStore, auth: SupabaseAuth) {
        self.sessionStore = sessionStore
        self.auth = auth
    }

    func setSignedOutHandler(_ handler: @escaping @Sendable () -> Void) {
        onSignedOut = handler
    }

    // MARK: - Typed verbs

    func get<T: Decodable>(_ path: String, query: [String: String?] = [:]) async throws -> T {
        try Self.decode(await raw("GET", path, query: query))
    }

    func post<T: Decodable>(_ path: String, body: (some Encodable)? = nil as String?) async throws -> T {
        try Self.decode(await raw("POST", path, body: Self.encode(body)))
    }

    func patch<T: Decodable>(_ path: String, body: some Encodable) async throws -> T {
        try Self.decode(await raw("PATCH", path, body: Self.encode(body)))
    }

    func delete(_ path: String) async throws {
        _ = try await raw("DELETE", path)
    }

    // MARK: - Core

    /// Execute a request and return the response body. 401 triggers ONE
    /// single-flight refresh + retry; a second 401 signs the user out.
    func raw(
        _ method: String,
        _ path: String,
        query: [String: String?] = [:],
        body: Data? = nil
    ) async throws -> Data {
        guard let session = await freshSession() else {
            throw ApiError(code: ApiErrorCode.unauthorized, message: "You're signed out.", httpStatus: 401)
        }
        let first = try await execute(method, path, query: query, body: body, token: session.accessToken)
        if first.status != 401 {
            return try first.expectSuccess()
        }
        guard let refreshed = await refreshNow() else {
            onSignedOut?()
            throw ApiError(code: ApiErrorCode.unauthorized, message: "Session expired.", httpStatus: 401)
        }
        let second = try await execute(method, path, query: query, body: body, token: refreshed.accessToken)
        if second.status == 401 {
            onSignedOut?()
        }
        return try second.expectSuccess()
    }

    private func freshSession() async -> Session? {
        guard let session = sessionStore.current() else { return nil }
        if !session.isExpired { return session }
        return await refreshNow()
    }

    /// Single-flight: concurrent callers await the same refresh task.
    private func refreshNow() async -> Session? {
        if let task = refreshTask {
            return await task.value
        }
        let task = Task<Session?, Never> { [sessionStore, auth] in
            guard let current = sessionStore.current() else { return nil }
            if !current.isExpired { return current }
            do {
                let next = try await auth.refresh(refreshToken: current.refreshToken).session
                sessionStore.save(next)
                return next
            } catch let error as ApiError where error.code == ApiErrorCode.network {
                return nil // Transient — keep the session; the request fails as network.
            } catch {
                sessionStore.clear() // Refresh token rejected — the session is dead.
                return nil
            }
        }
        refreshTask = task
        let result = await task.value
        refreshTask = nil
        return result
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
        token: String
    ) async throws -> RawResponse {
        var components = URLComponents(
            url: AppConfig.apiURL.appending(path: path),
            resolvingAgainstBaseURL: false
        )!
        let items = query.compactMap { key, value in value.map { URLQueryItem(name: key, value: $0) } }
        if !items.isEmpty {
            components.queryItems = items
        }
        var request = URLRequest(url: components.url!)
        request.httpMethod = method
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        if body != nil {
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        }
        request.httpBody = body

        do {
            let (data, response) = try await URLSession.shared.data(for: request)
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
        guard let body else { return "{}".data(using: .utf8) }
        return try? JSONEncoder().encode(body)
    }
}
