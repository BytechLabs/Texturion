import Foundation

/// GoTrue's structural code for "confirm it's you before this change".
let reauthenticationNeededCode = "reauthentication_needed"

/// The two GoTrue account operations the settings surface needs beyond
/// Core/SupabaseAuth (which owns sign-in/up/out/refresh): PUT /auth/v1/user
/// for email + password changes, and POST /auth/v1/reauthenticate for the
/// stale-session nonce flow. Same direct-REST posture as SupabaseAuth —
/// defensive error parsing, structural codes only (never message sniffing).
///
/// Email change is Supabase's double-confirm flow: links go to both the old
/// and new address, nothing changes until confirmed. Password change on a
/// stale session throws `reauthenticationNeededCode`; the caller then requests
/// a nonce (emailed to the user) and retries the same change with it.
struct SettingsAuthClient: Sendable {
    var supabaseURL: URL = AppConfig.supabaseURL
    var publishableKey: String = AppConfig.supabasePublishableKey

    func updateEmail(accessToken: String, newEmail: String) async throws {
        _ = try await request(
            method: "PUT",
            path: "user",
            body: ["email": .string(newEmail)],
            bearer: accessToken
        )
    }

    /// Change (or first-set, for OAuth-only accounts) the password. Throws
    /// an `ApiError` with code `reauthenticationNeededCode` when the session
    /// is too stale — request a nonce and retry with it.
    func updatePassword(accessToken: String, password: String, nonce: String? = nil) async throws {
        var body: [String: JSONValue] = ["password": .string(password)]
        if let nonce {
            body["nonce"] = .string(nonce)
        }
        _ = try await request(method: "PUT", path: "user", body: body, bearer: accessToken)
    }

    /// Emails the signed-in user a one-time nonce for the retry above.
    func requestReauthenticationNonce(accessToken: String) async throws {
        _ = try await request(method: "POST", path: "reauthenticate", body: [:], bearer: accessToken)
    }

    // MARK: - Internals

    private func request(
        method: String,
        path: String,
        body: [String: JSONValue],
        bearer: String
    ) async throws -> Data {
        var request = URLRequest(url: supabaseURL.appending(path: "auth/v1/\(path)"))
        request.httpMethod = method
        request.setValue(publishableKey, forHTTPHeaderField: "apikey")
        request.setValue("Bearer \(bearer)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try? JSONEncoder().encode(JSONValue.object(body))

        let data: Data
        let response: URLResponse
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

    /// GoTrue error shapes vary ({error_code,msg} vs {error,error_description}).
    private static func parseAuthError(_ data: Data, status: Int) -> ApiError {
        let object = (try? JSONDecoder().decode(JSONValue.self, from: data))?.objectValue
        let code = object?["error_code"]?.stringValue
            ?? object?["error"]?.stringValue
            ?? ApiErrorCode.unauthorized
        let message = object?["msg"]?.stringValue
            ?? object?["error_description"]?.stringValue
            ?? "Something went wrong (\(status))."
        return ApiError(code: code, message: message, httpStatus: status)
    }
}
