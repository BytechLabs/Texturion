import Foundation

/// multipart/form-data POST for the /v1 upload endpoints (contact CSV/vCard
/// import, note file attachments). `ApiClient` only speaks JSON bodies, so
/// this helper drives URLSession directly, borrowing the client's session
/// (via `SessionStore`) and its single-flight refresh (by poking a cheap
/// authorized GET when the token is stale). Lives here because both upload
/// doors (contacts import, task-note files) belong to this feature pair —
/// the same layout as the Android MultipartClient.
struct MultipartClient: Sendable {
    let api: ApiClient
    let sessionStore: SessionStore
    var baseURL: URL = AppConfig.apiURL

    /// POST `path` with string `fields` plus one file part. Returns the raw
    /// response body on 2xx; throws `ApiError` with the decoded envelope code
    /// otherwise (unauthorized when the session can't be refreshed).
    func postFile(
        path: String,
        companyId: String,
        fields: [(name: String, value: String)],
        fileField: String,
        fileName: String,
        contentType: String,
        bytes: Data
    ) async throws -> Data {
        let boundary = "loonext-\(UUID().uuidString)"
        let body = multipartFormBody(
            boundary: boundary,
            fields: fields,
            fileField: fileField,
            fileName: fileName,
            contentType: contentType,
            fileBytes: bytes
        )
        let first = try await send(
            path: path, companyId: companyId,
            boundary: boundary, body: body,
            token: try await freshToken()
        )
        if first.status != 401 {
            return try expectSuccess(first)
        }
        // Access token rejected mid-upload — poke the ApiClient's
        // single-flight refresh and retry once with the replaced token.
        _ = try await api.raw("GET", "/v1/me")
        guard let retried = sessionStore.current() else {
            throw signedOut
        }
        let second = try await send(
            path: path, companyId: companyId,
            boundary: boundary, body: body,
            token: retried.accessToken
        )
        return try expectSuccess(second)
    }

    // MARK: - Internals

    private var signedOut: ApiError {
        ApiError(code: ApiErrorCode.unauthorized, message: "You're signed out.", httpStatus: 401)
    }

    /// A not-(about-to-be)-expired access token. When the stored one is
    /// stale, a cheap authorized GET routes through the ApiClient's
    /// single-flight refresh, replacing the stored session.
    private func freshToken() async throws -> String {
        if let session = sessionStore.current(), !session.isExpired {
            return session.accessToken
        }
        _ = try await api.raw("GET", "/v1/me")
        guard let session = sessionStore.current() else { throw signedOut }
        return session.accessToken
    }

    private struct Raw {
        let status: Int
        let data: Data
    }

    private func send(
        path: String,
        companyId: String,
        boundary: String,
        body: Data,
        token: String
    ) async throws -> Raw {
        var request = URLRequest(url: baseURL.appending(path: path))
        request.httpMethod = "POST"
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        request.setValue(companyId, forHTTPHeaderField: "X-Company-Id")
        request.setValue(
            "multipart/form-data; boundary=\(boundary)",
            forHTTPHeaderField: "Content-Type"
        )
        request.httpBody = body
        do {
            let (data, response) = try await URLSession.shared.data(for: request)
            return Raw(status: (response as? HTTPURLResponse)?.statusCode ?? 0, data: data)
        } catch {
            throw ApiError(
                code: ApiErrorCode.network,
                message: "Can't reach Loonext. Check your connection.",
                httpStatus: 0
            )
        }
    }

    /// SPEC §7 envelope decoding — the same contract ApiClient enforces.
    private func expectSuccess(_ raw: Raw) throws -> Data {
        if (200 ..< 300).contains(raw.status) { return raw.data }
        let parsed = try? JSONDecoder().decode(ErrorEnvelope.self, from: raw.data)
        throw ApiError(
            code: parsed?.error.code ?? ApiErrorCode.internalError,
            message: parsed?.error.message ?? "Something went wrong (\(raw.status)).",
            httpStatus: raw.status
        )
    }
}

/// Upload one staged file onto a posted note (D19): task/note files enter
/// ONLY through `owner_type='note'` — a direct task upload is a 422 by design.
extension MultipartClient {
    func uploadNoteFile(
        companyId: String,
        noteId: String,
        fileName: String,
        contentType: String,
        bytes: Data
    ) async throws {
        _ = try await postFile(
            path: "/v1/attachments",
            companyId: companyId,
            fields: [("owner_type", "note"), ("owner_id", noteId)],
            fileField: "file",
            fileName: fileName,
            contentType: contentType,
            bytes: bytes
        )
    }
}

/// Assemble one multipart/form-data body (RFC 2388): string fields first (in
/// the given order), then the single file part, then the closing boundary.
/// Pure so the exact bytes are unit-testable.
func multipartFormBody(
    boundary: String,
    fields: [(name: String, value: String)],
    fileField: String,
    fileName: String,
    contentType: String,
    fileBytes: Data
) -> Data {
    // Quotes/CRLF in a display-name-derived filename would corrupt the part
    // header — strip them rather than trust the picker.
    func sanitized(_ value: String) -> String {
        value.replacingOccurrences(of: "\"", with: "")
            .replacingOccurrences(of: "\r", with: "")
            .replacingOccurrences(of: "\n", with: "")
    }
    var body = Data()
    func append(_ text: String) { body.append(Data(text.utf8)) }
    for (name, value) in fields {
        append("--\(boundary)\r\n")
        append("Content-Disposition: form-data; name=\"\(sanitized(name))\"\r\n\r\n")
        append("\(value)\r\n")
    }
    append("--\(boundary)\r\n")
    append(
        "Content-Disposition: form-data; name=\"\(sanitized(fileField))\"; " +
            "filename=\"\(sanitized(fileName))\"\r\n"
    )
    append("Content-Type: \(contentType)\r\n\r\n")
    body.append(fileBytes)
    append("\r\n--\(boundary)--\r\n")
    return body
}
