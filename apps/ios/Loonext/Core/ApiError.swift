import Foundation

/// SPEC §7 error envelope: `{ error: { code, message } }`.
struct ErrorEnvelope: Decodable {
    struct Body: Decodable {
        let code: String
        let message: String
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

    var errorDescription: String? { message }
}
