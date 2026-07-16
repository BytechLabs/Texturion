import Foundation

/// Typed /v1 calls for the softphone's server side: token mint, outbound
/// authorization, live-call ops, log/voicemail reads. Mirrors the Android
/// `telephony/CallsApi.kt` + `features/calls/CallsData.kt` twins.
///
/// Wire models that Core/Model doesn't carry yet live here (extension models
/// per the mobile build rules — flagged for the integrator to hoist into
/// Core/Model when convenient). Property names ARE the wire names
/// (CodableDefaults.swift rule).

/// POST /v1/calls/browser response — client_state goes into newCall VERBATIM
/// (see `ClientState` for the iOS SDK boundary rule).
struct BrowserCallAuth: Codable, Sendable {
    let from: String
    let to: String
    let client_state: String
}

struct OutboundCallBody: Codable, Sendable {
    let conversation_id: String?
    let contact_id: String?
    let to: String?
    let phone_number_id: String?
}

/// GET /v1/calls/live/by-leg/:ccid — ring leg -> customer session.
struct LegResolution: Codable, Sendable {
    let call_session_id: String
}

/// GET /v1/calls/live/:sessionId — the call bar facts (notes deep-link).
struct LiveCallFacts: Codable, Sendable {
    let conversation_id: String?
    let caller_e164: String?
}

struct TransferTarget: Codable, Sendable {
    let user_id: String
    @Default<DefaultFalse> var busy: Bool
}

struct TransferTargets: Codable, Sendable {
    @Default<DefaultEmptyList<TransferTarget>> var targets: [TransferTarget]
}

struct TransferAck: Codable, Sendable {
    let status: String
}

struct RingAck: Codable, Sendable {
    let ok: Bool
}

/// GET /v1/calls/:sessionId/voicemail — a short-lived (1h) signed URL. Minted
/// per playback and NEVER cached/persisted (SPEC: signed attachment URLs are
/// always fetched on view).
struct VoicemailPlayback: Codable, Sendable {
    let url: String
    @Default<DefaultZero> var seconds: Int
}

private struct TransferBody: Codable, Sendable {
    let target_user_id: String
}

/// The endpoints `SoftphoneCore` drives — a protocol seam so the core's
/// orchestration unit-tests against a fake without URL stubbing.
protocol CallsBackend: Sendable {
    /// Mint the Telnyx login token — on start/recovery ONLY (rate-limited).
    func mintToken(companyId: String) async throws -> WebRtcToken

    /// Authorize an outbound call (all gates run server-side; no dial yet).
    func authorizeBrowserCall(
        companyId: String,
        conversationId: String?,
        contactId: String?,
        to: String?,
        phoneNumberId: String?
    ) async throws -> BrowserCallAuth

    /// Resolve an answered inbound RING leg to the customer call_session_id —
    /// REQUIRED before any live-call op on an inbound answer (the ring leg has
    /// its own session; acting on it addresses the wrong call).
    func resolveByLeg(companyId: String, legCcid: String) async throws -> LegResolution

    func liveFacts(companyId: String, sessionId: String) async throws -> LiveCallFacts

    func transferTargets(companyId: String, sessionId: String) async throws -> TransferTargets

    func blindTransfer(
        companyId: String,
        sessionId: String,
        targetUserId: String
    ) async throws -> TransferAck

    /// Push-to-wake part 2: re-ring THIS member for a still-ringing call.
    func ringMe(companyId: String, sessionId: String) async throws -> RingAck
}

/// The real backend over `ApiClient`, plus the calls tab's typed reads.
struct CallsService: CallsBackend {
    let api: ApiClient

    func mintToken(companyId: String) async throws -> WebRtcToken {
        try await api.post("/v1/webrtc/token", companyId: companyId)
    }

    func authorizeBrowserCall(
        companyId: String,
        conversationId: String? = nil,
        contactId: String? = nil,
        to: String? = nil,
        phoneNumberId: String? = nil
    ) async throws -> BrowserCallAuth {
        try await api.post(
            "/v1/calls/browser",
            body: OutboundCallBody(
                conversation_id: conversationId,
                contact_id: contactId,
                to: to,
                phone_number_id: phoneNumberId
            ),
            companyId: companyId
        )
    }

    func resolveByLeg(companyId: String, legCcid: String) async throws -> LegResolution {
        try await api.get("/v1/calls/live/by-leg/\(legCcid)", companyId: companyId)
    }

    func liveFacts(companyId: String, sessionId: String) async throws -> LiveCallFacts {
        try await api.get("/v1/calls/live/\(sessionId)", companyId: companyId)
    }

    func transferTargets(companyId: String, sessionId: String) async throws -> TransferTargets {
        try await api.get("/v1/calls/live/\(sessionId)/targets", companyId: companyId)
    }

    func blindTransfer(
        companyId: String,
        sessionId: String,
        targetUserId: String
    ) async throws -> TransferAck {
        try await api.post(
            "/v1/calls/live/\(sessionId)/transfer",
            body: TransferBody(target_user_id: targetUserId),
            companyId: companyId
        )
    }

    func ringMe(companyId: String, sessionId: String) async throws -> RingAck {
        try await api.post("/v1/calls/live/\(sessionId)/ring-me", companyId: companyId)
    }

    // MARK: - Calls tab reads (not part of the core seam)

    /// Company call log, newest first, cursor-paged, #106-filtered in SQL.
    func calls(
        companyId: String,
        outcome: String? = nil,
        cursor: String? = nil,
        limit: Int = 25
    ) async throws -> Page<Call> {
        try await api.get(
            "/v1/calls",
            query: [
                "outcome": outcome,
                "cursor": cursor,
                "limit": String(limit),
            ],
            companyId: companyId
        )
    }

    /// Mint a fresh signed playback URL — on demand, per view.
    func voicemail(companyId: String, sessionId: String) async throws -> VoicemailPlayback {
        try await api.get("/v1/calls/\(sessionId)/voicemail", companyId: companyId)
    }

    /// Member display names for the transfer picker (targets are id-only).
    func members(companyId: String) async throws -> Page<Member> {
        try await api.get(
            "/v1/members",
            query: ["limit": "100"],
            companyId: companyId
        )
    }
}
