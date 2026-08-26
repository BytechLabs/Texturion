import Foundation

/// SPEC §7 error envelope: `{ error: { code, message } }`.
struct ErrorEnvelope: Decodable {
    struct Body: Decodable {
        let code: String
        let message: String
        /// Optional catalogue copy preferred over the legacy English sentence.
        let message_key: String?
        let message_vars: [String: String]?
        /// #555: the Cloudflare ray the server already puts on a 500, and which
        /// every client dropped.
        ///
        /// `apps/api/src/http/errors.ts` has been sending it for as long as the
        /// envelope has existed. Without it a real server error and a response this
        /// build could not decode are indistinguishable on a phone — the 500's
        /// message is the literal string "Something went wrong.", the same words
        /// the decode fallback used — so the founder reported two different bugs
        /// (#549, #551) as one symptom, and neither report could carry the one
        /// identifier that finds the failure in the logs.
        let request_id: String?
    }

    let error: Body
}

/// Structural codes the client branches on (never sniff messages).
enum ApiErrorCode {
    static let unauthorized = "unauthorized"
    static let forbidden = "forbidden"
    static let subscriptionInactive = "subscription_inactive"
    static let usageCapReached = "usage_cap_reached"
    static let registrationPending = "registration_pending"
    static let recipientOptedOut = "recipient_opted_out"
    static let validationFailed = "validation_failed"
    static let notFound = "not_found"
    static let conflict = "conflict"
    static let quietHoursConfirmationRequired = "quiet_hours_confirmation_required"
    static let rateLimited = "rate_limited"
    /// #314: the WORKSPACE requires a second factor, the grace window has
    /// passed, and this session has none. Routed to the gate, never shown as an
    /// error — a wall with no explanation is a lockout.
    static let mfaRequired = "mfa_required"
    /// #496: this person HOLDS a factor and this session is aal1. The opposite
    /// remedy to `mfaRequired`: they need to enter a CODE, not enrol. Offering
    /// enrolment here invites a SECOND factor to fix being asked for the first.
    static let mfaChallengeRequired = "mfa_challenge_required"
    /// #283: a subsystem is switched off at the runtime kill switch. Temporary
    /// and nobody's fault, so the copy is "paused, try shortly" — never "you
    /// cannot do this".
    static let serviceUnavailable = "service_unavailable"
    static let internalError = "internal_error"
    /// Client-side code for transport failures (no HTTP response at all).
    static let network = "network"
}

struct ApiError: Error, LocalizedError {
    let code: String
    let message: String
    let httpStatus: Int
    /// #555: the server's own reference for this failure, when it sent one.
    var requestId: String? = nil
    /// #228 — WHOSE SENTENCE THIS IS.
    ///
    /// Nil means the SERVER wrote it: the message came off the
    /// `{ error: { code, message } }` envelope, composed in English at one of
    /// 370 call sites. An English reader gets it verbatim and that is right —
    /// it is specific in a way no per-code sentence can be. A reader in another
    /// language gets the CODE's sentence from the catalogue instead, because
    /// the English one carries nothing they can use. `Error.userMessage` holds
    /// that rule; this field only says whose words they were.
    ///
    /// Non-null means WE wrote it — a transport failure, an expired session, a
    /// refusal this app decided alone. Those are ours to translate, and every
    /// one of them reached a French reader in English.
    ///
    /// The English `message` stays either way: it is what a crash log shows,
    /// where a catalogue key would say nothing. Twin of Android's
    /// `ApiException.messageKey`.
    var messageKey: String? = nil
    /// Values for a `{name}` inside [messageKey]'s sentence.
    var messageVars: [String: String] = [:]

    var errorDescription: String? { message }
}

/// A 200 whose body did not match this build's model.
///
/// #555 — the founder tapped a call entry and got "Something went wrong, try
/// again". On Android the cause was one nullable column arriving as an explicit
/// null, and the reason was discarded because a decode failure was not an
/// `ApiError` and so fell through to the generic line. iOS had the identical
/// anonymity: `JSONDecoder` throws a plain `DecodingError`, which is not an
/// `ApiError`, so `userMessage` said the same nine words with nothing recorded.
///
/// This is the type that lets the sentence and the diagnostic be different things.
struct ApiDecodeError: Error, LocalizedError {
    let path: String
    let summary: String

    var errorDescription: String? { "Response for \(path) did not match the client model" }
}

/// What a decode failure is allowed to say out loud.
///
/// THE FIELD PATH IS THE WHOLE DIAGNOSTIC, and the value never was. Knowing that
/// `spam_signals` arrived as a null is what fixes the bug; knowing what the
/// customer wrote adds nothing to it.
///
/// Stricter than the Android twin on purpose. `RecentErrors` there at least
/// redacts phone numbers and emails; `DiagnosticsLog` here only TRUNCATES, and
/// its contents ride into a support email from Settings > Help. So nothing but
/// the case name and the coding path is ever built into this string —
/// `Context.debugDescription` is deliberately never read, because for a corrupted
/// payload it can quote the payload.
func decodeSummary(_ error: Error) -> String {
    guard let decoding = error as? DecodingError else {
        return String(describing: type(of: error))
    }
    func path(_ context: DecodingError.Context) -> String {
        let keys = context.codingPath.map(\.stringValue)
        return keys.isEmpty ? "(root)" : keys.joined(separator: ".")
    }
    switch decoding {
    case let .keyNotFound(key, context):
        return "missing \(path(context)).\(key.stringValue)"
    case let .valueNotFound(_, context):
        return "null at \(path(context))"
    case let .typeMismatch(_, context):
        return "wrong type at \(path(context))"
    case let .dataCorrupted(context):
        return "corrupted at \(path(context))"
    @unknown default:
        return "decode failed"
    }
}
