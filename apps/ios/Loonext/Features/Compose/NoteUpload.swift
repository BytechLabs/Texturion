import Foundation

/// Multipart POST /v1/attachments for note files (D19/D28). `ApiClient` only
/// speaks JSON bodies, so this helper does the one multipart door the composer
/// needs itself (owner_type='note' is the ONLY generic upload owner), reading
/// the bearer token from the shared `SessionStore` and nudging `ApiClient`'s
/// single-flight refresh (via a cheap authed GET) when the stored token is
/// stale or rejected.
struct NoteFileUploader: Sendable {
    let sessionStore: SessionStore
    let meApi: MeApi
    var baseURL: URL = AppConfig.apiURL
    /// #228 — the reader's language, for the two refusals below.
    ///
    /// DECLARED LAST and defaulted, so the memberwise initialiser every existing
    /// construction site uses is unchanged; nil reads English. Passed in rather
    /// than read from `UiLocaleStore`, because this runs off the main actor and
    /// the store lives on it.
    var locale: String? = nil

    func upload(
        companyId: String,
        noteId: String,
        fileName: String,
        contentType: String,
        bytes: Data
    ) async throws -> Attachment {
        let token = try await freshToken(forceRefresh: false)
        let first = try await execute(
            token: token,
            companyId: companyId,
            noteId: noteId,
            fileName: fileName,
            contentType: contentType,
            bytes: bytes
        )
        if first.status != 401 {
            return try decodeAttachment(first)
        }
        // Access token rejected — refresh once through ApiClient and retry.
        let refreshed = try await freshToken(forceRefresh: true)
        let second = try await execute(
            token: refreshed,
            companyId: companyId,
            noteId: noteId,
            fileName: fileName,
            contentType: contentType,
            bytes: bytes
        )
        return try decodeAttachment(second)
    }

    /// A token that is not (about to be) expired. `forceRefresh` routes a
    /// trivial authed GET through `ApiClient` so its single-flight refresh
    /// replaces the stored session; we then read the store again.
    private func freshToken(forceRefresh: Bool) async throws -> String {
        if !forceRefresh, let session = sessionStore.current(), !session.isExpired {
            return session.accessToken
        }
        let _: Me = try await meApi.me()
        guard let session = sessionStore.current() else {
            throw ApiError(
                code: ApiErrorCode.unauthorized,
                message: AppStrings.translate(locale, "thread.signedOut"),
                httpStatus: 401
            )
        }
        return session.accessToken
    }

    private struct UploadResponse {
        let status: Int
        let data: Data
    }

    private func execute(
        token: String,
        companyId: String,
        noteId: String,
        fileName: String,
        contentType: String,
        bytes: Data
    ) async throws -> UploadResponse {
        let boundary = "loonext-\(UUID().uuidString)"
        var request = URLRequest(url: baseURL.appending(path: "/v1/attachments"))
        request.httpMethod = "POST"
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        request.setValue(companyId, forHTTPHeaderField: "X-Company-Id")
        request.setValue(
            "multipart/form-data; boundary=\(boundary)",
            forHTTPHeaderField: "Content-Type"
        )
        request.httpBody = multipartBody(
            boundary: boundary,
            noteId: noteId,
            fileName: fileName,
            contentType: contentType,
            bytes: bytes
        )

        do {
            let (data, response) = try await URLSession.shared.data(for: request)
            return UploadResponse(
                status: (response as? HTTPURLResponse)?.statusCode ?? 0,
                data: data
            )
        } catch {
            throw ApiError(
                code: ApiErrorCode.network,
                message: AppStrings.translate(locale, "thread.cantReachLoonext"),
                httpStatus: 0
            )
        }
    }

    private func multipartBody(
        boundary: String,
        noteId: String,
        fileName: String,
        contentType: String,
        bytes: Data
    ) -> Data {
        var body = Data()
        func append(_ text: String) { body.append(Data(text.utf8)) }

        append("--\(boundary)\r\n")
        append("Content-Disposition: form-data; name=\"owner_type\"\r\n\r\n")
        append("note\r\n")

        append("--\(boundary)\r\n")
        append("Content-Disposition: form-data; name=\"owner_id\"\r\n\r\n")
        append("\(noteId)\r\n")

        // Quote-escape the user-controlled filename for the header line.
        let safeName = fileName
            .replacingOccurrences(of: "\\", with: "_")
            .replacingOccurrences(of: "\"", with: "_")
            .replacingOccurrences(of: "\r", with: "")
            .replacingOccurrences(of: "\n", with: "")
        append("--\(boundary)\r\n")
        append("Content-Disposition: form-data; name=\"file\"; filename=\"\(safeName)\"\r\n")
        append("Content-Type: \(contentType)\r\n\r\n")
        body.append(bytes)

        // #240: the thread renders a picture of the file, not the file. This
        // phone has just decoded the image to show it in the staging strip, so
        // the resize is nearly free here and saves the whole crew re-fetching a
        // 25 MB original on every scroll. Nil for anything that does not want
        // one, and on any failure.
        if let preview = AttachmentPreview.make(contentType: contentType, bytes: bytes) {
            append("\r\n--\(boundary)\r\n")
            append(
                "Content-Disposition: form-data; name=\"preview\"; " +
                    "filename=\"\(AttachmentPreview.fileName)\"\r\n"
            )
            append("Content-Type: image/jpeg\r\n\r\n")
            body.append(preview)
        }

        append("\r\n--\(boundary)--\r\n")
        return body
    }

    private func decodeAttachment(_ response: UploadResponse) throws -> Attachment {
        guard (200 ..< 300).contains(response.status) else {
            let parsed = try? JSONDecoder().decode(ErrorEnvelope.self, from: response.data)
            throw ApiError(
                code: parsed?.error.code ?? ApiErrorCode.internalError,
                message: parsed?.error.message
                    ?? AppStrings.translate(
                        locale,
                        "thread.somethingWentWrongStatus",
                        ["status": String(response.status)]
                    ),
                httpStatus: response.status
            )
        }
        return try JSONDecoder().decode(Attachment.self, from: response.data)
    }
}
