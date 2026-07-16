import Foundation

/// All /v1 settings/billing/numbers endpoints (#163). Request shapes verified
/// against apps/api/src/routes/{companies,team,numbers,available-numbers,
/// billing,usage,porting,text-enablement,registration}.ts and the Android
/// twin's SettingsRepository.kt. (Notification prefs live with #162's
/// NotificationsFeedApi — the settings screen hosts that card.)
///
/// Company PATCH bodies are hand-built `JSONValue` objects so an explicit
/// `null` (clear this message) survives serialization — `JSONValue.null`
/// encodes as JSON `null` under its key.
struct SettingsRepository: Sendable {
    let api: ApiClient
    let sessionStore: SessionStore
    var baseURL: URL = AppConfig.apiURL

    // MARK: - Company

    func company(_ companyId: String) async throws -> CompanyView {
        try await api.get("/v1/company", companyId: companyId)
    }

    /// PATCH /v1/company — returns the updated scalar columns as a view.
    func updateCompany(_ companyId: String, patch: JSONValue) async throws -> CompanyView {
        try await api.patch("/v1/company", body: patch, companyId: companyId)
    }

    func usage(_ companyId: String) async throws -> Usage {
        try await api.get("/v1/usage", companyId: companyId)
    }

    // MARK: - Team

    func members(_ companyId: String) async throws -> Page<Member> {
        try await api.get("/v1/members", companyId: companyId)
    }

    func setMemberRole(_ companyId: String, memberId: String, role: String) async throws -> Member {
        try await api.patch(
            "/v1/members/\(memberId)",
            body: JSONValue.object(["role": .string(role)]),
            companyId: companyId
        )
    }

    func deactivateMember(_ companyId: String, memberId: String) async throws {
        try await api.delete("/v1/members/\(memberId)", companyId: companyId)
    }

    func invites(_ companyId: String) async throws -> Page<Invite> {
        try await api.get("/v1/invites", companyId: companyId)
    }

    func createInvite(_ companyId: String, email: String, role: String) async throws -> Invite {
        try await api.post(
            "/v1/invites",
            body: JSONValue.object(["email": .string(email), "role": .string(role)]),
            companyId: companyId
        )
    }

    func revokeInvite(_ companyId: String, inviteId: String) async throws {
        try await api.delete("/v1/invites/\(inviteId)", companyId: companyId)
    }

    // MARK: - Numbers

    func numbers(_ companyId: String) async throws -> Page<PhoneNumberSummary> {
        try await api.get("/v1/numbers", companyId: companyId)
    }

    func availableNumbers(
        country: String,
        areaCode: String? = nil,
        bestEffort: Bool = false,
        limit: Int = 50
    ) async throws -> AvailableNumbersResult {
        try await api.get(
            "/v1/available-numbers",
            query: [
                "country": country,
                "area_code": areaCode,
                "best_effort": bestEffort ? "true" : nil,
                "limit": String(limit),
            ],
            // Company-exempt route (the onboarding number step runs pre-company).
            companyId: nil
        )
    }

    /// POST /v1/numbers/provision — Idempotency-Key REQUIRED (per intent).
    func provisionNumber(
        _ companyId: String,
        idempotencyKey: String,
        chosenNumberE164: String? = nil,
        requestedAreaCode: String? = nil
    ) async throws -> PhoneNumberSummary {
        try await api.post(
            "/v1/numbers/provision",
            body: numberChoiceBody(chosenNumberE164: chosenNumberE164, requestedAreaCode: requestedAreaCode),
            companyId: companyId,
            idempotencyKey: idempotencyKey
        )
    }

    /// POST /v1/numbers/:id/remediate — re-arm a failed row, no new charge.
    func remediateNumber(
        _ companyId: String,
        numberId: String,
        chosenNumberE164: String? = nil,
        requestedAreaCode: String? = nil
    ) async throws -> PhoneNumberSummary {
        try await api.post(
            "/v1/numbers/\(numberId)/remediate",
            body: numberChoiceBody(chosenNumberE164: chosenNumberE164, requestedAreaCode: requestedAreaCode),
            companyId: companyId
        )
    }

    private func numberChoiceBody(chosenNumberE164: String?, requestedAreaCode: String?) -> JSONValue {
        if let chosenNumberE164 {
            return .object(["chosen_number_e164": .string(chosenNumberE164)])
        }
        return .object(["requested_area_code": .string(requestedAreaCode ?? "")])
    }

    /// DELETE /v1/numbers/:id — owner-only; returns the released row.
    func releaseNumber(_ companyId: String, numberId: String) async throws -> PhoneNumberSummary {
        let data = try await api.raw("DELETE", "/v1/numbers/\(numberId)", companyId: companyId)
        return try JSONDecoder().decode(PhoneNumberSummary.self, from: data)
    }

