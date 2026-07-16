import Foundation

struct Member: Codable, Sendable {
    let id: String
    let user_id: String
    let role: String
    let deactivated_at: String?
    let created_at: String
    @Default<DefaultEmptyString> var display_name: String
}

struct Invite: Codable, Sendable {
    let id: String
    let company_id: String
    let email: String
    let role: String
    let invited_by: String
    let expires_at: String
    let accepted_at: String?
    let revoked_at: String?
    let created_at: String
    /// POST /v1/invites only: false = send failed, fall back to Copy link.
    let email_sent: Bool?
    /// GET /v1/invites/mine only: inviting company's name for the banner.
    let company_name: String?
}

/// POST /v1/invites/accept response (member row + company_id).
struct AcceptedInvite: Codable, Sendable {
    let id: String
    let user_id: String
    let role: String
    let deactivated_at: String?
    let created_at: String
    let company_id: String
}
