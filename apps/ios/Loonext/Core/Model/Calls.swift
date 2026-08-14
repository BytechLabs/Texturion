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
    /// #367: what the caller said, pulled out of the transcript. Extraction
    /// only, never a judgement about urgency, and nil whenever there is nothing
    /// to show. A plain Optional for the same reason `state` is one — a cached
    /// payload written before this column decodes to nil rather than throwing.
    var voicemail_intake: VoicemailIntake? = nil
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

/// #367 depth (1) — what the caller said, from `calls.voicemail_intake`.
///
/// Hand-port of `packages/shared/src/voicemail-intake.ts`. Every field is
/// something the caller SAID: nothing here is a classification, and there is
/// deliberately no urgency field to render — an AI that mishandles an emergency
/// is worse than voicemail, so it is never asked.
struct VoicemailIntake: Codable, Sendable, Equatable {
    var problem: String? = nil
    var address: String? = nil
    var callback: String? = nil
    var name: String? = nil
}

/// One rendered row: a stable key, the label, and the caller's words.
struct VoicemailIntakeLine: Identifiable, Equatable {
    let key: String
    let label: String
    let value: String

    var id: String { key }
}

/// The provenance label, per PORTAL-UX §3.1. The Lou mark beside it already says
/// a machine did this; these words say WHERE it read it, which is the half a
/// person can check against the transcript underneath.
let voicemailIntakeSourceKey = "domain.voicemailIntakeSource"

/// The English, for the callers that have not been handed a reader yet.
///
/// Computed rather than stored: a stored global in Swift 6 language mode brings
/// sendability and initialisation-order rules with it, and none of that is
/// worth carrying for a dictionary lookup.
var voicemailIntakeSourceLabel: String {
    AppStrings.translate(nil, voicemailIntakeSourceKey)
}

extension VoicemailIntake {
    /// The rows worth drawing: present fields, in a fixed order, empties dropped.
    ///
    /// Dropping rather than blanking is the part with consequences. A labelled
    /// empty row reports an absence as a finding — "Address" with nothing after
    /// it reads as though we looked and the caller gave none, when most
    /// voicemails simply do not contain most of these.
    ///
    /// Order matches web and Android: whether to go, then where, then how to
    /// reach them.
    var lines: [VoicemailIntakeLine] { localisedLines() }

    /// The same rows, in the reader's language.
    ///
    /// #228. A property cannot take a parameter, so the reader's language needs
    /// a function — and it is a DIFFERENT NAME rather than an overload of
    /// `lines`. Whether Swift accepts a property and a method sharing one base
    /// name in one type is a question this repo cannot answer locally: Swift
    /// compiles only in CI's `Gate / iOS`, and there is no precedent for the
    /// pair anywhere in this app to copy. A distinct name has no such question
    /// attached, and `lines` above keeps every call site that has not been
    /// handed a reader compiling and rendering exactly what it did before.
    func localisedLines(_ locale: String? = nil) -> [VoicemailIntakeLine] {
        let fields: [(String, String, String?)] = [
            ("problem", AppStrings.translate(locale, "domain.voicemailIntakeProblem"), problem),
            ("address", AppStrings.translate(locale, "domain.voicemailIntakeAddress"), address),
            ("callback", AppStrings.translate(locale, "domain.voicemailIntakeCallback"), callback),
            ("name", AppStrings.translate(locale, "domain.voicemailIntakeName"), name),
        ]
        return fields.compactMap { (key, label, raw) -> VoicemailIntakeLine? in
            let value = raw?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
            guard !value.isEmpty else { return nil }
            return VoicemailIntakeLine(key: key, label: label, value: value)
        }
    }
}

/// POST /v1/webrtc/token — Telnyx credential login token (≤24h).
struct WebRtcToken: Codable, Sendable {
    let token: String
    let sip_username: String
    @Default<DefaultHours24> var expires_in_hours: Int
}
