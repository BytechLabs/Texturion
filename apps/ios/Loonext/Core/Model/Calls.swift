import Foundation

enum CallOutcome {
    static let answered = "answered"
    static let voicemail = "voicemail"
    static let missed = "missed"
}

enum DefaultHours24: DefaultCodableProvider {
    static var defaultValue: Int { 24 }
}

/// GET /v1/calls row. `outcome` nil = in progress.
struct Call: Codable, Sendable {
    let id: String
    let call_session_id: String
    let caller_e164: String?
    let contact_id: String?
    let contact_name: String?
    let caller_name: String?
    let phone_number_id: String?
    let conversation_id: String?
    let outcome: String?
    let direction: String
    /// Talk time — 0 for misses, never ring time.
    @Default<DefaultZero> var forward_seconds: Int
    let screening_result: String?
    let stir_attestation: String?
    let voicemail_seconds: Int?
    let answered_by_user_id: String?
    let started_at: String

    /// Display resolution order: contact > CNAM dip > raw number.
    var displayName: String? {
        contact_name ?? caller_name ?? caller_e164
    }
}

/// POST /v1/webrtc/token — Telnyx credential login token (≤24h).
struct WebRtcToken: Codable, Sendable {
    let token: String
    let sip_username: String
    @Default<DefaultHours24> var expires_in_hours: Int
}