    func numberAccess(_ companyId: String, numberId: String) async throws -> NumberAccess {
        try await api.get("/v1/numbers/\(numberId)/access", companyId: companyId)
    }

    func setNumberAccess(
        _ companyId: String,
        numberId: String,
        body: JSONValue
    ) async throws -> NumberAccess {
        try await api.put("/v1/numbers/\(numberId)/access", body: body, companyId: companyId)
    }

    // MARK: - Port-in

    func ports(_ companyId: String) async throws -> Page<PortRequest> {
        try await api.get("/v1/port-requests", companyId: companyId)
    }

    func checkPortability(_ companyId: String, phoneE164: String) async throws -> PortabilityCheck {
        try await api.post(
            "/v1/port-requests/check",
            body: JSONValue.object(["phone_e164": .string(phoneE164)]),
            companyId: companyId
        )
    }

    /// POST /v1/port-requests — Idempotency-Key REQUIRED (per intent).
    func createPort(
        _ companyId: String,
        idempotencyKey: String,
        body: JSONValue
    ) async throws -> PortRequest {
        try await api.post(
            "/v1/port-requests",
            body: body,
            companyId: companyId,
            idempotencyKey: idempotencyKey
        )
    }

    /// PUT /v1/port-requests/:id — fix-and-resubmit edits (draft/exception).
    func updatePort(_ companyId: String, portId: String, body: JSONValue) async throws -> PortRequest {
        try await api.put("/v1/port-requests/\(portId)", body: body, companyId: companyId)
    }

    func uploadPortDocuments(
        _ companyId: String,
        portId: String,
        parts: [DocumentUpload]
    ) async throws -> PortRequest {
        let data = try await multipartPut(
            path: "/v1/port-requests/\(portId)/documents",
            companyId: companyId,
            parts: parts
        )
        return try JSONDecoder().decode(PortRequest.self, from: data)
    }

    func submitPort(_ companyId: String, portId: String) async throws -> PortRequest {
        try await api.post("/v1/port-requests/\(portId)/submit", companyId: companyId)
    }

    func resubmitPort(_ companyId: String, portId: String) async throws -> PortRequest {
        try await api.post("/v1/port-requests/\(portId)/resubmit", companyId: companyId)
    }

    /// Owner-only.
    func cancelPort(_ companyId: String, portId: String) async throws -> PortRequest {
        try await api.post("/v1/port-requests/\(portId)/cancel", companyId: companyId)
    }

    // MARK: - Text-enablement

    func textEnablements(_ companyId: String) async throws -> Page<TextEnablementOrder> {
        try await api.get("/v1/text-enablements", companyId: companyId)
    }

    /// POST /v1/text-enablements — Idempotency-Key REQUIRED (per intent).
    func createTextEnablement(
        _ companyId: String,
        idempotencyKey: String,
        phoneE164: String
    ) async throws -> TextEnablementOrder {
        try await api.post(
            "/v1/text-enablements",
            body: JSONValue.object(["phone_e164": .string(phoneE164)]),
            companyId: companyId,
            idempotencyKey: idempotencyKey
        )
    }

    func uploadTextEnablementDocuments(
        _ companyId: String,
        orderId: String,
        parts: [DocumentUpload]
    ) async throws -> TextEnablementOrder {
        let data = try await multipartPut(
            path: "/v1/text-enablements/\(orderId)/documents",
            companyId: companyId,
            parts: parts
        )
        return try JSONDecoder().decode(TextEnablementOrder.self, from: data)
    }

    func resubmitTextEnablement(_ companyId: String, orderId: String) async throws -> TextEnablementOrder {
        try await api.post("/v1/text-enablements/\(orderId)/resubmit", companyId: companyId)
    }

    func requestVerificationCode(
        _ companyId: String,
        orderId: String,
        method: String
    ) async throws -> TextEnablementOrder {
        try await api.post(
            "/v1/text-enablements/\(orderId)/verification-codes",
            body: JSONValue.object(["verification_method": .string(method)]),
            companyId: companyId
        )
    }

    func submitVerificationCode(
        _ companyId: String,
        orderId: String,
        code: String
    ) async throws -> TextEnablementOrder {
        try await api.post(
            "/v1/text-enablements/\(orderId)/verification-codes/verify",
            body: JSONValue.object(["code": .string(code)]),
            companyId: companyId
        )
    }

    /// Owner-only.
    func cancelTextEnablement(_ companyId: String, orderId: String) async throws -> TextEnablementOrder {
        try await api.post("/v1/text-enablements/\(orderId)/cancel", companyId: companyId)
    }

    // MARK: - 10DLC registration

    func registration(_ companyId: String) async throws -> RegistrationDetailPair {
        try await api.get("/v1/registration", companyId: companyId)
    }

