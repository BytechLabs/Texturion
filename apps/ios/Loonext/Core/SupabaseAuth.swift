import Foundation

struct AuthUser: Decodable, Sendable {
    let id: String
    let email: String?
}

struct AuthSession: Decodable, Sendable {
    let accessToken: String
    let refreshToken: String
    let expiresIn: TimeInterval
    let expiresAt: TimeInterval?
    let user: AuthUser

    enum CodingKeys: String, CodingKey {
        case accessToken = "access_token"
        case refreshToken = "refresh_token"
        case expiresIn = "expires_in"
        case expiresAt = "expires_at"
        case user
    }

    var session: Session {
        Session(
            accessToken: accessToken,
            refreshToken: refreshToken,
            expiresAt: expiresAt ?? Date().timeIntervalSince1970 + expiresIn,
            userId: user.id,
            email: user.email ?? ""
        )
    }
}

/// Signup may return a user with no session when email confirmation is on.
enum SignUpResult: Sendable {
    case signedIn(AuthSession)
    case confirmationEmailSent
}

/// Direct GoTrue REST client (four endpoints — no SDK dependency needed).
struct SupabaseAuth: Sendable {
    func signInWithPassword(
        email: String,
        password: String,
        captchaToken: String? = nil
    ) async throws -> AuthSession {
        try decode(
            await request(
                "token?grant_type=password",
                body: authBody(["email": email, "password": password], captchaToken: captchaToken)
            )
        )
    }

    func refresh(refreshToken: String) async throws -> AuthSession {
        try decode(
            await request("token?grant_type=refresh_token", body: ["refresh_token": refreshToken])
        )
    }

    func signUp(
        email: String,
        password: String,
        captchaToken: String? = nil
    ) async throws -> SignUpResult {
        let data = try await request(
            "signup",
            body: authBody(["email": email, "password": password], captchaToken: captchaToken)
        )
        if let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
           object["access_token"] != nil {
            return .signedIn(try decode(data))
        }
        return .confirmationEmailSent
    }

    func sendPasswordReset(email: String, captchaToken: String? = nil) async throws {
        _ = try await request("recover", body: authBody(["email": email], captchaToken: captchaToken))
    }

    /// Best-effort server-side revocation; local sign-out never depends on it.
    func signOut(accessToken: String) async {
        _ = try? await request("logout", body: [:], bearer: accessToken)
    }

    // MARK: - Internals

    private func authBody(_ fields: [String: Any], captchaToken: String?) -> [String: Any] {
        var body = fields
        if let captchaToken {
            body["gotrue_meta_security"] = ["captcha_token": captchaToken]
        }
        return body
    }

    private func decode(_ data: Data) throws -> AuthSession {
        try JSONDecoder().decode(AuthSession.self, from: data)
    }

    private func request(
        _ path: String,
        body: [String: Any],
        bearer: String? = nil
    ) async throws -> Data {
        var request = URLRequest(url: AppConfig.supabaseURL.appending(path: "auth/v1/\(path)"))
        // appending(path:) percent-escapes "?" — rebuild query form explicitly.
        if path.contains("?") {
            let parts = path.split(separator: "?", maxSplits: 1)
            var components = URLComponents(
                url: AppConfig.supabaseURL.appending(path: "auth/v1/\(parts[0])"),
                resolvingAgainstBaseURL: false
            )!
            components.query = String(parts[1])
            request = URLRequest(url: components.url!)
        }
        request.httpMethod = "POST"
        request.setValue(AppConfig.supabasePublishableKey, forHTTPHeaderField: "apikey")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        if let bearer {
            request.setValue("Bearer \(bearer)", forHTTPHeaderField: "Authorization")
        }
        request.httpBody = try JSONSerialization.data(withJSONObject: body)

        let (data, response): (Data, URLResponse)
        do {
            (data, response) = try await URLSession.shared.data(for: request)
        } catch {
            throw ApiError(
                code: ApiErrorCode.network,
                message: "Can't reach the sign-in service. Check your connection.",
                httpStatus: 0
            )
        }
        let status = (response as? HTTPURLResponse)?.statusCode ?? 0
        guard (200 ..< 300).contains(status) else {
            throw Self.parseAuthError(data, status: status)
        }
        return data
    }

    /// GoTrue error shapes vary by endpoint/version — parse defensively.
    private static func parseAuthError(_ data: Data, status: Int) -> ApiError {
        let object = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any]
        let code = (object?["error_code"] as? String)
            ?? (object?["error"] as? String)
            ?? ApiErrorCode.unauthorized
        let message = (object?["msg"] as? String)
            ?? (object?["error_description"] as? String)
            ?? "Sign-in failed."
        return ApiError(code: code, message: message, httpStatus: status)
    }
}
