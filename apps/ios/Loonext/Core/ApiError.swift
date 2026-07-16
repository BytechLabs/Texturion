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
