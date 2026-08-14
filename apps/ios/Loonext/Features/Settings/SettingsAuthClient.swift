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
    /// #593: the same transport seam `ApiClient` already has.
    ///
    /// `supabaseURL` was injectable but nothing else was, so a test could only point this
    /// at a URL nobody answers — a connection error, not a scripted identity provider.
    /// Trailing and defaulted, so the memberwise init stays source-compatible and every
    /// existing `SettingsAuthClient()` compiles unchanged.
    var transport: HTTPClient = URLSessionHTTPClient()

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

    // MARK: - Two-factor (#314)
    //
    // Enrolment talks to GoTrue directly, exactly as sign-in does — the D8
    // boundary. The Worker owns only what Supabase does not provide (recovery
    // codes, the workspace policy).

    /// What an enrolment hands back before it is verified.
    struct TotpEnrolment: Sendable {
        let factorId: String
        let secret: String
        /// The `otpauth://` URI. On a phone this is the whole point: a QR code
        /// shown ON the device that would scan it is useless, so the app opens
        /// this in whatever authenticator is installed instead.
        let uri: String
    }

    /// #228: `locale` is LAST and DEFAULTED, so the one caller outside Settings
    /// (`Features/Auth/MfaGate.swift`) is untouched and keeps the English.
    /// Threaded rather than read, because a network client has no reader — and
    /// this particular refusal is worth threading for: `TwoFactorCard` surfaces
    /// it verbatim as `error.userMessage`, unlike `challengeFactor` below, whose
    /// message every caller in this app discards in favour of its own sentence.
    func enrollTotp(
        accessToken: String,
        friendlyName: String,
        locale: String? = nil
    ) async throws -> TotpEnrolment {
        let data = try await request(
            method: "POST",
            path: "factors",
            body: ["factor_type": .string("totp"), "friendly_name": .string(friendlyName)],
            bearer: accessToken
        )
        let object = (try? JSONDecoder().decode(JSONValue.self, from: data))?.objectValue
        let totp = object?["totp"]?.objectValue
        guard let id = object?["id"]?.stringValue else {
            throw ApiError(
                code: ApiErrorCode.network,
                message: AppStrings.translate(locale, "settingsMore.tfaSetupDidNotStart"),
                httpStatus: 0
            )
        }
        return TotpEnrolment(
            factorId: id,
            secret: totp?["secret"]?.stringValue ?? "",
            uri: totp?["uri"]?.stringValue ?? ""
        )
    }

    func challengeFactor(accessToken: String, factorId: String) async throws -> String {
        let data = try await request(
            method: "POST",
            path: "factors/\(factorId)/challenge",
            body: [:],
            bearer: accessToken
        )
        let object = (try? JSONDecoder().decode(JSONValue.self, from: data))?.objectValue
        guard let id = object?["id"]?.stringValue else {
            throw ApiError(
                code: ApiErrorCode.network,
                message: AppStrings.translate(nil, "settingsMore.tfaCodeCheckFailed"),
                httpStatus: 0
            )
        }
        return id
    }

    /// On success GoTrue returns a FRESH SESSION at aal2. The caller must store
    /// it — otherwise the app keeps presenting the old aal1 token and the
    /// workspace gate keeps refusing a device that just enrolled.
    func verifyFactor(
        accessToken: String,
        factorId: String,
        challengeId: String,
        code: String
    ) async throws -> AuthSession {
        let data = try await request(
            method: "POST",
            path: "factors/\(factorId)/verify",
            body: ["challenge_id": .string(challengeId), "code": .string(code)],
            bearer: accessToken
        )
        return try JSONDecoder().decode(AuthSession.self, from: data)
    }

    /// Remove a factor. The account falls back to a password alone.
    func unenrollFactor(accessToken: String, factorId: String) async throws {
        _ = try await request(
            method: "DELETE",
            path: "factors/\(factorId)",
            body: nil,
            bearer: accessToken
        )
    }

    // MARK: - Internals

    /// `locale` is the READER's, carried in rather than read here: this is not a
    /// View and the two sentences below are ours rather than GoTrue's. Defaulted
    /// to nil — the English table — so a caller with no environment to read one
    /// from still gets a sentence rather than a key. The same shape, and the same
    /// default, as `SettingsAuth.kt`'s `request`.
    private func request(
        method: String,
        path: String,
        body: [String: JSONValue]?,
        bearer: String,
        locale: String? = nil
    ) async throws -> Data {
        var request = URLRequest(url: supabaseURL.appending(path: "auth/v1/\(path)"))
        request.httpMethod = method
        request.setValue(publishableKey, forHTTPHeaderField: "apikey")
        request.setValue("Bearer \(bearer)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        // Nil, not an empty object: GoTrue rejects a body on DELETE
        // /factors/{id}, and URLSession is happy to send one if asked.
        request.httpBody = body.map { try? JSONEncoder().encode(JSONValue.object($0)) } ?? nil

        let data: Data
        let response: URLResponse
        do {
            (data, response) = try await transport.data(for: request)
        } catch {
            throw ApiError(
                code: ApiErrorCode.network,
                message: AppStrings.translate(locale, "settingsMore.cantReachSignIn"),
                httpStatus: 0
            )
        }
        let status = (response as? HTTPURLResponse)?.statusCode ?? 0
        guard (200 ..< 300).contains(status) else {
            throw Self.parseAuthError(data, status: status, locale: locale)
        }
        return data
    }

    /// GoTrue error shapes vary ({error_code,msg} vs {error,error_description}).
    ///
    /// Only the LAST fallback is ours to translate. The two above it are the
    /// identity provider's own sentence, and rewriting somebody's server error
    /// into our voice is how a support call stops being able to find it.
    private static func parseAuthError(
        _ data: Data,
        status: Int,
        locale: String? = nil
    ) -> ApiError {
        let object = (try? JSONDecoder().decode(JSONValue.self, from: data))?.objectValue
        let code = object?["error_code"]?.stringValue
            ?? object?["error"]?.stringValue
            ?? ApiErrorCode.unauthorized
        let message = object?["msg"]?.stringValue
            ?? object?["error_description"]?.stringValue
            ?? AppStrings.translate(
                locale,
                "settingsMore.somethingWentWrongStatus",
                ["status": String(status)]
            )
        return ApiError(code: code, message: message, httpStatus: status)
    }
}
