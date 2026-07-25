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
    /// What the voicemail says, written best-effort after the recording is
    /// stored. Nil means it was not transcribed (turned off, over the monthly
    /// cap, too long, or the model failed) and is never a reason to hide the
    /// audio.
    var voicemail_transcript: String? = nil
    let answered_by_user_id: String?
    /// #191: server-resolved display name of the acting member — the PLACER of
    /// an outbound call, the ANSWERER of an inbound one (both land in
    /// `answered_by_user_id`). Optional so pre-#191 rows decode cleanly.
    var answered_by_name: String?
    let started_at: String
    /// #170/#208 CALLS-V3 §3/§8.4: the DO-mirrored live phase — "ringing",
    /// "answered", "voicemail_greeting", "voicemail_recording" or an
    /// "ended_*" terminal. NULLABLE by design (legacy rows and every outbound
    /// row carry none), so readers derive from `outcome` when it is absent.
    /// A plain Optional rather than `@Default` for the same reason
    /// `answered_by_name` is one: the synthesized decoder reads an Optional
    /// with `decodeIfPresent`, so a cached pre-v3 payload missing the key
    /// decodes to nil instead of throwing.
    var state: String? = nil
    /// #210: when a member picked up — the Ongoing card's live-duration
    /// anchor. Absent on rows written before the api_list_calls projection
    /// shipped it; readers fall back to `started_at`.
    var answered_at: String? = nil

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