    /// First-submission recovery and rejected-resubmit.
    func submitRegistration(_ companyId: String) async throws -> RegistrationDetailPair {
        try await api.post("/v1/registration/submit", companyId: companyId)
    }

    /// Sole-proprietor SMS OTP verification.
    func verifyRegistrationOtp(_ companyId: String, code: String) async throws -> RegistrationDetailPair {
        try await api.post(
            "/v1/registration/otp",
            body: JSONValue.object(["code": .string(code)]),
            companyId: companyId
        )
    }

    func resendRegistrationOtp(_ companyId: String) async throws {
        let _: JSONValue = try await api.post("/v1/registration/otp/resend", companyId: companyId)
    }

    // MARK: - Billing

    func modules(_ companyId: String) async throws -> BillingModules {
        try await api.get("/v1/billing/modules", companyId: companyId)
    }

    func setModule(_ companyId: String, module: String, enabled: Bool) async throws {
        let _: JSONValue = try await api.post(
            "/v1/billing/modules",
            body: JSONValue.object(["module": .string(module), "enabled": .bool(enabled)]),
            companyId: companyId
        )
    }

    func changePlan(_ companyId: String, plan: String) async throws -> ChangePlanResult {
        try await api.post(
            "/v1/billing/change-plan",
            body: JSONValue.object(["plan": .string(plan)]),
            companyId: companyId
        )
    }

    /// Hosted Stripe Billing Portal URL — open in an EXTERNAL browser.
    func billingPortal(_ companyId: String) async throws -> HostedUrl {
        try await api.post("/v1/billing/portal", companyId: companyId)
    }

    /// Hosted Stripe Checkout URL (resubscribe) — EXTERNAL browser only.
    func checkout(_ companyId: String, plan: String) async throws -> HostedUrl {
        try await api.post(
            "/v1/billing/checkout",
            body: JSONValue.object(["plan": .string(plan)]),
            companyId: companyId
        )
    }

    // MARK: - Token access (GoTrue account ops + multipart)

    /// A non-expired Supabase access token. When the stored token is stale,
    /// this routes through `ApiClient`'s single-flight refresh (via a cheap
    /// company-exempt read) instead of refreshing here — two refreshers racing
    /// would burn the rotated refresh token and kill the session.
    func freshAccessToken() async throws -> String {
        if let session = sessionStore.current(), !session.isExpired {
            return session.accessToken
        }
        let _: Me = try await api.get("/v1/me")
        guard let session = sessionStore.current() else {
            throw ApiError(code: ApiErrorCode.unauthorized, message: "You're signed out.", httpStatus: 401)
        }
        return session.accessToken
    }

    // MARK: - Multipart

    /// Multipart PUT for the document-upload routes. `ApiClient.raw` only
    /// carries JSON bodies (it stamps Content-Type: application/json), so this
    /// builds its own URLRequest with the same bearer and decodes failures
    /// through the same SPEC §7 envelope.
    private func multipartPut(
        path: String,
        companyId: String,
        parts: [DocumentUpload]
    ) async throws -> Data {
        let token = try await freshAccessToken()
        let boundary = "loonext-\(UUID().uuidString)"
        var body = Data()
        for part in parts {
            let safeName = part.fileName
                .replacingOccurrences(of: "\"", with: "")
                .replacingOccurrences(of: "\r", with: "")
                .replacingOccurrences(of: "\n", with: "")
            body.append(Data("--\(boundary)\r\n".utf8))
            body.append(Data(
                "Content-Disposition: form-data; name=\"\(part.fieldName)\"; filename=\"\(safeName)\"\r\n".utf8
            ))
            body.append(Data("Content-Type: \(part.mimeType)\r\n\r\n".utf8))
            body.append(part.bytes)
            body.append(Data("\r\n".utf8))
        }
        body.append(Data("--\(boundary)--\r\n".utf8))

        var request = URLRequest(url: baseURL.appending(path: path))
        request.httpMethod = "PUT"
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        request.setValue(companyId, forHTTPHeaderField: "X-Company-Id")
        request.setValue("multipart/form-data; boundary=\(boundary)", forHTTPHeaderField: "Content-Type")
        request.httpBody = body

        let data: Data
        let response: URLResponse
        do {
            (data, response) = try await URLSession.shared.data(for: request)
        } catch {
            throw ApiError(
                code: ApiErrorCode.network,
                message: "Can't reach Loonext. Check your connection.",
                httpStatus: 0
            )
        }
        let status = (response as? HTTPURLResponse)?.statusCode ?? 0
        guard (200 ..< 300).contains(status) else {
            let parsed = try? JSONDecoder().decode(ErrorEnvelope.self, from: data)
            throw ApiError(
                code: parsed?.error.code ?? ApiErrorCode.internalError,
                message: parsed?.error.message ?? "Something went wrong (\(status)).",
                httpStatus: status
            )
        }
        return data
    }
}
